import nodemailer from 'nodemailer';
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import {
  hashPassword,
  verifyPassword,
  aesEncrypt,
  aesDecrypt,
  signToken,
  verifyToken,
  randomTicketCode,
} from './lib/crypto'
import adminTicketingHtml from './pages/admin-ticketing.html?raw'
import gateVerifierHtml from './pages/gate-verifier.html?raw'
import adminDashboardHtml from './pages/admin-dashboard.html?raw'

type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
  AES_SECRET?: string
}

type AuthUser = {
  id: number
  username: string
  full_name: string | null
  role: 'super' | 'counter' | 'gate'
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUS_POINTS = [
  'ভালুকা', 'মাওনা', 'রাজেন্দ্রপুর', 'শিববাড়ি', 'শিমুলতলী', 'চন্দ্রা',
  'কোনাবাড়ি', 'সাভার', 'শ্রীপুর', 'নরসিংদী', 'কালিগঞ্জ', 'চাষাড়া',
  'বাসাবো', 'স্টাফ কোয়ার্টার', 'মোহাম্মদপুর', 'মিরপুর ইসিবি', 'মিরপুর ১৪',
  'মিরপুর ১২', 'মিরপুর ১০', 'মহাখালী', 'টঙ্গী কলেজ গেট', 'ঘোড়াশাল',
  'শিববাড়ি ডুয়েট', 'উত্তরা',
]

const BUS_CAPACITY = 40 // seats per bus, used for progress-bar visualization

function getSecret(c: any, key: 'JWT_SECRET' | 'AES_SECRET'): string {
  const fromEnv = c.env?.[key]
  if (fromEnv) return fromEnv
  // Fallback demo secrets so the app works out-of-the-box in local/dev mode.
  // IMPORTANT: For production, set real secrets via `wrangler secret put JWT_SECRET` / `AES_SECRET`.
  return key === 'JWT_SECRET'
    ? 'binary-fest-2026-default-jwt-secret-change-me'
    : 'binary-fest-2026-default-aes-secret-change-me'
}

// ---------------------------------------------------------------------------
// Auth helpers / middleware
// ---------------------------------------------------------------------------

async function getAuthUser(c: any): Promise<AuthUser | null> {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null
  const secret = getSecret(c, 'JWT_SECRET')
  const payload = await verifyToken<AuthUser & { exp: number }>(token, secret)
  if (!payload) return null
  return { id: payload.id, username: payload.username, full_name: payload.full_name, role: payload.role }
}

function requireAuth(...roles: Array<'super' | 'counter' | 'gate'>) {
  return async (c: any, next: any) => {
    const user = await getAuthUser(c)
    if (!user) return c.json({ error: 'Unauthorized. Please log in.' }, 401)
    if (roles.length && !roles.includes(user.role)) {
      return c.json({ error: 'Forbidden. Insufficient permissions.' }, 403)
    }
    c.set('user', user)
    await next()
  }
}

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------

// Register a new issuer account (counter or gate). Requires super-admin approval before login works.
app.post('/api/auth/register', async (c) => {
  const { env } = c
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const { username, password, full_name, role } = body as {
    username?: string
    password?: string
    full_name?: string
    role?: string
  }

  if (!username || !password || !role) {
    return c.json({ error: 'username, password and role are required' }, 400)
  }
  if (!['counter', 'gate'].includes(role)) {
    return c.json({ error: 'role must be counter or gate' }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }

  const existing = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(username).first()
  if (existing) {
    return c.json({ error: 'Username already taken' }, 409)
  }

  const { hash, salt } = await hashPassword(password)

  await env.DB.prepare(
    `INSERT INTO admins (username, full_name, password_hash, password_salt, role, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ).bind(username, full_name || username, hash, salt, role).run()

  return c.json({
    success: true,
    message: 'Registration submitted. Please wait for super-admin approval before logging in.',
  })
})

app.post('/api/auth/login', async (c) => {
  const { env } = c
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)
  const { username, password } = body as { username?: string; password?: string }
  if (!username || !password) return c.json({ error: 'username and password are required' }, 400)

  const row = await env.DB.prepare(
    'SELECT id, username, full_name, password_hash, password_salt, role, status FROM admins WHERE username = ?'
  ).bind(username).first<any>()

  if (!row) return c.json({ error: 'Invalid username or password' }, 401)

  const valid = await verifyPassword(password, row.password_salt, row.password_hash)
  if (!valid) return c.json({ error: 'Invalid username or password' }, 401)

  if (row.status !== 'approved') {
    return c.json({ error: 'Your account is pending super-admin approval.', status: row.status }, 403)
  }

  const secret = getSecret(c, 'JWT_SECRET')
  const token = await signToken(
    {
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      role: row.role,
      exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
    },
    secret
  )

  return c.json({
    success: true,
    token,
    user: { id: row.id, username: row.username, full_name: row.full_name, role: row.role },
  })
})

app.get('/api/auth/me', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser
  return c.json({ user })
})

// ---------------------------------------------------------------------------
// ADMIN MANAGEMENT (super only)
// ---------------------------------------------------------------------------

app.get('/api/admin/list', requireAuth('super'), async (c) => {
  const { env } = c
  const { results } = await env.DB.prepare(
    `SELECT id, username, full_name, role, status, created_at, approved_at, approved_by
     FROM admins WHERE role != 'super' ORDER BY created_at DESC`
  ).all()
  return c.json({ admins: results })
})

app.post('/api/admin/approve/:id', requireAuth('super'), async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const user = c.get('user') as AuthUser
  await env.DB.prepare(
    `UPDATE admins SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?`
  ).bind(user.username, id).run()
  return c.json({ success: true })
})

app.post('/api/admin/reject/:id', requireAuth('super'), async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const user = c.get('user') as AuthUser
  await env.DB.prepare(
    `UPDATE admins SET status = 'rejected', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?`
  ).bind(user.username, id).run()
  return c.json({ success: true })
})

app.post('/api/admin/approve-all', requireAuth('super'), async (c) => {
  const { env } = c
  const user = c.get('user') as AuthUser
  await env.DB.prepare(
    `UPDATE admins SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE status = 'pending'`
  ).bind(user.username).run()
  return c.json({ success: true })
})

app.delete('/api/admin/:id', requireAuth('super'), async (c) => {
  const { env } = c
  const id = c.req.param('id')
  await env.DB.prepare(`DELETE FROM admins WHERE id = ? AND role != 'super'`).bind(id).run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// TICKETS
// ---------------------------------------------------------------------------

// Create a ticket (counter issuers + super admin)
app.post('/api/tickets', requireAuth('counter', 'super'), async (c) => {
  const { env } = c
  const user = c.get('user') as AuthUser
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const {
    name, university_id, university_email, category, batch, section, price, bus_point,
  } = body as Record<string, any>

  if (!name || !university_id || !university_email || !category || !bus_point) {
    return c.json({ error: 'name, university_id, university_email, category and bus_point are required' }, 400)
  }
  if (!['CSE', 'Others', 'Outsiders'].includes(category)) {
    return c.json({ error: 'Invalid category' }, 400)
  }
  if (!BUS_POINTS.includes(bus_point)) {
    return c.json({ error: 'Invalid bus pickup point' }, 400)
  }

  const ticketCode = randomTicketCode()
  const ticketPrice = typeof price === 'number' && price > 0 ? price : 1000

  const secret = getSecret(c, 'AES_SECRET')
  const qrPayload = await aesEncrypt(
    { tc: ticketCode, uid: university_id, iat: Date.now() },
    secret
  )

  await env.DB.prepare(
    `INSERT INTO tickets
      (ticket_code, name, university_id, university_email, category, batch, section, price, bus_point, qr_payload, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ticketCode, name, university_id, university_email, category,
    batch || null, section || null, ticketPrice, bus_point, qrPayload, user.username
  ).run()

  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE ticket_code = ?').bind(ticketCode).first()

  return c.json({ success: true, ticket })
})

// List tickets (super admin dashboard) with optional filters
app.get('/api/tickets', requireAuth('super'), async (c) => {
  const { env } = c
  const search = c.req.query('search')?.trim()
  const busPoint = c.req.query('bus_point')?.trim()
  const category = c.req.query('category')?.trim()

  let sql = 'SELECT * FROM tickets WHERE 1=1'
  const params: any[] = []

  if (search) {
    sql += ' AND (name LIKE ? OR university_id LIKE ? OR ticket_code LIKE ? OR university_email LIKE ?)'
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  if (busPoint) {
    sql += ' AND bus_point = ?'
    params.push(busPoint)
  }
  if (category) {
    sql += ' AND category = ?'
    params.push(category)
  }
  sql += ' ORDER BY created_at DESC'

  const { results } = await env.DB.prepare(sql).bind(...params).all()
  return c.json({ tickets: results })
})

app.get('/api/tickets/:id', requireAuth('super'), async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first()
  if (!ticket) return c.json({ error: 'Not found' }, 404)
  return c.json({ ticket })
})

app.put('/api/tickets/:id', requireAuth('super'), async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid request body' }, 400)

  const { name, university_id, university_email, category, batch, section, price, bus_point } = body as Record<string, any>

  const existing = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first<any>()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await env.DB.prepare(
    `UPDATE tickets SET name = ?, university_id = ?, university_email = ?, category = ?, batch = ?, section = ?, price = ?, bus_point = ?
     WHERE id = ?`
  ).bind(
    name ?? existing.name,
    university_id ?? existing.university_id,
    university_email ?? existing.university_email,
    category ?? existing.category,
    batch ?? existing.batch,
    section ?? existing.section,
    typeof price === 'number' ? price : existing.price,
    bus_point ?? existing.bus_point,
    id
  ).run()

  const updated = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first()
  return c.json({ success: true, ticket: updated })
})


// Auto-Attached Email Dispatch Endpoint
app.post('/api/tickets/:id/send-email', requireAuth('counter', 'super'), async (c) => {
  const { env } = c;
  const id = c.req.param('id');
  const { qr_image } = await c.req.json().catch(() => ({}));
  
  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE id = ? OR ticket_code = ?').bind(id, id).first<any>();
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  try {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });

    const attachments: any[] = [];
    if (qr_image && qr_image.includes('base64,')) {
      const base64Data = qr_image.split('base64,')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      attachments.push({
        filename: 'BinaryFest_QR_' + ticket.ticket_code + '.png',
        content: buffer,
        contentType: 'image/png',
        cid: 'qr_image_cid'
      });
    }

    const htmlBody = 
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #4338ca; color: #fff; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px;">Binary Fest 2026</h1>
          <p style="margin: 4px 0 0; font-size: 13px;">Official Event Pass &amp; QR Code Ticket</p>
        </div>
        <div style="padding: 24px; color: #334155; line-height: 1.6;">
          <p>Dear <strong>\</strong>,</p>
          <p>Your official ticket for <strong>Binary Fest 2026</strong> has been confirmed.</p>
          
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Ticket Code:</strong> <span style="color: #4338ca;">\</span></p>
            <p style="margin: 4px 0;"><strong>University ID:</strong> \</p>
            <p style="margin: 4px 0;"><strong>Category:</strong> \</p>
            <p style="margin: 4px 0;"><strong>Bus Pickup Point:</strong> \</p>
            <p style="margin: 4px 0;"><strong>Amount Paid:</strong> ৳\ (Receipt Confirmed)</p>
          </div>

          
          <p style="font-size: 13px; color: #1e40af; background: #eff6ff; padding: 10px; border-radius: 6px;">
            📌 <strong>Auto-Attached File:</strong> Your official <code>BinaryFest_QR_\.png</code> image is automatically attached to this email. Present it at the gate or bus door.
          </p>
        </div>
      </div>;

    const info = await transporter.sendMail({
      from: '"Binary Fest 2026" <tickets@binaryfest2026.org>',
      to: ticket.university_email,
      subject: '🎫 Binary Fest 2026 Ticket & QR Code - ' + ticket.ticket_code,
      html: htmlBody,
      attachments: attachments
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return c.json({
      success: true,
      message: 'Email sent successfully to ' + ticket.university_email + ' with QR Code auto-attached!',
      previewUrl: previewUrl || null
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to send email' }, 500);
  }
});

app.delete('/api/tickets/:id', requireAuth('super'), async (c) => {
  const { env } = c
  const id = c.req.param('id')
  await env.DB.prepare('DELETE FROM tickets WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// CSV export
app.get('/api/tickets-export/csv', requireAuth('super'), async (c) => {
  const { env } = c
  const { results } = await env.DB.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all<any>()

  const headers = [
    'ticket_code', 'name', 'university_id', 'university_email', 'category',
    'batch', 'section', 'price', 'bus_point', 'issued_by', 'boarded', 'boarded_at', 'boarded_by', 'created_at',
  ]
  const escape = (val: any) => {
    const s = val === null || val === undefined ? '' : String(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [headers.join(',')]
  for (const row of results) {
    lines.push(headers.map((h) => escape((row as any)[h])).join(','))
  }
  const csv = lines.join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="binary-fest-2026-tickets.csv"`,
    },
  })
})

// ---------------------------------------------------------------------------
// VERIFICATION (gate + super)
// ---------------------------------------------------------------------------

app.post('/api/verify', requireAuth('gate', 'super'), async (c) => {
  const { env } = c
  const body = await c.req.json().catch(() => null)
  if (!body || !body.qr_payload) return c.json({ error: 'qr_payload is required' }, 400)

  const secret = getSecret(c, 'AES_SECRET')
  const decrypted = await aesDecrypt<{ tc: string; uid: string; iat: number }>(body.qr_payload, secret)

  if (!decrypted || !decrypted.tc) {
    return c.json({ valid: false, message: 'INVALID OR FAKE TICKET DETECTED' }, 200)
  }

  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE ticket_code = ?').bind(decrypted.tc).first<any>()

  if (!ticket || ticket.qr_payload !== body.qr_payload) {
    return c.json({ valid: false, message: 'INVALID OR FAKE TICKET DETECTED' }, 200)
  }

  return c.json({ valid: true, message: 'VALID TICKET CONFIRMED', ticket })
})

app.post('/api/verify/board', requireAuth('gate', 'super'), async (c) => {
  const { env } = c
  const user = c.get('user') as AuthUser
  const body = await c.req.json().catch(() => null)
  if (!body || !body.ticket_code) return c.json({ error: 'ticket_code is required' }, 400)

  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE ticket_code = ?').bind(body.ticket_code).first<any>()
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  if (ticket.boarded) {
    return c.json({ success: false, message: 'This ticket has already been marked as boarded.', ticket })
  }

  await env.DB.prepare(
    `UPDATE tickets SET boarded = 1, boarded_at = CURRENT_TIMESTAMP, boarded_by = ? WHERE ticket_code = ?`
  ).bind(user.username, body.ticket_code).run()

  const updated = await env.DB.prepare('SELECT * FROM tickets WHERE ticket_code = ?').bind(body.ticket_code).first()
  return c.json({ success: true, ticket: updated })
})

// ---------------------------------------------------------------------------
// STATS (super only)
// ---------------------------------------------------------------------------

app.get('/api/stats', requireAuth('super'), async (c) => {
  const { env } = c

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) as total_tickets, COALESCE(SUM(price), 0) as total_revenue,
            COALESCE(SUM(boarded), 0) as boarded_count
     FROM tickets`
  ).first<any>()

  const issuerCount = await env.DB.prepare(
    `SELECT COUNT(*) as approved_issuers FROM admins WHERE role != 'super' AND status = 'approved'`
  ).first<any>()

  const { results: busRows } = await env.DB.prepare(
    `SELECT bus_point, COUNT(*) as count FROM tickets GROUP BY bus_point`
  ).all<any>()

  const busMap: Record<string, number> = {}
  for (const row of busRows) busMap[row.bus_point] = row.count

  const busBreakdown = BUS_POINTS.map((point) => ({
    point,
    count: busMap[point] || 0,
    capacity: BUS_CAPACITY,
  }))

  return c.json({
    total_revenue: totals.total_revenue,
    total_tickets: totals.total_tickets,
    boarded_count: totals.boarded_count,
    approved_issuers: issuerCount.approved_issuers,
    bus_breakdown: busBreakdown,
  })
})

app.get('/api/bus-points', (c) => c.json({ bus_points: BUS_POINTS }))

// ---------------------------------------------------------------------------
// Static assets (public/*.html served automatically by Cloudflare Pages)
// ---------------------------------------------------------------------------

app.use('/static/*', serveStatic({ root: './public' }))

app.get('/admin-ticketing.html', (c) => c.html(adminTicketingHtml))
app.get('/gate-verifier.html', (c) => c.html(gateVerifierHtml))
app.get('/admin-dashboard.html', (c) => c.html(adminDashboardHtml))

app.get('/counter', (c) => c.html(adminTicketingHtml))
app.get('/ticket', (c) => c.html(adminTicketingHtml))
app.get('/checker', (c) => c.html(gateVerifierHtml))
app.get('/gate', (c) => c.html(gateVerifierHtml))
app.get('/admin', (c) => c.html(adminDashboardHtml))
app.get('/', (c) => c.html(adminDashboardHtml))

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
