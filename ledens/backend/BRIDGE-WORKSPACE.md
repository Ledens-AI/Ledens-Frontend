# Bridge Movimientos Documentos

## Pantallas

- **Bridge Movimientos Documentos**: enlaces reales de `ledens.bank_document_allocations`, número de documento, tercero, movimiento, importe conciliado, estado y motivo. Consulta paginada y filtros de texto y fechas bancarias.
- **Pendiente de bridge movimientos documentos**: movimientos sin cobertura completa o con enlaces en revisión. Cada movimiento aparece una vez. Excluye transferencias internas y movimientos reservados para trabajadores, como la bandeja de conciliación existente.
- Contadores rosas en el menú de pendientes del Bridge y en Pendiente de conciliación. Se actualizan al entrar, actualizar o guardar.

Para conciliar: **Asignar documento → buscar y seleccionar el documento existente → importe → motivo → Guardar**. No se crea otra factura ni otro movimiento. La búsqueda incluye documentos importados sin registro de ingesta, muestra su número, tercero, fecha, importe y saldo. No lista documentos ya completamente conciliados ni los descartados. La pantalla no escribe hasta Guardar. Se permiten conciliaciones parciales y relaciones de varios documentos/movimientos respetando los saldos. El movimiento sale de pendientes únicamente cuando queda cubierto y no conserva enlaces en revisión.

Un documento con dirección incorrecta puede corregirse explícitamente al guardar cuando todavía no tiene enlaces. Se muestra la advertencia antes de confirmar y se conservan valores anterior/nuevo y motivo en `bridge_events`. Un documento con enlaces existentes no cambia de signo por esta vía. Los enlaces reservados para revisión en otros documentos bloquean la confirmación: no se sobrescriben automáticamente.

## Regla automática solicitada

Versión `amount-near-date-v3`: importe exacto con el mismo signo, fecha ±7 días y un único movimiento compatible. No requiere que el proveedor/cliente coincida con el pagador o beneficiario. Otro documento que pueda reclamar ese movimiento impide la asignación automática. La regla anterior de referencia exacta y tercero corroborado conserva su ventana de fechas más amplia. Los eventos indican si hubo evidencia de tercero; nunca la inventan.

Se conservan las validaciones de confianza del 50 % en importe, fecha y sentido, EUR, estado COMPLETED, ausencia de comisión o cambio de moneda, y saldo disponible. Se incorpora TOPUP únicamente para cobros positivos; CARD_REFUND mantiene el requisito de rectificativa de anticipo validada. Las transferencias internas siguen excluidas. Las conciliaciones antiguas conservan su regla de origen y su monitorización.

La migración incremental **017_bridge_amount_near_date.sql** vuelve a poner en cola los documentos de ingesta verificados pendientes sin enlaces. No crea conciliaciones durante la migración, no cambia documentos ni toca enlaces confirmados o casos descartados. No afecta a costes, ingresos, asignaciones a proyecto ni a los originales de SharePoint.

## API y permisos

Se reutiliza `/api/bridge/:documentId/confirm`. Nuevas consultas:

- `GET /api/bridge/workspace/counts`
- `GET /api/bridge/workspace/movements`
- `GET /api/bridge/workspace/allocations`
- `GET /api/bridge/workspace/movements/:bankId/documents`

Paginación `limit` (1–50), `offset` (0–100000), búsqueda `q` (máximo 120 caracteres), fechas `from`/`to`. La lista de documentos utiliza `q`, `limit`, `offset`. El contrato está en `docs/bridge-workspace.openapi.json`.

Se mantienen los permisos globales actuales del Bridge: **admin** (Business User con ese rol). Jefe y cliente no reciben acceso global por este cambio. Cookie de sesión existente, validación de Origin en escrituras, bloqueo transaccional compartido, versión y huellas de documento/movimiento, control de saldos e idempotencia por `request_id`. La confirmación manual tiene usuario, importe, motivo y fecha en `bridge_events`.

## Validación y despliegue

Pruebas de API: selección y guardado, parciales, desaparición de pendientes, contador, consulta del Bridge, reintento idempotente, importes excesivos, selección obsoleta, permisos y Origin, dirección corregida con auditoría, pagador diferente y TOPUP, competencia entre documentos y guardados simultáneos sobre PostgreSQL real. Regresiones de facturas, anticipo, devolución y costes separadas del banco.

`npm test` ejecuta pruebas aisladas; CI ejecuta además `test/bridge-workspace.test.js` contra su propia base PostgreSQL 16 (`BRIDGE_WORKSPACE_TEST_DATABASE_URL`, solo pruebas). El frontend se comprueba con `npm run build` y una vista previa local con datos ficticios del flujo completo. No hay nuevas variables de producción.

El despliegue normal aplica la migración mediante el mecanismo existente. Este cambio se entrega en PR: no implica autorización para fusionar, desplegar o conciliar documentos reales. La comprobación del caso de 2.640,50 € en producción fue únicamente de lectura, autorizada por el usuario; confirmó documento e ingreso sin enlace, con tipo bancario TOPUP. No se adjuntan datos personales ni credenciales en las pruebas.
