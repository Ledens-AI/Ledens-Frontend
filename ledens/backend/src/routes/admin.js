import { Router } from 'express';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireRole, ROLES, ROLE_LABEL } from '../auth/sessions.js';
import { audit } from '../db/audit.js';

// Everything under /api/admin is for the admin role only — the users list
// holds every account's email, so this must never be reachable by a client
// or a jefe de obra, whatever the frontend shows.
const router = Router();

router.use((_req, res, next) => {
  if (!isDbConfigured()) return res.status(503).json({ error: 'Administración no disponible todavía' });
  next();
});
router.use(requireRole('admin'));

// One row per user, with how they can sign in and when they last did.
// last_seen comes from sessions.created_at (a login), which is what the
// admin screen calls "último acceso".
const USERS_SQL = `
  SELECT u.id, u.email, u.name, u.role, u.email_verified, u.created_at, u.registered_at,
         (u.password_hash IS NOT NULL) AS has_password,
         COALESCE(array_agg(DISTINCT i.provider) FILTER (WHERE i.provider IS NOT NULL), '{}') AS providers,
         (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
    FROM users u
    LEFT JOIN auth_identities i ON i.user_id = u.id
   GROUP BY u.id`;

router.get('/users', async (_req, res, next) => {
  try {
    const { rows } = await getPool().query(`${USERS_SQL} ORDER BY u.created_at DESC`);
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/role', async (req, res, next) => {
  const { role, reason } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol no válido' });
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    return res.status(400).json({ error: 'Indica el motivo del cambio' });
  }
  // An admin demoting themselves could leave the platform with nobody able
  // to undo it — another admin has to do it.
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, email, name, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id])
      .catch((err) => (err.code === '22P02' ? { rows: [] } : Promise.reject(err))); // malformed uuid
    const target = rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (target.role !== role) {
      await client.query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, target.id]);
      await audit({
        actor: req.user,
        action: 'Rol cambiado',
        target,
        detail: `${ROLE_LABEL[target.role]} → ${ROLE_LABEL[role]} · ${reason.trim()}`,
      }, client);
    }
    await client.query('COMMIT');
    const { rows: [user] } = await getPool().query(`${USERS_SQL} HAVING u.id = $1`, [target.id]);
    res.json({ user });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// «Ver como»: the admin starts looking at the platform as this user (read-only,
// see src/auth/viewAs.js). Recorded in audit_log; returns who it is.
router.post('/view-as', async (req, res, next) => {
  const { userId } = req.body || {};
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Usuario no válido' });
  try {
    const { rows: [target] } = await getPool().query('SELECT id, email, name, role FROM users WHERE id = $1', [userId]);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Ya estás viendo tu propio panel' });
    await audit({ actor: req.user, action: 'Vista como usuario', target, detail: `Panel de ${ROLE_LABEL[target.role]} · solo lectura` });
    res.json({ user: target });
  } catch (err) {
    next(err);
  }
});

router.get('/audit', async (_req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'SELECT id, at, actor_label, action, target_label, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT 200',
    );
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
