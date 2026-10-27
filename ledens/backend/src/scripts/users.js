import crypto from 'node:crypto';
import { getPool, closePool } from '../db/pool.js';
import { hashPassword } from '../auth/passwords.js';
import { ROLES, ROLE_LABEL } from '../auth/sessions.js';
import { audit } from '../db/audit.js';

// Operator tool for account chores the web UI doesn't cover yet. Run it where
// DATABASE_URL points at the right database — in production, inside the
// Container App:
//   az containerapp exec -g rg-ledens -n ledens-backend --command "npm run users -- set-password ana.anzola@ledens.es"
//
//   npm run users -- set-password <email>          random temporary password, printed once
//   npm run users -- set-role <email> <role>       admin | jefe | client
//   npm run users -- create <email> <role> <name…> account with no password yet
const USAGE = `Uso:
  npm run users -- set-password <email>
  npm run users -- set-role <email> <admin|jefe|client>
  npm run users -- create <email> <admin|jefe|client> <nombre completo>`;

const ACTOR = { label: 'Sistema (consola)' };

async function findUser(email) {
  const { rows } = await getPool().query('SELECT id, email, name, role FROM users WHERE lower(email) = lower($1)', [email]);
  if (!rows[0]) throw new Error(`No existe ninguna cuenta con el email ${email}`);
  return rows[0];
}

const commands = {
  async 'set-password'(email) {
    const user = await findUser(email);
    // 18 random bytes → 24 base64url chars: well past any guessing range,
    // still copyable by hand. The user should change it after logging in.
    const password = crypto.randomBytes(18).toString('base64url');
    await getPool().query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hashPassword(password), user.id]);
    await audit({ actor: ACTOR, action: 'Contraseña temporal', target: user, detail: 'Generada desde consola' });
    console.log(`Contraseña temporal para ${user.email}: ${password}`);
    console.log('Se muestra una sola vez. Envíasela por un canal privado.');
  },

  async 'set-role'(email, role) {
    if (!ROLES.includes(role)) throw new Error(`Rol no válido: ${role}`);
    const user = await findUser(email);
    if (user.role === role) {
      console.log(`${user.email} ya tiene el rol ${role}. Sin cambios.`);
      return;
    }
    await getPool().query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, user.id]);
    await audit({ actor: ACTOR, action: 'Rol cambiado', target: user, detail: `${ROLE_LABEL[user.role]} → ${ROLE_LABEL[role]}` });
    console.log(`${user.email}: ${user.role} → ${role}`);
  },

  async create(email, role, ...nameParts) {
    const name = nameParts.join(' ').trim();
    if (!email || !ROLES.includes(role) || !name) throw new Error(USAGE);
    const { rows } = await getPool().query(
      // Staff created here count as registered; a client is pending until they get in (migration 024).
      `INSERT INTO users (email, name, role, registered_at) VALUES ($1, $2, $3, CASE WHEN $3 = 'client' THEN NULL ELSE now() END)
       RETURNING id, email, role`,
      [email.trim(), name, role],
    ).catch((err) => {
      throw err.code === '23505' ? new Error(`Ya existe una cuenta con el email ${email}`) : err;
    });
    await audit({ actor: ACTOR, action: 'Alta de cuenta', target: rows[0], detail: `Rol: ${ROLE_LABEL[role]}` });
    console.log(`Cuenta creada: ${rows[0].email} (${role}). Sin contraseña: usa set-password o un login de Google/Microsoft.`);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!commands[cmd]) {
  console.error(USAGE);
  process.exitCode = 1;
} else {
  commands[cmd](...args)
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
