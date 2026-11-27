# Avisos de transacciones de Ledens

Destinatarios: alvaro.navarro@ledens.es y ajnavarrosilva@gmail.com (campo To separado por «;»; también en los grupos de acción de Azure Monitor), salvo los mensajes con destinatario propio (más abajo). Remitente: la cuenta Microsoft 365 autorizada en office365-ledens-alerts. Sin contraseñas en el código.

## Cobertura

Recepción, extracción correcta, documentos en revisión, archivo trimestral, duplicados detectados, conciliación confirmada o parcial, Bridge pendiente/revisión, modificaciones de asignación y validación contable, errores técnicos de las rutas de ingesta y evaluaciones Bridge. No se notifican las comprobaciones sin archivos, el estado OCR analyzing ni los reintentos que no cambian el resultado. Los movimientos históricos sin una nueva operación no generan una ráfaga de avisos. Se incluyen documentos de las últimas 24 horas al aplicar la migración, para avisar del documento de prueba.

El mensaje incluye fecha e ID del evento, estado, motivo, archivo/documento, importes y conceptos, movimientos y sus referencias, importe Bridge y saldo de conceptos sin proyecto. Datos del evento y estado actual se distinguen. Los importes conservan el signo de origen y nunca se suman facturas con pagos como costes. El correo no adjunta originales ni contiene credenciales.

## Cola y entrega

011_transaction_alerts.sql crea una cola con eventos capturados dentro de las transacciones de negocio. Unicidad por operación/estado evita el correo por cada reintento. Los errores idénticos se agrupan por hora. Los eventos quedan guardados si Outlook falla.

Logic App Consumption ledens-transaction-alerts, cada 5 minutos, una ejecución simultánea, máximo 10 mensajes por lote, envío secuencial a destinatarios fijos, o al campo `to` del mensaje cuando lo trae (`To = @coalesce(items('Deliver_messages')?['to'], '<destinatarios fijos>')`). POST /api/v1/facturas/ingesta/notifications/claim reserva 30 minutos. POST /notifications/{id}/ack con lease_token y delivered confirma o programa reintento en 15 minutos. Autenticación Bearer existente; el navegador no recibe acceso a estos endpoints.

La entrega es al menos una vez: si Outlook acepta el correo pero se pierde la respuesta o falla la confirmación, podría repetirse. El ID de evento permite identificarlo. No se promete entrega exactamente una vez por SMTP/Outlook. Los errores de correo no revierten facturas ni conciliaciones. Los eventos se conservan para auditoría; no existe limpieza automática destructiva.

## Mensajes con destinatario propio: invitaciones de cliente

Las invitaciones de cliente (migración 023, `src/invitaciones/service.js`) usan la misma cola y la misma Logic App, con `event_type = 'invitation'`. La fila de la cola solo guarda el id de la invitación y su número de envío (`payload = { invitacion_id, sent_count }`), nunca el enlace.

- Al reclamar (`claim`), `AlertService` llama a `invitationMessage`: genera en ese momento el token del enlace, guarda solo su SHA-256 en `invitaciones.token_hash` y devuelve el mensaje con `to` (el email invitado), `subject` y `html` en el idioma elegido (ES/EN). El enlace es `<PUBLIC_APP_URL>/invitacion#<token>`: el token va en el fragmento, que el navegador no envía a ningún servidor.
- Si la invitación ya no está abierta (aceptada, revocada, caducada) o un reenvío la ha sustituido (otro `sent_count`), el mensaje se cierra sin enviarse (`last_error = 'invitation_not_pending'`).
- Un reintento tras un fallo de Outlook vuelve a reclamar y genera un token nuevo, que invalida el anterior: con la entrega al menos una vez, si llegan dos correos solo funciona el último enlace.
- El correo no incluye datos del presupuesto, solo el título de la obra, quién invita y la caducidad.

Los **enlaces para crear o restablecer la contraseña** (migración 025, `src/auth/passwordLinks.js`) siguen el mismo camino con `event_type = 'password_link'` y `payload = { link_id }`: el token se genera al reclamar, el enlace es `<base>/contrasena#<token>` y un enlace usado, caducado o sustituido por otro más reciente se cierra sin enviarse (`password_link_not_pending`).

`PUBLIC_APP_URL` (opcional) es la base del enlace; por defecto el host de SWA de producción.

## Aviso de cada alta de usuario

La migración 052 añade un trigger en `users` (`users_registered_alert`): cuando `registered_at` pasa de vacío a una fecha — la primera sesión de una cuenta creada al registrarse con contraseña, con Google/Microsoft, al aceptar una invitación o con un enlace para compartir una obra, o un registro que toma la fila que el equipo había preparado para ese email — encola **un** mensaje con `event_type = 'user_registered'` y `payload = { user_id }` (clave `user_registered:<id>`, así que nunca se repite). Las cuentas ya dadas de alta al aplicar la migración no se avisan.

- Al reclamar, `AlertService` llama a `userRegisteredMessage` (`src/notifications/altas.js`), que compone el correo en ese momento: nombre, email, rol, fecha de alta (hora de Madrid), con qué entra (Google, Microsoft, email y contraseña), si el email está verificado, las obras que ya ve (cliente principal o solo lectura, y si llegó por invitación o enlace) y un aviso si la cuenta espera a confirmar su email (`access_held`).
- Destinatario propio (campo `to`): `AVISO_ALTAS_TO` si está definida (varios separados por «;»), si no `alvaro.navarro@ledens.es`. No va a los destinatarios fijos de los avisos de transacciones.
- Si el usuario ya no existe al reclamar, el mensaje se cierra sin enviarse (`user_registered_not_pending`).
- Misma Logic App y misma entrega al menos una vez que el resto de mensajes; un correo puede llegar hasta unos 5 minutos después del alta.

## Despliegue

1. Fusionar y desplegar backend; el mecanismo habitual aplica migración 011. CI ejecuta integración PostgreSQL 16.
2. Autorizar office365-ledens-alerts con la cuenta remitente.
3. Generar plantilla con node ledens/infra/build-transaction-alerts-logicapp.mjs work/transaction-alerts-logicapp.json. Desplegar inicialmente Disabled.
4. Conceder a su identidad administrada Key Vault Secrets User solo sobre invoice-ingest-token, previa autorización explícita solicitada al usuario.
5. Preparar alertas Azure Monitor RunsFailed para ingesta, Bridge y correo (transaction-alerts-monitoring.json), con grupo de acción por email. Esto cubre errores antes de que el backend pueda escribir en la cola.
6. Activar tras validar backend y conexión; comprobar una entrega real y su delivered_at antes de considerarlo operativo.

Para las alertas no hay nuevas variables de entorno de backend (las invitaciones añaden `PUBLIC_APP_URL`, opcional). Se reutiliza INGEST_TOKEN_SHA256; la Logic App obtiene el token de Key Vault. Las nuevas ejecuciones y acciones consumen el plan de Logic Apps existente y Microsoft 365 requiere un buzón habilitado. El sincronizador Revolut externo conserva sus alertas existentes; esta entrega no sustituye su implementación ni notifica cada movimiento histórico importado.

## Estado de activación

Activo y verificado (4 Nov 2026): la conexión Outlook `office365-ledens-alerts` está `Connected`, la Logic App `ledens-transaction-alerts` está `Enabled` y corre cada 5 minutos; una entrega real de `password_link` se comprobó de extremo a extremo (`Claim_messages` → `Send_email` → `Mark_delivered`, los tres `Succeeded`). Las invitaciones de cliente usan la misma cola y Logic App, así que también deberían entregarse — si una parece no haber llegado, reenviarla cuenta como una entrega nueva, no hace falta reactivar nada.
