-- Gestión financiera: imputación de registros contables a proyectos.
--
-- Numbered 010 because production's schema_migrations also records 004_ledens_business
-- … 009_revolut_daily_sync, applied by the accounting import tooling (not in this
-- repo). Filenames must stay unique across both sources.
--
-- The accounting tables themselves (ledens.material_expenses, worker_payments,
-- customer_payments, projects, documents, bank_movements) are owned by that import and
-- already carry project_id uuid → ledens.projects(id). This migration does NOT alter
-- them; it only adds what the imputation screens need around them:
--   project_allocations — one record split across several projects (never duplicates
--                         the source amount; see the invariant trigger below)
--   imputation_reviews  — "marcar para revisión" and suggestions, kept apart from
--                         confirmed assignments
--   imputation_audit    — every assignment change, with previous/new project
CREATE SCHEMA IF NOT EXISTS ledens;

CREATE TABLE ledens.project_allocations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text        NOT NULL CHECK (source_type IN ('material', 'trabajador', 'cliente')),
  source_id   uuid        NOT NULL,
  project_id  uuid        NOT NULL,
  amount      numeric     NOT NULL CHECK (amount <> 0),
  pct         numeric     CHECK (pct IS NULL OR (pct > 0 AND pct <= 100)),
  origin      text        NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'automatica')),
  assigned_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, project_id)
);
CREATE INDEX project_allocations_project_idx ON ledens.project_allocations (project_id);

CREATE TABLE ledens.imputation_reviews (
  source_type          text        NOT NULL CHECK (source_type IN ('material', 'trabajador', 'cliente')),
  source_id            uuid        NOT NULL,
  needs_review         boolean     NOT NULL DEFAULT false,
  review_note          text,
  -- A suggestion is never an assignment: project_id on the source row is only
  -- written by a confirmed (manual or evidence-backed automatic) assignment.
  suggested_project_id uuid,
  suggestion_reason    text,
  updated_by           uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id)
);

CREATE TABLE ledens.imputation_audit (
  id              bigserial   PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  actor_label     text        NOT NULL,
  origin          text        NOT NULL CHECK (origin IN ('manual', 'automatica')),
  action          text        NOT NULL,
  source_type     text        NOT NULL CHECK (source_type IN ('material', 'trabajador', 'cliente')),
  source_id       uuid        NOT NULL,
  old_project_id  uuid,
  new_project_id  uuid,
  old_allocations jsonb,
  new_allocations jsonb,
  reason          text
);
CREATE INDEX imputation_audit_source_idx ON ledens.imputation_audit (source_type, source_id, at DESC);
CREATE INDEX imputation_audit_at_idx ON ledens.imputation_audit (at DESC);

-- Amount a record can distribute: the same column the screens show as "Importe".
CREATE FUNCTION ledens.imputable_amount(p_type text, p_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric;
BEGIN
  IF p_type = 'material' THEN SELECT total INTO v FROM ledens.material_expenses WHERE id = p_id;
  ELSIF p_type = 'trabajador' THEN SELECT amount INTO v FROM ledens.worker_payments WHERE id = p_id;
  ELSIF p_type = 'cliente' THEN SELECT total INTO v FROM ledens.customer_payments WHERE id = p_id;
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION ledens.source_project_id(p_type text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid;
BEGIN
  IF p_type = 'material' THEN SELECT project_id INTO v FROM ledens.material_expenses WHERE id = p_id;
  ELSIF p_type = 'trabajador' THEN SELECT project_id INTO v FROM ledens.worker_payments WHERE id = p_id;
  ELSIF p_type = 'cliente' THEN SELECT project_id INTO v FROM ledens.customer_payments WHERE id = p_id;
  END IF;
  RETURN v;
END $$;

-- Invariant: a split never adds up to more than the record itself, every part has
-- the record's sign (credit notes stay negative), and a split record has no single
-- project_id at the same time. Deferred so the API can replace a whole split
-- (delete + insert + clear project_id) inside one transaction.
CREATE FUNCTION ledens.check_project_allocations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  total numeric;
  allocated numeric;
  bad_sign int;
BEGIN
  FOR r IN SELECT DISTINCT t.source_type, t.source_id
             FROM (SELECT NEW.source_type, NEW.source_id WHERE TG_OP <> 'DELETE'
                   UNION ALL
                   SELECT OLD.source_type, OLD.source_id WHERE TG_OP <> 'INSERT') t (source_type, source_id)
  LOOP
    SELECT sum(amount), count(*) FILTER (WHERE sign(amount) <> sign(ledens.imputable_amount(r.source_type, r.source_id)))
      INTO allocated, bad_sign
      FROM ledens.project_allocations WHERE source_type = r.source_type AND source_id = r.source_id;
    CONTINUE WHEN allocated IS NULL; -- every part was removed
    total := ledens.imputable_amount(r.source_type, r.source_id);
    IF total IS NULL THEN
      RAISE EXCEPTION 'registro % % no existe o no tiene importe', r.source_type, r.source_id USING ERRCODE = '23503';
    END IF;
    IF bad_sign > 0 OR abs(allocated) > abs(total) THEN
      RAISE EXCEPTION 'la distribución (%) supera o no coincide en signo con el importe del registro (%)', allocated, total
        USING ERRCODE = '23514';
    END IF;
    IF ledens.source_project_id(r.source_type, r.source_id) IS NOT NULL THEN
      RAISE EXCEPTION 'un registro distribuido no puede tener además project_id' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER project_allocations_invariant
  AFTER INSERT OR UPDATE OR DELETE ON ledens.project_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledens.check_project_allocations();

-- Same pattern as 004_invoice_ingestion: an auth-only database (local dev before the
-- accounting import) still migrates; the foreign keys are added whenever the
-- accounting tables are already there, which they are in production.
DO $$ BEGIN
  IF to_regclass('ledens.projects') IS NOT NULL THEN
    ALTER TABLE ledens.project_allocations ADD CONSTRAINT project_allocations_project_fkey
      FOREIGN KEY (project_id) REFERENCES ledens.projects (id);
    ALTER TABLE ledens.imputation_reviews ADD CONSTRAINT imputation_reviews_suggested_project_fkey
      FOREIGN KEY (suggested_project_id) REFERENCES ledens.projects (id);
  END IF;
END $$;
