-- Presupuestos para clientes y seguimiento de obra (/plataforma).
-- Own tables in public: the accounting budgets (ledens.budgets, budget_versions,
-- budget_lines, budget_approvals) belong to the accounting tooling and feed the
-- profitability report, so this flow neither writes nor references them.
--
-- A presupuesto is sent to one client (users.role = 'client') in versions. The
-- client approves, asks for changes (the team then sends a new version) or
-- rejects. An approved presupuesto with a start date is an «obra en curso»; an
-- ampliación (parent_id) is a presupuesto of its own, approved separately, whose
-- approved lines add to the parent obra. The jefe de obra (jefe_id) declares the
-- executed quantity of each line; prices are net of VAT, one VAT rate per version.
CREATE SEQUENCE presupuesto_ref_seq;

CREATE TABLE presupuestos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text NOT NULL UNIQUE DEFAULT 'PRE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('presupuesto_ref_seq')::text, 3, '0'),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  address     text CHECK (length(address) <= 300),
  client_id   uuid NOT NULL REFERENCES users (id),
  jefe_id     uuid REFERENCES users (id),
  parent_id   uuid REFERENCES presupuestos (id),
  start_date  date,
  end_date    date,
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  -- An ampliación takes its dates from the obra it extends.
  CHECK (parent_id IS NULL OR (start_date IS NULL AND end_date IS NULL))
);
CREATE INDEX presupuestos_client_idx ON presupuestos (client_id);
CREATE INDEX presupuestos_jefe_idx ON presupuestos (jefe_id);
CREATE INDEX presupuestos_parent_idx ON presupuestos (parent_id);

-- draft → sent → approved | changes_requested | rejected; a sent or
-- changes_requested version becomes superseded when a newer one is sent.
CREATE TABLE presupuesto_versiones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  number          integer NOT NULL CHECK (number > 0),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'changes_requested', 'superseded', 'approved', 'rejected')),
  vat_rate        numeric(5, 2) NOT NULL DEFAULT 21 CHECK (vat_rate >= 0 AND vat_rate < 100),
  notes           text CHECK (length(notes) <= 5000),
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_by         uuid REFERENCES users (id),
  sent_at         timestamptz,
  decided_by      uuid REFERENCES users (id),
  decided_at      timestamptz,
  UNIQUE (presupuesto_id, number)
);
-- At most one draft and one approved version per presupuesto.
CREATE UNIQUE INDEX presupuesto_versiones_one_draft ON presupuesto_versiones (presupuesto_id) WHERE status = 'draft';
CREATE UNIQUE INDEX presupuesto_versiones_one_approved ON presupuesto_versiones (presupuesto_id) WHERE status = 'approved';

CREATE TABLE presupuesto_capitulos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES presupuesto_versiones (id) ON DELETE CASCADE,
  position    integer NOT NULL CHECK (position > 0),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  UNIQUE (version_id, position)
);

-- kind: confirmada and condicionada always count; decision and opcion count
-- only when the client selects them on approval (selected).
CREATE TABLE presupuesto_partidas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id   uuid NOT NULL REFERENCES presupuesto_versiones (id) ON DELETE CASCADE,
  capitulo_id  uuid NOT NULL REFERENCES presupuesto_capitulos (id) ON DELETE CASCADE,
  position     integer NOT NULL CHECK (position > 0),
  code         text CHECK (length(code) <= 40),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  description  text CHECK (length(description) <= 4000),
  unit         text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  quantity     numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
  kind         text NOT NULL DEFAULT 'confirmada' CHECK (kind IN ('confirmada', 'condicionada', 'decision', 'opcion')),
  selected     boolean NOT NULL DEFAULT false,
  CHECK (NOT selected OR kind IN ('decision', 'opcion')),
  UNIQUE (capitulo_id, position)
);
CREATE INDEX presupuesto_partidas_version_idx ON presupuesto_partidas (version_id);

-- Conversation and decisions on a presupuesto. kind 'cambios' is the client
-- asking for a revision, 'rechazo' the client rejecting.
CREATE TABLE presupuesto_comentarios (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  version_id      uuid REFERENCES presupuesto_versiones (id) ON DELETE CASCADE,
  author_id       uuid REFERENCES users (id),
  kind            text NOT NULL DEFAULT 'comentario' CHECK (kind IN ('comentario', 'cambios', 'rechazo')),
  body            text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presupuesto_comentarios_idx ON presupuesto_comentarios (presupuesto_id, id);

-- Production declared by the jefe de obra: every declaration is kept, the latest
-- per line is the executed quantity. It may exceed the budgeted quantity (that
-- excess shows as consumed budget beyond the execution).
CREATE TABLE presupuesto_produccion (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partida_id   uuid NOT NULL REFERENCES presupuesto_partidas (id) ON DELETE CASCADE,
  executed     numeric(14, 3) NOT NULL CHECK (executed >= 0),
  note         text CHECK (length(note) <= 1000),
  declared_by  uuid REFERENCES users (id),
  declared_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presupuesto_produccion_idx ON presupuesto_produccion (partida_id, id DESC);
