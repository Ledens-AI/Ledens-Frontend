-- Lines of a presupuesto matched against the base de partidas (DimPartida,
-- ledens.work_items), as the PDF import does (src/presupuestos/catalog.js).
-- * base_code: the id_partida it was matched to (a snapshot of the code, not a
--   foreign key: ledens.* belongs to the accounting tooling).
-- * annotations: what the team must know about the line — price different
--   from the base (the PDF price is kept), the PDF code pointing to another
--   partida, inactive partida, untranslated text… [{type, text}], team only.
ALTER TABLE presupuesto_partidas ADD COLUMN base_code text CHECK (length(base_code) <= 40);
ALTER TABLE presupuesto_partidas ADD COLUMN annotations jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(annotations) = 'array');

-- A line that no partida of the base covers becomes a proposed new partida.
-- It only reaches ledens.work_items when an admin approves it: then it is
-- appended with the next free PA-### (and, if needed, the next CAT-###);
-- existing partidas are never modified.
CREATE TABLE partida_propuestas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partida_id      uuid REFERENCES presupuesto_partidas (id) ON DELETE SET NULL,
  presupuesto_id  uuid REFERENCES presupuestos (id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  category_code   text CHECK (length(category_code) <= 20),
  category_name   text CHECK (length(category_name) <= 200),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  definition      text CHECK (length(definition) <= 4000),
  unit            text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  price_incl_vat  numeric(14, 6) CHECK (price_incl_vat >= 0),
  price_source    text CHECK (length(price_source) <= 300),
  nearest_code    text CHECK (length(nearest_code) <= 40),
  reason          text CHECK (length(reason) <= 1000),
  origin          text CHECK (length(origin) <= 1000),
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id),
  decided_at      timestamptz,
  decision_note   text CHECK (length(decision_note) <= 1000),
  created_code    text CHECK (length(created_code) <= 40)
);
CREATE INDEX partida_propuestas_status_idx ON partida_propuestas (status, created_at);
