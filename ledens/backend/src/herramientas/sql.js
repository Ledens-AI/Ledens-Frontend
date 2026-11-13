// Constants and the SQL that reads an asset with its current state, shared by
// the Ledens Tools modules.
export const LOCATION_KINDS = ['almacen', 'obra', 'vehiculo', 'taller', 'proveedor', 'externa', 'pendiente'];
export const CONDITIONS = ['operativa', 'averiada', 'en_mantenimiento', 'perdida', 'robada'];
export const OWNERSHIP = ['propia', 'alquilada', 'tercero'];
export const INCIDENT_KINDS = ['averia', 'rotura', 'perdida', 'robo', 'accesorio_faltante', 'mantenimiento'];
export const PURPOSES = ['entrega', 'traslado', 'devolucion', 'reparacion', 'correccion'];
// Kinds of incident that always take the asset out of service, and the condition they leave.
export const BLOCKING = { averia: 'averiada', rotura: 'averiada', perdida: 'perdida', robo: 'robada' };
// Readable availability, derived (never stored): baja > condition > in transit > assigned > reserved > free.
export const STATUS_SQL = `CASE WHEN a.retired_at IS NOT NULL THEN 'baja' WHEN a.condition<>'operativa' THEN a.condition
  WHEN pm.id IS NOT NULL THEN 'en_traslado' WHEN aa.id IS NOT NULL THEN 'asignada'
  WHEN EXISTS (SELECT 1 FROM inventory.reservations r WHERE r.asset_id=a.id AND r.status='activa' AND r.ends_on>=current_date) THEN 'reservada'
  ELSE 'disponible' END`;
export const ASSET_FROM = `inventory.assets a
  JOIN inventory.tool_types t ON t.id=a.type_id
  JOIN inventory.locations l ON l.id=a.location_id
  LEFT JOIN inventory.asset_movements pm ON pm.asset_id=a.id AND pm.status='pendiente'
  LEFT JOIN inventory.locations pl ON pl.id=pm.to_location_id
  LEFT JOIN inventory.asset_assignments aa ON aa.asset_id=a.id AND aa.ended_at IS NULL
  LEFT JOIN users cu ON cu.id=a.custodian_user_id`;
export const ASSET_COLS = `a.*, a.rental_ends_on::text rental_ends_on, a.acquired_on::text acquired_on, a.warranty_until::text warranty_until, t.name type_name, t.category, t.tracking, l.kind loc_kind, l.name loc_name, l.project_id loc_project,
  pm.id pm_id, pm.to_location_id pm_to, pl.name pm_to_name, pl.kind pm_to_kind, pl.project_id pm_to_project, pm.to_custodian_user_id pm_to_user,
  pm.to_custodian_employee_id pm_to_employee, pm.sent_by pm_sent_by, pm.sent_at pm_sent_at, pm.purpose pm_purpose,
  aa.id asg_id, aa.project_id asg_project, aa.expected_return_on::text asg_return, aa.starts_at asg_since, aa.request_id asg_request,
  cu.name cust_user_name, cu.email cust_user_email, coalesce(aa.project_id, l.project_id) work_project, ${STATUS_SQL} status`;

