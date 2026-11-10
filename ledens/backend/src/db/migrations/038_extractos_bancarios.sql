-- Bank statements received as files (CaixaBank, Norma 43 .txt from SharePoint
-- «datasource/Caixabank/Landing»). Their movements are rows of
-- ledens.bank_movements like those of the Revolut sync, so nothing downstream
-- changes; these two tables only keep what that table has no column for.
--   bank_statement_files      one row per file content (SHA-256): a file sent
--                             again is recognised and adds nothing.
--   bank_statement_movements  for each movement a statement created: its file,
--                             account, value date and the bank's concept codes.
CREATE TABLE ledens.bank_statement_files (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bank           text        NOT NULL,
  content_sha256 text        NOT NULL UNIQUE CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_key     text        NOT NULL,
  filename       text        NOT NULL,
  period_from    date        NOT NULL,
  period_to      date        NOT NULL,
  movements      integer     NOT NULL CHECK (movements >= 0),
  inserted       integer     NOT NULL DEFAULT 0,
  duplicates     integer     NOT NULL DEFAULT 0,
  received_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledens.bank_statement_movements (
  bank_movement_id uuid PRIMARY KEY REFERENCES ledens.bank_movements (id),
  file_id          uuid NOT NULL REFERENCES ledens.bank_statement_files (id),
  account          text NOT NULL,
  value_date       date,
  concept_common   text,
  concept_own      text,
  office           text,
  line             integer
);
CREATE INDEX bank_statement_movements_file_idx ON ledens.bank_statement_movements (file_id);
