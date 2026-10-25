# Conciliación automática global

Regla v2 solicitada por el usuario: proveedor/tercero e importe firmado exactos, moneda EUR verificada y fecha del movimiento dentro de ±7 días de la fecha documental. Se aplica a todas las facturas procesadas, sin listas especiales de proveedores. El umbral OCR mínimo del 50 % se conserva para importe, fecha, dirección y tercero/NIF utilizado.

No se exige número de factura ni confianza sobre ese número para la coincidencia sin referencia. La regla con referencia explícita conserva su ventana previa (-7 a +90 días), exige confianza del número >=50 % y se prioriza frente a coincidencias sin referencia. En ambos casos se exige un único movimiento elegible y libre. Se comprueba además que ninguna otra factura no conciliada compatible pueda reclamarlo, con bloqueo transaccional común y guardas de capacidad del Bridge.

Dos movimientos compatibles sin referencia, dos facturas competidoras, importes distintos, monedas no verificadas, contrapartes distintas, fechas fuera de ventana, transferencias internas, comisiones/FX o reservas previas quedan para revisión. Los abonos conservan su signo. No se toleran diferencias por redondeo ni se asigna un proyecto al conciliar.

Las nuevas filas del Bridge tienen AUTO_BRIDGE:party-amount-date-v2. El evento auto_confirmed incluye evidence_mode, reference verdadero/falso y ventana aplicable; no se inventa una referencia que no existe. El monitor conserva la propiedad de las conciliaciones v1 y v2 para invalidarlas si cambia su origen.

Migración incremental 012_bridge_party_amount_date.sql: audita el cambio de regla y reprograma casos pendientes con ingesta ready/archived, moneda y campos requeridos verificados. No modifica importes, conciliaciones existentes ni casos descartados manualmente. Los registros históricos sin evidencias OCR verificadas siguen requiriendo revisión.

Despliegue: migración automática al arrancar backend; el reintento periódico existente se mantiene cada 15 minutos. Puede ejecutarse BridgeService.evaluate(documentId,{force:true}) para verificar inmediatamente una factura concreta. Las alertas de conciliación existentes enviarán el resultado. No hay nuevas variables de entorno ni cambios de autenticación.

Pruebas: reglas exactas y sin referencia, ±7 días inclusivos, número ausente, proveedores/importes/signos incorrectos, ambigüedad de bancos y documentos, reservas previas, idempotencia, migración de pendientes, monitor de propiedad v1 y concurrencia real PostgreSQL 16.
