# Confianza del 50 % y recuperación de liquidación municipal

INVOICE_MIN_CONFIDENCE=0.5 es la política común de fecha, importe, referencia, dirección, tercero y NIF del Bridge. Los valores originales de Azure no se sobrescriben ni inflan. El 50 % es inclusivo; una fecha imposible y las comprobaciones de identidad, referencia, divisa, signo, ambigüedad y saldo se siguen validando.

El ICIO analizado se rechazó con InvoiceDate confidence=0.669 (fecha 22/09/2026). Azure trató la base del impuesto (8472.15) y el tipo (3.20 %) como partidas. La cuota es 271.11. Son campos dentro de la propia liquidación; no un presupuesto independiente subido a la carpeta.

El perfil municipal verifica que la cuota coincide con la base por el tipo y que la fecha aparece corroborada en texto, y excluye base/tipo de las líneas financieras. Una liquidación municipal requiere revisión de su naturaleza y titular; no se fuerza que el contribuyente sea la sociedad.

Herramienta de operador: node src/scripts/recover-municipal.js INGESTION_UUID ADMIN_UUID --preview (sin cambios) o --apply. Exige usuario administrador existente, expediente y tercero bancarios únicos, cuota exacta y comisión explícita consistente. Recupera el documento existente, crea un único concepto other_direct pendiente sin proyecto ni aprobación contable y conserva las lecturas OCR incorrectas en evidence. El provisional bancario anterior se excluye e invalida; sus asignaciones y auditoría se conservan. No hay borrado físico de datos ni cambios de importes bancarios. Las consultas financieras de la interfaz excluyen registros inválidos o excluidos, y la API canónica conserva su historial.

La conciliación usa BridgeService.confirm con actor, motivo, versión, fingerprints e idempotencia. Es una corrección de operador autorizada, no una falsa conciliación automática ni una subida artificial de confianza OCR. El pago de 271.11 se concilia contra el cargo total 271.31; la comisión 0.20 sigue separada como diferencia bancaria y no se añade a la liquidación. No se fabrica un justificante de comisión.

Tras la recuperación, reanudar la ejecución original de ingesta en Logic Apps para trasladar el original al trimestre de su fecha. El reprocesamiento reutiliza la misma ingesta por hash y origen.

Sin migraciones ni variables de entorno nuevas. Incluye pruebas de umbral, cuota/base, fecha de expedición frente a vencimiento, recuperación repetida, auditoría, conservación de asignaciones previas y comisión separada.
