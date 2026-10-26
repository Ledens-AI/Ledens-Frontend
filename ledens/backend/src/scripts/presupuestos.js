import fs from 'node:fs/promises';
import { getPool, closePool } from '../db/pool.js';
import { importApproved } from '../presupuestos/import.js';

// Operator tool: loads an already-approved presupuesto (with its progress so
// far) as an obra en curso. Run it where DATABASE_URL points at the right
// database — in production, inside the Container App, with the file on the
// /data share (delete it afterwards: it carries client data):
//   az containerapp exec -g rg-ledens -n ledens-backend --command "npm run presupuestos -- importar /data/importar/obra.json"
//
// File (JSON): { clientEmail, jefeEmail?, title, address?, vatRate (21),
//   pricesIncludeVat (bool), offeredOn, startDate, endDate? (AAAA-MM-DD),
//   notes?, source?, chapters: [{ name, items: [{ code?, unit, name,
//   description?, quantity, unitPrice, kind? (confirmada…), progress (0–1),
//   progressNote? }] }] }
// The client (and jefe) accounts must exist: `npm run users -- create …`.
const USAGE = 'Uso: npm run presupuestos -- importar <fichero.json>';

const [command, file] = process.argv.slice(2);
try {
  if (command !== 'importar' || !file) throw new Error(USAGE);
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  const r = await importApproved(getPool(), data);
  console.log(`Importado ${r.ref}: ${r.lines} partidas, ${r.declared} con avance.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
