import crypto from 'node:crypto';

// scrypt (Node's built-in, no extra native dependency to compile in Docker)
// is what Node's own docs recommend for password hashing.
const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false; // social-only accounts have no password_hash
  const [algo, saltHex, hashHex] = stored.split(':');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  // timingSafeEqual instead of === so a wrong-length or wrong-content guess
  // cannot be distinguished by how long the comparison takes.
  return crypto.timingSafeEqual(expected, actual);
}
