-- One-off maintenance jobs run at startup after the migrations (src/index.js),
-- recorded here so each runs once: e.g. «nombres-partida-pdf-1», re-reading the
-- budget PDFs kept in obras to restore partida names the old PDF reader cut
-- (src/presupuestos/repararNombres.js).
CREATE TABLE mantenimientos (
  name    text PRIMARY KEY,
  done_at timestamptz NOT NULL DEFAULT now(),
  detail  text
);
