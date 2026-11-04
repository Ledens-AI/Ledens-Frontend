-- English text of what a client reads in a presupuesto (chapter names, line
-- names and descriptions, the version notes), translated with Azure AI
-- Translator the first time someone opens it in English and kept here so the
-- same text is never sent twice (src/presupuestos/traducciones.js). Keyed by
-- the SHA-256 of the Spanish text: an edited line is simply a new text.
CREATE TABLE IF NOT EXISTS presupuesto_traducciones (
  lang         text NOT NULL CHECK (lang IN ('en')),
  source_hash  text NOT NULL CHECK (length(source_hash) = 64),
  translated   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, source_hash)
);
