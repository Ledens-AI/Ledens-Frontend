# Extractos de CaixaBank

Revolut llega por su API (job `ledens-revolut-daily`, fuera de este repositorio). CaixaBank no tiene API contratada: el extracto se descarga de la banca online en formato **Norma 43 (Cuaderno 43, .txt)** y se deja en SharePoint, `datasource/Caixabank/Landing`. A partir de ahí todo es automático y sus movimientos acaban en la misma tabla que los de Revolut, `ledens.bank_movements`, de modo que el Bridge, «Pendiente de conciliación» y el resto de pantallas los tratan igual.

## Recorrido

1. La Logic App `ledens-caixabank-statements` (cada 5 minutos) detecta el fichero nuevo en `Landing`, lee su contenido y lo envía a `POST /api/v1/facturas/ingesta/extractos/caixabank` con el mismo token que la ingesta de facturas (`invoice-ingest-token` en Key Vault).
2. El backend lee el fichero (`src/ingestion/norma43.js`) y lo rechaza entero (422, `norma43_*`) si algo no cuadra: registros de 80 caracteres, cabecera 11 / movimientos 22 / conceptos 23 / final 33 / fin 88, número y suma de apuntes al debe y al haber, saldo inicial + movimientos = saldo final, número de registros, divisa EUR (978) y entidad 2100 (CaixaBank).
3. Cada movimiento se inserta en `ledens.bank_movements` (`src/ingestion/caixabank.js`). Responde `{ status: "processed", movements, inserted, duplicates, period_from, period_to, replay }`.
4. Solo con `processed` la Logic App mueve el fichero a `datasource/Caixabank/Archive` (si ya hay uno con ese nombre se guarda con nombre nuevo). Con cualquier otra respuesta la ejecución falla, el fichero se queda en `Landing` y salta la alerta `ledens-caixabank-statements-failed`.

## Cómo queda cada movimiento

| Columna | Valor |
|---|---|
| `source_id` | `caixabank-<hash>`: cuenta, fechas, conceptos, importe, referencias y texto del movimiento, más su posición entre los idénticos |
| `completed_on` | fecha de operación (la fecha valor se guarda en `bank_statement_movements`) |
| `amount`, `total_amount` | importe con signo: debe negativo, haber positivo |
| `currency`, `state` | `EUR`, `COMPLETED` |
| `description` | los textos de los registros 23, sin repetir |
| `reference` | nº de documento y referencias 1 y 2 cuando no son ceros |
| `type` | según el concepto común: 04 `TRANSFER`, 12 `CARD_PAYMENT` / `CARD_REFUND`, 17 `CHARGE` / `INTEREST`, 03 `DIRECT_DEBIT`, 02 `DEPOSIT`, 11 `ATM`… (`movementType`) |
| `is_internal_transfer` | `false`; un traspaso entre cuentas propias lo marca la persona, como hasta ahora |
| `bank_account_id`, `payer`, `beneficiary_name` | sin valor: el extracto no trae contrapartida estructurada, y la cuenta queda en `bank_statement_movements.account` |

El Bridge solo enlaza solo con `TRANSFER`, `CARD_PAYMENT`, `CHARGE` y `TOPUP`; un recibo domiciliado (`DIRECT_DEBIT`) u otro tipo aparece en «Pendiente de conciliación» y se asigna a mano.

## Duplicados

- **El mismo fichero otra vez** (reintento, o subido dos veces): se reconoce por su SHA-256 (`ledens.bank_statement_files`) y no añade nada; responde `replay: true` y se archiva.
- **Extractos que se solapan** (descargar del 1 al 15 y luego del 10 al 20): el extracto no trae identificador de operación, así que el `source_id` sale del propio movimiento; el que ya estaba no se inserta otra vez. Dos movimientos idénticos el mismo día (dos compras iguales) son dos movimientos. Conviene descargar días completos: un extracto del día en curso puede quedar a medias.

## Tablas (migración 038)

- `ledens.bank_statement_files`: un fichero por contenido, con periodo y recuento (`movements`, `inserted`, `duplicates`).
- `ledens.bank_statement_movements`: por cada movimiento creado, su fichero, cuenta, fecha valor, conceptos común y propio, oficina y línea.

## Configuración

Sin variables obligatorias nuevas. Opcionales: `CAIXABANK_FOLDER` (por defecto `datasource/Caixabank/Landing`), `CAIXABANK_ARCHIVE_FOLDER`, y `CAIXABANK_ACCOUNTS` (IBAN o CCC separados por comas: rechaza extractos de cualquier otra cuenta).

## Despliegue

1. Desplegar el backend (migración 038 y endpoint).
2. `ledens/infra/deploy-caixabank-logicapp.ps1` crea la Logic App deshabilitada, reutilizando la conexión de SharePoint de facturas, con acceso solo al secreto del token, diagnóstico en `log-ledens` y alerta de fallo. Con `-Enable` queda activa.
3. Un fichero que ya estuviera en `Landing` antes de activarla no dispara el flujo: volver a subirlo.

## Pruebas

`test/caixabank-extracto.test.js` (PGlite, extractos sintéticos): lectura, rechazos por descuadre, tipos, inserción, reintento, solape, movimientos idénticos, otra entidad u otra cuenta, validación de la petición y el endpoint con su token.
