-- Fotos y documentos de obra (/plataforma). The jefe de obra assigned to an obra
-- (presupuestos.jefe_id) or an admin uploads them; the client of that obra
-- (presupuestos.client_id) sees and downloads them. Files hang from the root
-- presupuesto (parent_id IS NULL): an ampliación shares its obra's files.
--
-- Only metadata lives here; the bytes are in Azure Blob Storage (or a local
-- folder in development) under storage_key, see src/obras/storage.js.
-- Withdrawing a file deletes its bytes and keeps the row (deleted_at/by) as the
-- record of what was published and when it was removed.
CREATE TABLE obra_archivos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos (id),
  kind            text NOT NULL CHECK (kind IN ('foto', 'documento')),
  storage_key     text NOT NULL UNIQUE,
  mime            text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf')),
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  original_name   text NOT NULL CHECK (length(btrim(original_name)) BETWEEN 1 AND 255),
  title           text CHECK (length(title) <= 200),
  description     text CHECK (length(description) <= 2000),
  taken_on        date NOT NULL,
  -- JPEG preview made by the uploader's browser; NULL until it arrives (HEIC
  -- photos outside Safari never get one).
  thumb_key       text UNIQUE,
  thumb_bytes     integer CHECK (thumb_bytes > 0),
  uploaded_by     uuid REFERENCES users (id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  deleted_by      uuid REFERENCES users (id),
  deleted_at      timestamptz,
  CHECK ((kind = 'documento') = (mime = 'application/pdf')),
  CHECK (kind = 'foto' OR thumb_key IS NULL),
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX obra_archivos_obra_idx ON obra_archivos (presupuesto_id, kind, taken_on DESC) WHERE deleted_at IS NULL;
