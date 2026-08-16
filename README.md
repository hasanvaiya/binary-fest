# Binary Fest 2026 — Ticketing System

## Project Overview
- **Name**: Binary Fest 2026 Ticketing & Bus Verification System
- **Goal**: Manage physical event ticket sales (counter), verify tickets at the gate/bus (QR scan), and give the organizing committee a real-time executive dashboard for revenue, bus allocation, and issuer approvals.
- **Core Features**:
  1. **Ticket Counter App** — manual data entry, live 1:1 QR preview, and server-side ticket creation.
  2. **Gate Verifier App** — camera-based QR scanning, AES-256-GCM decryption + live DB match, bus boarding confirmation.
  3. **Master Executive Dashboard** — live metrics, 24-point bus breakdown, issuer approval workflow, ticket edit/delete/CSV export, and 1-click Gmail/Outlook receipt email dispatch.

## URLs (local sandbox)
- **Ticket Counter**: `/admin-ticketing.html`
- **Gate Verifier**: `/gate-verifier.html`
- **Super Admin Dashboard**: `/admin-dashboard.html`
- **API base**: `/api/*` (see below)

> After deployment, replace the local base URL with your Cloudflare Pages production URL (e.g. `https://<project>.pages.dev`).

## API Endpoints
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Register a counter/gate issuer account (status = pending) |
| POST | `/api/auth/login` | public | Login, returns signed session token |
| GET | `/api/auth/me` | any logged-in | Current user info |
| GET | `/api/admin/list` | super | List all issuer accounts |
| POST | `/api/admin/approve/:id` | super | Approve one issuer |
| POST | `/api/admin/reject/:id` | super | Reject one issuer |
| POST | `/api/admin/approve-all` | super | Approve all pending issuers |
| DELETE | `/api/admin/:id` | super | Delete an issuer account |
| POST | `/api/tickets` | counter, super | Create a ticket (generates AES-256 encrypted QR payload) |
| GET | `/api/tickets` | super | List tickets (supports `search`, `category`, `bus_point` query params) |
| GET | `/api/tickets/:id` | super | Get a single ticket |
| PUT | `/api/tickets/:id` | super | Edit a ticket |
| DELETE | `/api/tickets/:id` | super | Delete a ticket |
| GET | `/api/tickets-export/csv` | super | Download all tickets as CSV |
| POST | `/api/verify` | gate, super | Decrypt + verify a scanned QR payload against the DB |
| POST | `/api/verify/board` | gate, super | Mark a verified ticket as boarded |
| GET | `/api/stats` | super | Revenue, ticket count, boarded count, issuer count, 24-point bus breakdown |
| GET | `/api/bus-points` | public | List of 24 official bus pickup points |

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite, globally distributed)
- **Tables**:
  - `admins` — issuer/super-admin accounts. `password_hash`/`password_salt` are PBKDF2-SHA256 (100k iterations) via Web Crypto — no Node `crypto` module used, fully compatible with the Workers runtime.
  - `tickets` — one row per issued ticket, including the AES-256-GCM encrypted `qr_payload`, boarding status, and issuer audit trail.
- **QR Security**: Each ticket's QR payload is `{ ticket_code, university_id, issued_at }` encrypted with AES-256-GCM (key derived via SHA-256 from a shared secret) and base64url-encoded. The Gate Verifier decrypts it server-side and cross-checks the exact payload string stored in the DB — a QR that decrypts but doesn't match, or fails to decrypt, is flagged `INVALID OR FAKE TICKET DETECTED`.
- **Session tokens**: Custom HMAC-SHA256 signed tokens (12h expiry) — no external JWT library dependency, works natively in Workers.

## User Guide
1. **Super Admin** logs in at `/admin-dashboard.html` with `admin_cse` / `admin123` (seeded automatically via migration — change this password in production!).
2. **Counter staff** register at `/admin-ticketing.html` → wait for Super Admin to approve their account in the dashboard's "Issuer Approvals" tab → then log in and start issuing tickets.
3. **Gate/bus staff** register at `/gate-verifier.html` the same way, get approved, then scan attendee QR codes at the gate/bus door. A green "VALID TICKET CONFIRMED" banner with full attendee details appears for real tickets; a red "INVALID OR FAKE TICKET DETECTED" alert appears otherwise. Staff can tap "Confirm Bus Boarded & Verified" to record boarding.
4. **Super Admin** can search/filter/edit/delete tickets, see live revenue + bus-point occupancy bars, approve issuers in bulk, export all data as CSV, and send a 1-click ticket confirmation email (opens Gmail compose with prefilled subject/body) per ticket.

## Bus Pickup Points (24 official points)
ভালুকা, মাওনা, রাজেন্দ্রপুর, শিববাড়ি, শিমুলতলী, চন্দ্রা, কোনাবাড়ি, সাভার, শ্রীপুর, নরসিংদী, কালিগঞ্জ, চাষাড়া, বাসাবো, স্টাফ কোয়ার্টার, মোহাম্মদপুর, মিরপুর ইসিবি, মিরপুর ১৪, মিরপুর ১২, মিরপুর ১০, মহাখালী, টঙ্গী কলেজ গেট, ঘোড়াশাল, শিববাড়ি ডুয়েট, উত্তরা.

## Not Yet Implemented / Next Steps
- **Google Sheets Cloud Sync**: The spec requested a Google Sheets cloud database mirror. This requires a Google Service Account + Sheets API credentials (a secret you must provide) — not yet wired up. Once you share credentials, we can add a `POST`-on-ticket-create webhook that appends a row to a Sheet via the Sheets API.
- **Real SMTP auto-send**: Currently "Send Mail" opens the user's own Gmail/Outlook compose window pre-filled (no server-side email sending, since Cloudflare Workers cannot run SMTP directly). For true 1-click auto-send without opening a mail client, integrate a transactional email API (e.g. Resend, SendGrid) — requires an API key.
- **QR code library**: Ticket Counter renders QR via the `qrcode` CDN library (canvas-based, effectively 1:1 vector-quality PNG at render time). Gate Verifier scans via `html5-qrcode` CDN library using the device camera.
- Ticket price is currently a free-form number override in the counter form (defaults to 1000 BDT) — no payment gateway integrated (spec describes physical/counter cash sales only).

## Deployment
- **Platform**: Cloudflare Pages + D1
- **Status**: ✅ Fully working in local sandbox (`wrangler pages dev` + local D1 SQLite)
- **Tech Stack**: Hono (TypeScript) + Cloudflare D1 + Vanilla JS/Tailwind CDN frontend (no build step needed for HTML pages — served as inline strings via Hono routes to guarantee exact `.html` URLs without Cloudflare Pages' automatic `.html`-stripping redirect)
- **Login (seeded)**: Super Admin — `admin_cse` / `admin123` (⚠️ change immediately after first deploy)
- **Last Updated**: 2026-08-16

### Production deployment checklist
1. Set real secrets: `wrangler secret put JWT_SECRET` and `wrangler secret put AES_SECRET` (the app falls back to demo secrets otherwise — fine for local dev, NOT safe for production).
2. Create a production D1 database: `npx wrangler d1 create webapp-production`, then copy the `database_id` into `wrangler.jsonc`.
3. Apply migrations to production: `npx wrangler d1 migrations apply webapp-production`.
4. Deploy: `npm run build && npx wrangler pages deploy dist --project-name <your-project-name>`.
5. Immediately log in as `admin_cse` and change the password (via direct D1 SQL update, since no "change password" UI exists yet — can be added on request).
