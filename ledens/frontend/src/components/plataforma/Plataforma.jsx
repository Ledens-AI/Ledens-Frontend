/* Client platform (/plataforma): client area, site-manager workspace and admin
 * panel, switchable from the "Ver como" control in the top bar.
 * Logic and markup ported from the Claude Design file "Ledens Plataforma.dc.html";
 * the JSX was converted mechanically from the design's markup, so it keeps the
 * design's inline styles. Data comes from ./data.js (demo content). */
import React from 'react';
import logo from '../../assets/logo-ledens-isotype.png';
import { IMG, ST, BST, eur, num, TODAY, D, days, MES, OBRAS, B031, PERMS, ALLP, BASE, USERS, SPEC0, ITYPE } from './data.js';
import '../../styles/plataforma.css';

export default class Plataforma extends React.Component {
  state={role:this.props.initialRole??'client',screen:({client:'c_home',worker:'w_home',admin:'a_home'})[this.props.initialRole??'client'],obraId:'o1',tab:'resumen',userId:'u4',partFilter:'all',photoFilter:'Todas',cmp:50,notifOpen:false,mods:{},modal:null,accStep:1,accA:false,accB:false,accepted031:false,overrides:{},progCode:null,progQty:'',progNote:'',progErr:'',toast:'',phone:'655 638 219',personType:'fisica',profErr:'',spec:SPEC0,edits:{},reason:'',audit:[],resolved:{},extraAct:[],userFilter:'all',q:'',reviewed:{},readN:{},docOpen:null,budgetId:'031'};
  go=(screen,x)=>{this.setState(Object.assign({screen,notifOpen:false},x||{}));window.scrollTo(0,0);};
  componentWillUnmount(){clearTimeout(this._t);}
  flash=t=>{this.setState({toast:t});clearTimeout(this._t);this._t=setTimeout(()=>this.setState({toast:''}),3600);};
  log=(actor,action,target,detail)=>this.setState(s=>({audit:[['21 oct · ahora',actor,action,target,detail]].concat(s.audit)}));
  build(raw,view){
    const ov=this.state.overrides,st0=D(raw.start),en=D(raw.end),total=days(st0,en),el=Math.max(0,Math.min(total,days(st0,TODAY)));
    let pem=0,earned=0;const counts={done:0,prog:0,val:0,todo:0,block:0};
    const chapters=raw.chapters.map(ch=>{let cT=0,cE=0;
      const items=ch.items.map(p=>{let status=p.status,pend=p.pend;const k=raw.id+p.code;if(ov[k]!=null){status='val';pend=ov[k];}
        const imp=p.qty*p.price,pct=p.nomeas?0:Math.round(p.val/p.qty*100);cT+=imp;cE+=p.nomeas?0:p.val*p.price;
        const vs=(view==='client'&&status==='val')?'prog':status;counts[vs]++;
        let note='';if(p.nomeas)note='Sin medición actualizada';else if(view!=='client'&&status==='val'&&pend!=null)note='Propuesto: '+num(pend)+' '+p.unit+' · pendiente de validar';
        return Object.assign({},p,{key:k,status:vs,st:ST[vs],impS:eur(imp),qtyS:num(p.qty),valS:p.nomeas?'—':num(p.val),pctS:p.nomeas?'—':pct+'%',pctW:pct+'%',note,hasNote:!!note,rsS:p.rs||'—',reS:p.re||'—',open:()=>this.setState({modal:'prog',progCode:k,progQty:String(pend!=null?pend:p.val),progNote:'',progErr:''})});});
      pem+=cT;earned+=cE;return Object.assign({},ch,{items,tot:cT,earn:cE});});
    chapters.forEach(ch=>{const pct=Math.round(ch.earn/ch.tot*100);const doing=ch.items.some(i=>i.status!=='done'&&i.status!=='todo')||(pct>0&&pct<100);
      Object.assign(ch,{pct,pctS:pct+'%',pctW:pct+'%',weightS:Math.round(ch.tot/pem*100)+'% del importe',totS:eur(ch.tot),gL:(ch.s/total*100)+'%',gW:((ch.e-ch.s)/total*100)+'%',gBg:pct>=100?'#DEF3F0':doing?'#E3E7F3':'#EDEDEA',gFg:pct>=100?'#55A89D':'#5567AE',stateS:pct>=100?'Terminado':doing?'En curso':'Próximamente',hasDelay:!!ch.delay,hasDep:!!ch.dep,nDone:ch.items.filter(i=>i.status==='done').length+' de '+ch.items.length+' partidas'});});
    const phys=Math.round(earned/pem*100),temp=Math.round(el/total*100);
    const months=[];let d=new Date(st0.getFullYear(),st0.getMonth(),1);while(d<=en){const off=Math.max(0,days(st0,d));months.push({label:MES[d.getMonth()],left:(off/total*100)+'%'});d=new Date(d.getFullYear(),d.getMonth()+1,1);}
    const mods=raw.mods.map(m=>{const status=this.state.mods[m.id]||m.status;return Object.assign({},m,{status,st:BST[status],amountS:'+'+eur(m.amount),isPending:status==='pending',accept:()=>this.setState({modal:'mod',modId:m.id,modAct:'accept'}),reject:()=>this.setState({modal:'mod',modId:m.id,modAct:'reject'})});});
    const appr=mods.filter(m=>m.status==='approved').reduce((a,m)=>a+m.amount,0),pendA=mods.filter(m=>m.status==='pending').reduce((a,m)=>a+m.amount,0);
    const ms=raw.milestones.map(m=>({label:m[0],date:m[1],done:m[2]==='done',now:m[2]==='now',next:m[2]==='next',dotBg:m[2]==='done'?'#55A89D':m[2]==='now'?'#5567AE':'#fff',dotBd:m[2]==='next'?'#CFC0C0':'transparent',fg:m[2]==='next'?'#6B6B68':'#1D1D1B',tag:m[2]==='done'?'Hecho':m[2]==='now'?'Ahora':'Previsto'}));
    const nextM=raw.milestones.find(m=>m[2]==='now')||raw.milestones.find(m=>m[2]==='next');
    const curr=[],next=[],nomeas=[];chapters.forEach(c=>c.items.forEach(i=>{if(i.status==='prog'||i.status==='val'||i.status==='block')curr.push(Object.assign({},i,{chap:c.name}));if(i.status==='todo'&&next.length<3)next.push(Object.assign({},i,{chap:c.name}));if(i.nomeas)nomeas.push(i);}));
    const docs=raw.docs.map((x,j)=>{const key=raw.id+j,rev=x[4]==='review'&&!this.state.reviewed[key];return {icon:x[0],name:x[1],type:x[2],date:x[3],stLabel:rev?'Pendiente de tu revisión':'Disponible',stBg:rev?'#FBF1DE':'#DEF3F0',stFg:rev?'#7A4E0E':'#2F6B63',open:()=>this.setState({modal:'doc',docOpen:{key,name:x[1],type:x[2],date:x[3],rev}})};});
    const act=(raw.id==='o1'?this.state.extraAct:[]).length?[['Ahora',this.state.extraAct]].concat(raw.activity):raw.activity;
    return Object.assign({},raw,{chapters,pem,pemS:eur(pem),phys,physS:phys+'%',physW:phys+'%',temp,tempS:temp+'%',tempW:temp+'%',elS:el+' de '+total+' días',certS:eur(raw.cert),certPct:Math.round(raw.cert/pem*100),certW:Math.round(raw.cert/pem*100)+'%',ofS:'de '+eur(pem),counts,months,todayF:el/total,todayL:(el/total*100)+'%',mods,hasMods:mods.length>0,noMods:mods.length===0,origS:eur(pem),apprS:'+'+eur(appr),vigS:eur(pem+appr),pendS:'+'+eur(pendA),hasPend:pendA>0,ms,nextM:nextM?nextM[0]+' · '+nextM[1]:'—',curr,next,nomeas,hasNomeas:nomeas.length>0,docs,isBehind:!!raw.behind&&phys<temp-10,
      activity:act.map(g=>({day:g[0],items:g[1].map(i=>({t:i[0],icon:i[1],txt:i[2]}))})),hasCompare:!!raw.compareAfter,noCompare:!raw.compareAfter,
      photos:raw.photos.filter(p=>this.state.photoFilter==='Todas'||p.phase===this.state.photoFilter),
      openC:()=>this.go(this.state.role==='worker'?'w_obra':'c_obra',{obraId:raw.id,tab:'resumen'}),
      pickC:()=>this.setState({obraId:raw.id}),
      pickBg:raw.id===this.state.obraId?'#0C062B':'#fff',pickFg:raw.id===this.state.obraId?'#fff':'#1D1D1B'});
  }
  renderVals(){
    const s=this.state,role=s.role,view=role==='client'?'client':'internal';
    const obras=['o1','o2'].map(id=>this.build(OBRAS[id],view));const obra=obras.find(o=>o.id===s.obraId);
    const mk=(label,icon,screen,badge,match)=>({label,icon,badge,go:()=>this.go(screen),bg:(match||[screen]).includes(s.screen)?'#F2F4FA':'transparent',fg:(match||[screen]).includes(s.screen)?'#3E4D85':'#3A3A38',fw:(match||[screen]).includes(s.screen)?700:500});
    const pend031=!s.accepted031;
    const modPend=obras[0].mods.filter(m=>m.isPending).length;
    const nav=role==='client'?[mk('Inicio','ri-home-5-line','c_home'),mk('Mis obras','ri-building-2-line','c_obras',modPend||0,['c_obras','c_obra']),mk('Presupuestos','ri-file-list-3-line','c_presupuestos',pend031?1:0,['c_presupuestos','c_presupuesto']),mk('Mi perfil','ri-user-3-line','c_perfil')]
      :role==='worker'?[mk('Hoy','ri-sun-line','w_home'),mk('Obras asignadas','ri-building-2-line','w_obras',0,['w_obras','w_obra'])]
      :[mk('Panel','ri-dashboard-3-line','a_home'),mk('Usuarios','ri-group-line','a_users',USERS.filter(u=>u.issues.some(i=>!s.resolved[i.id])&&u.role==='client').length,['a_users','a_user']),mk('Auditoría','ri-history-line','a_audit')];
    const me=role==='client'?{name:'Lucía Fernández',initials:'LF',role:'Cliente · 2 obras',avBg:'#EC6090'}:role==='worker'?{name:'Javier Moreno',initials:'JM',role:'Jefe de obra',avBg:'#68C0B5'}:{name:'Administrador principal',initials:'AP',role:'Admin',avBg:'#0C062B'};
    const roles=[['client','Cliente'],['worker','Jefe obra'],['admin','Admin']].map(([k,l])=>({label:l,go:()=>this.setState({role:k,screen:({client:'c_home',worker:'w_home',admin:'a_home'})[k],notifOpen:false,obraId:'o1',tab:'resumen'}),bg:k===role?'#fff':'transparent',fg:k===role?'#0C062B':'#6B6B68',sh:k===role?'0 1px 2px rgba(12,6,43,0.08)':'none'}));
    const user=USERS.find(u=>u.id===s.userId);
    const titles={c_home:['Inicio'],c_obras:['Mis obras'],c_obra:['Mis obras',obra.name],c_presupuestos:['Presupuestos'],c_presupuesto:['Presupuestos','PRE-2026-031 v1'],c_perfil:['Mi perfil'],w_home:['Hoy'],w_obras:['Obras asignadas'],w_obra:['Obras asignadas',obra.name],a_home:['Panel de administración'],a_users:['Usuarios'],a_user:['Usuarios',user.name],a_audit:['Auditoría']};
    const parent={c_obra:'c_obras',c_presupuesto:'c_presupuestos',w_obra:'w_obras',a_user:'a_users'};
    const tt=titles[s.screen];const crumbs=tt.map((l,i)=>({label:l,sep:i>0,fg:i===tt.length-1?'#1D1D1B':'#6B6B68',fw:i===tt.length-1?700:500,go:()=>i<tt.length-1&&this.go(parent[s.screen])}));
    const NT=[['n1','ri-edit-2-line','MOD-02 espera tu decisión','Reforma integral · +385,00 € · antes del 24 oct',()=>this.go('c_obra',{obraId:'o1',tab:'mods'})],['n2','ri-camera-line','Nuevo avance publicado','Reforma integral · 3 fotos en Electricidad',()=>this.go('c_obra',{obraId:'o1',tab:'fotos'})],['n3','ri-file-text-line','Documento para revisar','Acta de replanteo · Revestimientos',()=>this.go('c_obra',{obraId:'o1',tab:'docs'})],['n4','ri-file-list-3-line','Presupuesto disponible','PRE-2026-031 · Terraza y cerramiento',()=>this.go('c_presupuesto')],['n5','ri-user-3-line','Completa tus datos fiscales','Necesarios para la certificación nº 2',()=>this.go('c_perfil')]];
    const readInit={n3:1,n4:1,n5:1};
    const notifs=NT.map(n=>{const read=s.readN[n[0]]||readInit[n[0]];return {icon:n[1],title:n[2],sub:n[3],bg:read?'#fff':'#F8F9FC',fw:read?500:700,dot:read?'transparent':'#EC6090',go:()=>{this.setState(st=>({readN:Object.assign({},st.readN,{[n[0]]:1})}));n[4]();}};});
    const unread=role==='client'?notifs.filter(n=>n.dot!=='transparent').length:0;
    const is={};['c_home','c_obras','c_obra','c_presupuestos','c_presupuesto','c_perfil','w_home','w_obras','w_obra','a_home','a_users','a_user','a_audit'].forEach(k=>is['is_'+k]=s.screen===k);
    const TABS=[['resumen','Resumen'],['partidas','Partidas'],['crono','Cronograma'],['fotos','Fotografías'],['docs','Documentos'],['mods','Modificaciones'],['act','Actividad']];
    const tabs=TABS.map(([k,l])=>({label:l,go:()=>this.setState({tab:k}),fg:s.tab===k?'#0C062B':'#6B6B68',bd:s.tab===k?'#5567AE':'transparent',fw:s.tab===k?700:500,badge:k==='mods'&&obra.mods.some(m=>m.isPending)?'1':''}));
    const it={};TABS.forEach(([k])=>it['tab_'+k]=s.tab===k);
    const fChap=obra.chapters.map(c=>Object.assign({},c,{items:c.items.filter(i=>s.partFilter==='all'||i.status===s.partFilter)})).filter(c=>c.items.length);
    const fdefs=view==='client'?[['all','Todas'],['done','Completadas'],['prog','En ejecución'],['todo','No iniciadas'],['block','Bloqueadas']]:[['all','Todas'],['done','Completadas'],['prog','En ejecución'],['val','Pendientes de validación'],['todo','No iniciadas'],['block','Bloqueadas']];
    const pfilters=fdefs.map(([k,l])=>({label:l+' · '+(k==='all'?Object.values(obra.counts).reduce((a,b)=>a+b,0):obra.counts[k]),go:()=>this.setState({partFilter:k}),bg:s.partFilter===k?'#0C062B':'#fff',fg:s.partFilter===k?'#fff':'#3A3A38',bd:s.partFilter===k?'#0C062B':'#D9D9D9'}));
    const phFilters=['Todas','Antes','Durante','Después'].map(k=>({label:k,go:()=>this.setState({photoFilter:k}),bg:s.photoFilter===k?'#0C062B':'#fff',fg:s.photoFilter===k?'#fff':'#3A3A38',bd:s.photoFilter===k?'#0C062B':'#D9D9D9'}));
    // budgets
    const bCh=B031.chapters.map(c=>{const lines=c[1].map(l=>({desc:l[0],unit:l[1],qtyS:num(l[2]),priceS:eur(l[3]),impS:eur(l[2]*l[3]),imp:l[2]*l[3]}));const t=lines.reduce((a,l)=>a+l.imp,0);return {name:c[0],lines,totS:eur(t),t};});
    const bBase=bCh.reduce((a,c)=>a+c.t,0);
    const bStatus=s.accepted031?'accepted':'pending';
    const budgets=[{ref:'PRE-2026-031',ver:'v1',name:B031.name,addr:'Martínez de la Rosa, 41',date:'10 oct 2026',amount:eur(bBase*1.1),st:BST[bStatus],upd:s.accepted031?'Hoy':'10 oct',action:s.accepted031?'Ver presupuesto':'Revisar y decidir',primary:!s.accepted031,go:()=>this.go('c_presupuesto')},
      {ref:'PRE-2026-014',ver:'v3',name:'Reforma integral de vivienda',addr:'Martínez de la Rosa, 41',date:'22 ago 2026',amount:eur(obras[0].pem*1.1),st:BST.accepted,upd:'28 ago',action:'Ver obra',primary:false,go:()=>this.go('c_obra',{obraId:'o1',tab:'resumen'})},
      {ref:'PRE-2026-019',ver:'v1',name:'Baño principal',addr:'Av. de la Paloma, 12',date:'12 sep 2026',amount:eur(obras[1].pem*1.1),st:BST.accepted,upd:'15 sep',action:'Ver obra',primary:false,go:()=>this.go('c_obra',{obraId:'o2',tab:'resumen'})},
      {ref:'PRE-2026-011',ver:'v1',name:'Cambio de ventanas · primera propuesta',addr:'Martínez de la Rosa, 41',date:'3 jul 2026',amount:'3.210,00 €',st:BST.expired,upd:'2 ago',action:'Ver',primary:false,go:()=>this.flash('Presupuesto caducado: puedes pedir una nueva versión desde la solicitud SOL-2026-044.')}];
    // profile
    const phoneOk=/^(\+34\s?)?[6789]\d{2}\s?\d{3}\s?\d{3}$/.test(s.phone.trim());
    // admin
    const issuesOpen=u=>u.issues.filter(i=>!s.resolved[i.id]);
    const uf=[['all','Todos'],['client','Clientes'],['internal','Internos'],['review','Pendientes de revisión'],['incomplete','Perfil incompleto']].map(([k,l])=>({label:l,go:()=>this.setState({userFilter:k}),bg:s.userFilter===k?'#0C062B':'#fff',fg:s.userFilter===k?'#fff':'#3A3A38',bd:s.userFilter===k?'#0C062B':'#D9D9D9'}));
    const urows=USERS.filter(u=>(s.userFilter==='all'||(s.userFilter==='client'&&u.role==='client')||(s.userFilter==='internal'&&u.role!=='client')||(s.userFilter==='review'&&issuesOpen(u).length)||(s.userFilter==='incomplete'&&u.prof<100))&&(!s.q||(u.name+u.email).toLowerCase().includes(s.q.toLowerCase()))).map(u=>({...u,initials:u.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),verBg:u.verOk?'#DEF3F0':'#FBF1DE',verFg:u.verOk?'#2F6B63':'#7A4E0E',profS:u.prof===100?'Completo':'Incompleto · '+u.prof+'%',profFg:u.prof===100?'#2F6B63':'#7A4E0E',nIss:issuesOpen(u).length,hasIss:issuesOpen(u).length>0,open:()=>this.go('a_user',{userId:u.id,edits:{},reason:''})}));
    const queue=USERS.flatMap(u=>issuesOpen(u).filter(i=>i.type!=='Perfil').map(i=>({user:u.name,title:i.title,type:i.type,tBg:ITYPE[i.type][0],tFg:ITYPE[i.type][1],open:()=>this.go('a_user',{userId:u.id,edits:{},reason:''})})));
    const isSelf=user.id==='u0';const base=BASE[user.role];const spec0=s.spec[user.id]||[];
    const effSpec=k=>s.edits[k]!=null?s.edits[k]:spec0.includes(k);
    const permGroups=PERMS.map(g=>({name:g[0],items:g[1].map(([k,l,f])=>{const byRole=base.includes(k),on=byRole||effSpec(k),adminOnly=f==='admin',locked=byRole||adminOnly||isSelf,changed=s.edits[k]!=null&&s.edits[k]!==spec0.includes(k);
      return {key:k,label:l,on,byRole,tag:byRole?'Por rol':on?'Específico':'',tagBg:byRole?'#EDEDEA':'#E3E7F3',tagFg:byRole?'#3A3A38':'#3E4D85',hasTag:byRole||on,sens:f==='sens',adminOnly,tBg:on?(locked?'#9A9A96':'#5567AE'):'#D9D9D9',tX:on?'18px':'0px',cur:locked?'not-allowed':'pointer',op:locked&&!on?0.5:1,rowBg:changed?'#F2F4FA':'transparent',
        toggle:()=>{if(locked){this.flash(isSelf?'No puedes modificar tus propios permisos.':adminOnly?'Solo el administrador principal tiene este permiso. No se puede conceder.':'Este permiso viene del rol. Para retirarlo, cambia el rol.');return;}this.setState(st=>({edits:Object.assign({},st.edits,{[k]:!on})}));}};})}));
    const diff=Object.keys(s.edits).filter(k=>s.edits[k]!==spec0.includes(k)).map(k=>({key:k,txt:(s.edits[k]?'Conceder ':'Retirar ')+k,fg:s.edits[k]?'#2F6B63':'#9E2F2F',icon:s.edits[k]?'ri-add-circle-line':'ri-indeterminate-circle-line'}));
    const effList=ALLP.filter(k=>base.includes(k)||effSpec(k));
    const AUD0=[['21 oct · 09:12','Laura Sanz (dirección de obra)','Avance validado','Reforma integral · 02.02','64 de 85 m²'],['18 oct · 17:40','Administrador principal','Permiso concedido','Marta Ruiz','business.users.manage'],['16 oct · 11:05','Marta Ruiz','Revisión completada','Carmen López Díaz','Dirección revisada (revisión humana)'],['14 oct · 10:22','Javier Moreno','Modificación propuesta','Reforma integral','MOD-02 · +385,00 €'],['12 oct · 08:55','Sistema','Incidencia automática','Antonio Gil','Teléfono con formato no válido'],['12 oct · 08:54','Sistema','Alta de cuenta','Antonio Gil','Email y contraseña']];
    const audit=s.audit.concat(AUD0).map(a=>({when:a[0],actor:a[1],action:a[2],target:a[3],detail:a[4]}));
    const bars=[2,1,0,3,1,2,0,1,4,2,1,0,1,3,2,1,0,2,1,1,3,2,0,1,2,1,0,2,1,3].map((v,i)=>({h:(v*22+4)+'px',bg:i>=23?'#5567AE':'#BFC7E4'}));
    const KPI=[['Usuarios registrados','148','+12 en 7 días · +41 en 30 días'],['Pendientes de revisión',String(queue.length),'Incidencias abiertas en la cola'],['Perfiles incompletos','23','Sin datos fiscales o dirección'],['Posibles duplicados','2','Mismo nombre y localidad'],['Clientes con obra','31','38 obras activas o terminadas'],['Clientes sin obra','106','14 con presupuesto pendiente'],['Internos activos','11','4 jefes de obra · 3 comerciales'],['Cambios de permisos','5','Últimos 30 días']].map(k=>({label:k[0],value:k[1],sub:k[2]}));
    const prog=s.progCode?(()=>{for(const c of obra.chapters)for(const i of c.items)if(i.key===s.progCode)return Object.assign({},i,{chap:c.code+' '+c.name});})():null;
    const mod=s.modal==='mod'?obra.mods.find(m=>m.id===s.modId):null;
    const wObras=[obras[0],obras[1],Object.assign({},obras[0],{id:'o3',name:'Cocina abierta al salón',addr:'C/ Granada, 8 · Málaga',type:'Cocina · 18 m²',cover:IMG.t17,physS:'0%',physW:'0%',status:'Inicio 3 nov',upd:'—',openC:()=>this.flash('Obra pendiente de inicio: las partidas se publican el 3 nov.')})];
    const myIssues=user.issues.map(i=>({...i,done:!!s.resolved[i.id],open:!s.resolved[i.id],tBg:ITYPE[i.type][0],tFg:ITYPE[i.type][1],
      fix:()=>{this.setState(st=>({resolved:Object.assign({},st.resolved,{[i.id]:'Corregido'})}));this.log('Administrador principal','Dato corregido',user.name,i.field);this.flash('Campo corregido. El cambio queda en el historial.');},
      ask:()=>{this.log('Administrador principal','Información solicitada',user.name,i.field);this.flash('Solicitud enviada: '+user.name+' verá un aviso para completar '+i.field+'.');},
      close:()=>{this.setState(st=>({resolved:Object.assign({},st.resolved,{[i.id]:'Revisada'})}));this.log('Administrador principal','Revisión completada',user.name,i.title);this.flash('Revisión marcada como completada.');}}));
    return Object.assign({},is,it,{
      showDemo:this.props.showDemoBadge??true,isClient:role==='client',isWorker:role==='worker',isAdmin:role==='admin',isInternal:view==='internal',
      areaLabel:role==='client'?'Área de cliente':role==='worker'?'Workspace':'Administración',nav,me,roles,crumbs,notifs,unread,notifOpen:s.notifOpen,
      toggleNotif:()=>this.setState({notifOpen:!s.notifOpen}),readAll:()=>this.setState({readN:{n1:1,n2:1,n3:1,n4:1,n5:1}}),
      askBudget:()=>this.props.onOpenLead?this.props.onOpenLead():this.flash('Abriría el formulario de solicitud.'),
      obras,obra,tabs,fChap,pfilters,phFilters,toast:s.toast,hasToast:!!s.toast,
      homeSummary:'Tienes 2 obras en marcha'+(modPend?' y '+modPend+' modificación esperando tu decisión.':'.'),
      attention:[modPend?{icon:'ri-edit-2-line',title:'Decide sobre MOD-02',sub:'Plato de ducha extraplano · +385,00 € · antes del 24 oct',cta:'Revisar',go:()=>this.go('c_obra',{obraId:'o1',tab:'mods'})}:null,!s.reviewed['o13']?{icon:'ri-file-text-line',title:'Revisa el acta de replanteo',sub:'Reforma integral · publicada el 20 oct',cta:'Abrir',go:()=>this.go('c_obra',{obraId:'o1',tab:'docs'})}:null,pend031?{icon:'ri-file-list-3-line',title:'Presupuesto pendiente de decisión',sub:'PRE-2026-031 · Terraza · válido hasta el 9 nov',cta:'Revisar',go:()=>this.go('c_presupuesto')}:null,{icon:'ri-user-3-line',title:'Completa tus datos fiscales',sub:'Los necesitamos para emitir la certificación nº 2',cta:'Completar',go:()=>this.go('c_perfil')}].filter(Boolean),
      recentPhotos:[{img:IMG.t02,cap:'Baño principal · 19 oct'},{img:IMG.t05,cap:'Baño principal · 20 oct'},{img:IMG.t03,cap:'Baño principal · 12 oct'}],
      cmp:s.cmp,cmpClip:'inset(0 '+(100-s.cmp)+'% 0 0)',cmpPos:s.cmp+'%',onCmp:e=>this.setState({cmp:+e.target.value}),
      budgets,b:Object.assign({},B031,{versions:B031.versions.map(v=>({v:v[0],d:v[1],s:s.accepted031?'Aceptada hoy':v[2]}))}),bCh,bBaseS:eur(bBase),bIvaS:eur(bBase*0.1),bTotS:eur(bBase*1.1),bSt:BST[bStatus],bPending:!s.accepted031,bAccepted:s.accepted031,
      startAccept:()=>this.setState({modal:'accept',accStep:1,accA:false,accB:false}),
      rejectBudget:()=>this.flash('Abriría el motivo de rechazo (opcional) y registraría la decisión sobre la versión v1.'),
      accStep1:s.accStep===1,accStep2:s.accStep===2,accStep3:s.accStep===3,accA:s.accA,accB:s.accB,accCanGo:s.accA&&s.accB,
      accAIcon:s.accA?'ri-checkbox-fill':'ri-checkbox-blank-line',accBIcon:s.accB?'ri-checkbox-fill':'ri-checkbox-blank-line',
      tglA:()=>this.setState({accA:!s.accA}),tglB:()=>this.setState({accB:!s.accB}),
      accNext:()=>this.setState({accStep:2}),accBack:()=>this.setState({accStep:1}),
      accBtnBg:s.accA&&s.accB?'#5567AE':'#D9D9D9',accBtnFg:s.accA&&s.accB?'#fff':'#6B6B68',
      accConfirm:()=>{if(!(s.accA&&s.accB))return;this.setState({accStep:3,accepted031:true});},
      closeModal:()=>this.setState({modal:null}),
      mAccept:s.modal==='accept',mMod:s.modal==='mod',mProg:s.modal==='prog'&&!!prog,mPerm:s.modal==='perm',mDoc:s.modal==='doc'&&!!s.docOpen,
      mod:mod||{},modIsAccept:s.modAct==='accept',modIsReject:s.modAct==='reject',
      modConfirm:()=>{const ok=s.modAct==='accept';this.setState(st=>({modal:null,mods:Object.assign({},st.mods,{[s.modId]:ok?'approved':'rejected'}),extraAct:[['ahora',ok?'ri-check-double-line':'ri-close-circle-line',(ok?'Aprobaste ':'Rechazaste ')+s.modId+(ok?': se incorpora al alcance autorizado':': el alcance contratado no cambia')]].concat(st.extraAct)}));this.flash(ok?s.modId+' aprobada. El alcance autorizado se ha actualizado.':s.modId+' rechazada. El alcance contratado no cambia.');},
      doc:s.docOpen||{},docRev:!!(s.docOpen&&s.docOpen.rev),
      markReviewed:()=>{this.setState(st=>({reviewed:Object.assign({},st.reviewed,{[st.docOpen.key]:1}),modal:null}));this.flash('Documento marcado como revisado.');},
      prog:prog||{},progQty:s.progQty,progNote:s.progNote,progErr:s.progErr,hasProgErr:!!s.progErr,
      onProgQty:e=>this.setState({progQty:e.target.value,progErr:''}),onProgNote:e=>this.setState({progNote:e.target.value}),
      progSubmit:()=>{const q=parseFloat(String(s.progQty).replace(',','.'));if(isNaN(q)||q<0){this.setState({progErr:'Introduce una cantidad válida.'});return;}if(q>prog.qty){this.setState({progErr:'Supera lo contratado ('+prog.qtyS+' '+prog.unit+'). Si es trabajo adicional, propón una modificación de obra.'});return;}if(q<prog.val){this.setState({progErr:'No puede ser menor que lo ya validado ('+prog.valS+' '+prog.unit+').'});return;}this.setState(st=>({modal:null,overrides:Object.assign({},st.overrides,{[s.progCode]:q})}));this.log('Javier Moreno','Avance enviado a validación',obra.name+' · '+prog.code,num(q)+' '+prog.unit);this.flash('Enviado a validación. El cliente lo verá cuando la dirección de obra lo publique.');},
      phone:s.phone,onPhone:e=>this.setState({phone:e.target.value,profErr:''}),profErr:s.profErr,hasProfErr:!!s.profErr,phoneBd:s.profErr?'#D14A4A':'#D9D9D9',
      saveProfile:()=>{if(!phoneOk){this.setState({profErr:'Formato no válido. Usa 9 cifras, por ejemplo 655 638 219.'});return;}this.flash('Cambios guardados.');},
      isFisica:s.personType==='fisica',isEmpresa:s.personType==='empresa',
      ptypes:[['fisica','Persona física'],['empresa','Empresa']].map(([k,l])=>({label:l,go:()=>this.setState({personType:k}),bg:s.personType===k?'#fff':'transparent',fg:s.personType===k?'#0C062B':'#6B6B68',sh:s.personType===k?'0 1px 2px rgba(12,6,43,0.08)':'none'})),
      kpis:KPI,bars,queue,uf,urows,q:s.q,onQ:e=>this.setState({q:e.target.value}),noRows:urows.length===0,
      user:Object.assign({},user,{initials:user.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),verBg:user.verOk?'#DEF3F0':'#FBF1DE',verFg:user.verOk?'#2F6B63':'#7A4E0E',profS:user.prof+'%',profW:user.prof+'%'}),
      userIsClient:user.role==='client',userIsInternal:user.role!=='client',isSelf,notSelf:!isSelf,myIssues,hasIssues:myIssues.length>0,noIssues:myIssues.length===0,
      permGroups,diff,hasDiff:diff.length>0,noDiff:diff.length===0,effCount:effList.length+' permisos efectivos',
      saveBg:diff.length?'#5567AE':'#D9D9D9',saveFg:diff.length?'#fff':'#6B6B68',
      openPerm:()=>diff.length&&this.setState({modal:'perm',reason:''}),reason:s.reason,onReason:e=>this.setState({reason:e.target.value}),
      permOk:!!s.reason.trim(),permBtnBg:s.reason.trim()?'#5567AE':'#D9D9D9',permBtnFg:s.reason.trim()?'#fff':'#6B6B68',
      permConfirm:()=>{if(!s.reason.trim())return;const nextSpec=ALLP.filter(k=>!base.includes(k)&&effSpec(k));diff.forEach(d=>this.log('Administrador principal',d.txt.startsWith('Conceder')?'Permiso concedido':'Permiso retirado',user.name,d.key+' · '+s.reason.trim()));this.setState(st=>({modal:null,edits:{},spec:Object.assign({},st.spec,{[user.id]:nextSpec})}));this.flash('Permisos actualizados y registrados en auditoría.');},
      discard:()=>this.setState({edits:{}}),
      audit,wObras,
      wSubmitted:Object.keys(s.overrides).length+1,
      wIncident:()=>this.flash('Abriría el formulario de incidencia: descripción, partida afectada, fotos y si bloquea trabajos.'),
      wDate:()=>this.flash('Abriría la propuesta de cambio de fechas. Requiere aprobación antes de mostrarse al cliente.'),
      goObras:()=>this.go('c_obras'),goPresu:()=>this.go('c_presupuestos'),goBudget:()=>this.go('c_presupuesto'),goObra1:()=>this.go('c_obra',{obraId:'o1',tab:'resumen'}),goUsers:()=>this.go('a_users'),goAudit:()=>this.go('a_audit'),goWObras:()=>this.go('w_obras'),
      goTabPart:()=>this.setState({tab:'partidas'}),goTabFotos:()=>this.setState({tab:'fotos'}),goTabCrono:()=>this.setState({tab:'crono'})
    });
  }
  render(){
    const v=this.renderVals();
    return (
      <div className="plat">
    <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0,1fr)", minHeight: "100vh" }}>
      <aside style={{ background: "#fff", borderRight: "1px solid #EDEDEA", display: "flex", flexDirection: "column", gap: "24px", padding: "22px 16px", position: "sticky", top: "0", height: "100vh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 8px" }}>
          <img src={logo} alt="" style={{ width: "34px", height: "34px" }} />
          <span style={{ fontWeight: "700", fontSize: "27px", letterSpacing: "-0.07em", color: "#5567AE", lineHeight: "1" }}>
            {"Ledens"}
          </span>
        </div>
        <div style={{ padding: "0 8px", fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
          {v.areaLabel}
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "-12px" }}>
          {(v.nav || []).map((n, n_i) => (
            <React.Fragment key={n_i}>
              <button onClick={n.go} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px", borderRadius: "8px", border: "0", background: n.bg, color: n.fg, fontSize: "15px", fontWeight: n.fw, cursor: "pointer", textAlign: "left", minHeight: "44px" }}>
                <i className={n.icon} style={{ fontSize: "20px" }}></i>
                <span style={{ flex: "1" }}>
                  {n.label}
                </span>
                {n.badge ? (
                  <>
                    <span style={{ minWidth: "22px", height: "22px", borderRadius: "99px", background: "#EC6090", color: "#fff", fontSize: "12px", fontWeight: "700", display: "grid", placeItems: "center", padding: "0 6px" }}>
                      {n.badge}
                    </span>
                  </>
                ) : null}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="plat-spacer" style={{ flex: "1" }}></div>
        {v.isClient ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "12px", background: "#F2F4FA" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#0C062B" }}>
                {"¿Otra reforma en mente?"}
              </div>
              <div style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.4" }}>
                {"Pide presupuesto y lo verás aquí junto al resto."}
              </div>
              <button onClick={v.askBudget} style={{ background: "#EC6090", color: "#fff", border: "0", borderRadius: "8px", padding: "11px 12px", fontWeight: "700", fontSize: "13px", cursor: "pointer", letterSpacing: "0.02em" }}>
                {"SOLICITAR PRESUPUESTO"}
              </button>
            </div>
          </>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 8px 0", borderTop: "1px solid #EDEDEA" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "99px", background: v.me.avBg, color: "#fff", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "13px" }}>
            {v.me.initials}
          </div>
          <div style={{ flex: "1", minWidth: "0" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {v.me.name}
            </div>
            <div style={{ fontSize: "12px", color: "#6B6B68" }}>
              {v.me.role}
            </div>
          </div>
          <i className="ri-logout-box-r-line" title="Cerrar sesi\u00f3n" style={{ fontSize: "18px", color: "#6B6B68" }}></i>
        </div>
      </aside>
      <div style={{ display: "flex", flexDirection: "column", minWidth: "0" }}>
        <header style={{ height: "64px", background: "#fff", borderBottom: "1px solid #EDEDEA", display: "flex", alignItems: "center", gap: "16px", padding: "0 32px", position: "sticky", top: "0", zIndex: "20" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1", minWidth: "0", fontSize: "14px" }}>
            {(v.crumbs || []).map((c, c_i) => (
              <React.Fragment key={c_i}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: "0" }}>
                  {c.sep ? (
                    <>
                      <i className="ri-arrow-right-s-line" style={{ color: "#9A9A96" }}></i>
                    </>
                  ) : null}
                  <button onClick={c.go} style={{ border: "0", background: "none", padding: "4px 2px", cursor: "pointer", fontSize: "14px", color: c.fg, fontWeight: c.fw, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "260px" }}>
                    {c.label}
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
          {v.showDemo ? (
            <>
              <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.05em", color: "#B84371", background: "#FDF0F4", border: "1px solid #FBE0EA", padding: "5px 10px", borderRadius: "99px", whiteSpace: "nowrap", flexShrink: "0" }}>
                {"DEMO"}
              </span>
            </>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#F7F7F5", border: "1px solid #EDEDEA", borderRadius: "10px", padding: "3px", flexShrink: "0" }}>
            <span style={{ fontSize: "12px", color: "#6B6B68", padding: "0 6px", whiteSpace: "nowrap" }}>
              {"Ver como"}
            </span>
            {(v.roles || []).map((r, r_i) => (
              <React.Fragment key={r_i}>
                <button onClick={r.go} style={{ border: "0", borderRadius: "7px", padding: "7px 12px", fontSize: "13px", fontWeight: "600", cursor: "pointer", background: r.bg, color: r.fg, boxShadow: r.sh, whiteSpace: "nowrap" }}>
                  {r.label}
                </button>
              </React.Fragment>
            ))}
          </div>
          <div style={{ position: "relative" }}>
            <button onClick={v.toggleNotif} aria-label="Notificaciones" style={{ width: "44px", height: "44px", borderRadius: "10px", border: "1px solid #EDEDEA", background: "#fff", cursor: "pointer", position: "relative", display: "grid", placeItems: "center" }}>
              <i className="ri-notification-3-line" style={{ fontSize: "20px", color: "#3A3A38" }}></i>
              {v.unread ? (
                <>
                  <span style={{ position: "absolute", top: "6px", right: "6px", minWidth: "18px", height: "18px", borderRadius: "99px", background: "#EC6090", color: "#fff", fontSize: "11px", fontWeight: "700", display: "grid", placeItems: "center", padding: "0 4px" }}>
                    {v.unread}
                  </span>
                </>
              ) : null}
            </button>
            {v.notifOpen ? (
              <>
                <div style={{ position: "absolute", right: "0", top: "52px", width: "400px", background: "#fff", border: "1px solid #EDEDEA", borderRadius: "12px", boxShadow: "0 12px 32px rgba(12,6,43,0.12),0 4px 8px rgba(12,6,43,0.06)", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", borderBottom: "1px solid #EDEDEA" }}>
                    <span style={{ fontWeight: "700", fontSize: "16px" }}>
                      {"Notificaciones"}
                    </span>
                    <button onClick={v.readAll} style={{ border: "0", background: "none", color: "#5567AE", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                      {"Marcar todo como leído"}
                    </button>
                  </div>
                  {(v.notifs || []).map((nt, nt_i) => (
                    <React.Fragment key={nt_i}>
                      <button onClick={nt.go} style={{ display: "flex", gap: "12px", width: "100%", textAlign: "left", border: "0", borderBottom: "1px solid #F0F0EC", background: nt.bg, padding: "14px 18px", cursor: "pointer" }}>
                        <i className={nt.icon} style={{ fontSize: "20px", color: "#5567AE", marginTop: "1px" }}></i>
                        <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ fontSize: "14px", fontWeight: nt.fw, color: "#1D1D1B" }}>
                            {nt.title}
                          </span>
                          <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                            {nt.sub}
                          </span>
                        </span>
                        <span style={{ width: "8px", height: "8px", borderRadius: "99px", background: nt.dot, marginTop: "6px" }}></span>
                      </button>
                    </React.Fragment>
                  ))}
                  <div style={{ padding: "12px 18px", fontSize: "12px", color: "#6B6B68", background: "#FAFAF8" }}>
                    {"Avisos por email: próximamente. Hoy solo dentro de la plataforma."}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </header>
        <main style={{ padding: "32px", maxWidth: "1240px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
          {v.is_c_home ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                    {"Martes, 21 de octubre"}
                  </div>
                  <h1 style={{ fontSize: "36px", fontWeight: "700", letterSpacing: "-0.02em", lineHeight: "1.1" }}>
                    {"Hola, Lucía"}
                  </h1>
                  <p style={{ fontSize: "17px", color: "#3A3A38" }}>
                    {v.homeSummary}
                  </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: "20px" }}>
                  {(v.obras || []).map((o, o_i) => (
                    <React.Fragment key={o_i}>
                      <button onClick={o.openC} style={{ textAlign: "left", border: "1px solid #EDEDEA", background: "#fff", borderRadius: "16px", padding: "0", overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(12,6,43,0.06)" }}>
                        <div style={{ position: "relative", height: "170px", background: "#EFEAE2" }}>
                          <img src={o.cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          <span style={{ position: "absolute", left: "16px", top: "16px", background: "#fff", color: "#0C062B", fontSize: "12px", fontWeight: "700", padding: "5px 10px", borderRadius: "99px" }}>
                            {o.status}
                          </span>
                        </div>
                        <div style={{ padding: "20px 22px 22px", display: "flex", flexDirection: "column", gap: "16px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                              {o.type}
                            </span>
                            <span style={{ fontSize: "20px", fontWeight: "700", color: "#0C062B", letterSpacing: "-0.01em" }}>
                              {o.name}
                            </span>
                            <span style={{ fontSize: "14px", color: "#3A3A38" }}>
                              {o.addr}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: "16px" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "40px", fontWeight: "700", lineHeight: "1", color: "#0C062B" }}>
                                {o.physS}
                              </span>
                              <span style={{ fontSize: "12px", color: "#6B6B68", marginTop: "4px" }}>
                                {"ejecutado y validado"}
                              </span>
                            </div>
                            <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "6px", paddingBottom: "4px" }}>
                              <div style={{ height: "8px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                                <div style={{ width: o.physW, height: "100%", background: "#5567AE", borderRadius: "99px" }}></div>
                              </div>
                              <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                {"Plazo transcurrido: "}{o.tempS}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "12px", paddingTop: "16px", borderTop: "1px solid #F0F0EC" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                {"Inicio"}
                              </span>
                              <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                {o.startS}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                {"Entrega prevista"}
                              </span>
                              <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                {o.endS}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                {"Próximo hito"}
                              </span>
                              <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                {o.nextM}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px", color: "#6B6B68" }}>
                            <span>
                              {"Última actualización: "}{o.upd}
                            </span>
                            <span style={{ color: "#5567AE", fontWeight: "700", display: "flex", alignItems: "center", gap: "4px" }}>
                              {"Ver obra "}
                              <i className="ri-arrow-right-line"></i>
                            </span>
                          </div>
                        </div>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: "20px" }}>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "8px" }}>
                      {"Necesita tu atención"}
                    </h2>
                    {(v.attention || []).map((a, a_i) => (
                      <React.Fragment key={a_i}>
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                          <span style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#F2F4FA", display: "grid", placeItems: "center", flexShrink: "0" }}>
                            <i className={a.icon} style={{ fontSize: "20px", color: "#5567AE" }}></i>
                          </span>
                          <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "15px", fontWeight: "700" }}>
                              {a.title}
                            </span>
                            <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                              {a.sub}
                            </span>
                          </div>
                          <button onClick={a.go} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "9px 14px", fontSize: "13px", fontWeight: "700", color: "#0C062B", cursor: "pointer", minHeight: "40px" }}>
                            {a.cta}
                          </button>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                        {"Fotos recientes"}
                      </h2>
                      <button onClick={v.goObras} style={{ border: "0", background: "none", color: "#5567AE", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}>
                        {"Ver todas"}
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "10px" }}>
                      {(v.recentPhotos || []).map((ph, ph_i) => (
                        <React.Fragment key={ph_i}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <img src={ph.img} alt="" style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: "10px", display: "block" }} />
                            <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                              {ph.cap}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px", borderRadius: "12px", background: "#F7F7F5" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "99px", background: "#68C0B5", color: "#fff", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "13px" }}>
                        {"JM"}
                      </div>
                      <div style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "14px", fontWeight: "700" }}>
                          {"Javier Moreno"}
                        </span>
                        <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                          {"Tu jefe de obra en ambas reformas"}
                        </span>
                      </div>
                      <a href="https://wa.me/34655638219" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "700" }}>
                        <i className="ri-whatsapp-line" style={{ fontSize: "18px" }}></i>
                        {"Escribir"}
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_c_obras ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                      {"Mis obras"}
                    </h1>
                    <p style={{ color: "#3A3A38", fontSize: "15px" }}>
                      {"2 activas · 0 terminadas"}
                    </p>
                  </div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "88px minmax(220px,1.6fr) minmax(130px,0.8fr) minmax(170px,1fr) 130px 130px 120px", gap: "16px", padding: "12px 20px", fontSize: "12px", fontWeight: "700", letterSpacing: "0.03em", color: "#6B6B68", textTransform: "uppercase", background: "#FAFAF8" }}>
                    <span></span>
                    <span>
                      {"Obra"}
                    </span>
                    <span>
                      {"Estado"}
                    </span>
                    <span>
                      {"Avance físico"}
                    </span>
                    <span>
                      {"Inicio"}
                    </span>
                    <span>
                      {"Entrega prevista"}
                    </span>
                    <span>
                      {"Actualizada"}
                    </span>
                  </div>
                  {(v.obras || []).map((o, o_i) => (
                    <React.Fragment key={o_i}>
                      <button onClick={o.openC} style={{ display: "grid", gridTemplateColumns: "88px minmax(220px,1.6fr) minmax(130px,0.8fr) minmax(170px,1fr) 130px 130px 120px", gap: "16px", alignItems: "center", padding: "16px 20px", border: "0", borderTop: "1px solid #F0F0EC", background: "#fff", width: "100%", textAlign: "left", cursor: "pointer", fontSize: "14px" }}>
                        <img src={o.cover} alt="" style={{ width: "88px", height: "64px", objectFit: "cover", borderRadius: "8px", display: "block" }} />
                        <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ fontSize: "16px", fontWeight: "700", color: "#0C062B" }}>
                            {o.name}
                          </span>
                          <span style={{ color: "#6B6B68", fontSize: "13px" }}>
                            {o.addr}{" · "}{o.type}
                          </span>
                        </span>
                        <span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#E3E7F3", color: "#3E4D85", fontSize: "12px", fontWeight: "700", padding: "5px 10px", borderRadius: "99px" }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: "#5567AE" }}></span>
                            {o.status}
                          </span>
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ flex: "1", height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                            <span style={{ display: "block", width: o.physW, height: "100%", background: "#5567AE" }}></span>
                          </span>
                          <span style={{ fontWeight: "700", width: "40px" }}>
                            {o.physS}
                          </span>
                        </span>
                        <span>
                          {o.startS}
                        </span>
                        <span>
                          {o.endS}
                        </span>
                        <span style={{ color: "#6B6B68" }}>
                          {o.upd}
                        </span>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {v.is_c_obra ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", color: "#6B6B68", marginRight: "4px" }}>
                    {"Tus obras:"}
                  </span>
                  {(v.obras || []).map((o, o_i) => (
                    <React.Fragment key={o_i}>
                      <button onClick={o.pickC} style={{ border: "1px solid #D9D9D9", borderRadius: "99px", padding: "7px 14px", fontSize: "13px", fontWeight: "700", cursor: "pointer", background: o.pickBg, color: o.pickFg }}>
                        {o.short}{" · "}{o.physS}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "24px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#E3E7F3", color: "#3E4D85", fontSize: "12px", fontWeight: "700", padding: "5px 10px", borderRadius: "99px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: "#5567AE" }}></span>
                        {v.obra.status}
                      </span>
                      <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                        {"Actualizada "}{v.obra.upd}
                      </span>
                    </div>
                    <h1 style={{ fontSize: "32px", fontWeight: "700", letterSpacing: "-0.02em", lineHeight: "1.1" }}>
                      {v.obra.name}
                    </h1>
                    <p style={{ fontSize: "15px", color: "#3A3A38" }}>
                      {v.obra.addr}{" · "}{v.obra.type}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#fff", border: "1px solid #EDEDEA", borderRadius: "12px", padding: "12px 16px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "99px", background: "#68C0B5", color: "#fff", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "13px" }}>
                      {v.obra.initials}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                        {"Responsable de obra"}
                      </span>
                      <span style={{ fontSize: "15px", fontWeight: "700" }}>
                        {v.obra.manager}
                      </span>
                    </div>
                    <a href="https://wa.me/34655638219" style={{ marginLeft: "8px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", color: "#0C062B" }}>
                      {"Contactar"}
                    </a>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid #E4E4E0", overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none", paddingBottom: "1px" }}>
                  {(v.tabs || []).map((t, t_i) => (
                    <React.Fragment key={t_i}>
                      <button onClick={t.go} style={{ border: "0", background: "none", padding: "12px 14px", fontSize: "14px", cursor: "pointer", color: t.fg, fontWeight: t.fw, borderBottom: `2px solid ${t.bd}`, marginBottom: "-1px", display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                        {t.label}
                        {t.badge ? (
                          <>
                            <span style={{ width: "18px", height: "18px", borderRadius: "99px", background: "#EC6090", color: "#fff", fontSize: "11px", display: "grid", placeItems: "center" }}>
                              {t.badge}
                            </span>
                          </>
                        ) : null}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                {v.tab_resumen ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "16px" }}>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "#3E4D85" }}>
                            {"Avance físico"}
                          </span>
                          <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "44px", fontWeight: "700", lineHeight: "1", color: "#0C062B" }}>
                            {v.obra.physS}
                          </span>
                          <div style={{ height: "8px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ width: v.obra.physW, height: "100%", background: "#5567AE" }}></div>
                          </div>
                          <p style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.45" }}>
                            {"Obra ejecutada y validada, ponderada por el importe contratado de cada partida."}
                          </p>
                        </div>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "#3A3A38" }}>
                            {"Plazo transcurrido"}
                          </span>
                          <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "44px", fontWeight: "700", lineHeight: "1", color: "#0C062B" }}>
                            {v.obra.tempS}
                          </span>
                          <div style={{ height: "8px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ width: v.obra.tempW, height: "100%", background: "#6B6B68" }}></div>
                          </div>
                          <p style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.45" }}>
                            {v.obra.elS}{", del "}{v.obra.startS}{" al "}{v.obra.endS}{"."}
                          </p>
                        </div>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "#2F6B63" }}>
                            {"Certificado (económico)"}
                          </span>
                          <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "32px", fontWeight: "700", lineHeight: "1.2", color: "#0C062B" }}>
                            {v.obra.certS}
                          </span>
                          <div style={{ height: "8px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ width: v.obra.certW, height: "100%", background: "#55A89D" }}></div>
                          </div>
                          <p style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.45" }}>
                            {"Certificado "}{v.obra.ofS}{" sin IVA. No es lo mismo que el avance físico."}
                          </p>
                        </div>
                      </div>
                      {v.obra.isBehind ? (
                        <>
                          <div style={{ display: "flex", gap: "12px", padding: "16px 18px", borderRadius: "12px", background: "#F2F4FA", fontSize: "14px", color: "#0C062B", lineHeight: "1.5" }}>
                            <i className="ri-information-line" style={{ fontSize: "20px", color: "#5567AE" }}></i>
                            <span>
                              {v.obra.behind}
                            </span>
                          </div>
                        </>
                      ) : null}
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: "20px" }}>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                            <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                              {"Avance por capítulo"}
                            </h2>
                            <button onClick={v.goTabPart} style={{ border: "0", background: "none", color: "#5567AE", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}>
                              {"Ver partidas"}
                            </button>
                          </div>
                          {(v.obra.chapters || []).map((ch, ch_i) => (
                            <React.Fragment key={ch_i}>
                              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px 44px", gap: "14px", alignItems: "center", padding: "10px 0", borderTop: "1px solid #F0F0EC" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                    {ch.code}{" · "}{ch.name}
                                  </span>
                                  <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                    {ch.stateS}{" · "}{ch.weightS}
                                  </span>
                                </div>
                                <div style={{ height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                                  <div style={{ width: ch.pctW, height: "100%", background: ch.gFg }}></div>
                                </div>
                                <span style={{ fontSize: "14px", fontWeight: "700", textAlign: "right" }}>
                                  {ch.pctS}
                                </span>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                          <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                            <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                              {"Ahora en obra"}
                            </h2>
                            {(v.obra.curr || []).map((i, i_i) => (
                              <React.Fragment key={i_i}>
                                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                                  <span style={{ width: "8px", height: "8px", borderRadius: "99px", background: i.st.dot, marginTop: "7px", flexShrink: "0" }}></span>
                                  <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                      {i.desc}
                                    </span>
                                    <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                      {i.chap}{" · "}{i.st.label}{" · "}{i.pctS}
                                    </span>
                                  </div>
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                                {"Próximos trabajos"}
                              </h2>
                              <button onClick={v.goTabCrono} style={{ border: "0", background: "none", color: "#5567AE", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}>
                                {"Cronograma"}
                              </button>
                            </div>
                            {(v.obra.next || []).map((i, i_i) => (
                              <React.Fragment key={i_i}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "14px" }}>
                                  <span style={{ fontWeight: "600" }}>
                                    {i.desc}
                                  </span>
                                  <span style={{ color: "#6B6B68", whiteSpace: "nowrap" }}>
                                    {"desde "}{i.ps}
                                  </span>
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
                {v.tab_partidas ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {(v.pfilters || []).map((f, f_i) => (
                            <React.Fragment key={f_i}>
                              <button onClick={f.go} style={{ border: `1px solid ${f.bd}`, background: f.bg, color: f.fg, borderRadius: "99px", padding: "7px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                                {f.label}
                              </button>
                            </React.Fragment>
                          ))}
                        </div>
                        <span style={{ fontSize: "13px", color: "#6B6B68", display: "flex", alignItems: "center", gap: "6px" }}>
                          <i className="ri-shield-check-line" style={{ color: "#55A89D", fontSize: "16px" }}></i>
                          {"Solo se muestran mediciones validadas por la dirección de obra"}
                        </span>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflowX: "auto" }}>
                        <div style={{ minWidth: "1040px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "60px minmax(200px,1fr) 40px 90px 110px 150px 176px 130px", gap: "12px", padding: "12px 20px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                            <span>
                              {"Código"}
                            </span>
                            <span>
                              {"Partida"}
                            </span>
                            <span>
                              {"Ud"}
                            </span>
                            <span style={{ textAlign: "right" }}>
                              {"Contratado"}
                            </span>
                            <span style={{ textAlign: "right" }}>
                              {"Ejecutado"}
                            </span>
                            <span>
                              {"Avance"}
                            </span>
                            <span>
                              {"Estado"}
                            </span>
                            <span>
                              {"Fechas"}
                            </span>
                          </div>
                          {(v.fChap || []).map((ch, ch_i) => (
                            <React.Fragment key={ch_i}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "14px 20px", background: "#FAFAF8", borderTop: "1px solid #EDEDEA" }}>
                                  <span style={{ fontSize: "15px", fontWeight: "700", color: "#0C062B", flex: "1" }}>
                                    {ch.code}{" · "}{ch.name}
                                  </span>
                                  <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                    {ch.nDone}{" · "}{ch.weightS}
                                  </span>
                                  <span style={{ width: "140px", height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                                    <span style={{ display: "block", width: ch.pctW, height: "100%", background: ch.gFg }}></span>
                                  </span>
                                  <span style={{ fontSize: "14px", fontWeight: "700", width: "40px", textAlign: "right" }}>
                                    {ch.pctS}
                                  </span>
                                </div>
                                {(ch.items || []).map((p, p_i) => (
                                  <React.Fragment key={p_i}>
                                    <div style={{ display: "grid", gridTemplateColumns: "60px minmax(200px,1fr) 40px 90px 110px 150px 176px 130px", gap: "12px", alignItems: "center", padding: "12px 20px", borderTop: "1px solid #F0F0EC", fontSize: "14px" }}>
                                      <span style={{ color: "#6B6B68", fontVariantNumeric: "tabular-nums" }}>
                                        {p.code}
                                      </span>
                                      <span style={{ fontWeight: "500" }}>
                                        {p.desc}
                                      </span>
                                      <span style={{ color: "#3A3A38" }}>
                                        {p.unit}
                                      </span>
                                      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                        {p.qtyS}
                                      </span>
                                      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "2px" }}>
                                        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: "600" }}>
                                          {p.valS}
                                        </span>
                                        {p.hasNote ? (
                                          <>
                                            <span style={{ fontSize: "11px", color: "#7A4E0E", lineHeight: "1.3" }}>
                                              {p.note}
                                            </span>
                                          </>
                                        ) : null}
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <span style={{ flex: "1", height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                                          <span style={{ display: "block", width: p.pctW, height: "100%", background: p.st.dot }}></span>
                                        </span>
                                        <span style={{ width: "38px", textAlign: "right", fontWeight: "600" }}>
                                          {p.pctS}
                                        </span>
                                      </div>
                                      <span>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: p.st.bg, color: p.st.fg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px", whiteSpace: "nowrap" }}>
                                          <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: p.st.dot }}></span>
                                          {p.st.label}
                                        </span>
                                      </span>
                                      <div style={{ fontSize: "12px", lineHeight: "1.45", color: "#3A3A38", fontVariantNumeric: "tabular-nums" }}>
                                        <div>
                                          {"Prev. "}{p.ps}{" → "}{p.pe}
                                        </div>
                                        <div style={{ color: "#6B6B68" }}>
                                          {"Real "}{p.rsS}{" → "}{p.reS}
                                        </div>
                                      </div>
                                    </div>
                                  </React.Fragment>
                                ))}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                      <p style={{ fontSize: "13px", color: "#6B6B68", lineHeight: "1.5" }}>
                        {"El avance de cada partida es cantidad ejecutada validada ÷ cantidad contratada. El avance global pondera cada partida por su importe contratado; las partidas sin medición actualizada cuentan como 0% hasta que se midan."}
                      </p>
                    </div>
                  </>
                ) : null}
                {v.tab_crono ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: "20px", alignItems: "start" }}>
                      <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                          <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                            {"Calendario por fases"}
                          </h2>
                          <div style={{ display: "flex", gap: "14px", fontSize: "12px", color: "#3A3A38" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ width: "12px", height: "8px", borderRadius: "3px", background: "#55A89D" }}></span>
                              {"Terminado"}
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ width: "12px", height: "8px", borderRadius: "3px", background: "#5567AE" }}></span>
                              {"En curso"}
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ width: "12px", height: "8px", borderRadius: "3px", background: "#EDEDEA" }}></span>
                              {"Previsto"}
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ width: "2px", height: "12px", background: "#EC6090" }}></span>
                              {"Hoy"}
                            </span>
                          </div>
                        </div>
                        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr)", gap: "16px", height: "24px" }}>
                            <span></span>
                            <div style={{ position: "relative" }}>
                              {(v.obra.months || []).map((m, m_i) => (
                                <React.Fragment key={m_i}>
                                  <span style={{ position: "absolute", left: m.left, top: "0", fontSize: "12px", fontWeight: "700", color: "#6B6B68", textTransform: "uppercase", borderLeft: "1px solid #E4E4E0", paddingLeft: "6px", height: "100%" }}>
                                    {m.label}
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                          {(v.obra.chapters || []).map((ch, ch_i) => (
                            <React.Fragment key={ch_i}>
                              <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr)", gap: "16px", alignItems: "center", minHeight: "44px", borderTop: "1px solid #F4F4F0" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0" }}>
                                  <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                    {ch.name}
                                  </span>
                                  {ch.hasDelay ? (
                                    <>
                                      <span style={{ fontSize: "11px", color: "#9E2F2F", fontWeight: "700", lineHeight: "1.3" }}>
                                        {ch.delay}
                                      </span>
                                    </>
                                  ) : null}
                                  {ch.hasDep ? (
                                    <>
                                      <span style={{ fontSize: "11px", color: "#6B6B68", lineHeight: "1.3" }}>
                                        {ch.dep}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <div style={{ position: "relative", height: "20px" }}>
                                  <div style={{ position: "absolute", left: ch.gL, width: ch.gW, top: "0", bottom: "0", background: ch.gBg, borderRadius: "6px", overflow: "hidden" }}>
                                    <div style={{ width: ch.pctW, height: "100%", background: ch.gFg }}></div>
                                  </div>
                                </div>
                              </div>
                            </React.Fragment>
                          ))}
                          <div style={{ position: "absolute", top: "24px", bottom: "0", left: `calc(216px + (100% - 216px) * ${v.obra.todayF})`, width: "2px", background: "#EC6090" }}></div>
                        </div>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <h2 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "12px" }}>
                          {"Hitos"}
                        </h2>
                        {(v.obra.ms || []).map((m, m_i) => (
                          <React.Fragment key={m_i}>
                            <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: "12px", minHeight: "52px" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <span style={{ width: "14px", height: "14px", borderRadius: "99px", background: m.dotBg, border: `2px solid ${m.dotBd}`, marginTop: "3px" }}></span>
                                <span style={{ flex: "1", width: "2px", background: "#EDEDEA" }}></span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "12px" }}>
                                <span style={{ fontSize: "14px", fontWeight: "700", color: m.fg }}>
                                  {m.label}
                                </span>
                                <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                  {m.tag}{" · "}{m.date}
                                </span>
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {v.tab_fotos ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                            {"Antes y ahora"}
                          </h2>
                          <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                            {"Arrastra para comparar"}
                          </span>
                        </div>
                        {v.obra.hasCompare ? (
                          <>
                            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                              <div style={{ position: "relative", height: "380px", borderRadius: "12px", overflow: "hidden", background: "#EFEAE2" }}>
                                <img src={v.obra.compareAfter} alt="Estado actual" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" }} />
                                <div style={{ position: "absolute", inset: "0", clipPath: v.cmpClip, background: "repeating-linear-gradient(135deg,#EFEAE2 0 12px,#E6DFD3 12px 24px)", display: "grid", placeItems: "center" }}>
                                  <span style={{ fontSize: "13px", fontWeight: "700", color: "#6B6B68", background: "#fff", padding: "6px 10px", borderRadius: "6px" }}>
                                    {"ANTES · foto de estado inicial"}
                                  </span>
                                </div>
                                <div style={{ position: "absolute", top: "0", bottom: "0", left: v.cmpPos, width: "3px", background: "#fff", boxShadow: "0 0 0 1px rgba(12,6,43,0.15)" }}></div>
                                <span style={{ position: "absolute", right: "14px", top: "14px", background: "#fff", fontSize: "12px", fontWeight: "700", padding: "5px 10px", borderRadius: "99px" }}>
                                  {"AHORA · 19 oct"}
                                </span>
                              </div>
                              <input type="range" min="0" max="100" value={v.cmp} onChange={v.onCmp} aria-label="Comparar antes y ahora" style={{ width: "100%", accentColor: "#5567AE" }} />
                            </div>
                          </>
                        ) : null}
                        {v.obra.noCompare ? (
                          <>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "36px", border: "1px dashed #D9D9D9", borderRadius: "12px", textAlign: "center" }}>
                              <i className="ri-contrast-2-line" style={{ fontSize: "28px", color: "#9A9A96" }}></i>
                              <span style={{ fontSize: "15px", fontWeight: "700" }}>
                                {"La comparación aparecerá con las primeras fotos de acabado"}
                              </span>
                              <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                                {"Prevista a partir de Revestimientos, en noviembre."}
                              </span>
                            </div>
                          </>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        {(v.phFilters || []).map((f, f_i) => (
                          <React.Fragment key={f_i}>
                            <button onClick={f.go} style={{ border: `1px solid ${f.bd}`, background: f.bg, color: f.fg, borderRadius: "99px", padding: "7px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                              {f.label}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "16px" }}>
                        {(v.obra.photos || []).map((ph, ph_i) => (
                          <React.Fragment key={ph_i}>
                            <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "12px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                              {ph.hasImg ? (
                                <>
                                  <img src={ph.img} alt={ph.desc} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
                                </>
                              ) : null}
                              {ph.noImg ? (
                                <>
                                  <div style={{ aspectRatio: "4/3", background: "repeating-linear-gradient(135deg,#EFEAE2 0 12px,#E6DFD3 12px 24px)", display: "grid", placeItems: "center" }}>
                                    <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", background: "#fff", padding: "5px 8px", borderRadius: "6px" }}>
                                      {"FOTO DE OBRA"}
                                    </span>
                                  </div>
                                </>
                              ) : null}
                              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#6B6B68" }}>
                                  <span style={{ fontWeight: "700", color: "#3E4D85" }}>
                                    {ph.phase}
                                  </span>
                                  <span>
                                    {ph.date}
                                  </span>
                                </div>
                                <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                  {ph.desc}
                                </span>
                                <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                                  {ph.chapter}
                                </span>
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {v.tab_docs ? (
                  <>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                      {(v.obra.docs || []).map((d, d_i) => (
                        <React.Fragment key={d_i}>
                          <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 120px 90px 190px 120px", gap: "16px", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #F0F0EC", fontSize: "14px" }}>
                            <span style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#F2F4FA", display: "grid", placeItems: "center" }}>
                              <i className={d.icon} style={{ fontSize: "20px", color: "#5567AE" }}></i>
                            </span>
                            <span style={{ fontWeight: "600" }}>
                              {d.name}
                            </span>
                            <span style={{ color: "#3A3A38" }}>
                              {d.type}
                            </span>
                            <span style={{ color: "#6B6B68" }}>
                              {d.date}
                            </span>
                            <span>
                              <span style={{ background: d.stBg, color: d.stFg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                                {d.stLabel}
                              </span>
                            </span>
                            <button onClick={d.open} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer", minHeight: "40px" }}>
                              {"Ver documento"}
                            </button>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </>
                ) : null}
                {v.tab_mods ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "0", background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                            {"Presupuesto original aprobado"}
                          </span>
                          <span style={{ fontSize: "20px", fontWeight: "700" }}>
                            {v.obra.origS}
                          </span>
                        </div>
                        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "4px", borderLeft: "1px solid #EDEDEA" }}>
                          <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                            {"Modificaciones aprobadas"}
                          </span>
                          <span style={{ fontSize: "20px", fontWeight: "700", color: "#2F6B63" }}>
                            {v.obra.apprS}
                          </span>
                        </div>
                        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "4px", borderLeft: "1px solid #EDEDEA", background: "#F2F4FA" }}>
                          <span style={{ fontSize: "12px", color: "#3E4D85", fontWeight: "700" }}>
                            {"Alcance autorizado vigente"}
                          </span>
                          <span style={{ fontSize: "20px", fontWeight: "700", color: "#0C062B" }}>
                            {v.obra.vigS}
                          </span>
                        </div>
                        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "4px", borderLeft: "1px solid #EDEDEA" }}>
                          <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                            {"Pendiente de tu decisión (no incluido)"}
                          </span>
                          <span style={{ fontSize: "20px", fontWeight: "700", color: "#7A4E0E" }}>
                            {v.obra.pendS}
                          </span>
                        </div>
                      </div>
                      {v.obra.hasMods ? (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {(v.obra.mods || []).map((m, m_i) => (
                              <React.Fragment key={m_i}>
                                <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
                                  <div style={{ flex: "1", minWidth: "280px", display: "flex", flexDirection: "column", gap: "6px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#6B6B68" }}>
                                        {m.id}
                                      </span>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: m.st.bg, color: m.st.fg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                                        <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: m.st.dot }}></span>
                                        {m.st.label}
                                      </span>
                                    </div>
                                    <span style={{ fontSize: "17px", fontWeight: "700" }}>
                                      {m.title}
                                    </span>
                                    <span style={{ fontSize: "14px", color: "#3A3A38" }}>
                                      {m.reason}
                                    </span>
                                    <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                                      {m.date}{" · "}{m.impact}
                                    </span>
                                  </div>
                                  <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "22px", fontWeight: "700" }}>
                                    {m.amountS}
                                  </span>
                                  {m.isPending ? (
                                    <>
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button onClick={m.reject} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "11px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                                          {"Rechazar"}
                                        </button>
                                        <button onClick={m.accept} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "11px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                                          {"Aprobar modificación"}
                                        </button>
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                        </>
                      ) : null}
                      {v.obra.noMods ? (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "44px", background: "#fff", border: "1px dashed #D9D9D9", borderRadius: "16px", textAlign: "center" }}>
                            <i className="ri-git-branch-line" style={{ fontSize: "28px", color: "#9A9A96" }}></i>
                            <span style={{ fontSize: "15px", fontWeight: "700" }}>
                              {"Sin modificaciones"}
                            </span>
                            <span style={{ fontSize: "13px", color: "#6B6B68", maxWidth: "420px" }}>
                              {"La obra se ejecuta tal y como aceptaste en el presupuesto. Si surge un cambio, te lo propondremos aquí antes de hacerlo."}
                            </span>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {v.tab_act ? (
                  <>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "24px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>
                      {(v.obra.activity || []).map((g, g_i) => (
                        <React.Fragment key={g_i}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                              {g.day}
                            </span>
                            {(g.items || []).map((i, i_i) => (
                              <React.Fragment key={i_i}>
                                <div style={{ display: "grid", gridTemplateColumns: "52px 36px minmax(0,1fr)", gap: "10px", alignItems: "center" }}>
                                  <span style={{ fontSize: "13px", color: "#6B6B68", fontVariantNumeric: "tabular-nums" }}>
                                    {i.t}
                                  </span>
                                  <span style={{ width: "32px", height: "32px", borderRadius: "99px", background: "#F2F4FA", display: "grid", placeItems: "center" }}>
                                    <i className={i.icon} style={{ fontSize: "16px", color: "#5567AE" }}></i>
                                  </span>
                                  <span style={{ fontSize: "14px" }}>
                                    {i.txt}
                                  </span>
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
          {v.is_c_presupuestos ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                      {"Presupuestos"}
                    </h1>
                    <p style={{ color: "#3A3A38", fontSize: "15px" }}>
                      {"Tus solicitudes y cada versión de presupuesto que te hemos enviado."}
                    </p>
                  </div>
                  <button onClick={v.askBudget} style={{ background: "#EC6090", color: "#fff", border: "0", borderRadius: "8px", padding: "12px 18px", fontWeight: "700", fontSize: "14px", cursor: "pointer", letterSpacing: "0.02em" }}>
                    {"SOLICITAR PRESUPUESTO"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                    {"Solicitudes en curso"}
                  </span>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "18px 20px", display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
                    <span style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#F2F4FA", display: "grid", placeItems: "center" }}>
                      <i className="ri-search-eye-line" style={{ fontSize: "20px", color: "#5567AE" }}></i>
                    </span>
                    <div style={{ flex: "1", minWidth: "240px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                        {"SOL-2026-044 · enviada el 16 oct"}
                      </span>
                      <span style={{ fontSize: "16px", fontWeight: "700" }}>
                        {"Cambio de carpintería exterior"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                      <span style={{ padding: "5px 10px", borderRadius: "99px", background: "#DEF3F0", color: "#2F6B63", fontWeight: "700" }}>
                        {"Recibida"}
                      </span>
                      <i className="ri-arrow-right-s-line" style={{ color: "#9A9A96" }}></i>
                      <span style={{ padding: "5px 10px", borderRadius: "99px", background: "#E3E7F3", color: "#3E4D85", fontWeight: "700" }}>
                        {"En estudio"}
                      </span>
                      <i className="ri-arrow-right-s-line" style={{ color: "#9A9A96" }}></i>
                      <span style={{ padding: "5px 10px", borderRadius: "99px", background: "#F7F7F5", color: "#6B6B68", fontWeight: "600" }}>
                        {"En preparación"}
                      </span>
                      <i className="ri-arrow-right-s-line" style={{ color: "#9A9A96" }}></i>
                      <span style={{ padding: "5px 10px", borderRadius: "99px", background: "#F7F7F5", color: "#6B6B68", fontWeight: "600" }}>
                        {"Enviado"}
                      </span>
                    </div>
                    <span style={{ fontSize: "13px", color: "#3A3A38" }}>
                      {"Siguiente paso: visita técnica el 24 oct"}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                    {"Presupuestos recibidos"}
                  </span>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "130px minmax(220px,1.5fr) 110px 130px 200px 90px 160px", gap: "16px", padding: "12px 20px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase", background: "#FAFAF8" }}>
                      <span>
                        {"Referencia"}
                      </span>
                      <span>
                        {"Proyecto"}
                      </span>
                      <span>
                        {"Fecha"}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {"Total IVA incl."}
                      </span>
                      <span>
                        {"Estado de la versión"}
                      </span>
                      <span>
                        {"Actualizado"}
                      </span>
                      <span></span>
                    </div>
                    {(v.budgets || []).map((b, b_i) => (
                      <React.Fragment key={b_i}>
                        <div style={{ display: "grid", gridTemplateColumns: "130px minmax(220px,1.5fr) 110px 130px 200px 90px 160px", gap: "16px", alignItems: "center", padding: "16px 20px", borderTop: "1px solid #F0F0EC", fontSize: "14px" }}>
                          <span style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontWeight: "700", fontVariantNumeric: "tabular-nums" }}>
                              {b.ref}
                            </span>
                            <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                              {"Versión "}{b.ver}
                            </span>
                          </span>
                          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontWeight: "700", color: "#0C062B" }}>
                              {b.name}
                            </span>
                            <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                              {b.addr}
                            </span>
                          </span>
                          <span style={{ color: "#3A3A38" }}>
                            {b.date}
                          </span>
                          <span style={{ textAlign: "right", fontWeight: "700", fontVariantNumeric: "tabular-nums" }}>
                            {b.amount}
                          </span>
                          <span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: b.st.bg, color: b.st.fg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                              <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: b.st.dot }}></span>
                              {b.st.label}
                            </span>
                          </span>
                          <span style={{ color: "#6B6B68" }}>
                            {b.upd}
                          </span>
                          {b.primary ? (
                            <>
                              <button onClick={b.go} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer", minHeight: "40px" }}>
                                {b.action}
                              </button>
                            </>
                          ) : null}
                          {b.primary ? (
                            <>
                              <span></span>
                            </>
                          ) : null}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_c_presupuesto ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: "24px", alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#6B6B68" }}>
                        {v.b.ref}{" · Versión "}{v.b.ver}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: v.bSt.bg, color: v.bSt.fg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: v.bSt.dot }}></span>
                        {v.bSt.label}
                      </span>
                    </div>
                    <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                      {v.b.name}
                    </h1>
                    <p style={{ fontSize: "15px", color: "#3A3A38" }}>
                      {v.b.addr}
                    </p>
                  </div>
                  {v.bAccepted ? (
                    <>
                      <div style={{ display: "flex", gap: "12px", padding: "16px 18px", borderRadius: "12px", background: "#EEF9F7", border: "1px solid #DEF3F0", fontSize: "14px", lineHeight: "1.5" }}>
                        <i className="ri-checkbox-circle-line" style={{ fontSize: "20px", color: "#2F6B63" }}></i>
                        <span>
                          <strong>
                            {"Aceptaste la versión v1 hoy a las 10:14."}
                          </strong>
                          {" Siguiente paso: tu responsable te contactará para formalizar el contrato. La obra aparecerá en Mis obras cuando se firme."}
                        </span>
                      </div>
                    </>
                  ) : null}
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 50px 70px 110px 110px", gap: "12px", padding: "12px 20px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                      <span>
                        {"Partida"}
                      </span>
                      <span>
                        {"Ud"}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {"Cant."}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {"Precio ud."}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {"Importe"}
                      </span>
                    </div>
                    {(v.bCh || []).map((c, c_i) => (
                      <React.Fragment key={c_i}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px", background: "#FAFAF8", borderTop: "1px solid #EDEDEA", fontSize: "15px", fontWeight: "700" }}>
                            <span>
                              {c.name}
                            </span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>
                              {c.totS}
                            </span>
                          </div>
                          {(c.lines || []).map((l, l_i) => (
                            <React.Fragment key={l_i}>
                              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 50px 70px 110px 110px", gap: "12px", padding: "12px 20px", borderTop: "1px solid #F0F0EC", fontSize: "14px", fontVariantNumeric: "tabular-nums" }}>
                                <span>
                                  {l.desc}
                                </span>
                                <span style={{ color: "#3A3A38" }}>
                                  {l.unit}
                                </span>
                                <span style={{ textAlign: "right" }}>
                                  {l.qtyS}
                                </span>
                                <span style={{ textAlign: "right" }}>
                                  {l.priceS}
                                </span>
                                <span style={{ textAlign: "right", fontWeight: "600" }}>
                                  {l.impS}
                                </span>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "16px" }}>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                        {"Condiciones"}
                      </h2>
                      {(v.b.conditions || []).map((x, x_i) => (
                        <React.Fragment key={x_i}>
                          <div style={{ display: "flex", gap: "8px", fontSize: "14px", color: "#3A3A38" }}>
                            <i className="ri-check-line" style={{ color: "#55A89D" }}></i>
                            <span>
                              {x}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                        {"No incluye"}
                      </h2>
                      {(v.b.exclusions || []).map((x, x_i) => (
                        <React.Fragment key={x_i}>
                          <div style={{ display: "flex", gap: "8px", fontSize: "14px", color: "#3A3A38" }}>
                            <i className="ri-close-line" style={{ color: "#9A9A96" }}></i>
                            <span>
                              {x}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "96px" }}>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                      {"Resumen económico"}
                    </h2>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                      <span style={{ color: "#3A3A38" }}>
                        {"Base imponible"}
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {v.bBaseS}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                      <span style={{ color: "#3A3A38" }}>
                        {"IVA 10% (vivienda)"}
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {v.bIvaS}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: "12px", borderTop: "1px solid #EDEDEA" }}>
                      <span style={{ fontWeight: "700" }}>
                        {"Total"}
                      </span>
                      <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "26px", fontWeight: "700", fontVariantNumeric: "tabular-nums" }}>
                        {v.bTotS}
                      </span>
                    </div>
                    {v.bPending ? (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
                          <button onClick={v.startAccept} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "13px", fontWeight: "700", fontSize: "15px", cursor: "pointer" }}>
                            {"Aceptar presupuesto"}
                          </button>
                          <button onClick={v.rejectBudget} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "12px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                            {"Rechazar"}
                          </button>
                          <span style={{ fontSize: "12px", color: "#6B6B68", textAlign: "center" }}>
                            {"Válido hasta el 9 nov 2026"}
                          </span>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                      {"Versiones"}
                    </h2>
                    {(v.b.versions || []).map((v, v_i) => (
                      <React.Fragment key={v_i}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                          <span>
                            <strong>
                              {v.v}
                            </strong>
                            {" · "}{v.d}
                          </span>
                          <span style={{ color: "#2F6B63", fontWeight: "700" }}>
                            {v.s}
                          </span>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                      {"Anexos"}
                    </h2>
                    {(v.b.annex || []).map((x, x_i) => (
                      <React.Fragment key={x_i}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px" }}>
                          <i className="ri-attachment-2" style={{ color: "#5567AE" }}></i>
                          <span>
                            {x}
                          </span>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_c_perfil ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: "24px", alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "96px" }}>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "56px", height: "56px", borderRadius: "99px", background: "#EC6090", color: "#fff", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "18px" }}>
                        {"LF"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "17px", fontWeight: "700" }}>
                          {"Lucía Fernández"}
                        </span>
                        <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                          {"Cliente desde ago 2026"}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                      <span style={{ fontWeight: "700" }}>
                        {"Perfil completado"}
                      </span>
                      <span style={{ fontWeight: "700" }}>
                        {"80%"}
                      </span>
                    </div>
                    <div style={{ height: "8px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                      <div style={{ width: "80%", height: "100%", background: "#5567AE" }}></div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px", borderRadius: "10px", background: "#FBF1DE" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#7A4E0E" }}>
                        {"Falta para facturar"}
                      </span>
                      <span style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.45" }}>
                        {"DNI/NIE y dirección fiscal. Los necesitamos para emitir la certificación nº 2."}
                      </span>
                    </div>
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "8px", display: "flex", flexDirection: "column" }}>
                    <a href="#perfil-personal" style={{ padding: "10px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: "600", color: "#0C062B" }}>
                      {"Información personal"}
                    </a>
                    <a href="#perfil-fiscal" style={{ padding: "10px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: "600", color: "#0C062B" }}>
                      {"Facturación"}
                    </a>
                    <a href="#perfil-seguridad" style={{ padding: "10px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: "600", color: "#0C062B" }}>
                      {"Cuenta y seguridad"}
                    </a>
                    <a href="#perfil-avisos" style={{ padding: "10px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: "600", color: "#0C062B" }}>
                      {"Notificaciones"}
                    </a>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div id="perfil-personal" style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                      {"Información personal"}
                    </h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "16px" }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                        {"Nombre"}
                        <input defaultValue="Luc\u00eda" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px", background: "#fff" }} />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                        {"Apellidos"}
                        <input defaultValue="Fern\u00e1ndez Ortiz" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                        {"Teléfono "}
                        <input value={v.phone} onChange={v.onPhone} style={{ height: "46px", border: `1px solid ${v.phoneBd}`, borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                        {v.hasProfErr ? (
                          <>
                            <span style={{ fontSize: "12px", color: "#9E2F2F", fontWeight: "600", display: "flex", gap: "4px", alignItems: "center" }}>
                              <i className="ri-error-warning-line"></i>
                              {v.profErr}
                            </span>
                          </>
                        ) : null}
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                        {"Email"}
                        <input defaultValue="lucia.fernandez@demo.ledens.es" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px", background: "#F7F7F5", color: "#3A3A38" }} />
                        <span style={{ fontSize: "12px", color: "#6B6B68", fontWeight: "500" }}>
                          {"Cambiarlo requiere confirmar el nuevo email. Se cambia en Cuenta y seguridad."}
                        </span>
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600", gridColumn: "1 / -1" }}>
                        {"Dirección"}
                        <input defaultValue="C/ Mart\u00ednez de la Rosa, 41 \u00b7 3\u00ba B" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                        {"Localidad"}
                        <input defaultValue="M\u00e1laga" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "16px" }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                          {"Código postal"}
                          <input defaultValue="29010" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                          {"País"}
                          <input defaultValue="Espa\u00f1a" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                        </label>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                      <button onClick={v.saveProfile} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "12px 20px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                        {"Guardar cambios"}
                      </button>
                    </div>
                  </div>
                  <div id="perfil-fiscal" style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                          {"Facturación"}
                        </h2>
                        <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                          {"Solo se piden al contratar o facturar."}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "4px", background: "#F7F7F5", border: "1px solid #EDEDEA", borderRadius: "10px", padding: "3px" }}>
                        {(v.ptypes || []).map((t, t_i) => (
                          <React.Fragment key={t_i}>
                            <button onClick={t.go} style={{ border: "0", borderRadius: "7px", padding: "8px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer", background: t.bg, color: t.fg, boxShadow: t.sh }}>
                              {t.label}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    {v.isFisica ? (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "16px" }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                            {"Nombre fiscal"}
                            <input defaultValue="Luc\u00eda Fern\u00e1ndez Ortiz" readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                            {"DNI/NIE "}
                            <span style={{ fontWeight: "500", color: "#7A4E0E" }}>
                              {"Pendiente"}
                            </span>
                            <input placeholder="12345678Z" style={{ height: "46px", border: "1px solid #E0A94A", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600", gridColumn: "1 / -1" }}>
                            {"Dirección fiscal "}
                            <span style={{ fontWeight: "500", color: "#7A4E0E" }}>
                              {"Pendiente"}
                            </span>
                            <input placeholder="Igual que la direcci\u00f3n personal" style={{ height: "46px", border: "1px solid #E0A94A", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                        </div>
                      </>
                    ) : null}
                    {v.isEmpresa ? (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "16px" }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                            {"Razón social"}
                            <input placeholder="Nombre de la empresa S.L." style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                            {"NIF/CIF"}
                            <input placeholder="B12345678" style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                            {"Dirección fiscal"}
                            <input style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                            {"Persona de contacto"}
                            <input defaultValue="Luc\u00eda Fern\u00e1ndez" style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
                          </label>
                        </div>
                      </>
                    ) : null}
                    <div style={{ display: "flex", gap: "10px", padding: "14px 16px", borderRadius: "10px", background: "#F7F7F5", fontSize: "13px", color: "#3A3A38", lineHeight: "1.5" }}>
                      <i className="ri-lock-line" style={{ fontSize: "18px", color: "#6B6B68" }}></i>
                      <span>
                        {"Si cambias la identidad fiscal después de facturar, el cambio queda pendiente hasta que Ledens lo revise. Las facturas emitidas no se modifican."}
                      </span>
                    </div>
                  </div>
                  <div id="perfil-seguridad" style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                      {"Cuenta y seguridad"}
                    </h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <i className="ri-mail-line" style={{ fontSize: "20px", color: "#3A3A38" }}></i>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        <strong>
                          {"lucia.fernandez@demo.ledens.es"}
                        </strong>
                      </span>
                      <span style={{ background: "#DEF3F0", color: "#2F6B63", fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                        {"Email verificado"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <i className="ri-google-fill" style={{ fontSize: "20px", color: "#3A3A38" }}></i>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        {"Google"}
                      </span>
                      <span style={{ fontSize: "13px", color: "#2F6B63", fontWeight: "700" }}>
                        {"Vinculado"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <i className="ri-microsoft-fill" style={{ fontSize: "20px", color: "#3A3A38" }}></i>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        {"Microsoft"}
                      </span>
                      <button style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                        {"Vincular"}
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <i className="ri-key-2-line" style={{ fontSize: "20px", color: "#3A3A38" }}></i>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        {"Contraseña"}
                        <span style={{ display: "block", fontSize: "12px", color: "#6B6B68" }}>
                          {"No tienes contraseña: entras con Google"}
                        </span>
                      </span>
                      <button style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                        {"Crear contraseña"}
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <i className="ri-apple-fill" style={{ fontSize: "20px", color: "#9A9A96" }}></i>
                      <span style={{ flex: "1", fontSize: "14px", color: "#6B6B68" }}>
                        {"Apple"}
                      </span>
                      <span style={{ fontSize: "12px", color: "#6B6B68", fontWeight: "700" }}>
                        {"Próximamente"}
                      </span>
                    </div>
                  </div>
                  <div id="perfil-avisos" style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                      {"Notificaciones"}
                    </h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        {"Avances, fotos y documentos de tus obras"}
                        <span style={{ display: "block", fontSize: "12px", color: "#6B6B68" }}>
                          {"En la plataforma"}
                        </span>
                      </span>
                      <span style={{ width: "40px", height: "22px", borderRadius: "99px", background: "#5567AE", position: "relative" }}>
                        <span style={{ position: "absolute", top: "3px", left: "21px", width: "16px", height: "16px", borderRadius: "99px", background: "#fff" }}></span>
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC" }}>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        {"Presupuestos y modificaciones"}
                        <span style={{ display: "block", fontSize: "12px", color: "#6B6B68" }}>
                          {"En la plataforma"}
                        </span>
                      </span>
                      <span style={{ width: "40px", height: "22px", borderRadius: "99px", background: "#5567AE", position: "relative" }}>
                        <span style={{ position: "absolute", top: "3px", left: "21px", width: "16px", height: "16px", borderRadius: "99px", background: "#fff" }}></span>
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0EC", opacity: "0.6" }}>
                      <span style={{ flex: "1", fontSize: "14px" }}>
                        {"Copia por email"}
                        <span style={{ display: "block", fontSize: "12px", color: "#6B6B68" }}>
                          {"Próximamente"}
                        </span>
                      </span>
                      <span style={{ width: "40px", height: "22px", borderRadius: "99px", background: "#D9D9D9", position: "relative" }}>
                        <span style={{ position: "absolute", top: "3px", left: "3px", width: "16px", height: "16px", borderRadius: "99px", background: "#fff" }}></span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_w_home ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                    {"Martes, 21 de octubre"}
                  </div>
                  <h1 style={{ fontSize: "34px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                    {"Buenos días, Javier"}
                  </h1>
                  <p style={{ fontSize: "16px", color: "#3A3A38" }}>
                    {"3 obras asignadas · "}{v.wSubmitted}{" avance pendiente de validación · 1 incidencia abierta"}
                  </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 22px" }}>
                      <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                        {"Tus obras"}
                      </h2>
                      <button onClick={v.goWObras} style={{ border: "0", background: "none", color: "#5567AE", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}>
                        {"Ver todas"}
                      </button>
                    </div>
                    {(v.wObras || []).map((o, o_i) => (
                      <React.Fragment key={o_i}>
                        <button onClick={o.openC} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr) 150px 24px", gap: "16px", alignItems: "center", padding: "14px 22px", border: "0", borderTop: "1px solid #F0F0EC", background: "#fff", width: "100%", textAlign: "left", cursor: "pointer" }}>
                          <img src={o.cover} alt="" style={{ width: "72px", height: "54px", objectFit: "cover", borderRadius: "8px" }} />
                          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "15px", fontWeight: "700" }}>
                              {o.name}
                            </span>
                            <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                              {o.addr}{" · "}{o.status}
                            </span>
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ flex: "1", height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                              <span style={{ display: "block", width: o.physW, height: "100%", background: "#5567AE" }}></span>
                            </span>
                            <span style={{ fontSize: "13px", fontWeight: "700", width: "34px" }}>
                              {o.physS}
                            </span>
                          </span>
                          <i className="ri-arrow-right-s-line" style={{ fontSize: "20px", color: "#9A9A96" }}></i>
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                      <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                        {"Incidencia abierta"}
                      </h2>
                      <div style={{ display: "flex", gap: "10px", padding: "12px", borderRadius: "10px", background: "#F8E1E1" }}>
                        <i className="ri-error-warning-line" style={{ fontSize: "18px", color: "#9E2F2F" }}></i>
                        <span style={{ fontSize: "13px", color: "#1D1D1B", lineHeight: "1.45" }}>
                          <strong>
                            {"Cuadro general bloqueado"}
                          </strong>
                          {" · Reforma integral. Suministro previsto 29 oct."}
                        </span>
                      </div>
                    </div>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <h2 style={{ fontSize: "16px", fontWeight: "700" }}>
                        {"Tus permisos"}
                      </h2>
                      <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                        {"Rol: Jefe de obra. Solo ves las obras que tienes asignadas."}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
                        <span style={{ display: "flex", gap: "8px" }}>
                          <i className="ri-check-line" style={{ color: "#55A89D" }}></i>
                          {"Registrar avance y cantidades"}
                        </span>
                        <span style={{ display: "flex", gap: "8px" }}>
                          <i className="ri-check-line" style={{ color: "#55A89D" }}></i>
                          {"Subir fotografías"}
                        </span>
                        <span style={{ display: "flex", gap: "8px" }}>
                          <i className="ri-check-line" style={{ color: "#55A89D" }}></i>
                          {"Ver clientes de tus obras"}
                        </span>
                        <span style={{ display: "flex", gap: "8px", color: "#6B6B68" }}>
                          <i className="ri-lock-line"></i>
                          {"Validar y publicar avance (dirección de obra)"}
                        </span>
                        <span style={{ display: "flex", gap: "8px", color: "#6B6B68" }}>
                          <i className="ri-lock-line"></i>
                          {"Presupuestos y usuarios"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_w_obras ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                  {"Obras asignadas"}
                </h1>
                <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                  {(v.wObras || []).map((o, o_i) => (
                    <React.Fragment key={o_i}>
                      <button onClick={o.openC} style={{ display: "grid", gridTemplateColumns: "88px minmax(0,1fr) 140px 180px 24px", gap: "16px", alignItems: "center", padding: "16px 22px", border: "0", borderBottom: "1px solid #F0F0EC", background: "#fff", width: "100%", textAlign: "left", cursor: "pointer", fontSize: "14px" }}>
                        <img src={o.cover} alt="" style={{ width: "88px", height: "64px", objectFit: "cover", borderRadius: "8px" }} />
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "16px", fontWeight: "700" }}>
                            {o.name}
                          </span>
                          <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                            {o.addr}{" · "}{o.type}
                          </span>
                        </span>
                        <span>
                          {o.status}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: "1", height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                            <span style={{ display: "block", width: o.physW, height: "100%", background: "#5567AE" }}></span>
                          </span>
                          <span style={{ fontWeight: "700", width: "34px" }}>
                            {o.physS}
                          </span>
                        </span>
                        <i className="ri-arrow-right-s-line" style={{ fontSize: "20px", color: "#9A9A96" }}></i>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {v.is_w_obra ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#3E4D85", textTransform: "uppercase" }}>
                      {"Vista interna · avance físico "}{v.obra.physS}
                    </span>
                    <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                      {v.obra.name}
                    </h1>
                    <p style={{ fontSize: "15px", color: "#3A3A38" }}>
                      {v.obra.addr}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={v.wDate} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "11px 14px", fontWeight: "700", fontSize: "14px", cursor: "pointer", display: "flex", gap: "6px", alignItems: "center" }}>
                      <i className="ri-calendar-event-line"></i>
                      {"Proponer cambio de fecha"}
                    </button>
                    <button onClick={v.wIncident} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "11px 14px", fontWeight: "700", fontSize: "14px", cursor: "pointer", display: "flex", gap: "6px", alignItems: "center" }}>
                      <i className="ri-error-warning-line"></i>
                      {"Informar incidencia"}
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {(v.pfilters || []).map((f, f_i) => (
                    <React.Fragment key={f_i}>
                      <button onClick={f.go} style={{ border: `1px solid ${f.bd}`, background: f.bg, color: f.fg, borderRadius: "99px", padding: "7px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                        {f.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflowX: "auto" }}>
                  <div style={{ minWidth: "1040px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "60px minmax(200px,1fr) 40px 90px 130px 140px 176px 150px", gap: "12px", padding: "12px 20px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                      <span>
                        {"Código"}
                      </span>
                      <span>
                        {"Partida"}
                      </span>
                      <span>
                        {"Ud"}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {"Contratado"}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {"Validado"}
                      </span>
                      <span>
                        {"Avance"}
                      </span>
                      <span>
                        {"Estado"}
                      </span>
                      <span></span>
                    </div>
                    {(v.fChap || []).map((ch, ch_i) => (
                      <React.Fragment key={ch_i}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "14px 20px", background: "#FAFAF8", borderTop: "1px solid #EDEDEA" }}>
                            <span style={{ fontSize: "15px", fontWeight: "700", flex: "1" }}>
                              {ch.code}{" · "}{ch.name}
                            </span>
                            <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                              {ch.totS}{" · "}{ch.weightS}
                            </span>
                            <span style={{ fontSize: "14px", fontWeight: "700", width: "40px", textAlign: "right" }}>
                              {ch.pctS}
                            </span>
                          </div>
                          {(ch.items || []).map((p, p_i) => (
                            <React.Fragment key={p_i}>
                              <div style={{ display: "grid", gridTemplateColumns: "60px minmax(200px,1fr) 40px 90px 130px 140px 176px 150px", gap: "12px", alignItems: "center", padding: "12px 20px", borderTop: "1px solid #F0F0EC", fontSize: "14px" }}>
                                <span style={{ color: "#6B6B68" }}>
                                  {p.code}
                                </span>
                                <span style={{ fontWeight: "500" }}>
                                  {p.desc}
                                </span>
                                <span>
                                  {p.unit}
                                </span>
                                <span style={{ textAlign: "right" }}>
                                  {p.qtyS}
                                </span>
                                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <span style={{ fontWeight: "600" }}>
                                    {p.valS}
                                  </span>
                                  {p.hasNote ? (
                                    <>
                                      <span style={{ fontSize: "11px", color: "#7A4E0E", lineHeight: "1.3" }}>
                                        {p.note}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ flex: "1", height: "6px", background: "#EDEDEA", borderRadius: "99px", overflow: "hidden" }}>
                                    <span style={{ display: "block", width: p.pctW, height: "100%", background: p.st.dot }}></span>
                                  </span>
                                  <span style={{ width: "38px", textAlign: "right", fontWeight: "600" }}>
                                    {p.pctS}
                                  </span>
                                </div>
                                <span>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: p.st.bg, color: p.st.fg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px", whiteSpace: "nowrap" }}>
                                    <span style={{ width: "6px", height: "6px", borderRadius: "99px", background: p.st.dot }}></span>
                                    {p.st.label}
                                  </span>
                                </span>
                                <button onClick={p.open} style={{ border: "1px solid #5567AE", color: "#3E4D85", background: "#fff", borderRadius: "8px", padding: "8px 10px", fontSize: "13px", fontWeight: "700", cursor: "pointer", minHeight: "40px" }}>
                                  {"Registrar avance"}
                                </button>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_a_home ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                    {"Panel de administración"}
                  </h1>
                  <p style={{ fontSize: "15px", color: "#3A3A38" }}>
                    {"Altas, revisiones y permisos. Las acciones sensibles piden confirmación y quedan en auditoría."}
                  </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "14px" }}>
                  {(v.kpis || []).map((k, k_i) => (
                    <React.Fragment key={k_i}>
                      <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "13px", color: "#3A3A38", fontWeight: "600" }}>
                          {k.label}
                        </span>
                        <span style={{ fontFamily: "Manrope,sans-serif", fontSize: "30px", fontWeight: "700", lineHeight: "1.1", color: "#0C062B" }}>
                          {k.value}
                        </span>
                        <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                          {k.sub}
                        </span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                        {"Altas · últimos 30 días"}
                      </h2>
                      <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                        {"Últimos 7 días en azul"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "110px", borderBottom: "1px solid #EDEDEA" }}>
                      {(v.bars || []).map((br, br_i) => (
                        <React.Fragment key={br_i}>
                          <span style={{ flex: "1", height: br.h, background: br.bg, borderRadius: "3px 3px 0 0" }}></span>
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#6B6B68" }}>
                      <span>
                        {"22 sep"}
                      </span>
                      <span>
                        {"21 oct"}
                      </span>
                    </div>
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <h2 style={{ fontSize: "18px", fontWeight: "700" }}>
                        {"Cola de revisión"}
                      </h2>
                      <button onClick={v.goUsers} style={{ border: "0", background: "none", color: "#5567AE", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}>
                        {"Ver usuarios"}
                      </button>
                    </div>
                    {(v.queue || []).map((r, r_i) => (
                      <React.Fragment key={r_i}>
                        <button onClick={r.open} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", border: "0", borderTop: "1px solid #F0F0EC", background: "#fff", width: "100%", textAlign: "left", cursor: "pointer" }}>
                          <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "14px", fontWeight: "700" }}>
                              {r.title}
                            </span>
                            <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                              {r.user}
                            </span>
                          </span>
                          <span style={{ background: r.tBg, color: r.tFg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px", whiteSpace: "nowrap" }}>
                            {r.type}
                          </span>
                          <i className="ri-arrow-right-s-line" style={{ fontSize: "20px", color: "#9A9A96" }}></i>
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "10px", padding: "14px 16px", borderRadius: "10px", background: "#fff", border: "1px solid #EDEDEA", fontSize: "13px", color: "#3A3A38", lineHeight: "1.5" }}>
                  <i className="ri-database-2-line" style={{ fontSize: "18px", color: "#6B6B68" }}></i>
                  <span>
                    {"Altas, verificación y método de acceso salen de "}
                    <code>
                      {"users"}
                    </code>
                    {" y "}
                    <code>
                      {"auth_identities"}
                    </code>
                    {". Revisiones, duplicados, roles y obras requieren tablas nuevas (Fase 1). La última actividad se deriva de "}
                    <code>
                      {"sessions.created_at"}
                    </code>
                    {"."}
                  </span>
                </div>
              </div>
            </>
          ) : null}
          {v.is_a_users ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
                  <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                    {"Usuarios"}
                  </h1>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "0 12px", width: "320px" }}>
                    <i className="ri-search-line" style={{ color: "#6B6B68" }}></i>
                    <input value={v.q} onChange={v.onQ} placeholder="Buscar por nombre o email" style={{ border: "0", outline: "none", flex: "1", fontSize: "14px", background: "transparent" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {(v.uf || []).map((f, f_i) => (
                    <React.Fragment key={f_i}>
                      <button onClick={f.go} style={{ border: `1px solid ${f.bd}`, background: f.bg, color: f.fg, borderRadius: "99px", padding: "7px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}>
                        {f.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflowX: "auto" }}>
                  <div style={{ minWidth: "1060px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) 110px 150px 120px 150px 70px 110px 90px", gap: "14px", padding: "12px 20px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase", background: "#FAFAF8" }}>
                      <span>
                        {"Usuario"}
                      </span>
                      <span>
                        {"Alta"}
                      </span>
                      <span>
                        {"Tipo"}
                      </span>
                      <span>
                        {"Email"}
                      </span>
                      <span>
                        {"Perfil"}
                      </span>
                      <span>
                        {"Obras"}
                      </span>
                      <span>
                        {"Último acceso"}
                      </span>
                      <span>
                        {"Revisión"}
                      </span>
                    </div>
                    {(v.urows || []).map((u, u_i) => (
                      <React.Fragment key={u_i}>
                        <button onClick={u.open} style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) 110px 150px 120px 150px 70px 110px 90px", gap: "14px", alignItems: "center", padding: "14px 20px", border: "0", borderTop: "1px solid #F0F0EC", background: "#fff", width: "100%", textAlign: "left", cursor: "pointer", fontSize: "14px" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "0" }}>
                            <span style={{ width: "36px", height: "36px", borderRadius: "99px", background: "#E3E7F3", color: "#3E4D85", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "12px", flexShrink: "0" }}>
                              {u.initials}
                            </span>
                            <span style={{ display: "flex", flexDirection: "column", minWidth: "0" }}>
                              <span style={{ fontWeight: "700" }}>
                                {u.name}
                              </span>
                              <span style={{ fontSize: "12px", color: "#6B6B68", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {u.email}
                              </span>
                            </span>
                          </span>
                          <span style={{ color: "#3A3A38" }}>
                            {u.since}
                          </span>
                          <span style={{ display: "flex", flexDirection: "column" }}>
                            <span>
                              {u.kind}
                            </span>
                            <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                              {u.roleL}
                            </span>
                          </span>
                          <span>
                            <span style={{ background: u.verBg, color: u.verFg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                              {u.ver}
                            </span>
                          </span>
                          <span style={{ color: u.profFg, fontWeight: "600", fontSize: "13px" }}>
                            {u.profS}
                          </span>
                          <span>
                            {u.works}
                          </span>
                          <span style={{ color: "#6B6B68" }}>
                            {u.last}
                          </span>
                          <span>
                            {u.hasIss ? (
                              <>
                                <span style={{ background: "#FBF1DE", color: "#7A4E0E", fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px" }}>
                                  {u.nIss}{" abiertas"}
                                </span>
                              </>
                            ) : null}
                          </span>
                        </button>
                      </React.Fragment>
                    ))}
                    {v.noRows ? (
                      <>
                        <div style={{ padding: "40px", textAlign: "center", color: "#6B6B68", fontSize: "14px" }}>
                          {"Ningún usuario coincide con la búsqueda."}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_a_user ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ width: "56px", height: "56px", borderRadius: "99px", background: "#E3E7F3", color: "#3E4D85", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "18px" }}>
                    {v.user.initials}
                  </div>
                  <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <h1 style={{ fontSize: "28px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                      {v.user.name}
                    </h1>
                    <span style={{ fontSize: "14px", color: "#3A3A38" }}>
                      {v.user.email}{" · alta "}{v.user.since}{" · "}{v.user.prov}
                    </span>
                  </div>
                  <span style={{ background: v.user.verBg, color: v.user.verFg, fontSize: "12px", fontWeight: "700", padding: "5px 10px", borderRadius: "99px" }}>
                    {"Email: "}{v.user.ver}
                  </span>
                  <span style={{ background: "#EDEDEA", color: "#3A3A38", fontSize: "12px", fontWeight: "700", padding: "5px 10px", borderRadius: "99px" }}>
                    {v.user.roleL}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "20px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                      <h2 style={{ fontSize: "17px", fontWeight: "700" }}>
                        {"Verificación de datos"}
                      </h2>
                      {v.noIssues ? (
                        <>
                          <span style={{ fontSize: "14px", color: "#6B6B68" }}>
                            {"Sin incidencias abiertas."}
                          </span>
                        </>
                      ) : null}
                      {(v.myIssues || []).map((i, i_i) => (
                        <React.Fragment key={i_i}>
                          <div style={{ border: "1px solid #EDEDEA", borderRadius: "12px", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
                              <span style={{ fontSize: "15px", fontWeight: "700" }}>
                                {i.title}
                              </span>
                              <span style={{ background: i.tBg, color: i.tFg, fontSize: "12px", fontWeight: "700", padding: "4px 10px", borderRadius: "99px", whiteSpace: "nowrap" }}>
                                {i.type}
                              </span>
                            </div>
                            <span style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.45" }}>
                              {i.detail}
                            </span>
                            <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                              {"Campo: "}{i.field}
                            </span>
                            {i.open ? (
                              <>
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                  <button onClick={i.fix} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                                    {"Corregir campo"}
                                  </button>
                                  <button onClick={i.ask} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                                    {"Pedir al cliente"}
                                  </button>
                                  <button onClick={i.close} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                                    {"Marcar revisada"}
                                  </button>
                                </div>
                              </>
                            ) : null}
                            {i.done ? (
                              <>
                                <span style={{ fontSize: "13px", color: "#2F6B63", fontWeight: "700", display: "flex", gap: "6px" }}>
                                  <i className="ri-checkbox-circle-line"></i>
                                  {"Resuelta por Administrador principal · hoy"}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </React.Fragment>
                      ))}
                      <span style={{ fontSize: "12px", color: "#6B6B68", lineHeight: "1.45" }}>
                        {"Automática = regla de formato. Revisión humana = lo comprueba una persona. Documental = requiere un documento. Ninguna marca la identidad como verificada por sí sola."}
                      </span>
                    </div>
                    <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <h2 style={{ fontSize: "17px", fontWeight: "700" }}>
                        {"Datos"}
                      </h2>
                      <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr)", gap: "8px 12px", fontSize: "14px" }}>
                        <span style={{ color: "#6B6B68" }}>
                          {"Teléfono"}
                        </span>
                        <span>
                          {v.user.phone}
                        </span>
                        <span style={{ color: "#6B6B68" }}>
                          {"Localidad"}
                        </span>
                        <span>
                          {v.user.city}
                        </span>
                        <span style={{ color: "#6B6B68" }}>
                          {"Perfil"}
                        </span>
                        <span>
                          {v.user.profS}{" completado"}
                        </span>
                        <span style={{ color: "#6B6B68" }}>
                          {"Obras"}
                        </span>
                        <span>
                          {v.user.works}
                        </span>
                        <span style={{ color: "#6B6B68" }}>
                          {"Último acceso"}
                        </span>
                        <span>
                          {v.user.last}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {v.userIsClient ? (
                      <>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "10px" }}>
                          <h2 style={{ fontSize: "17px", fontWeight: "700" }}>
                            {"Acceso por relación"}
                          </h2>
                          <p style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.5" }}>
                            {"Los clientes no tienen permisos internos. Ven lo que les corresponde por su relación con un cliente y sus obras."}
                          </p>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #F0F0EC", fontSize: "14px" }}>
                            <span>
                              {"Cliente vinculado"}
                            </span>
                            <strong>
                              {"Titular"}
                            </strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #F0F0EC", fontSize: "14px" }}>
                            <span>
                              {"Obras autorizadas"}
                            </span>
                            <strong>
                              {v.user.works}
                            </strong>
                          </div>
                          <button style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "10px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
                            {"Gestionar asociaciones usuario · cliente · obra"}
                          </button>
                        </div>
                      </>
                    ) : null}
                    {v.userIsInternal ? (
                      <>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h2 style={{ fontSize: "17px", fontWeight: "700" }}>
                              {"Permisos"}
                            </h2>
                            <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                              {v.effCount}
                            </span>
                          </div>
                          {v.isSelf ? (
                            <>
                              <div style={{ padding: "12px", borderRadius: "10px", background: "#FBF1DE", fontSize: "13px", color: "#7A4E0E", lineHeight: "1.45" }}>
                                {"Es tu propia cuenta: no puedes cambiar tus permisos ni dejar la plataforma sin administrador principal."}
                              </div>
                            </>
                          ) : null}
                          {(v.permGroups || []).map((g, g_i) => (
                            <React.Fragment key={g_i}>
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase", padding: "8px 0" }}>
                                  {g.name}
                                </span>
                                {(g.items || []).map((p, p_i) => (
                                  <React.Fragment key={p_i}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px", borderRadius: "8px", background: p.rowBg, opacity: p.op }}>
                                      <span style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                                        <span style={{ fontSize: "14px", fontWeight: "600" }}>
                                          {p.label}
                                        </span>
                                        <span style={{ fontSize: "12px", color: "#6B6B68", fontFamily: "ui-monospace,monospace" }}>
                                          {p.key}
                                        </span>
                                      </span>
                                      {p.sens ? (
                                        <>
                                          <span style={{ fontSize: "11px", fontWeight: "700", color: "#B84371" }}>
                                            {"Sensible"}
                                          </span>
                                        </>
                                      ) : null}
                                      {p.hasTag ? (
                                        <>
                                          <span style={{ background: p.tagBg, color: p.tagFg, fontSize: "11px", fontWeight: "700", padding: "3px 8px", borderRadius: "99px" }}>
                                            {p.tag}
                                          </span>
                                        </>
                                      ) : null}
                                      <button onClick={p.toggle} aria-label={p.label} style={{ width: "40px", height: "22px", borderRadius: "99px", border: "0", background: p.tBg, position: "relative", cursor: p.cur, padding: "0", flexShrink: "0" }}>
                                        <span style={{ position: "absolute", top: "3px", left: "3px", width: "16px", height: "16px", borderRadius: "99px", background: "#fff", transform: `translateX(${p.tX})`, transition: "transform 160ms" }}></span>
                                      </button>
                                    </div>
                                  </React.Fragment>
                                ))}
                              </div>
                            </React.Fragment>
                          ))}
                          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", paddingTop: "8px", borderTop: "1px solid #EDEDEA" }}>
                            {v.hasDiff ? (
                              <>
                                <button onClick={v.discard} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>
                                  {"Descartar"}
                                </button>
                              </>
                            ) : null}
                            <button onClick={v.openPerm} style={{ border: "0", background: v.saveBg, color: v.saveFg, borderRadius: "8px", padding: "10px 14px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>
                              {"Revisar y guardar"}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {v.is_a_audit ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <h1 style={{ fontSize: "30px", fontWeight: "700", letterSpacing: "-0.02em" }}>
                  {"Auditoría"}
                </h1>
                <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "130px 200px 190px 200px minmax(0,1fr)", gap: "14px", padding: "12px 20px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase", background: "#FAFAF8" }}>
                    <span>
                      {"Fecha"}
                    </span>
                    <span>
                      {"Quién"}
                    </span>
                    <span>
                      {"Acción"}
                    </span>
                    <span>
                      {"Sobre"}
                    </span>
                    <span>
                      {"Detalle"}
                    </span>
                  </div>
                  {(v.audit || []).map((a, a_i) => (
                    <React.Fragment key={a_i}>
                      <div style={{ display: "grid", gridTemplateColumns: "130px 200px 190px 200px minmax(0,1fr)", gap: "14px", padding: "13px 20px", borderTop: "1px solid #F0F0EC", fontSize: "14px" }}>
                        <span style={{ color: "#6B6B68" }}>
                          {a.when}
                        </span>
                        <span style={{ fontWeight: "600" }}>
                          {a.actor}
                        </span>
                        <span>
                          {a.action}
                        </span>
                        <span>
                          {a.target}
                        </span>
                        <span style={{ color: "#3A3A38" }}>
                          {a.detail}
                        </span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
    {v.hasToast ? (
      <>
        <div role="status" style={{ position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", background: "#0C062B", color: "#fff", padding: "14px 20px", borderRadius: "10px", fontSize: "14px", fontWeight: "500", boxShadow: "0 12px 32px rgba(12,6,43,0.2)", zIndex: "60", maxWidth: "560px", display: "flex", gap: "10px", alignItems: "center" }}>
          <i className="ri-information-line" style={{ fontSize: "18px", color: "#68C0B5" }}></i>
          {v.toast}
        </div>
      </>
    ) : null}
    {v.mAccept ? (
      <>
        <div style={{ position: "fixed", inset: "0", background: "rgba(12,6,43,0.45)", display: "grid", placeItems: "center", zIndex: "50", padding: "24px" }}>
          <div role="dialog" aria-modal="true" style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "560px", padding: "28px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                {"Aceptar PRE-2026-031 · v1"}
              </span>
              <button onClick={v.closeModal} aria-label="Cerrar" style={{ border: "0", background: "none", cursor: "pointer", fontSize: "22px", color: "#6B6B68" }}>
                <i className="ri-close-line"></i>
              </button>
            </div>
            {v.accStep1 ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <h2 style={{ fontSize: "22px", fontWeight: "700" }}>
                    {"Revisa lo que aceptas"}
                  </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "8px 16px", fontSize: "14px", padding: "16px", borderRadius: "12px", background: "#F7F7F5" }}>
                    <span style={{ color: "#3A3A38" }}>
                      {"Proyecto"}
                    </span>
                    <strong>
                      {v.b.name}
                    </strong>
                    <span style={{ color: "#3A3A38" }}>
                      {"Versión"}
                    </span>
                    <strong>
                      {"v1 · 10 oct 2026"}
                    </strong>
                    <span style={{ color: "#3A3A38" }}>
                      {"Total IVA incluido"}
                    </span>
                    <strong>
                      {v.bTotS}
                    </strong>
                    <span style={{ color: "#3A3A38" }}>
                      {"Pago"}
                    </span>
                    <strong>
                      {"40% inicio · 60% final"}
                    </strong>
                  </div>
                  <button onClick={v.tglA} style={{ display: "flex", gap: "10px", alignItems: "flex-start", border: "0", background: "none", textAlign: "left", cursor: "pointer", fontSize: "14px", lineHeight: "1.45", padding: "0" }}>
                    <i className={v.accAIcon} style={{ fontSize: "22px", color: "#5567AE" }}></i>
                    <span>
                      {"He leído las partidas, condiciones y exclusiones de esta versión."}
                    </span>
                  </button>
                  <button onClick={v.tglB} style={{ display: "flex", gap: "10px", alignItems: "flex-start", border: "0", background: "none", textAlign: "left", cursor: "pointer", fontSize: "14px", lineHeight: "1.45", padding: "0" }}>
                    <i className={v.accBIcon} style={{ fontSize: "22px", color: "#5567AE" }}></i>
                    <span>
                      {"Acepto las condiciones comerciales y entiendo que el contrato se formaliza después."}
                    </span>
                  </button>
                  <div style={{ display: "flex", gap: "10px", padding: "12px 14px", borderRadius: "10px", background: "#F2F4FA", fontSize: "13px", color: "#0C062B", lineHeight: "1.45" }}>
                    <i className="ri-information-line" style={{ fontSize: "18px", color: "#5567AE" }}></i>
                    <span>
                      {"Esto registra tu decisión sobre la versión v1. No es una firma electrónica: el contrato lo firmaréis aparte."}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button onClick={v.closeModal} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                      {"Cancelar"}
                    </button>
                    <button onClick={v.accConfirm} style={{ border: "0", background: v.accBtnBg, color: v.accBtnFg, borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                      {"Confirmar aceptación"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.accStep3 ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px", alignItems: "flex-start" }}>
                  <span style={{ width: "52px", height: "52px", borderRadius: "99px", background: "#DEF3F0", display: "grid", placeItems: "center" }}>
                    <i className="ri-check-line" style={{ fontSize: "28px", color: "#2F6B63" }}></i>
                  </span>
                  <h2 style={{ fontSize: "22px", fontWeight: "700" }}>
                    {"Presupuesto aceptado"}
                  </h2>
                  <p style={{ fontSize: "14px", color: "#3A3A38", lineHeight: "1.5" }}>
                    {"Queda constancia de que aceptaste la versión v1 ("}{v.bTotS}{") hoy, 21 oct 2026, a las 10:14. Puedes consultarlo en el historial de versiones."}
                  </p>
                  <p style={{ fontSize: "14px", color: "#3A3A38", lineHeight: "1.5" }}>
                    <strong>
                      {"Siguiente paso:"}
                    </strong>
                    {" Javier Moreno te contactará para firmar el contrato y fijar la fecha de inicio. Después verás la obra en Mis obras."}
                  </p>
                  <button onClick={v.closeModal} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "12px 18px", fontWeight: "700", fontSize: "14px", cursor: "pointer", alignSelf: "flex-end" }}>
                    {"Entendido"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </>
    ) : null}
    {v.mMod ? (
      <>
        <div style={{ position: "fixed", inset: "0", background: "rgba(12,6,43,0.45)", display: "grid", placeItems: "center", zIndex: "50", padding: "24px" }}>
          <div role="dialog" aria-modal="true" style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "520px", padding: "28px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
              {v.mod.id}
            </span>
            {v.modIsAccept ? (
              <>
                <h2 style={{ fontSize: "22px", fontWeight: "700" }}>
                  {"¿Aprobar esta modificación?"}
                </h2>
              </>
            ) : null}
            {v.modIsReject ? (
              <>
                <h2 style={{ fontSize: "22px", fontWeight: "700" }}>
                  {"¿Rechazar esta modificación?"}
                </h2>
              </>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px", borderRadius: "12px", background: "#F7F7F5" }}>
              <span style={{ fontSize: "15px", fontWeight: "700" }}>
                {v.mod.title}
              </span>
              <span style={{ fontSize: "14px", color: "#3A3A38" }}>
                {v.mod.amountS}{" sin IVA · "}{v.mod.impact}
              </span>
            </div>
            {v.modIsAccept ? (
              <>
                <p style={{ fontSize: "14px", color: "#3A3A38", lineHeight: "1.5" }}>
                  {"Se añadirá al alcance autorizado de la obra y al importe vigente. El presupuesto original no cambia y sigue en el historial."}
                </p>
              </>
            ) : null}
            {v.modIsReject ? (
              <>
                <p style={{ fontSize: "14px", color: "#3A3A38", lineHeight: "1.5" }}>
                  {"La obra continúa con el alcance contratado. Ledens no ejecutará este cambio."}
                </p>
              </>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button onClick={v.closeModal} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                {"Cancelar"}
              </button>
              <button onClick={v.modConfirm} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                {"Confirmar"}
              </button>
            </div>
          </div>
        </div>
      </>
    ) : null}
    {v.mDoc ? (
      <>
        <div style={{ position: "fixed", inset: "0", background: "rgba(12,6,43,0.45)", display: "grid", placeItems: "center", zIndex: "50", padding: "24px" }}>
          <div role="dialog" aria-modal="true" style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "760px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid #EDEDEA" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "16px", fontWeight: "700" }}>
                  {v.doc.name}
                </span>
                <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                  {v.doc.type}{" · publicado el "}{v.doc.date}
                </span>
              </div>
              <button onClick={v.closeModal} aria-label="Cerrar" style={{ border: "0", background: "none", cursor: "pointer", fontSize: "22px", color: "#6B6B68" }}>
                <i className="ri-close-line"></i>
              </button>
            </div>
            <div style={{ height: "380px", background: "#F7F7F5", display: "grid", placeItems: "center" }}>
              <div style={{ width: "270px", height: "340px", background: "#fff", boxShadow: "0 4px 12px rgba(12,6,43,0.08)", display: "grid", placeItems: "center", fontSize: "12px", fontWeight: "700", color: "#9A9A96", letterSpacing: "0.04em" }}>
                {"VISTA PREVIA PDF"}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "16px 22px" }}>
              <button style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "11px 14px", fontWeight: "700", fontSize: "14px", cursor: "pointer", display: "flex", gap: "6px", alignItems: "center" }}>
                <i className="ri-download-2-line"></i>
                {"Descargar"}
              </button>
              {v.docRev ? (
                <>
                  <button onClick={v.markReviewed} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "11px 14px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                    {"Marcar como revisado"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </>
    ) : null}
    {v.mProg ? (
      <>
        <div style={{ position: "fixed", inset: "0", background: "rgba(12,6,43,0.45)", display: "grid", placeItems: "center", zIndex: "50", padding: "24px" }}>
          <div role="dialog" aria-modal="true" style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "560px", padding: "28px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.04em", color: "#6B6B68", textTransform: "uppercase" }}>
                {v.prog.chap}{" · "}{v.prog.code}
              </span>
              <button onClick={v.closeModal} aria-label="Cerrar" style={{ border: "0", background: "none", cursor: "pointer", fontSize: "22px", color: "#6B6B68" }}>
                <i className="ri-close-line"></i>
              </button>
            </div>
            <h2 style={{ fontSize: "22px", fontWeight: "700" }}>
              {v.prog.desc}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px" }}>
              <div style={{ padding: "14px", borderRadius: "10px", background: "#F7F7F5", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                  {"Contratado"}
                </span>
                <strong>
                  {v.prog.qtyS}{" "}{v.prog.unit}
                </strong>
              </div>
              <div style={{ padding: "14px", borderRadius: "10px", background: "#F7F7F5", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "12px", color: "#6B6B68" }}>
                  {"Validado hasta hoy"}
                </span>
                <strong>
                  {v.prog.valS}{" "}{v.prog.unit}
                </strong>
              </div>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
              {"Cantidad ejecutada acumulada ("}{v.prog.unit}{")"}
              <input value={v.progQty} onChange={v.onProgQty} inputMode="decimal" style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "16px" }} />
            </label>
            {v.hasProgErr ? (
              <>
                <span style={{ fontSize: "13px", color: "#9E2F2F", fontWeight: "600", display: "flex", gap: "6px" }}>
                  <i className="ri-error-warning-line"></i>
                  {v.progErr}
                </span>
              </>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "84px", border: "1px dashed #CFC0C0", borderRadius: "10px", fontSize: "14px", color: "#3A3A38", cursor: "pointer" }}>
              <i className="ri-camera-line" style={{ fontSize: "20px", color: "#5567AE" }}></i>
              {"Añadir fotografías como evidencia"}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
              {"Comentario interno"}
              <textarea value={v.progNote} onChange={v.onProgNote} rows="2" style={{ border: "1px solid #D9D9D9", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", resize: "vertical" }}></textarea>
            </label>
            <div style={{ display: "flex", gap: "10px", padding: "12px 14px", borderRadius: "10px", background: "#F2F4FA", fontSize: "13px", lineHeight: "1.45" }}>
              <i className="ri-shield-check-line" style={{ fontSize: "18px", color: "#5567AE" }}></i>
              <span>
                {"Se envía a validación. El cliente no lo verá hasta que la dirección de obra lo publique."}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button onClick={v.closeModal} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                {"Cancelar"}
              </button>
              <button onClick={v.progSubmit} style={{ border: "0", background: "#5567AE", color: "#fff", borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                {"Enviar a validación"}
              </button>
            </div>
          </div>
        </div>
      </>
    ) : null}
    {v.mPerm ? (
      <>
        <div style={{ position: "fixed", inset: "0", background: "rgba(12,6,43,0.45)", display: "grid", placeItems: "center", zIndex: "50", padding: "24px" }}>
          <div role="dialog" aria-modal="true" style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "520px", padding: "28px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "700" }}>
              {"Confirmar cambios de permisos"}
            </h2>
            <span style={{ fontSize: "14px", color: "#3A3A38" }}>
              {v.user.name}{" · "}{v.user.roleL}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px", borderRadius: "10px", background: "#F7F7F5" }}>
              {(v.diff || []).map((d, d_i) => (
                <React.Fragment key={d_i}>
                  <span style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px", fontWeight: "600", color: d.fg }}>
                    <i className={d.icon}></i>
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>
                      {d.txt}
                    </span>
                  </span>
                </React.Fragment>
              ))}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
              {"Motivo (obligatorio, queda en auditoría)"}
              <textarea value={v.reason} onChange={v.onReason} rows="2" placeholder="Ej.: pasa a revisar altas de clientes" style={{ border: "1px solid #D9D9D9", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", resize: "vertical" }}></textarea>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button onClick={v.closeModal} style={{ border: "1px solid #D9D9D9", background: "#fff", borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                {"Cancelar"}
              </button>
              <button onClick={v.permConfirm} style={{ border: "0", background: v.permBtnBg, color: v.permBtnFg, borderRadius: "8px", padding: "12px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                {"Confirmar cambios"}
              </button>
            </div>
          </div>
        </div>
      </>
    ) : null}
      </div>
    );
  }
}
