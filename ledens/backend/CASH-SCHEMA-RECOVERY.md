# Compatibilidad con efectivo importado

El backend intentaba crear `ledens.cash_movements` en 016, pero producción ya tenía esa tabla procedente de la importación, con `movimientoefectivoid`, `source_id`, `raw_id`, `concepto`, `tercero` y otros campos históricos. La transacción de 016 se revirtió y el backend siguió sirviendo con columnas ausentes. Esto rompió Pendiente de conciliación (`counterparty`) y Pendiente de trabajador (`cash_movement_id`). No fue una pérdida de documentos o pagos.

La nueva migración incremental **015z_adopt_legacy_cash.sql** se ordena antes de 016. Solo adopta la estructura histórica verificada, añade campos de aplicación y las relaciones de lotes, y crea la vista de tesorería. No modifica importes, conceptos, proyectos, referencias ni identificadores históricos. Los registros importados conservan `kind=NULL` y no se reinterpretan como nuevos pagos pendientes.

La adopción implementa los cambios de 016 dentro de una única transacción y solo entonces registra `016_cash_movements.sql` como equivalente aplicado. El ejecutor vuelve a consultar el historial antes de cada archivo, para no intentar crear otra vez la tabla. Si cualquier paso falla, todo se revierte y no se registra 016. No se editan las migraciones ya publicadas.

En instalaciones vacías la adopción no hace nada y 016 se ejecuta normalmente. En instalaciones que ya completaron 016 tampoco se cambian datos. Un esquema preexistente distinto del verificado provoca un error explícito en lugar de inventar una conversión.

La prueba `legacy-cash.test.js` usa el ejecutor real de migraciones sobre el esquema importado, comprueba conservación del pago histórico, ambos listados, alta y segregación de un pago nuevo y reinicio idempotente. CI repite la prueba en PostgreSQL 16 aislado. Las consultas de pendientes y contadores solo incluyen efectivo con tipo explícito `pago` o `cobro`.

Despliegue: usar el flujo normal de imagen y reinicio del backend; su arranque aplica la adopción pendiente antes de 016 y después continúa con las migraciones posteriores. No hace falta vaciar tablas ni editar el historial manualmente. No hay nuevas variables de producción. La consulta de diagnóstico en producción fue de estructura e historial exclusivamente; la aplicación de la reparación requiere autorización de despliegue.
