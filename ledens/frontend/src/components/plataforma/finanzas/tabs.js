// Sections of Gestión financiera, in navigation order. Kept apart from the
// screens so Plataforma.jsx can build the sidebar without loading them
// (the module itself is lazy-loaded: clients never download it).
// [key, label, icon, adminOnly]
export const FIN_TABS = [
  ['resumen', 'Resumen', 'ri-dashboard-line'],
  ['conciliados', 'Movimientos conciliados', 'ri-checkbox-multiple-line', true],
  // Includes «Asignar documento» (formerly «Pendiente de bridge movimientos documentos»).
  ['conciliacion', 'Pendiente de conciliación', 'ri-bank-line'],
  ['bridge', 'Bridge Movimientos Documentos', 'ri-links-line'],
  ['documentos-sin-asignar', 'Documentos sin asignar', 'ri-file-warning-line', true],
  ['concepto', 'Concepto de movimientos', 'ri-file-list-line', true],
  ['proyectos', 'Proyectos', 'ri-building-2-line'],
  ['rentabilidad', 'Rentabilidad por proyecto', 'ri-line-chart-line'],
  ['cliente', 'Pagos de clientes', 'ri-hand-coin-line'],
  ['trabajadores', 'Trabajadores', 'ri-team-line'],
  ['trabajador', 'Pagos a trabajadores', 'ri-user-settings-line'],
  ['cuentas-por-pagar', 'Cuentas por pagar', 'ri-calendar-check-line', true],
  ['pendiente-trabajador', 'Pendiente de trabajador', 'ri-user-follow-line'],
  ['material', 'Materiales', 'ri-hammer-line'],
  ['pendientes', 'Materiales pendiente de asignación', 'ri-inbox-line'],
  ['logs', 'Logs de transacciones', 'ri-pulse-line', true],
];
