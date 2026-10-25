# Integración de Gestión financiera con el backend vigente

El PR 22 conserva la interfaz de Claude y se integra con el motor desplegado por el PR 21. /api/finanzas es una fachada de presentación en español; no es un segundo sistema contable.

Todas las asignaciones y repartos escriben mediante FinanceService en financial_records y project_financial_allocations. El historial se obtiene de finance_events. Se conserva la sincronización de project_id, los límites por importe, los UUID de idempotencia y el control de versiones. El cliente envía version y request_id; un cambio simultáneo devuelve 409. Los lotes de esta fachada admiten hasta 100 registros y reportan éxito o conflicto por elemento; la API canónica /api/finance mantiene su operación masiva atómica.

La migración 010 solo añade finance_review_flags, con FK real a financial_records, para la marca manual de revisión de la interfaz. No crea project_allocations, no duplica importes ni instala invariantes contradictorias con las migraciones 005/006. Desmarcar revisión no aprueba impuestos ni reconoce ingresos/costes.

Materiales y pagos de trabajadores se muestran con el signo económico canónico; los abonos conservan su signo negativo. Las líneas y documentos de factura aún sin clasificar aparecen como Conceptos de facturas. Las métricas reutilizan el resumen y la evolución de FinanceService: resultado económico sin IVA deducible, cobros y pagos por separado. Los registros pendientes de reconocimiento no entran en el margen. El presupuesto requiere aprobación y verificación de su base sin IVA.

Se conservan las sesiones y roles existentes. Cliente recibe 403. Admin accede a toda la información. Jefe necesita permisos explícitos de finance_project_permissions y solo ve sus registros/proyectos; una factura compartida no revela totales ajenos. La conciliación bancaria global es de administrador. Las escrituras verifican Origin y usan SQL parametrizado. Los enlaces de archivos solo se muestran si son HTTPS de SharePoint y el usuario tiene acceso al documento.

Pruebas: test/finanzas.test.js verifica que interfaz y API usan una sola asignación, límites y reparto, concurrencia, permisos, filtros, marcas de revisión, lotes, historial, separación de tesorería y autenticación/CSRF. Se ejecuta además la batería canónica del PR 21. El frontend se valida con vite build.

El despliegue normal aplica la migración 010 después de las 005/006 ya desplegadas. No se sustituye la ingesta de facturas, el Bridge, Revolut ni la autenticación. Las sugerencias no asignan automáticamente proyectos desde la interfaz.

## Pendiente de conciliación

La pantalla Pendiente de conciliación muestra exclusivamente movimientos bancarios sin enlaces Bridge, con enlaces en revisión o con diferencias entre su total firmado y las imputaciones confirmadas. Cada movimiento aparece una sola vez, con los números de documentos relacionados. Los materiales y conceptos se gestionan en Pendientes de asignación. Las vistas de registros financieros y documentos se conservan solo como consultas compatibles de API. Solo administrador puede consultar la bandeja global. Es una consulta de revisión; no crea ni confirma conciliaciones desde la pantalla.

GET /api/finanzas/conciliacion: vista=registros|movimientos|documentos (por defecto movimientos), motivo=sin_documento|sin_bridge|revision|parcial, q, desde, hasta, pagina, tam (máximo 100). Respuesta: rows, total, page, pageSize. Cada fila incluye id,type,fecha,tercero,concepto,numerodocumento,referencia,importe,document_id,enlaces,conciliado,por_conciliar,motivos. Los importes mantienen el signo original; conciliado es el total confirmado del documento o movimiento, no un coste adicional. Los registros financieros comparten el estado de su documento. Las transferencias internas se excluyen de la vista bancaria. No se modifica el esquema ni el Bridge.

## Efectivo

Los pagos y cobros en efectivo no tienen banco detrás, así que viven en su propia tabla `ledens.cash_movements` (migración 016), no en `ledens.bank_movements`. Solo administrador. Mientras no se asignan aparecen en Pendiente de conciliación (vista movimientos) con `type=efectivo`, importe firmado como un movimiento (pago negativo, cobro positivo) y motivo `efectivo`.

- POST /api/finanzas/conciliacion/efectivo `{kind: pago|cobro, amount, date, concept, counterparty?}` → 201.
- POST /api/finanzas/conciliacion/efectivo/:id/asignar `{target: materiales|clientes, projectId?, description?}`: un pago crea una fila de `material_expenses` (total negativo, como la importación); un cobro crea una de `customer_payments` (`id_pago='Efectivo'`). Los triggers de 006 registran el `financial_record`; con proyecto se imputa con FinanceService, sin proyecto queda en Pendientes de asignación.
- Un pago a trabajadores se envía con POST /conciliacion/pago-trabajadores, igual que un movimiento bancario: el lote de 013 lleva `cash_movement_id` y los pagos guardados no tienen `bank_movement_id`. Devolver el lote a conciliación libera el efectivo.
- DELETE /api/finanzas/conciliacion/efectivo/:id solo mientras no está asignado.

En rentabilidad, los registros aprobados que vienen de efectivo (`ledens.v_cash_records`) cuentan como cobro o pago de tesorería, porque ningún movimiento bancario ni enlace Bridge los cubrirá. Todas las operaciones quedan en Logs de transacciones (proceso «Efectivo»).
