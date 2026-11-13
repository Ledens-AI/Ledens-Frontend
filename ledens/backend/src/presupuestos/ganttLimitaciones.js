// Limitaciones de la Planificación (Gantt): rules a plan must meet to be saved
// (gantt.js updateMany refuses a save that breaks one in an obra it touches;
// Gantt.jsx keeps «Guardar» disabled while the draft breaks one).
//
// 1. Sobreasignación de recursos: each cuadrilla does one task at a time, so in
//    an obra no more tasks may run at the same moment than it has cuadrillas
//    (gantt_obras.cuadrillas, migration 042). With one cuadrilla, no two tasks
//    overlap. Tasks of 0 days take no time and never count. Positions are on
//    the working-day axis of schedule() (end exclusive), so a task ending at
//    2,5 and another starting at 2,5 do not overlap.
//
// Each limitación found is { tipo, obraId, ref, cuadrillas, max, desde, hasta,
// tareas: [ids], mensaje }; desde/hasta are the dates of the working days it
// covers.

const tenths = (v) => Math.round(Number(v) * 10);

// tasks: [{ id, obraId, start, end, name }] (positions from schedule()),
// obras: [{ id, ref, cuadrillas }], date: index of a working day → 'YYYY-MM-DD'.
export function sobreasignaciones(tasks, obras, date) {
  const out = [];
  for (const o of obras) {
    const n = Math.max(1, Number(o.cuadrillas) || 1);
    const ts = tasks.filter((t) => t.obraId === o.id && tenths(t.end) > tenths(t.start));
    if (ts.length <= n) continue;
    // Sweep: ends before starts at the same position (touching is not overlapping).
    const ev = ts.flatMap((t) => [{ at: tenths(t.start), d: 1, id: t.id }, { at: tenths(t.end), d: -1, id: t.id }])
      .sort((a, b) => a.at - b.at || a.d - b.d);
    const active = new Set();
    let cur = null; // the conflict being built: { from, to, ids: Set, max }
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.d > 0) active.add(e.id); else active.delete(e.id);
      const next = ev[i + 1];
      if (next && next.at === e.at) continue; // apply every event at this position first
      if (!next) break;
      if (active.size > n) {
        if (cur && cur.to === e.at) { cur.to = next.at; for (const id of active) cur.ids.add(id); cur.max = Math.max(cur.max, active.size); }
        else { if (cur) out.push(close(cur, o, n)); cur = { from: e.at, to: next.at, ids: new Set(active), max: active.size }; }
      } else if (cur) { out.push(close(cur, o, n)); cur = null; }
    }
    if (cur) out.push(close(cur, o, n));
  }
  return out;

  function close(c, o, n) {
    const ids = [...c.ids];
    const names = ids.map((id) => tasks.find((t) => t.id === id)?.name || id);
    const desde = date(Math.floor(c.from / 10)), hasta = date(Math.ceil(c.to / 10) - 1);
    const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
    return {
      tipo: 'sobreasignacion', obraId: o.id, ref: o.ref, cuadrillas: n, max: c.max, desde, hasta, tareas: ids,
      mensaje: `${o.ref}: con ${n === 1 ? '1 cuadrilla' : `${n} cuadrillas`} hay ${c.max} tareas a la vez ${desde === hasta ? `el ${fmt(desde)}` : `del ${fmt(desde)} al ${fmt(hasta)}`} (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}). Encadénalas con predecesoras o añade cuadrillas.`,
    };
  }
}
