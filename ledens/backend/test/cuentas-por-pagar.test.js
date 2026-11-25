import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PayablesService,addDays,mondayOf,monthEnd,weeklyPayday} from '../src/finanzas/payables.js';
import {WorkersService} from '../src/finanzas/workers.js';
// Cuentas por pagar on PGlite: the shared finance fixture plus the production
// columns of ledens.employees. Synthetic rows only. The clock is injected:
// «today» is Thursday 12 Nov 2026 unless a test moves it.
let db,pool,admin,jefe,ana,luis,mensual,project,today='2026-11-12';
const as=(u)=>new PayablesService(pool,u,{today:()=>today});
const cell=(g,id,d)=>g.rows.find((r)=>r.id===id).cells.find((c)=>c.date===d);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text; ALTER TABLE audit_log ADD COLUMN target_label text');
 await db.exec(`ALTER TABLE ledens.employees ADD COLUMN source_id text UNIQUE,ADD COLUMN raw_id uuid UNIQUE,ADD COLUMN empleadoid text,ADD COLUMN daily_pay numeric,
  ADD COLUMN tipo text,ADD COLUMN horasjornada numeric,ADD COLUMN user_id uuid REFERENCES users(id)`);
 await db.exec(await fs.readFile(new URL('../src/db/migrations/034_cuentas_por_pagar.sql',import.meta.url),'utf8'));
 // Jornales from Monday 2 Nov 2026.
 await db.query("UPDATE ledens.payables_config SET jornales_desde='2026-11-02'");
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@cxp.test','admin','Admin Test'),('jefe@cxp.test','jefe','Jefe Test') RETURNING id,role,name")).rows;
 [ana,luis,mensual]=(await db.query(`INSERT INTO ledens.employees(name,daily_pay,activo) VALUES('Ana Obrera',100,true),('Luis Peón',60.5,true),('Marta Mensual',90,true) RETURNING id`)).rows.map((r)=>r.id);
 await db.query("INSERT INTO ledens.employees(name,daily_pay,activo) VALUES('Sin Pago',NULL,true),('De Baja',80,false)");
 await db.query("INSERT INTO ledens.worker_pay_settings(employee_id,frequency) VALUES($1,'mensual')",[mensual]);
 project=(await db.query("INSERT INTO ledens.projects(project_id,name) VALUES('P2026-001','Reforma Centro') RETURNING id")).rows[0].id;
});
after(()=>db?.close());

test('date helpers: Monday of the week and last day of the month',()=>{
 assert.equal(mondayOf('2026-11-12'),'2026-11-09');assert.equal(mondayOf('2026-11-15'),'2026-11-09');assert.equal(mondayOf('2026-11-09'),'2026-11-09');
 assert.equal(monthEnd('2026-02-10'),'2026-02-28');assert.equal(addDays('2026-12-31',1),'2027-01-01');
 assert.equal(weeklyPayday('2026-11-12',()=>false),'2026-11-13','Friday when Saturday is not worked');
 assert.equal(weeklyPayday('2026-11-15',(d)=>d==='2026-11-14'),'2026-11-14','Saturday when it is, also seen from Sunday');
});

test('only admins: a jefe or a client gets 403',async()=>{
 await assert.rejects(as(jefe).list(),{status:403});
 await assert.rejects(as({id:jefe.id,role:'client'}).grid(),{status:403});
});

test('each past weekday accrues one jornal per active worker with a daily pay; idempotent',async()=>{
 const n=await as(admin).generate();
 // 2–6 Nov and 9–11 Nov = 8 weekdays × 3 workers (no pay, de baja and weekends excluded).
 assert.equal(n,24);
 assert.equal(await as(admin).generate(),0,'running it again adds nothing');
 const r=(await db.query("SELECT amount::text,due_on::text,concept,counterparty FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-04'",[luis])).rows[0];
 assert.deepEqual(r,{amount:'60.50',due_on:'2026-11-06',concept:'Jornal 04/11/2026',counterparty:'Luis Peón'},'paid on Friday: that Saturday is not worked');
 const m=(await db.query("SELECT due_on::text FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-04'",[mensual])).rows[0];
 assert.equal(m.due_on,'2026-11-30','monthly workers are due at the end of the month');
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE work_date>='2026-11-12'")).rows[0].n,0,'today is not owed yet');
});

test('grid: workers × Monday–Saturday, generated days, forecast for the rest and what is needed',async()=>{
 const g=await as(admin).grid({desde:'2026-11-12',periodo:'semana'});
 assert.equal(g.from,'2026-11-09');assert.equal(g.to,'2026-11-14');
 assert.deepEqual(g.days.map((d)=>d.dow),[1,2,3,4,5,6]);
 const a=cell(g,ana,'2026-11-10');assert.equal(a.payable.amount,'100.00');assert.equal(a.works,true);
 assert.equal(cell(g,ana,'2026-11-12').forecast,100,'today is a forecast');
 assert.equal(cell(g,ana,'2026-11-14').works,false,'Saturday is not worked by default');
 const rowAna=g.rows.find((r)=>r.id===ana);assert.equal(rowAna.devengado,300);assert.equal(rowAna.previsto,200);assert.equal(rowAna.total,500);
 assert.equal(g.rows.find((r)=>r.name==='Sin Pago').warning,'Sin pago diario');
 assert.ok(!g.rows.some((r)=>r.name==='De Baja'),'inactive workers without jornales are not listed');
 // Weekly: Ana and Luis, 8 pending days each + Thu and Fri to come.
 assert.equal(Number(g.necesidad.semana.pendiente),8*100+8*60.5);assert.equal(Number(g.necesidad.semana.previsto),2*100+2*60.5);
 assert.equal(g.necesidad.semana.hasta,'2026-11-14');
 // Monthly: Marta, 8 pending days + 12 Nov … 30 Nov weekdays (13 days).
 assert.equal(Number(g.necesidad.mes.pendiente),8*90);assert.equal(Number(g.necesidad.mes.previsto),13*90);
});

test('a Saturday worked accrues once the day has passed; an absence annuls the jornal and can be undone',async()=>{
 await as(admin).setAttendance([{employeeId:luis,date:'2026-11-07',works:true},{employeeId:luis,date:'2026-11-14',works:true}]);
 const sat=(await db.query("SELECT amount::text,status,due_on::text FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-07'",[luis])).rows[0];
 assert.deepEqual(sat,{amount:'60.50',status:'pendiente',due_on:'2026-11-07'},'a past Saturday is generated at once');
 const due=(await db.query("SELECT work_date::text d,due_on::text due FROM ledens.payables WHERE employee_id=$1 AND work_date BETWEEN '2026-11-02' AND '2026-11-11' ORDER BY 1",[luis])).rows;
 assert.ok(due.every((x)=>x.due===(x.d<'2026-11-08'?'2026-11-07':'2026-11-14')),'a Saturday worked moves the payday of its week from Friday to Saturday');
 assert.equal((await db.query("SELECT due_on::text d FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-04'",[ana])).rows[0].d,'2026-11-06','only for that worker');
 let g=await as(admin).grid({desde:'2026-11-14'});
 assert.equal(cell(g,luis,'2026-11-14').forecast,60.5,'a future Saturday is a forecast');assert.equal(cell(g,luis,'2026-11-14').explicit,true);
 const r=await as(admin).setAttendance([{employeeId:ana,date:'2026-11-10',works:false}]);
 assert.equal(r.annulled,1);
 g=await as(admin).grid({desde:'2026-11-10'});
 assert.equal(cell(g,ana,'2026-11-10').payable.status,'anulada');assert.equal(g.rows.find((x)=>x.id===ana).devengado,200);
 await db.query('UPDATE ledens.employees SET daily_pay=110 WHERE id=$1',[ana]);
 const back=await as(admin).setAttendance([{employeeId:ana,date:'2026-11-10',works:null}]);
 assert.equal(back.restored,1);
 const j=(await db.query("SELECT amount::text,status FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-10'",[ana])).rows[0];
 assert.deepEqual(j,{amount:'110.00',status:'pendiente'},'back to the calendar, at the current daily pay');
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.worker_attendance WHERE employee_id=$1",[ana])).rows[0].n,0);
 const a=(await db.query("SELECT detail FROM audit_log WHERE action='Asistencia de trabajadores' ORDER BY id DESC LIMIT 1")).rows[0].detail;
 assert.equal(a,'Ana Obrera 10/11/2026: según calendario');
});

test('the next day generates the day that has just passed',async()=>{
 today='2026-11-13';
 const n=await as(admin).generate();
 assert.equal(n,3,'Thursday 12 Nov for the three workers');
 today='2026-11-12';
});

test('manual payables: created with project and due date, listed, edited with version, paid and annulled',async()=>{
 await assert.rejects(as(admin).create({concept:'',amount:'10'}),{status:400,message:/concepto/});
 await assert.rejects(as(admin).create({concept:'X',amount:'-5'}),{status:400,message:/Importe/});
 await assert.rejects(as(admin).create({concept:'X',amount:'5',projectId:'00000000-0000-0000-0000-000000000000'}),{status:400,message:/Proyecto/});
 const p=await as(admin).create({concept:'Alquiler andamio',amount:'1.250,40',counterparty:'Andamios Sur',dueOn:'2026-11-13',projectId:project,notes:'Factura pendiente'});
 assert.equal(p.amount,'1250.40');assert.equal(p.project,'Reforma Centro');assert.equal(p.origin,'manual');assert.equal(p.status,'pendiente');
 const l=await as(admin).list({origen:'manual'});
 assert.equal(l.total,1);assert.equal(l.importe,'1250.40');assert.equal(l.necesidad.otras.semana,'1250.40');
 const u=await as(admin).update(p.id,{concept:'Alquiler andamio',amount:'1300',counterparty:'Andamios Sur',dueOn:'2026-11-13',projectId:project,notes:'Factura pendiente',version:p.version});
 assert.equal(u.changed,true);assert.equal(u.amount,'1300');
 await assert.rejects(as(admin).update(p.id,{concept:'Pisado',amount:'1',version:p.version}),{status:409});
 const paid=await as(admin).setStatus({ids:[p.id],status:'pagada',paidOn:'2026-11-12'});
 assert.equal(paid.updated,1);assert.equal(paid.importe,'1300.00');
 assert.equal((await as(admin).list({origen:'manual'})).total,0,'paid ones leave the default (pending) list');
 await assert.rejects(as(admin).update(p.id,{concept:'Alquiler andamio',amount:'5',version:(await as(admin).list({estado:'pagada',origen:'manual'})).rows[0].version}),{status:409,message:/pendiente/});
 await as(admin).setStatus({ids:[p.id],status:'anulada'});
 assert.equal((await as(admin).list({estado:'anulada'})).rows[0].concept,'Alquiler andamio');
});

test('jornales: paid in bulk, project in bulk; never annulled from the list; a paid day cannot be taken away',async()=>{
 const l=await as(admin).list({trabajador:luis,hasta:'2026-11-07'});
 assert.equal(l.total,6,'2–6 Nov plus the Saturday worked');
 const ids=l.rows.map((r)=>r.id);
 await assert.rejects(as(admin).setStatus({ids,status:'anulada'}),{status:409,message:/No trabaja/});
 assert.equal((await as(admin).setProject({ids,projectId:project})).updated,6);
 const r=await as(admin).setStatus({ids,status:'pagada'});
 assert.equal(r.updated,6);assert.equal(r.importe,(6*60.5).toFixed(2));
 assert.equal((await db.query("SELECT paid_on::text FROM ledens.payables WHERE id=$1",[ids[0]])).rows[0].paid_on,'2026-11-12','paid today by default');
 await assert.rejects(as(admin).setAttendance([{employeeId:luis,date:'2026-11-03',works:false}]),{status:409,message:/ya está pagado/});
 const g=await as(admin).grid({desde:'2026-11-02'});
 assert.equal(g.rows.find((x)=>x.id===luis).pagado,6*60.5,'Mon–Fri plus the Saturday worked');
});

test('settings: monthly moves pending due dates; switching accrual off and on never backfills',async()=>{
 const s=await as(admin).setSettings(ana,{frequency:'mensual'});
 assert.equal(s.changed,true);
 assert.equal((await db.query("SELECT due_on::text FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-04'",[ana])).rows[0].due_on,'2026-11-30');
 await as(admin).setSettings(ana,{accrues:false});
 today='2026-11-18';
 await as(admin).generate();
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE employee_id=$1 AND work_date>='2026-11-13'",[ana])).rows[0].n,0);
 await as(admin).setSettings(ana,{accrues:true});
 today='2026-11-19';
 await as(admin).generate();
 const days=(await db.query("SELECT work_date::text d FROM ledens.payables WHERE employee_id=$1 AND work_date>='2026-11-13' ORDER BY 1",[ana])).rows.map((r)=>r.d);
 assert.deepEqual(days,['2026-11-18'],'accrues again from the day it was switched back on');
 today='2026-11-12';
});

test('a worker added later accrues from the day of the alta, not from the start',async()=>{
 const w=await new WorkersService(pool,admin).create({name:'Nuevo Ingreso',dailyPay:'70'});
 const starts=(await db.query('SELECT starts_on::text s FROM ledens.worker_pay_settings WHERE employee_id=$1',[w.id])).rows[0].s;
 assert.match(starts,/^\d{4}-\d{2}-\d{2}$/);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE employee_id=$1",[w.id])).rows[0].n,0);
});

test('review fixes: pausing first generates the days already passed; an annulled jornal cannot be paid',async()=>{
 const w=(await db.query("INSERT INTO ledens.employees(name,daily_pay,activo) VALUES('Pausa Tardía',50,true) RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.worker_pay_settings(employee_id,starts_on) VALUES($1,'2026-11-12')",[w]);
 today='2026-11-13';
 await as(admin).setSettings(w,{accrues:false}); // the hourly run has not generated Thursday yet
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-12'",[w])).rows[0].n,1,'Thursday is still owed');
 await as(admin).setSettings(w,{accrues:true});
 await as(admin).setAttendance([{employeeId:w,date:'2026-11-12',works:false}]);
 const id=(await db.query("SELECT id,status FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-12'",[w])).rows[0];
 assert.equal(id.status,'anulada');
 await assert.rejects(as(admin).setStatus({ids:[id.id],status:'pagada'}),{status:409,message:/anulado/});
 today='2026-11-12';
});

// ── The card of a project page ───────────────────────────────────────────────
// Two workers in the cuadrilla of an obra of «Reforma Centro», from Monday 16 Nov.
let oficial,peon,otro,antiguo,obra,otroProyecto;
const tarjeta=()=>as(admin).project(project);
const worker=(t,id)=>t.workers.find((w)=>w.id===id);
test('project card setup: the cuadrillas of the project obras',async()=>{
 await db.exec(`CREATE TABLE presupuestos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ref text,title text,project_id uuid,parent_id uuid REFERENCES presupuestos(id));
  CREATE TABLE gantt_obras(obra_id uuid PRIMARY KEY REFERENCES presupuestos(id),cuadrillas integer NOT NULL DEFAULT 1)`);
 await db.exec(await fs.readFile(new URL('../src/db/migrations/043_gantt_cuadrilla_miembros.sql',import.meta.url),'utf8'));
 [oficial,peon,otro,antiguo]=(await db.query(`INSERT INTO ledens.employees(name,daily_pay,activo) VALUES('Andrés Oficial',120,true),('Pablo Peón',80,true),('Otra Obra',95,true),('Antiguo Miembro',70,true) RETURNING id`)).rows.map((r)=>r.id);
 for(const id of [oficial,peon,otro,antiguo])await db.query("INSERT INTO ledens.worker_pay_settings(employee_id,starts_on) VALUES($1,'2026-11-16')",[id]);
 otroProyecto=(await db.query("INSERT INTO ledens.projects(project_id,name) VALUES('P2026-002','Ático Norte') RETURNING id")).rows[0].id;
 [obra]=(await db.query(`INSERT INTO presupuestos(ref,title,project_id) VALUES('PRE-2026-010','Reforma integral',$1) RETURNING id`,[project])).rows.map((r)=>r.id);
 const amp=(await db.query(`INSERT INTO presupuestos(ref,title,project_id,parent_id) VALUES('PRE-2026-011','Ampliación',$1,$2) RETURNING id`,[project,obra])).rows[0].id;
 const fuera=(await db.query(`INSERT INTO presupuestos(ref,title,project_id) VALUES('PRE-2026-020','Ático',$1) RETURNING id`,[otroProyecto])).rows[0].id;
 await db.query('INSERT INTO gantt_obras(obra_id,cuadrillas) VALUES($1,1)',[obra]);
 const m=(o,c,rol,e)=>db.query('INSERT INTO gantt_cuadrilla_miembros(obra_id,cuadrilla,rol,employee_id) VALUES($1,$2,$3,$4)',[o,c,rol,e]);
 await m(obra,1,'oficial',oficial);await m(obra,1,'peon',peon);
 await m(obra,2,'oficial',antiguo); // cuadrilla 2 no longer exists (1 cuadrilla)
 await m(amp,1,'oficial',otro);     // an ampliación has no cuadrillas of its own
 await m(fuera,1,'oficial',oficial);await m(fuera,1,'peon',otro);
});

test('project card: this week, accrued up to yesterday, forecast up to Friday, paid on Friday',async()=>{
 today='2026-11-19'; // Thursday
 await assert.rejects(as(jefe).project(project),{status:403});
 await assert.rejects(as(admin).project('00000000-0000-0000-0000-000000000000'),{status:404});
 const t=await tarjeta();
 assert.deepEqual(t.week,{from:'2026-11-16',to:'2026-11-21'});
 assert.deepEqual(t.workers.map((w)=>w.name),['Andrés Oficial','Pablo Peón'],'only the members of the current cuadrillas of its obras');
 const o=worker(t,oficial),p=worker(t,peon);
 assert.deepEqual(o.roles,['oficial']);assert.deepEqual(o.obras.map((x)=>x.ref),['PRE-2026-010']);
 assert.deepEqual(o.otrosProyectos,[{code:'P2026-002',name:'Ático Norte'}]);assert.deepEqual(p.otrosProyectos,[]);
 assert.equal(o.payday,'2026-11-20');
 assert.deepEqual([o.pendiente,o.previsto,o.aPagar,o.pagado],[360,240,600,0],'Mon–Wed accrued, Thu and Fri to come');
 assert.deepEqual([p.pendiente,p.previsto,p.aPagar],[240,160,400]);
 assert.equal(o.cells.find((c)=>c.date==='2026-11-18').payable.status,'pendiente');
 assert.equal(o.cells.find((c)=>c.date==='2026-11-19').forecast,120,'today is a forecast');
 assert.equal(o.cells.find((c)=>c.date==='2026-11-21').works,false);
 assert.deepEqual(t.pagos.map((g)=>[g.date,g.ready,g.aPagar,g.workers.length]),[['2026-11-20',false,1000,2]]);
 assert.deepEqual(t.totales,{pendiente:600,previsto:400,aPagar:1000,pagado:0,atrasado:0});
 const due=(await db.query("SELECT DISTINCT due_on::text d FROM ledens.payables WHERE employee_id=ANY($1::uuid[])",[[oficial,peon]])).rows.map((r)=>r.d);
 assert.deepEqual(due,['2026-11-20'],'the jornales are due on Friday');
});

test('project card: a Saturday worked moves that worker to Saturday, and back',async()=>{
 await as(admin).setAttendance([{employeeId:peon,date:'2026-11-21',works:true}]);
 let t=await tarjeta();
 assert.equal(worker(t,peon).payday,'2026-11-21');assert.equal(worker(t,peon).previsto,240,'Thu, Fri and Sat');
 assert.equal(worker(t,oficial).payday,'2026-11-20');
 assert.deepEqual(t.pagos.map((g)=>[g.date,g.aPagar,g.workers.map((w)=>w.name)]),[['2026-11-20',600,['Andrés Oficial']],['2026-11-21',480,['Pablo Peón']]]);
 const due=async(id)=>(await db.query("SELECT DISTINCT due_on::text d FROM ledens.payables WHERE employee_id=$1",[id])).rows.map((r)=>r.d);
 assert.deepEqual(await due(peon),['2026-11-21'],'his pending jornales are due on Saturday');
 // A due date set by hand is never moved.
 const hand=(await db.query("SELECT id FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-16'",[peon])).rows[0].id;
 await db.query("UPDATE ledens.payables SET due_on='2026-11-25' WHERE id=$1",[hand]);
 await as(admin).setAttendance([{employeeId:peon,date:'2026-11-21',works:null}]);
 t=await tarjeta();
 assert.equal(worker(t,peon).payday,'2026-11-20');assert.deepEqual(t.pagos.map((g)=>g.date),['2026-11-20']);
 assert.deepEqual((await due(peon)).sort(),['2026-11-20','2026-11-25']);
 await db.query("UPDATE ledens.payables SET due_on='2026-11-20' WHERE id=$1",[hand]);
});

test('project card: paying on Friday closes the week, its own day included',async()=>{
 today='2026-11-20';
 const svc=as(admin);
 await assert.rejects(svc.payProject(project,{items:[{employeeId:oficial,hasta:'2026-11-21'}]}),{status:400,message:/hasta hoy/});
 await assert.rejects(svc.payProject(project,{items:[{employeeId:otro,hasta:'2026-11-20'}]}),{status:400,message:/cuadrillas/});
 await assert.rejects(svc.payProject(project,{items:[{employeeId:antiguo,hasta:'2026-11-20'}]}),{status:400,message:/cuadrillas/});
 let t=await tarjeta();
 assert.equal(t.pagos[0].ready,true,'payday has come');
 const r=await svc.payProject(project,{items:[{employeeId:oficial,hasta:'2026-11-20'}]});
 assert.deepEqual(r,{updated:5,importe:'600.00',paidOn:'2026-11-20'},'Mon–Thu plus today, generated now');
 const a=(await db.query("SELECT target_label,detail FROM audit_log WHERE action='Cuentas por pagar pagadas' ORDER BY id DESC LIMIT 1")).rows[0];
 assert.equal(a.target_label,'Proyecto P2026-001 · Reforma Centro · 5 jornales');
 assert.equal(a.detail,'600.00 € · pagado el 20/11/2026 · Andrés Oficial: 5 jornales hasta el 20/11/2026 (600.00 €)');
 t=await tarjeta();
 const o=worker(t,oficial);
 assert.deepEqual([o.pendiente,o.previsto,o.aPagar,o.pagado],[0,0,0,600]);
 assert.equal(o.cells.find((c)=>c.date==='2026-11-20').payable.status,'pagada');
 assert.deepEqual([worker(t,peon).aPagar,t.totales.aPagar,t.totales.pagado],[400,400,600]);
 await assert.rejects(svc.payProject(project,{items:[{employeeId:oficial,hasta:'2026-11-20'}]}),{status:409});
 today='2026-11-21';
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-20'",[oficial])).rows[0].n,1);
 await as(admin).generate();
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-20'",[oficial])).rows[0].n,1,'the next day does not generate it again');
});

test('project card: a week left unpaid is shown apart the next week and can be paid',async()=>{
 today='2026-11-23'; // Monday
 const t=await tarjeta();
 const p=worker(t,peon);
 assert.deepEqual(p.atrasado,{importe:400,n:5,desde:'2026-11-16',hasta:'2026-11-22'});
 assert.deepEqual([p.pendiente,p.previsto,p.payday],[0,400,'2026-11-27'],'the new week: Mon–Fri to come, paid on Friday 27');
 assert.equal(worker(t,oficial).atrasado.importe,0);assert.equal(t.totales.atrasado,400);
 const r=await as(admin).payProject(project,{items:[{employeeId:peon,hasta:'2026-11-22'}],paidOn:'2026-11-21'});
 assert.deepEqual(r,{updated:5,importe:'400.00',paidOn:'2026-11-21'});
 assert.equal(worker(await tarjeta(),peon).atrasado.importe,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.payables WHERE employee_id=$1 AND work_date='2026-11-23'",[peon])).rows[0].n,0,'today is not paid nor generated');
 today='2026-11-12';
});
