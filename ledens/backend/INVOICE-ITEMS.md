# Partidas de factura pendientes de asignación

Cada línea financiera conserva document_id y se muestra con numerodocumento, line_number, product_code y quantity en /api/finanzas/registros. El selector de proyecto actúa sobre cada línea. La factura original y el Bridge no se duplican.

Normalización: el campo Amount de Azure puede incluir o excluir IVA. Se contrastan las alternativas derivadas del impuesto/tipo explícito de cada línea con el total y el IVA documentales, usando céntimos enteros. Solo una solución única genera bases e IVA por partida. Si se conocen importes brutos por línea que cuadran exactamente, las partidas pueden asignarse manteniendo los impuestos pendientes de revisión. No se suponen materiales ni IVA deducible; los registros siguen pending/unclassified hasta revisión.

Se conservan SKU, cantidad, precio unitario y lecturas OCR en evidence. Una búsqueda acotada evita explosión de combinaciones. Si las partidas no cuadran o son ambiguas, permanece un único resumen pendiente de desglose. No se reparten importes de forma inventada.

Reprocesamiento: storeInvoiceLines reutiliza la clave (document_id,line_number) y la unicidad invoice_line_id. Un resumen no asignado puede sustituirse por las partidas balanceadas; el resumen se excluye/invalida, se conserva y se audita. Si está asignado o aprobado, se exige revisión explícita y la transacción no cambia nada. No se sobrescriben asignaciones existentes ni importes de partidas ya activas.

Operador: node src/scripts/rebuild-invoice-lines.js INGESTION_UUID ADMIN_UUID obtiene el resultado OCR existente, normaliza las partidas y las actualiza dentro de FinanceService.transaction. No crea otro documento, cambia el Bridge ni vuelve a mover el original. Sin migraciones o variables nuevas.

Caso comprobado: OBRAMAT 008-0010-459065 contiene una sola partida PAGO ANTICIPADO DEL PEDIDO 302957 (neto 638.48, IVA 134.08, bruto 772.56), no un listado de los productos. La segunda página son condiciones generales. Para distribuir productos reales hace falta el documento detallado del pedido/albarán o factura final. El sistema no inventa artículos ausentes.

Validación: cuatro productos pueden asignarse a proyectos distintos conservando una factura y un Bridge; se prueban IVA mixto, Amount bruto/neto, abonos, idempotencia, sustitución auditada del resumen y bloqueo de resúmenes asignados. Pruebas de integración PostgreSQL 16 en el workflow habitual.
