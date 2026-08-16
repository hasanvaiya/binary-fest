// Web Crypto based helpers for Cloudflare Workers runtime.
// No Node.js `crypto` module usage anywhere here.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

// ---------------- Password hashing (PBKDF2-SHA256) ----------------

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? randomHex(16);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    32 * 8
  );
  return { hash: toHex(bits), salt };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, expectedHash);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------- AES-256-GCM encryption for QR payloads ----------------

async function getAesKey(secret: string): Promise<CryptoKey> {
  // Derive a 256-bit AES key from the shared secret via SHA-256.
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function aesEncrypt(plainObj: unknown, secret: string): Promise<string> {
  const key = await getAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify(plainObj));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  // Pack iv + ciphertext, base64 encode
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);
  return bytesToBase64(combined);
}

export async function aesDecrypt<T = unknown>(payload: string, secret: string): Promise<T | null> {
  try {
    const key = await getAesKey(secret);
    const combined = base64ToBytes(payload);
    const iv = combined.slice(0, 12);
    const cipherBuf = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
    const json = dec.decode(plainBuf);
    return JSON.parse(json) as T;
  } catch (e) {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in Workers runtime
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------- Simple session token (signed) ----------------

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = bytesToBase64(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const sigB64 = bytesToBase64(new Uint8Array(sig));
  return `${body}.${sigB64}`;
}

export async function verifyToken<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  try {
    const [body, sigB64] = token.split('.');
    if (!body || !sigB64) return null;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const expectedSig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    const expectedSigB64 = bytesToBase64(new Uint8Array(expectedSig));
    if (!timingSafeEqual(sigB64, expectedSigB64)) return null;
    const json = dec.decode(base64ToBytes(body));
    const payload = JSON.parse(json) as T & { exp?: number };
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export function randomTicketCode(): string {
  // BF26-XXXXXXXX
  return `BF26-${randomHex(5).toUpperCase()}`;
}
