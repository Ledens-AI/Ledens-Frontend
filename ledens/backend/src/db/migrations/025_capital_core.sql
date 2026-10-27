-- Ledens Capital, fase 1 (design-source/ledens-capital/SPEC.md §6). Esquema
-- propio: no toca public (reformas) ni ledens.* (contabilidad, de otra
-- herramienta). Importes en euros con céntimos.
CREATE SCHEMA IF NOT EXISTS capital;

-- Inversores (partícipes). Una cuenta de users por persona o sociedad; el
-- estado decide qué ve: solo `approved` accede a oportunidades y cartera.
CREATE TABLE capital.members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  kind          text        NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'company')),
  status        text        NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'accepted', 'pending_verification', 'pending_approval', 'approved', 'suspended', 'revoked')),
  status_reason text,
  legal_name    text,
  company_name  text,
  tax_country   text,
  approved_at   timestamptz,
  approved_by   uuid        REFERENCES users (id),
  created_by    uuid        REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Equipo de Capital. Aparte de users.role para no mezclar los roles de la
-- plataforma de reformas con los de la de inversión.
CREATE TABLE capital.staff_roles (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('super_admin', 'investment_manager', 'project_manager', 'finance_manager', 'compliance', 'investor_relations')),
  granted_by uuid        REFERENCES users (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE capital.projects (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text          NOT NULL UNIQUE,
  name                 text          NOT NULL,
  location_public      text          NOT NULL,
  -- Solo se muestra a quien tiene una asignación aprobada.
  location_full        text,
  strategy             text          NOT NULL CHECK (strategy IN ('flip', 'rental', 'hybrid')),
  status               text          NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'coming_soon', 'open', 'allocation_review', 'funded', 'in_progress', 'completed')),
  manager_entity       text          NOT NULL,
  external_target      numeric(14,2) NOT NULL CHECK (external_target > 0),
  manager_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (manager_contribution >= 0),
  min_contribution     numeric(14,2) NOT NULL CHECK (min_contribution > 0),
  commitment_deadline  date,
  summary              text,
  risk_summary         text,
  published_at         timestamptz,
  created_by           uuid          REFERENCES users (id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);

-- Versiones del plan financiero: supuestos, escenarios y estructura de
-- distribución (forma en src/capital/engine.js). Una versión aprobada no se
-- edita: se crea otra. La aprueba alguien distinto de quien la creó.
CREATE TABLE capital.plan_versions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES capital.projects (id) ON DELETE CASCADE,
  version     integer     NOT NULL,
  plan        jsonb       NOT NULL,
  status      text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'superseded')),
  note        text,
  created_by  uuid        NOT NULL REFERENCES users (id),
  approved_by uuid        REFERENCES users (id),
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE UNIQUE INDEX plan_versions_one_approved ON capital.plan_versions (project_id) WHERE status = 'approved';

-- Qué miembro ve qué operación: las oportunidades son por invitación.
CREATE TABLE capital.project_access (
  project_id uuid        NOT NULL REFERENCES capital.projects (id) ON DELETE CASCADE,
  member_id  uuid        NOT NULL REFERENCES capital.members (id) ON DELETE CASCADE,
  granted_by uuid        REFERENCES users (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

-- Cada solicitud de participación y sus cinco estados (SPEC.md §2.2):
-- requested → allocated → signed → funded → effective; o rejected/withdrawn.
CREATE TABLE capital.commitments (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid          NOT NULL REFERENCES capital.projects (id),
  member_id        uuid          NOT NULL REFERENCES capital.members (id),
  plan_version_id  uuid          NOT NULL REFERENCES capital.plan_versions (id),
  status           text          NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested', 'allocated', 'signed', 'funded', 'effective', 'rejected', 'withdrawn')),
  requested_amount numeric(14,2) NOT NULL CHECK (requested_amount > 0),
  allocated_amount numeric(14,2) CHECK (allocated_amount > 0 AND allocated_amount <= requested_amount),
  signed_amount    numeric(14,2) CHECK (signed_amount > 0),
  contract_ref     text,
  closed_reason    text,
  requested_at     timestamptz   NOT NULL DEFAULT now(),
  allocated_at     timestamptz,
  signed_at        timestamptz,
  funded_at        timestamptz,
  effective_at     timestamptz,
  closed_at        timestamptz,
  updated_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX commitments_member_idx ON capital.commitments (member_id);
CREATE INDEX commitments_project_idx ON capital.commitments (project_id);
-- Una solicitud abierta por persona y operación.
CREATE UNIQUE INDEX commitments_one_open ON capital.commitments (project_id, member_id)
  WHERE status IN ('requested', 'allocated', 'signed', 'funded');

-- Cada documento confirmado, con su versión: no una casilla genérica.
CREATE TABLE capital.acknowledgements (
  commitment_id    uuid        NOT NULL REFERENCES capital.commitments (id) ON DELETE CASCADE,
  document_key     text        NOT NULL,
  document_version text        NOT NULL,
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  ip               text,
  user_agent       text,
  PRIMARY KEY (commitment_id, document_key)
);

-- Aprobaciones a cuatro ojos: paso 1 y paso 2, de personas distintas.
CREATE TABLE capital.approvals (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text        NOT NULL CHECK (subject_type IN ('allocation', 'distribution')),
  subject_id   uuid        NOT NULL,
  step         smallint    NOT NULL CHECK (step IN (1, 2)),
  decided_by   uuid        NOT NULL REFERENCES users (id),
  amount       numeric(14,2),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, step)
);

CREATE FUNCTION capital.approvals_four_eyes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.step = 2 AND EXISTS (
    SELECT 1 FROM capital.approvals
     WHERE subject_type = NEW.subject_type AND subject_id = NEW.subject_id AND step = 1 AND decided_by = NEW.decided_by
  ) THEN
    RAISE EXCEPTION 'La segunda aprobación debe hacerla otra persona' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.step = 2 AND NOT EXISTS (
    SELECT 1 FROM capital.approvals WHERE subject_type = NEW.subject_type AND subject_id = NEW.subject_id AND step = 1
  ) THEN
    RAISE EXCEPTION 'Falta la primera aprobación' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approvals_four_eyes BEFORE INSERT ON capital.approvals
  FOR EACH ROW EXECUTE FUNCTION capital.approvals_four_eyes();

-- Dinero que entra y sale, por partícipe. Solo `reconciled` cuenta como real.
CREATE TABLE capital.cash_movements (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid          NOT NULL REFERENCES capital.projects (id),
  member_id     uuid          NOT NULL REFERENCES capital.members (id),
  commitment_id uuid          REFERENCES capital.commitments (id),
  kind          text          NOT NULL CHECK (kind IN ('contribution', 'capital_return', 'profit', 'loss_allocation')),
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  status        text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'reconciled', 'rejected', 'returned')),
  bank_reference text,
  value_date    date,
  note          text,
  recorded_by   uuid          REFERENCES users (id),
  reconciled_by uuid          REFERENCES users (id),
  reconciled_at timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX cash_movements_member_idx ON capital.cash_movements (member_id);
CREATE INDEX cash_movements_project_idx ON capital.cash_movements (project_id);
