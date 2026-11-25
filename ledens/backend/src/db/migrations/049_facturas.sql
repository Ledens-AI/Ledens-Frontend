-- Facturas a clientes, emitidas desde la página de un proyecto en «Presupuestos
-- y obras» (src/facturas/service.js). Own tables in public: ledens.* belongs to
-- the accounting import, so project ids are plain uuids without foreign keys
-- (like presupuestos.project_id, migration 033), and an invoice issued here is
-- not written into ledens.documents.

-- The billing data of a project's client (name, CIF/NIF, address…): what the
-- accounting does not have. Filled the first time an invoice is issued and
-- offered again for the next ones; the latest values win.
CREATE TABLE proyecto_facturacion (
  project_id  uuid PRIMARY KEY,
  nombre      text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 200),
  nif         text NOT NULL CHECK (length(nif) BETWEEN 3 AND 20),
  direccion   text NOT NULL CHECK (length(btrim(direccion)) BETWEEN 1 AND 300),
  telefono    text CHECK (length(telefono) <= 40),
  email       text CHECK (length(email) <= 200),
  updated_by  uuid REFERENCES users (id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One invoice, written once: the issuer, the client and the amounts are a
-- snapshot, so the PDF is always the same whatever changes later. Never
-- updated or deleted (a mistake is corrected with a rectifying invoice).
CREATE TABLE facturas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            text NOT NULL CHECK (length(btrim(numero)) BETWEEN 1 AND 30),
  fecha             date NOT NULL,
  project_id        uuid NOT NULL,
  project_code      text,
  project_name      text,
  emisor            jsonb NOT NULL,
  cliente_nombre    text NOT NULL,
  cliente_nif       text NOT NULL,
  cliente_direccion text NOT NULL,
  cliente_telefono  text,
  cliente_email     text,
  concepto          text NOT NULL CHECK (length(btrim(concepto)) BETWEEN 1 AND 500),
  base              numeric(12, 2) NOT NULL,
  iva_pct           numeric(5, 2) NOT NULL CHECK (iva_pct >= 0 AND iva_pct < 100),
  iva               numeric(12, 2) NOT NULL,
  total             numeric(12, 2) NOT NULL CHECK (total > 0),
  porcentaje        numeric(5, 2) CHECK (porcentaje > 0 AND porcentaje <= 100),
  created_by        uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (base + iva = total)
);
CREATE UNIQUE INDEX facturas_numero_unico ON facturas (upper(btrim(numero)));
CREATE INDEX facturas_proyecto_idx ON facturas (project_id, fecha DESC, created_at DESC);

CREATE FUNCTION facturas_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Una factura emitida no se modifica ni se borra: emite una factura rectificativa';
END $$;
CREATE TRIGGER facturas_no_update BEFORE UPDATE OR DELETE ON facturas FOR EACH ROW EXECUTE FUNCTION facturas_inmutables();
