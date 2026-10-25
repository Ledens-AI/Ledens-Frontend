# Invoice ingestion

`POST /api/v1/facturas/ingesta` accepts authenticated requests from the SharePoint flow.
The secret must be a random base64url token (32+ random bytes). Only its SHA-256 is
configured as `INGEST_TOKEN_SHA256` in the backend. Do not reuse website sessions.
Requests are authenticated before the 6 MB JSON parser runs. Raw files are limited
to 4 MB and PDF/PNG/JPEG. The other API endpoints retain their 64 KB limit.

## Configuration

- `INGEST_TOKEN_SHA256`: lowercase hexadecimal SHA-256 of the bearer token.
- `INGEST_SITE_URL`: `https://ledenses.sharepoint.com/sites/ledens.es`.
- `INGEST_FOLDER`: `datasource/Landing facturas`.
- `INGEST_ARCHIVE_ROOT`: `datasource`.
- `DI_ENDPOINT`: approved Document Intelligence resource endpoint.
- `DI_KEY`: Key Vault-backed Container App secret reference.
- Existing `DATABASE_URL` and `DATABASE_SSL` remain in use.

Migration 004 adds two ingestion tables. It does not replace or alter the existing
accounting fields or legacy import IDs. The accounting tables must already exist
for the endpoint to work. There is one document per SHA-256, with separate source
records for duplicate uploads. A source with changed content returns 409 instead
of silently replacing a previously processed invoice. Transaction-scoped advisory
locks and unique constraints enforce this across replicas.

## Contract

```json
{
  "site_url": "https://ledenses.sharepoint.com/sites/ledens.es",
  "library": "Shared Documents",
  "folder": "datasource/Landing facturas",
  "item_id": "123",
  "filename": "invoice.pdf",
  "content_base64": "..."
}
```

202 means the document and source were committed durably. 200 means replay or
duplicate. Always inspect `duplicate`: a different source with identical bytes
must remain in Landing for review and must not move the canonical original again.

The flow calls `POST /:ingestion_id/process` every five seconds (maximum 15 minutes).
The first call starts prebuilt-invoice analysis; later calls poll its stored
operation URL. Status is durable across flow retries and backend restarts.
PDFs longer than two pages (Document Intelligence F0 reads two at most) send only their first page to the OCR: number, date, base, VAT and total are expected there. The stored hash, duplicate detection and the archived original are always the complete file. A PDF held earlier as `f0_page_limit` is analysed when it arrives again (replay or re-upload, which is then reported as non-duplicate so the Logic App processes it). Encrypted/unreadable PDFs, or one whose first page cannot be extracted, go directly to `review`.
Direction: our tax id (`BRIDGE_BUSINESS_TAX_ID`, B19753805) as seller makes the invoice `Cobrar`, as buyer `Pagar`. A supplier invoice where the OCR does not find ours (utilities, telecoms…) is still `Pagar` when the seller has a valid tax id that is not ours; that tax id's confidence is the direction confidence, so it must reach `INVOICE_MIN_CONFIDENCE`. Without a seller tax id, or with ours on both sides, it stays in `review` as `invoice_direction_requires_review`. An invoice held for that reason before this rule is analysed again when it arrives again, unless its document already has bank links.
The original stays in SharePoint. Temporary bytes in PostgreSQL are cleared after
OCR finishes or the document is sent to review. There is no extra original-file
archive in Azure storage.

Only one detected invoice with a valid `InvoiceDate` at confidence >= 0.90 produces
`ready`. The quarter is calculated from that date, never from upload/registration
date. Other extracted fields remain subject to accounting review; no bank Bridge
is fabricated. `review_state` remains `pendiente_revision`.

The flow resolves an existing quarter folder by ignoring spaces in its name.
Missing or ambiguous folders fail visibly rather than creating a new filing scheme.
Move file must use conflict behavior 0 (fail), never overwrite/rename. Only after
the successful SharePoint move does `POST /:id/archive` update `enlacearchivo`.
Its body is `{ "archive_url": "https://..." }`, validated against the expected
site, root, quarter and original filename. Archive acknowledgment is idempotent.

## Power Automate

The active production automation is **Azure Logic Apps Consumption**, named
`ledens-invoice-ingestion` in `rg-ledens` (West Europe), polling every five minutes.
Power Automate was suspended because HTTP requires Premium, and remains a reference.
No Power Automate Premium subscription was purchased.

`ledens/infra/deploy-invoice-logicapp.ps1` reproduces the Logic App using the live
SharePoint connector schema. Its default is Disabled; after authorizing the new
SharePoint connection, pass `-Enable`. Existing authenticated connections are
preserved. The Logic App's system identity can read only the `invoice-ingest-token`
secret in Key Vault. It fetches that secret during the run: no ingestion credential
is embedded in the workflow definition. Secure outputs also cover the trigger
(SharePoint may return invoice thumbnails), and run history retention is seven days.

Live verification: a synthetic PDF uploaded through the OneDrive sync folder was
received, extracted as 30 September 2025, moved to the existing `3T-2025` folder and
acknowledged in PostgreSQL. An identical copy produced no second document and
remained in Landing. A synthetic document without a date stayed pending review.

### Legacy Power Automate template

Generate a secret-free update using `ledens/infra/build-invoice-flow.mjs` with the
current flow JSON, output path and API URL. Preserve its existing SharePoint
connection. Replace `__LEDENS_INGEST_TOKEN__` only in memory during deployment,
using the Key Vault secret `invoice-ingest-token`. Never commit the resulting
secret-bearing definition. HTTP action headers are visible to flow editors;
restrict flow ownership accordingly and rotate via Key Vault + flow update.
Secure inputs and outputs hide invoices and credentials in run history.

HTTP is a Premium Power Automate action; the owner needs a suitable license.
The existing trigger polls once per minute. It is not a local filesystem watcher:
local arrivals trigger after OneDrive finishes syncing the file into SharePoint.
Use one invoice per file. Large/unsupported files, same-name overwrites and moved
existing files require operator follow-up. A failed move leaves ingestion `ready`;
if a move succeeded but acknowledgment failed, confirm the actual SharePoint
location before resubmitting the archive acknowledgment. Do not blindly overwrite.

## Verification

`npm test` includes an isolated PostgreSQL-compatible PGlite suite for ingestion,
PDF limits, authentication, OCR decisions and source/content replay. Existing auth
integration tests additionally require a real `DATABASE_URL` and otherwise skip.
Test actual OCR, two identical arrivals and the final moved file in SharePoint
before processing real invoices. No automatic bank allocation is implemented here.
