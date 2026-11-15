-- Recetas de las partidas (src/presupuestos/recetas.js, «Partidas» → Herramientas
-- y Materiales). Each partida of the base (ledens.work_items) can list:
--   * the tools it requires (partida_herramientas): a tool type of Ledens Tools
--     (inventory.tool_types, migration 044) and how many units a cuadrilla needs;
--   * its recipe of materials (partida_materiales): how much of each material one
--     unit of the partida consumes (per m², ml, ud… of the partida), plus waste.
-- A presupuesto then shows what its lines need (quantity × recipe) and an obra
-- compares the tools it needs with the ones it has (/:id/necesidades).
--
-- The partida is identified by its code (id_partida, PA-###), never by its uuid:
-- the code is never renumbered (presupuesto_partidas.base_code keeps it) while
-- ledens.* belongs to the accounting import, which may rebuild its rows. So no
-- foreign key into ledens.*, like migrations 025 and 033.
CREATE TABLE partida_herramientas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_code     text NOT NULL CHECK (base_code ~ '^PA-\d+$'),
  tool_type_id  uuid NOT NULL REFERENCES inventory.tool_types (id),
  quantity      integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  notes         text CHECK (length(notes) <= 500),
  position      integer NOT NULL DEFAULT 0,
  origin        text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'inicial')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_code, tool_type_id)
);
CREATE INDEX partida_herramientas_code_idx ON partida_herramientas (base_code, position);

CREATE TABLE partida_materiales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_code     text NOT NULL CHECK (base_code ~ '^PA-\d+$'),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  unit          text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  -- Per one unit of the partida (1 m² of pintura → 0,25 l of pintura).
  quantity      numeric(14,4) NOT NULL CHECK (quantity > 0),
  waste_pct     numeric(5,2) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  notes         text CHECK (length(notes) <= 500),
  position      integer NOT NULL DEFAULT 0,
  origin        text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'inicial')),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partida_materiales_name_uq ON partida_materiales (base_code, lower(btrim(name)));
CREATE INDEX partida_materiales_code_idx ON partida_materiales (base_code, position);
