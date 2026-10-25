# Anticipo, entrega con saldo cero y rectificativa

## Estado del PR

Preparado en PR 29. No fusionar ni desplegar ni aplicar la migración o recuperación en producción sin una instrucción posterior. El PR integra main con los cambios de proyectos y trabajadores y conserva el botón Guardar.

## Circuito comprobado

Pedido 302957, proveedor B84406289, cliente B19753805, EUR:
- 008-0010-459065: anticipo 772.56 (base 638.48 + IVA 134.08).
- 008-0010-459619: 21 partidas positivas 766.12 (633.16 + 132.96) y aplicación -766.12, saldo a pagar 0.
- 008-0010-R280230: rectificación del anticipo -6.44 (-5.32 -1.12).

La disponibilidad documental queda 0 cuando ambas aplicaciones están vinculadas. La devolución permanece pending_bank_refund hasta confirmar una entrada bancaria real de 6.44. El palet retornable y la preparación conservan su naturaleza en evidence.line_kind, y las 21 partidas nacen pending/unclassified sin proyecto ni aprobación contable. No se asume que todo sea material, gasto directo ni IVA deducible.

## Lectura nativa y validación

pdfjs-dist 4.10.38, compatible con Node >=20, lectura de texto con evaluación desactivada. Se conserva el PDF original sin recortar, incluidos los tres folios del detalle (2 financieros + condiciones). No se consume OCR en este patrón digital. Se exige proveedor, comprador configurado, moneda EUR, número fiscal único, pedido único, fechas válidas, continuidad de páginas/partidas, SKU, cantidades e importes por fila consistentes y tablas de impuestos balanceadas.

El lector usa el último Importe TTI como bruto de la línea. No vuelve a multiplicarlo por cantidad. Las bases/IVA por partida se obtienen del bruto y grupo fiscal, distribuyendo céntimos con mayores restos y desempate por número de línea para respetar 633.16/132.96. Los precios unitarios impresos se conservan; no se suman sus redondeos como si fueran bases de línea. No se fabrican probabilidades OCR: purchase_proof registra evidencia del texto nativo. Documentos escaneados o formatos ambiguos siguen el circuito OCR/revisión; nunca se truncan páginas financieras.

## Modelo incremental

014_purchase_settlements.sql (013 pertenece a pagos de trabajadores):
- purchase_documents: identidad fiscal y naturaleza, importes documentales y económicos separados, fingerprint/evidencia.
- purchase_settlements: relación explícita anticipo -> entrega o devolución. FK, unicidad, mismo proveedor/cliente/pedido/moneda, límite temporal y suma aplicada <= anticipo, con bloqueo compartido 727032.
- purchase_settlement_events: auditoría de registro y enlaces, con actor cuando actúa un administrador.
- purchase_proof en invoice_ingestions y hash propio por invoice_sources para copias semánticas con bytes distintos.
- v_document_economic_capacity, v_document_funding y v_purchase_coverage para rentabilidad, tesorería y cobertura.

Las identidades documentales verificadas no se sobrescriben: una copia con contenido económico distinto da conflicto para revisión. DUPLICADO no descarta por sí mismo; proveedor/cliente/número + fingerprint evita duplicar documentos/partidas, incluso si cambia el hash. Un anticipo previamente asignado o aprobado no se sustituye automáticamente. Su revisión requiere decisión humana, conservando el historial.

## Bridge y rentabilidad

El Bridge original conserva solo dinero real: -772.56 contra el anticipo y +6.44 contra la rectificativa. La entrega a cero nunca crea una asignación bancaria de importe cero ni un segundo pago de 766.12. Su estado es covered_by_advance cuando el anticipo está realmente financiado; si se revierte el pago, el monitor retira esa cobertura. Movimientos reservados a trabajadores se excluyen del Bridge.

La capacidad económica de la entrega es 766.12, aunque su saldo sea cero. Solo las partidas aprobadas entran en rentabilidad. La tesorería por proyecto usa las mismas asignaciones Bridge del anticipo, prorrateadas por aplicación y por la cuota de cada partida; el anticipo/rectificativa no generan otros costes ni ingresos. Los anticipos no aplicados y reembolsos aún no recibidos siguen identificados en la familia documental.

## API e interfaz

GET /api/finance/documents/{id}/purchase-settlement: relación, saldos y estado bancario de devolución. Exige acceso financiero y a todos los documentos de la familia; cliente no autorizado, jefe sin permisos suficientes tampoco. OpenAPI en docs/project-finance.openapi.json. La API canónica informa covered_by_advance/awaiting_advance_payment; el detalle de la bandeja muestra pedido, documentos relacionados y devolución pendiente/conciliada. El listado conserva factura, línea, SKU y cantidad.

## Reprocesar después de un futuro despliegue autorizado

Subir los originales al origen permite reconocerlos en cualquier orden. Un reintento nativo válido recupera una ingesta anterior en revisión por F0 sin crear otro documento. Para originales ya archivados: node src/scripts/backfill-purchase-documents.js ADMIN_UUID archivo1.pdf archivo2.pdf archivo3.pdf muestra la propuesta en modo lectura. Añadir --apply solo tras autorización aplica la recuperación a ingestas existentes y únicas. No inventa fuentes OneDrive, movimientos ni documentos ausentes; si no hay una ingesta única pide subir el original primero. La autorización de este trabajo NO permite ejecutar ese modo en producción.

Sin nuevas variables obligatorias. Se reutiliza BRIDGE_BUSINESS_TAX_ID, acceso PostgreSQL y conexiones existentes. No cambia autenticación, Revolut ni despliega servicios nuevos.

## Verificación

Fixture económica derivada de las dos facturas adjuntas, sin domicilios, teléfonos ni PDFs originales en Git. Pruebas nativas e integración PostgreSQL 16 dedicadas: 21 partidas, IVA/redondeos, orden de llegada, duplicados, fuente cambiada, recuperación F0, anticipo asignado, capacidad, permisos, devolución pendiente/conciliada, cobertura sin dinero ficticio, reversión e inserciones concurrentes. Regresión de trabajadores/proyectos y frontend.
