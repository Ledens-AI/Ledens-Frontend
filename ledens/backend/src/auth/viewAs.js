import { getPool } from '../db/pool.js';

// «Ver como»: an admin may look at the platform as another user sees it
// (/plataforma's jefe de obra and client panels). The request carries
// X-Ledens-View-As: <user id>; only admins may send it and only to read.
// The data then comes back exactly as for that user: their role and their
// finance permissions decide, so a client target is refused by the role check
// that follows. req.viewer keeps the admin for anything that must know.
export const VIEW_AS_HEADER = 'x-ledens-view-as';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function viewAs({ findUser = defaultFindUser } = {}) {
  return async (req, res, next) => {
    const id = req.get(VIEW_AS_HEADER);
    if (!id) return next();
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede ver como otro usuario' });
    if (req.method !== 'GET') return res.status(403).json({ error: 'Viendo como otro usuario: solo lectura' });
    if (!UUID.test(id)) return res.status(400).json({ error: 'Usuario no válido' });
    try {
      const target = await findUser(id);
      if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
      req.viewer = req.user;
      req.user = target;
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function defaultFindUser(id) {
  const { rows } = await getPool().query('SELECT id, email, name, role FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}
