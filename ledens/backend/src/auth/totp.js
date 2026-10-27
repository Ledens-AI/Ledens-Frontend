import crypto from 'node:crypto';

// TOTP (RFC 6238 sobre HOTP, RFC 4226) con node:crypto: lo que entienden
// Google Authenticator, Microsoft Authenticator, 1Password, etc. SHA-1, 6
// dígitos y pasos de 30 s son los valores que todas aceptan.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('base32 no válido');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 0xf;
  const code = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Comprueba un código admitiendo un paso de desfase a cada lado (relojes de
 * móvil algo adelantados o atrasados). Devuelve el paso que coincidió, para
 * que quien llama rechace reutilizarlo, o null.
 */
export function verifyTotp(secret, code, { now = Date.now(), window = 1 } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const expected = hotp(secret, current + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return current + d;
  }
  return null;
}

export function otpauthUrl({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// El secreto TOTP se guarda cifrado (AES-256-GCM) con MFA_ENCRYPTION_KEY,
// 32 bytes en base64, que vive en Key Vault como el resto de secretos: con
// solo una copia de la base de datos no se pueden generar códigos.
export function encryptionKey(env = process.env) {
  const raw = env.MFA_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY debe ser 32 bytes en base64');
  return key;
}

export function seal(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function open(sealed, key) {
  const [v, iv, tag, ct] = String(sealed).split(':');
  if (v !== 'v1') throw new Error('Formato de secreto desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
