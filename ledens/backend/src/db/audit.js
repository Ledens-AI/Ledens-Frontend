import { getPool } from './pool.js';

/**
 * Appends one row to audit_log. `db` lets callers pass a transaction client
 * so the audit row commits or rolls back together with the change it records.
 */
export async function audit({ actor, action, target, detail }, db = getPool()) {
  await db.query(
    `INSERT INTO audit_log (actor_id, actor_label, action, target_id, target_label, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor?.id || null, actor?.label || actor?.name || 'Sistema', action, target?.id || null, target?.label || target?.email || null, detail || null],
  );
}
