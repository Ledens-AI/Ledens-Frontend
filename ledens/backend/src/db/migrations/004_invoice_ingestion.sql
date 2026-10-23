-- The accounting schema is managed separately from the website's auth schema.
-- Never create an incompatible replacement for the accounting tables.
CREATE SCHEMA IF NOT EXISTS ledens;
CREATE TABLE ledens.invoice_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  content_hash text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL,
  content bytea,
  status text NOT NULL CHECK (status IN ('received','analyzing','ready','review','archived')),
  reason text,
  operation_url text,
  invoice_date date,
  date_confidence numeric,
  destination_folder text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledens.invoice_sources (
  source_key text PRIMARY KEY,
  ingestion_id uuid NOT NULL REFERENCES ledens.invoice_ingestions(id),
  source_item_id text NOT NULL,
  filename text NOT NULL,
  is_duplicate boolean NOT NULL DEFAULT false,
  archive_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_sources_ingestion_idx ON ledens.invoice_sources(ingestion_id);
-- Auth-only installations do not yet have the accounting schema. They can
-- still start; ingestion returns 503 until the accounting tables are imported.
DO $$ BEGIN
  IF to_regclass('ledens.documents') IS NOT NULL THEN
    ALTER TABLE ledens.invoice_ingestions ADD CONSTRAINT invoice_document_fkey
      FOREIGN KEY (document_id) REFERENCES ledens.documents(id);
  END IF;
END $$;
