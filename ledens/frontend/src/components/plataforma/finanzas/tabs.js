// Sections of Gestión financiera, in navigation order. Kept apart from the
// screens so Plataforma.jsx can build the sidebar without loading them
// (the module itself is lazy-loaded: clients never download it).
export const FIN_TABS = [
  ['resumen', 'Resumen', 'ri-dashboard-line'],
  ['pendientes', 'Pendientes de asignación', 'ri-inbox-line'],
  ['material', 'Materiales', 'ri-hammer-line'],
  ['trabajador', 'Pagos a trabajadores', 'ri-user-settings-line'],
  ['cliente', 'Pagos de clientes', 'ri-hand-coin-line'],
  ['concepto', 'Conceptos de facturas', 'ri-file-list-line'],
  ['conciliacion', 'Pendiente de conciliación', 'ri-bank-line'],
  ['bridge', 'Bridge Movimientos Documentos', 'ri-links-line'],
  ['pendiente-bridge', 'Pendiente de bridge movimientos documentos', 'ri-notification-3-line'],
  ['pendiente-trabajador', 'Pendiente de trabajador', 'ri-user-follow-line'],
  ['rentabilidad', 'Rentabilidad por proyecto', 'ri-line-chart-line'],
  ['proyectos', 'Proyectos', 'ri-building-2-line'],
  ['trabajadores', 'Trabajadores', 'ri-team-line'],
  ['logs', 'Logs de transacciones', 'ri-pulse-line', true],
];
