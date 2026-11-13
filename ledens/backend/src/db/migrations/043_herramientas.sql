-- Ledens Tools: herramientas y equipos (src/herramientas/, /api/herramientas).
-- Own schema `inventory`, next to `public` (users, presupuestos) and `ledens`
-- (accounting, owned by the import tooling). Like presupuestos.project_id
-- (migration 033) a reference into ledens.* (projects, employees, documents)
-- is a plain uuid checked by the service, never a foreign key: the accounting
-- import may rebuild those tables and must never be blocked by this module.
--
-- Three different things, never mixed:
--   * where an asset physically is (assets.location_id, moved only by a received
--     asset_movements row), and who answers for it (assets.custodian_*);
--   * which project it is working for (asset_assignments, one open per asset);
--   * who plans to use it later (reservations, by date range).
-- A request (tool_requests) is only an ask: approving it reserves, dispatching
-- it moves, receiving it delivers.
--
-- History is append-only: asset_movements, asset_incidents and consumable_ledger
-- refuse DELETE, and a movement only changes once, from «pendiente» to its
-- outcome (triggers below). A wrong movement is corrected with a new one.
CREATE SCHEMA IF NOT EXISTS inventory;

CREATE TABLE inventory.tool_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category    text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  -- A: one QR per unit; B: kits that travel together; C: counted consumables.
  tracking    text NOT NULL CHECK (tracking IN ('individual', 'kit', 'consumible')),
  unit        text NOT NULL DEFAULT 'ud' CHECK (length(unit) BETWEEN 1 AND 20),
  min_stock   numeric(12,2) CHECK (min_stock IS NULL OR min_stock >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tool_types_name_uq ON inventory.tool_types (lower(name), tracking);

CREATE TABLE inventory.locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('almacen', 'obra', 'vehiculo', 'taller', 'proveedor', 'externa', 'pendiente')),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  project_id  uuid,                       -- ledens.projects.id, only for kind 'obra'
  obra_id     uuid REFERENCES public.presupuestos (id),  -- optional: one concrete obra of the project
  address     text,
  active      boolean NOT NULL DEFAULT true,
  system      boolean NOT NULL DEFAULT false,  -- seeded here; cannot be edited or archived
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'obra') = (project_id IS NOT NULL))
);
-- One obra location per project: created on first use, race-free (ON CONFLICT).
CREATE UNIQUE INDEX locations_project_uq ON inventory.locations (project_id) WHERE kind = 'obra';
CREATE UNIQUE INDEX locations_name_uq ON inventory.locations (lower(name)) WHERE kind <> 'obra';
INSERT INTO inventory.locations (kind, name, system) VALUES
  ('almacen', 'Almacén central', true),
  ('pendiente', 'Ubicación pendiente de confirmar', true);

-- Readable codes: LED-TOOL-000042, KIT-000003. Never reused, never renumbered.
CREATE SEQUENCE inventory.asset_code_seq;
CREATE SEQUENCE inventory.kit_code_seq;

CREATE TABLE inventory.assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  kind                  text NOT NULL CHECK (kind IN ('individual', 'kit')),
  type_id               uuid NOT NULL REFERENCES inventory.tool_types (id),
  name                  text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  brand                 text,
  model                 text,
  serial_number         text,
  photo_key             text,              -- object in the obra-archivos container, prefix herramientas/
  photo_mime            text,
  -- Condition of the unit itself. Anything but 'operativa' blocks new
  -- reservations, assignments and dispatches to an obra until it is reviewed.
  condition             text NOT NULL DEFAULT 'operativa'
                          CHECK (condition IN ('operativa', 'averiada', 'en_mantenimiento', 'perdida', 'robada')),
  ownership             text NOT NULL DEFAULT 'propia' CHECK (ownership IN ('propia', 'alquilada', 'tercero')),
  owner_name            text,              -- the third party / rental company, when not propia
  rental_ends_on        date,
  -- Economic and administrative data: admins only (never in a jefe's answer).
  acquired_on           date,
  cost                  numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
  supplier              text,
  invoice_document_id   uuid,              -- ledens.documents.id (no FK, see the header)
  warranty_until        date,
  -- Current state, written only by the service in the same transaction as the
  -- movement / incident that explains it.
  location_id           uuid NOT NULL REFERENCES inventory.locations (id),
  custodian_user_id     uuid REFERENCES public.users (id),
  custodian_employee_id uuid,              -- ledens.employees.id (workers without an account)
  last_movement_at      timestamptz,
  notes                 text,
  -- The QR carries <app>/h/<qr_token>: opaque, no data, no permission. A worn
  -- label is reprinted with the same token; a lost one gets a new token
  -- (label_version + 1) and the old one stops resolving. The code never changes.
  qr_token              text NOT NULL UNIQUE,
  label_version         integer NOT NULL DEFAULT 1,
  retired_at            timestamptz,       -- baja lógica: never deleted
  retired_reason        text,
  version               integer NOT NULL DEFAULT 1,  -- optimistic check for edits
  created_by            uuid REFERENCES public.users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (custodian_user_id IS NULL OR custodian_employee_id IS NULL),
  CHECK ((retired_at IS NULL) = (retired_reason IS NULL))
);
CREATE INDEX assets_location_idx ON inventory.assets (location_id) WHERE retired_at IS NULL;
CREATE INDEX assets_type_idx ON inventory.assets (type_id) WHERE retired_at IS NULL;
CREATE INDEX assets_custodian_idx ON inventory.assets (custodian_user_id) WHERE custodian_user_id IS NOT NULL;
CREATE INDEX assets_search_idx ON inventory.assets (lower(name), lower(coalesce(brand, '')));

-- Components of a kit and what is missing from it.
CREATE TABLE inventory.kit_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id      uuid NOT NULL REFERENCES inventory.assets (id),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  quantity    integer NOT NULL CHECK (quantity > 0),
  missing     integer NOT NULL DEFAULT 0 CHECK (missing >= 0 AND missing <= quantity),
  notes       text,
  position    integer NOT NULL DEFAULT 0
);
CREATE INDEX kit_items_kit_idx ON inventory.kit_items (kit_id, position);

-- Physical movements. Created «pendiente» (on its way) unless the receiver
-- registers it themselves; becomes «recibido», «cancelado» (never left) or
-- «no_entregado» (left and did not arrive: the asset goes to «Ubicación
-- pendiente de confirmar»). Only then do assets.location_id/custodian change.
CREATE TABLE inventory.asset_movements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                 uuid NOT NULL REFERENCES inventory.assets (id),
  purpose                  text NOT NULL CHECK (purpose IN ('alta', 'entrega', 'traslado', 'devolucion', 'reparacion', 'correccion')),
  from_location_id         uuid REFERENCES inventory.locations (id),
  to_location_id           uuid NOT NULL REFERENCES inventory.locations (id),
  from_custodian_user_id   uuid REFERENCES public.users (id),
  from_custodian_employee_id uuid,
  to_custodian_user_id     uuid REFERENCES public.users (id),
  to_custodian_employee_id uuid,
  project_id               uuid,           -- project the asset will work for (assignment on reception)
  request_id               uuid,           -- tool_requests.id when it fulfils a request (FK added below)
  corrects_movement_id     uuid REFERENCES inventory.asset_movements (id),
  status                   text NOT NULL CHECK (status IN ('pendiente', 'recibido', 'cancelado', 'no_entregado')),
  notes                    text,
  sent_by                  uuid NOT NULL REFERENCES public.users (id),
  sent_at                  timestamptz NOT NULL DEFAULT now(),
  resolved_by              uuid REFERENCES public.users (id),
  resolved_at              timestamptz,
  resolution_notes         text,
  CHECK (to_custodian_user_id IS NULL OR to_custodian_employee_id IS NULL),
  CHECK ((status = 'pendiente') = (resolved_at IS NULL))
);
-- At most one movement on its way per asset: two people cannot send the same
-- drill to two places at once, whatever the timing.
CREATE UNIQUE INDEX asset_movements_pending_uq ON inventory.asset_movements (asset_id) WHERE status = 'pendiente';
CREATE INDEX asset_movements_asset_idx ON inventory.asset_movements (asset_id, sent_at DESC);
CREATE INDEX asset_movements_to_idx ON inventory.asset_movements (to_location_id) WHERE status = 'pendiente';

-- Which project an asset works for (and until when it should be back).
CREATE TABLE inventory.asset_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES inventory.assets (id),
  project_id          uuid NOT NULL,      -- ledens.projects.id
  obra_id             uuid REFERENCES public.presupuestos (id),
  request_id          uuid,
  movement_id         uuid REFERENCES inventory.asset_movements (id),
  starts_at           timestamptz NOT NULL DEFAULT now(),
  expected_return_on  date,
  ended_at            timestamptz,
  ended_reason        text,
  created_by          uuid REFERENCES public.users (id)
);
-- One open assignment per asset, enforced by the database itself.
CREATE UNIQUE INDEX asset_assignments_open_uq ON inventory.asset_assignments (asset_id) WHERE ended_at IS NULL;
CREATE INDEX asset_assignments_project_idx ON inventory.asset_assignments (project_id) WHERE ended_at IS NULL;

CREATE TABLE inventory.tool_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,  -- SOL-000012 on screen
  project_id       uuid NOT NULL,         -- ledens.projects.id
  obra_id          uuid REFERENCES public.presupuestos (id),
  requested_by     uuid NOT NULL REFERENCES public.users (id),
  status           text NOT NULL CHECK (status IN ('borrador', 'solicitada', 'en_revision', 'aprobada', 'parcialmente_aprobada',
                     'rechazada', 'en_preparacion', 'en_traslado', 'entregada', 'finalizada', 'cancelada')),
  needed_from      date NOT NULL,
  return_by        date NOT NULL,
  notes            text,
  decided_by       uuid REFERENCES public.users (id),
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (return_by >= needed_from)
);
CREATE INDEX tool_requests_status_idx ON inventory.tool_requests (status, needed_from);
CREATE INDEX tool_requests_project_idx ON inventory.tool_requests (project_id, created_at DESC);
ALTER TABLE inventory.asset_movements ADD FOREIGN KEY (request_id) REFERENCES inventory.tool_requests (id);
ALTER TABLE inventory.asset_assignments ADD FOREIGN KEY (request_id) REFERENCES inventory.tool_requests (id);

CREATE TABLE inventory.tool_request_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES inventory.tool_requests (id),
  type_id            uuid NOT NULL REFERENCES inventory.tool_types (id),
  asset_id           uuid REFERENCES inventory.assets (id),   -- a specific unit, when the jefe asked for one
  quantity           integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  quantity_approved  integer CHECK (quantity_approved IS NULL OR quantity_approved BETWEEN 0 AND quantity),
  notes              text,
  position           integer NOT NULL DEFAULT 0
);
CREATE INDEX tool_request_items_request_idx ON inventory.tool_request_items (request_id, position);

-- Reservations by inclusive date range. Overlaps for one asset are refused by
-- the service while it holds that asset's row lock (FOR UPDATE), the same
-- serialisation every write on an asset goes through — no btree_gist needed,
-- which Azure Flexible Server would have to allow-list first.
CREATE TABLE inventory.reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL REFERENCES inventory.assets (id),
  project_id       uuid NOT NULL,
  request_id       uuid REFERENCES inventory.tool_requests (id),
  request_item_id  uuid REFERENCES inventory.tool_request_items (id),
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  status           text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'cumplida', 'cancelada')),
  created_by       uuid NOT NULL REFERENCES public.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX reservations_asset_idx ON inventory.reservations (asset_id, starts_on) WHERE status = 'activa';
CREATE INDEX reservations_project_idx ON inventory.reservations (project_id) WHERE status = 'activa';

CREATE TABLE inventory.asset_incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES inventory.assets (id),
  kind          text NOT NULL CHECK (kind IN ('averia', 'rotura', 'perdida', 'robo', 'accesorio_faltante', 'mantenimiento')),
  description   text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  blocks_use    boolean NOT NULL,         -- «no apta para uso»: blocks the asset until reviewed
  project_id    uuid,
  movement_id   uuid REFERENCES inventory.asset_movements (id),
  photo_key     text,
  photo_mime    text,
  status        text NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'resuelta')),
  reported_by   uuid NOT NULL REFERENCES public.users (id),
  reported_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by   uuid REFERENCES public.users (id),
  resolved_at   timestamptz,
  resolution    text
);
CREATE INDEX asset_incidents_open_idx ON inventory.asset_incidents (asset_id) WHERE status = 'abierta';

CREATE TABLE inventory.asset_maintenance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     uuid NOT NULL REFERENCES inventory.assets (id),
  incident_id  uuid REFERENCES inventory.asset_incidents (id),
  status       text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'finalizado')),
  provider     text,
  cost         numeric(12,2) CHECK (cost IS NULL OR cost >= 0),   -- admins only
  notes        text,
  -- 'apta': back to operativa; 'baja': retired; 'sigue_averiada': stays blocked.
  result       text CHECK (result IN ('apta', 'baja', 'sigue_averiada')),
  opened_by    uuid NOT NULL REFERENCES public.users (id),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_by    uuid REFERENCES public.users (id),
  closed_at    timestamptz,
  CHECK ((status = 'finalizado') = (closed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE UNIQUE INDEX asset_maintenance_open_uq ON inventory.asset_maintenance (asset_id) WHERE status = 'abierto';

-- Physical counts of a location: what was seen against what the system says.
CREATE TABLE inventory.inventory_counts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES inventory.locations (id),
  status       text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'cerrado')),
  started_by   uuid NOT NULL REFERENCES public.users (id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  closed_by    uuid REFERENCES public.users (id),
  closed_at    timestamptz,
  summary      jsonb
);
CREATE TABLE inventory.inventory_count_lines (
  count_id   uuid NOT NULL REFERENCES inventory.inventory_counts (id),
  asset_id   uuid NOT NULL REFERENCES inventory.assets (id),
  seen_by    uuid NOT NULL REFERENCES public.users (id),
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (count_id, asset_id)
);

-- Category C: quantity per type and location, and every change to it.
CREATE TABLE inventory.consumable_stock (
  type_id      uuid NOT NULL REFERENCES inventory.tool_types (id),
  location_id  uuid NOT NULL REFERENCES inventory.locations (id),
  quantity     numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type_id, location_id)
);
CREATE TABLE inventory.consumable_ledger (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type_id      uuid NOT NULL REFERENCES inventory.tool_types (id),
  location_id  uuid NOT NULL REFERENCES inventory.locations (id),
  delta        numeric(12,2) NOT NULL CHECK (delta <> 0),
  reason       text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES public.users (id),
  at           timestamptz NOT NULL DEFAULT now()
);

-- Idempotency-Key of a write: the same key from the same person gets the
-- first answer back instead of a second movement (retries on bad coverage).
-- Written in the same transaction as the change, so a key exists only for a
-- change that was saved.
CREATE TABLE inventory.idempotency_keys (
  user_id     uuid NOT NULL REFERENCES public.users (id),
  key         text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  route       text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Append-only history.
CREATE FUNCTION inventory.refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de herramientas no se borra (%): registra una corrección', TG_TABLE_NAME;
END $$;
CREATE TRIGGER asset_movements_no_delete BEFORE DELETE ON inventory.asset_movements FOR EACH ROW EXECUTE FUNCTION inventory.refuse_delete();
CREATE TRIGGER asset_incidents_no_delete BEFORE DELETE ON inventory.asset_incidents FOR EACH ROW EXECUTE FUNCTION inventory.refuse_delete();
CREATE TRIGGER consumable_ledger_no_delete BEFORE DELETE ON inventory.consumable_ledger FOR EACH ROW EXECUTE FUNCTION inventory.refuse_delete();
CREATE TRIGGER asset_assignments_no_delete BEFORE DELETE ON inventory.asset_assignments FOR EACH ROW EXECUTE FUNCTION inventory.refuse_delete();
CREATE TRIGGER assets_no_delete BEFORE DELETE ON inventory.assets FOR EACH ROW EXECUTE FUNCTION inventory.refuse_delete();

-- A movement is written once and resolved once: what was sent never changes.
CREATE FUNCTION inventory.movement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pendiente' THEN
    RAISE EXCEPTION 'Un movimiento resuelto no se modifica: registra una corrección';
  END IF;
  IF (NEW.asset_id, NEW.purpose, NEW.from_location_id, NEW.to_location_id, NEW.from_custodian_user_id, NEW.from_custodian_employee_id,
      NEW.to_custodian_user_id, NEW.to_custodian_employee_id, NEW.project_id, NEW.request_id, NEW.sent_by, NEW.sent_at, NEW.notes)
     IS DISTINCT FROM
     (OLD.asset_id, OLD.purpose, OLD.from_location_id, OLD.to_location_id, OLD.from_custodian_user_id, OLD.from_custodian_employee_id,
      OLD.to_custodian_user_id, OLD.to_custodian_employee_id, OLD.project_id, OLD.request_id, OLD.sent_by, OLD.sent_at, OLD.notes) THEN
    RAISE EXCEPTION 'Los datos de un movimiento no se modifican';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_movements_immutable BEFORE UPDATE ON inventory.asset_movements FOR EACH ROW EXECUTE FUNCTION inventory.movement_immutable();
