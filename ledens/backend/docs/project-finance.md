# Project finance backend

## Verified installation and mapping

Inspected repository main `360306807849c4f6493227361cb521fc495dc347` and the live PostgreSQL catalog in read-only mode. Express 4, Node 20 ES modules, node-postgres. Existing session cookies and `users.role` remain unchanged (`admin`, `jefe`, `client`). The imported financial schema is managed separately from website migrations.

| Former Excel name | Existing PostgreSQL table | Existing project link |
|---|---|---|
| FactDocumentos | ledens.documents | Distributed through financial records/lines |
| FactMateriales | ledens.material_expenses | project_id UUID, nullable FK projects(id) |
| FactPagoTrabajadores | ledens.worker_payments | project_id UUID, nullable FK projects(id) |
| FactPagoClientes | ledens.customer_payments | project_id UUID, nullable FK projects(id) |
| BridgeMovimientoDocumento | ledens.bank_document_allocations | document_id and bank_movement_id UUID FKs |

Existing projects have internal UUID `id` and a separate legacy text `project_id` code. API project IDs always mean the UUID. Verified initial rows: 1,105 material records (1,029 assigned), 183 worker records (171 assigned), 43 customer receipts (39 assigned). Existing project_access permissions are not treated as permission to inspect finance: explicit financial grants are narrower. Existing business role tables were empty.

## Migrations and source integrity

005 adds the conservative bank Bridge, review cases, evidence confidence and signed allocation guards. 006 adds invoice lines, one-to-one financial source records, project distributions, audit events, idempotency requests, explicit permissions and a recognized accounting view. Each financial record references exactly ONE existing source using real foreign keys; no unvalidated polymorphic IDs. Imported source_id/raw_id provenance is untouched.

All existing nonzero cent-precision source records are registered, with their existing project links preserved as full allocations. They start `pending`: unknown currency, VAT treatment and revenue recognition are not guessed. Zero or sub-cent imported amounts remain in their original table and require source correction; no destructive rounding occurs. New source inserts are registered by triggers. Source updates invalidate approval, remove stale allocations, and record an audit event. Document accounting changes invalidate related approvals. Source deletion is blocked by foreign keys.

The canonical project distribution is project_financial_allocations. Its amount is the financial record's GROSS settlement basis, signed consistently with that record. Material/worker source amounts use the opposite of their legacy cash sign; customer receipts retain their cash sign. A supplier credit has negative economic gross. Full single-project allocations project into legacy project_id. Partial/multi-project distributions set the legacy field NULL; legacy importer updates are synchronized back into canonical allocations and audited as external source changes. The API remains the Business User interface. No bank movements or documents are duplicated.

Writers use transactions, a shared advisory lock with Bridge, row locks, optimistic version checks and a database allocation-capacity trigger. Bulk operations are all-or-nothing, maximum 100 records and 50 shares per record. request_id UUID plus payload hash prevents repeated application; changed payloads conflict. Audit records retain before/after snapshots, actor, timestamp, action and reason. There is no history deletion API.

## Financial meaning

- Only explicitly `approved` EUR records enter metrics. `pending` is review; `excluded` never enters totals.
- Review supplies net, VAT, non-deductible VAT, withholding and recognition date. Gross = net + VAT - withholding. Discounts must already be included in net. Taxes retain the credit/debit sign.
- Economic amount = net + non-deductible VAT. Deductible/repercuted VAT and withholdings do not inflate direct cost or revenue.
- Categories: materials, labor, subcontract, other_direct, revenue, advance, overhead, unclassified. Only the first four are direct costs. Overheads are visible but not included in direct result. Customer payment sources can only be advances/treasury, never recognized revenue. Revenue comes from issued invoice lines.
- Direct result = recognized revenue - direct costs. Margin is NULL when revenue is zero. These are NOT net profit figures.
- Shares distribute economic amounts by allocated gross / source gross. PostgreSQL NUMERIC performs calculations; decimal values are JSON strings. Retain full precision internally; round for display only.
- Treasury uses existing Confirmado document allocations and COMPLETED EUR bank movements. The record/document gross fraction distributes one settlement across multiple invoice lines and projects. Bank payments are never added again as costs.
- Advances without confirmed document links contribute cash only. Once a bank movement is linked to a document, its advance representation is excluded from cash to avoid duplication. Pending/unassigned invoice representations then remain visible for review.
- Pending collection/payment metrics use approved document gross less completed, confirmed bank settlements, proportionally by project. Credit notes reduce the amount due. Monthly evolution uses recognized_on, not the bank date. Bank-date cash history is not a recognized revenue chart.
- Budgets reuse accepted versions and the latest approved decision. A permitted reviewer confirms net-of-VAT basis through PUT /api/finance/budget-versions/{id}/basis. The line fingerprint invalidates that confirmation after edits. Current totals use the latest accepted/approved version per budget; base and approved revisions are separate. No verified budget returns NULL, never an invented zero. Existing approval workflows remain unchanged.

Approval refuses mixed legacy/invoice-line representations of a document and total approved line gross exceeding the document gross. Existing duplicate imported rows stay pending rather than being silently counted. Legacy multiple records from the same invoice may be approved only within its gross envelope. Source rows with zero/invalid amounts are flagged source_valid=false and cannot be approved or assigned until corrected.

## Ingestion and classification

The existing Logic App polls SharePoint Landing facturas every five minutes. Originals archive to the quarter of the invoice date. API bearer authentication, content hashing, duplicate-source protection, OCR limits and archive safeguards remain intact. OCR now retains individual concepts and confidence evidence. Known net+VAT lines create pending financial records; incomplete lines are exposed separately for human completion. If no line has a reliable gross amount, one reserved document-review envelope (line 10000) keeps the invoice visible in the pending queue without approving or duplicating cost. `POST /finance/documents/{id}/lines` can register a reviewed gross amount for an incomplete line. It is idempotent by (document_id,line_number).

No invoice is classified as materials solely because it was received. Existing typed source tables provide their category, issued invoices can be recognized as revenue, and new invoice concepts remain unclassified until reviewed. Exact project-code references produce suggestions with evidence and no invented confidence percentage. OCR suggestions never write a project automatically in this initial policy. Multiple candidates remain pending.

Bridge attempts immediately after archive when BRIDGE_ENABLED=true. POST /api/v1/facturas/ingesta/bridge/run is bearer-protected and available for a scheduled retry. Automatic matching requires a unique exact amount/reference/counterparty, known EUR/direction and high OCR confidence; fees, FX, unknown internal transfers, competing invoices and existing partial allocations stay pending. Reversed/changed automatic matches become Revisar. Manual/imported matches are preserved.

Revolut ingestion is outside this repository: bank accounts, provider metadata and existing movements were verified in PostgreSQL; no Revolut job configuration was modified or claimed to be deployed here. New imported financial source rows are registered by triggers. Later bank arrivals can be reconciled by the existing Bridge retry endpoint.

## Frontend integration (Claude)

Contract: [project-finance.openapi.json](project-finance.openapi.json). Regenerate with `node src/scripts/build-finance-openapi.js`. Backend is independent of React components.

1. GET /api/projects for selectors (UUID id; display code/name).
2. GET /api/finance/unassigned or /records?status=pending for review. Filter by type, project_id, search, from/to, min/max, sort; limit <=100, offset <=100000. Specialized materials/worker-payments/customer-payments routes use the same shape.
3. GET /api/finance/records/{id} gives current version, source document header/link, shares and authorized suggestions. Full document amounts and link require access to all its financial records; otherwise only the identifier/date/number are shown. IDs here are financial record IDs, with explicit material_id/worker_payment_id/customer_payment_id/invoice_line_id identifying original rows.
4. PATCH /api/finance/records/{id}/project for full single-project assignment or NULL removal. Always send version, request_id and reason.
5. POST /api/finance/allocations/bulk replaces each listed record's entire distribution. Empty list clears it; incomplete sums remain unassigned. Do not send incremental deltas. Reuse the same request_id/body on network retry; obtain a fresh version after 409.
6. PATCH /recognition for reviewed accounting/tax treatment. Project assignment alone does not approve economics.
7. GET /allocations and /history for detail and audit. GET /finance/documents/{id}/lines exposes incomplete OCR concepts.
8. GET /api/projects/{id}/financial-summary (alias profitability) for direct result and treasury. /financial-transactions returns paginated source records; /financial-evolution returns monthly recognized values.

Example bulk body (amounts include gross VAT and withholding effects):

```json
{"request_id":"<uuid>","reason":"Reparto de factura revisado","records":[{"record_id":"<financial-record-uuid>","version":1,"allocations":[{"project_id":"<marbella-uuid>","amount":"605.00"},{"project_id":"<velez-uuid>","amount":"605.00"}]}]}
```

A 1,210 gross / 1,000 net invoice split 605/605 gives each project 500 net cost. Worker gross 800 split 500/300 represents one source payment. A browser must send its existing session cookie, Content-Type application/json and same-site Origin. Do not store a service bearer in the frontend. 401 login, 403 permission/Origin, 409 stale/capacity/idempotency conflict, 503 unavailable. Existing API rate limit is 30 requests/minute per client; use pagination and bulk writes.

## Authorization and deployment

Admin has full financial access. Client is always denied. Jefes/other existing authenticated non-client roles need explicit per-project finance_project_permissions; can_write controls changes. Global NULL-project grants with can_review_unassigned enable the central pending queue. Shared records require access to every current project. Grant/update access using admin-only PUT /api/finance/permissions; DELETE on the same path revokes the grant. Both actions are audited. Existing general project_access does not by itself disclose finance. No auth replacement or automatic elevation.

Environment: existing DATABASE_URL and TLS configuration; existing CORS_ORIGIN must be the exact frontend origin for writes. Existing OCR/ingestion variables remain. Optional BRIDGE_ENABLED=true activates automation; BRIDGE_BUSINESS_TAX_ID defaults to verified company B19753805. No new financial service secrets.

Back up the existing database and verify imported accounting tables before deployment. Apply 005 then 006 through npm run migrate (startup uses the same runner and lock). These migrations depend on the verified accounting schema; do not run against an auth-only database. Deploy backend via the existing workflow. Smoke-test health, unauthenticated 401, admin pending queue and a read-only summary. Provision explicit Business User finance permissions. Enable Bridge only after its endpoint/migrations are deployed. The template ledens/infra/build-bank-bridge-logicapp.mjs generates an initially Disabled Consumption workflow with a 15-minute recurrence. Deploy it as ledens-bank-bridge, grant its managed identity Key Vault Secrets User scoped only to the invoice-ingest-token secret, and enable after backend deployment plus BRIDGE_ENABLED=true. Inputs/outputs containing the token are secured and run retention is seven days.

Tests: `npm test` runs isolated financial/ingestion/Bridge tests with PGlite. Existing authentication integration tests additionally require DATABASE_URL pointing to a dedicated test database. `FINANCE_TEST_DATABASE_URL=... node --test test/finance.test.js` runs critical tests on an EMPTY DISPOSABLE PostgreSQL database; NEVER point this at production because it creates fixtures. The development verification also uses a separate disposable database on the actual PostgreSQL server, without writing production ledger rows.

## Deliberate limits

EUR only; unsupported currency stays pending. No inferred tax deductibility or payroll accrual from a bank debit. Existing budget approvals are reused; this module does not approve commercial quotations. No probabilistic project auto-assignment. Lines missing tax/gross require review. No frontend components are included: this contract is for Claude. No Revolut scheduler is replaced. No general overhead allocation, amortization, financing or corporate tax is included in direct margin.
