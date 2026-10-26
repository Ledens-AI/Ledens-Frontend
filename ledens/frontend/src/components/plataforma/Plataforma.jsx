/* Client platform (/plataforma): client area, site-manager workspace and admin
 * panel. Which one you get is decided by your role (users.role on the backend,
 * see CLAUDE.md "Roles"). Admins can also open the jefe de obra and client
 * panels, as such or as one user sees them (read-only, audited: VerComo.jsx).
 * Logic and markup ported from the Claude Design file "Ledens Plataforma.dc.html";
 * the JSX was converted mechanically from the design's markup, so it keeps the
 * design's inline styles. Admin screens show real data from /api/admin
 * (./adminData.js); presupuestos, obras en curso and their notifications come
 * from /api/presupuestos (./obras/, lazy-loaded); Mi perfil is still demo. */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import logo from '../../assets/logo-ledens-isotype.png';
import { PERMS, BASE, ITYPE } from './data.js';
import { ROLE_VIEW, ROLE_LABEL, initials, firstName, fmtDate, userRow, signupBars, adminKpis, auditRow } from './adminData.js';
import { FIN_TABS } from './finanzas/tabs.js';
import { setViewAs, viewAsHeaders } from './finanzas/api.js';
import { VerComoSelector, VerComoBanner } from './VerComo.jsx';
const GestionFinanciera = React.lazy(() => import('./finanzas/GestionFinanciera.jsx'));
const Obras = React.lazy(() => import('./obras/Obras.jsx'));
import '../../styles/plataforma.css';

const HOME = { client: 'c_home', worker: 'w_home', admin: 'a_home' };
const PREFIX = { client: 'c_', worker: 'w_', admin: 'a_' };
// Screens drawn by ./obras/Obras.jsx, and which of its views each one is.
const OBRAS_SCREEN = { c_home: 'home', c_presupuestos: 'presupuestos', c_obras: 'obras', w_home: 'home', w_obras: 'presupuestos', w_avance: 'avance', a_presu: 'presupuestos', a_avance: 'avance' };

class PlataformaView extends React.Component {
  state={role:ROLE_VIEW[this.props.user.role]||'client',screen:HOME[ROLE_VIEW[this.props.user.role]||'client'],userId:null,adminUsers:null,adminAudit:[],roleEdit:null,saving:false,notifOpen:false,modal:null,toast:'',phone:'',personType:'fisica',profErr:'',reason:'',userFilter:'all',q:'',presu:null,finTab:'resumen',finPending:0,finBridgePending:0,finConciliationPending:0};
  // Screens belong to one role each (c_ client, w_ jefe de obra, a_ admin);
  // anything else is ignored. The backend enforces the same split for data.
  // Gestión financiera is w_fin / a_fin (jefe de obra and admin), never c_.
  go=(screen,x)=>{if(!screen.startsWith(PREFIX[this.state.role]))return;this.setState(Object.assign({screen,notifOpen:false},x||{}));window.scrollTo(0,0);};
  componentDidMount(){if(this.state.role==='admin'){this.loadUsers();this.loadAudit();this.getJSON('/api/bridge/workspace/counts').then(d=>this.setState({finBridgePending:d.pending,finConciliationPending:d.reconciliation??d.pending}),()=>{});}if(this.state.role!=='client')this.getJSON('/api/finanzas/resumen').then(d=>this.setState({finPending:d.pendientes}),()=>{});this.loadPresu();}
  // Badge and notification counts: presupuestos waiting for this user.
  loadPresu=()=>this.getJSON('/api/presupuestos').then(d=>{const n=k=>d.presupuestos.filter(p=>p.phase===k).length;this.setState({presu:{pendiente:n('pendiente'),cambios:n('cambios')}});},()=>this.setState({presu:null}));
  getJSON=async(url)=>{const r=await fetch(url,{headers:viewAsHeaders()});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudieron cargar los datos.');return d;};
  loadUsers=()=>this.getJSON('/api/admin/users').then(d=>this.setState({adminUsers:d.users}),e=>{this.setState({adminUsers:[]});this.flash(e.message);});
  loadAudit=()=>this.getJSON('/api/admin/audit').then(d=>this.setState({adminAudit:d.entries}),e=>this.flash(e.message));
  componentWillUnmount(){clearTimeout(this._t);setViewAs(null);}
  // «Ver como» (admins only): open another panel, optionally as one user sees it.
  // Viewing as a user is recorded first (POST /api/admin/view-as); from then on
  // finance requests carry X-Ledens-View-As and the backend answers read-only.
  switchView=async(panel,user)=>{
    if(this.props.user.role!=='admin'||!HOME[panel])return;
    this.setState({switching:true});
    try{
      if(user){const r=await fetch('/api/admin/view-as',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id})});
        const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo abrir la vista de ese usuario.');}
      setViewAs(panel==='admin'?null:user?.id);
      this.setState({role:panel,screen:HOME[panel],viewAs:panel==='admin'?null:user||null,finTab:'resumen',finPending:undefined,notifOpen:false,switching:false},
        ()=>{if(panel!=='client')this.getJSON('/api/finanzas/resumen').then(d=>this.setState({finPending:d.pendientes}),()=>{});this.loadPresu();});
      window.scrollTo(0,0);
    }catch(e){this.setState({switching:false});this.flash(e.message);}
  };
  flash=t=>{this.setState({toast:t});clearTimeout(this._t);this._t=setTimeout(()=>this.setState({toast:''}),3600);};
  renderVals(){
    const s=this.state,role=s.role,view=role==='client'?'client':'internal';
    const mk=(label,icon,screen,badge,match)=>({label,icon,badge,go:()=>this.go(screen),bg:(match||[screen]).includes(s.screen)?'#F2F4FA':'transparent',fg:(match||[screen]).includes(s.screen)?'#3E4D85':'#3A3A38',fw:(match||[screen]).includes(s.screen)?700:500});
    // admin: real users from /api/admin/users
    const now=new Date(),allU=s.adminUsers||[],rowsAll=allU.map(u=>userRow(u,allU,now));
    const user=rowsAll.find(u=>u.id===s.userId)||{id:null,name:s.adminUsers?'Usuario no encontrado':'Cargando…',email:'',role:'client',roleL:'',since:'',prov:'',ver:'',verBg:'#EDEDEA',verFg:'#3A3A38',profS:'',works:'—',last:'',phone:'—',city:'—',issues:[],initials:''};
    const pc=s.presu||{},obrasScreen=OBRAS_SCREEN[s.screen]||null;
    const nav=role==='client'?[mk('Inicio','ri-home-5-line','c_home'),mk('Presupuestos','ri-file-list-3-line','c_presupuestos',pc.pendiente||0),mk('Obra en curso','ri-building-2-line','c_obras'),mk('Mi perfil','ri-user-3-line','c_perfil')]
      :role==='worker'?[mk('Hoy','ri-sun-line','w_home'),mk('Obras asignadas','ri-building-2-line','w_obras',pc.cambios||0),mk('Actualizar avance','ri-bar-chart-horizontal-line','w_avance')]
      :[mk('Panel','ri-dashboard-3-line','a_home'),mk('Usuarios','ri-group-line','a_users',rowsAll.filter(u=>u.issues.length).length,['a_users','a_user']),mk('Auditoría','ri-history-line','a_audit'),mk('Presupuestos y obras','ri-file-list-3-line','a_presu',pc.cambios||0),mk('Actualizar avance','ri-bar-chart-horizontal-line','a_avance')];
    const finScreen=PREFIX[role]+'fin',isFin=s.screen===finScreen;
    // Admin-only finance tabs follow the panel on screen: an admin in the jefe
    // panel (or viewing as a jefe) sees the jefe's tabs.
    if(role!=='client')nav.push({header:'Gestión financiera'},...FIN_TABS.filter(t=>!t[3]||(role==='admin'&&this.props.user.role==='admin')).map(([k,label,icon])=>{const on=isFin&&s.finTab===k;
      return {label,icon,badge:k==='pendientes'?s.finPending:k==='conciliacion'?s.finConciliationPending:k==='pendiente-bridge'?s.finBridgePending:0,finConciliationPending:0,go:()=>this.go(finScreen,{finTab:k}),bg:on?'#F2F4FA':'transparent',fg:on?'#3E4D85':'#3A3A38',fw:on?700:500};}));
    const U=this.props.user,shown=s.viewAs||U,meName=shown.name||shown.email;
    const me={name:meName,initials:initials(meName),role:ROLE_LABEL[shown.role]||'Cliente',avBg:role==='client'?'#EC6090':role==='worker'?'#68C0B5':'#0C062B'};
    const titles={c_home:['Inicio'],c_obras:['Obra en curso'],c_presupuestos:['Presupuestos'],c_perfil:['Mi perfil'],w_home:['Hoy'],w_obras:['Obras asignadas'],a_home:['Panel de administración'],a_users:['Usuarios'],a_user:['Usuarios',user.name],a_audit:['Auditoría'],a_presu:['Presupuestos y obras'],w_avance:['Actualizar avance'],a_avance:['Actualizar avance']};
    titles[finScreen]=['Gestión financiera',(FIN_TABS.find(t=>t[0]===s.finTab)||FIN_TABS[0])[1]];
    const parent={a_user:'a_users'};
    const tt=titles[s.screen];const crumbs=tt.map((l,i)=>({label:l,sep:i>0,fg:i===tt.length-1?'#1D1D1B':'#6B6B68',fw:i===tt.length-1?700:500,go:()=>i<tt.length-1&&(isFin?this.go(finScreen,{finTab:'resumen'}):this.go(parent[s.screen]))}));
    const NT=role==='client'&&pc.pendiente?[['ri-file-list-3-line',pc.pendiente===1?'Un presupuesto espera tu decisión':pc.pendiente+' presupuestos esperan tu decisión','Revísalos en Presupuestos',()=>this.go('c_presupuestos')]]
      :role!=='client'&&pc.cambios?[['ri-chat-3-line',pc.cambios===1?'Un cliente ha pedido cambios':pc.cambios+' presupuestos con cambios pedidos','Prepara la versión nueva',()=>this.go(role==='admin'?'a_presu':'w_obras')]]:[];
    const notifs=NT.map(n=>({icon:n[0],title:n[1],sub:n[2],bg:'#F8F9FC',fw:700,dot:'#EC6090',go:n[3]}));
    const unread=notifs.length;
    const is={};['c_perfil','a_home','a_users','a_user','a_audit'].forEach(k=>is['is_'+k]=s.screen===k);
    // profile
    const phoneOk=/^(\+34\s?)?[6789]\d{2}\s?\d{3}\s?\d{3}$/.test(s.phone.trim());
    // admin
    const uf=[['all','Todos'],['client','Clientes'],['internal','Internos'],['review','Pendientes de revisión'],['incomplete','Sin acceso']].map(([k,l])=>({label:l,go:()=>this.setState({userFilter:k}),bg:s.userFilter===k?'#0C062B':'#fff',fg:s.userFilter===k?'#fff':'#3A3A38',bd:s.userFilter===k?'#0C062B':'#D9D9D9'}));
    const openUser=id=>()=>this.go('a_user',{userId:id,roleEdit:null,reason:''});
    const urows=rowsAll.filter(u=>(s.userFilter==='all'||(s.userFilter==='client'&&u.role==='client')||(s.userFilter==='internal'&&u.role!=='client')||(s.userFilter==='review'&&u.issues.length)||(s.userFilter==='incomplete'&&!u.has_password&&!u.providers.length))&&(!s.q||(u.name+u.email).toLowerCase().includes(s.q.toLowerCase()))).map(u=>({...u,nIss:u.issues.length,hasIss:u.issues.length>0,open:openUser(u.id)}));
    const queue=rowsAll.flatMap(u=>u.issues.map(i=>({user:u.name,title:i.title,type:i.type,tBg:ITYPE[i.type][0],tFg:ITYPE[i.type][1],open:openUser(u.id)})));
    // Permissions follow the role; the admin edits the role, and the list
    // previews what the new role would allow.
    const isSelf=user.id===U.id,roleEdit=s.roleEdit||user.role,cur=BASE[user.role]||[],nxt=BASE[roleEdit]||[];
    const permGroups=PERMS.map(g=>({name:g[0],items:g[1].map(([k,l,f])=>{const on=nxt.includes(k);
      return {key:k,label:l,on,byRole:on,tag:on?'Por rol':'',tagBg:'#EDEDEA',tagFg:'#3A3A38',hasTag:on,sens:f==='sens',adminOnly:f==='admin',tBg:on?'#9A9A96':'#D9D9D9',tX:on?'18px':'0px',cur:'not-allowed',op:on?1:0.5,rowBg:cur.includes(k)!==on?'#F2F4FA':'transparent',
        toggle:()=>this.flash(isSelf?'Es tu propia cuenta: otro administrador tendría que cambiar tu rol.':'Los permisos dependen del rol. Para cambiarlos, cambia el rol del usuario.')};})}));
    const diff=roleEdit!==user.role?[{key:'role',txt:'Rol: '+ROLE_LABEL[user.role]+' → '+ROLE_LABEL[roleEdit],fg:'#3E4D85',icon:'ri-user-settings-line'}]:[];
    const roleOpts=['client','jefe','admin'].map(k=>({label:ROLE_LABEL[k],on:k===roleEdit,go:()=>this.setState({roleEdit:k}),bg:k===roleEdit?'#fff':'transparent',fg:k===roleEdit?'#0C062B':'#6B6B68',sh:k===roleEdit?'0 1px 2px rgba(12,6,43,0.08)':'none'}));
    const effList=nxt;
    const audit=(s.adminAudit||[]).map(auditRow);
    const sb=signupBars(allU,now),bars=sb.bars;
    const KPI=adminKpis(allU,rowsAll,s.adminAudit||[],now);
    const myIssues=user.issues.map(i=>({...i,done:false,open:false,tBg:ITYPE[i.type][0],tFg:ITYPE[i.type][1]}));
    return Object.assign({},is,{
      showDemo:role!=='admin'&&!isFin&&!obrasScreen,obrasScreen,isFin,finTab:s.finTab,finGo:k=>this.go(finScreen,{finTab:k}),finPending:n=>n!==s.finPending&&this.setState({finPending:n}),finBridgePending:(n,c=n)=>(n!==s.finBridgePending||c!==s.finConciliationPending)&&this.setState({finBridgePending:n,finConciliationPending:c}),flash:this.flash,isClient:role==='client',isWorker:role==='worker',isAdmin:role==='admin',isInternal:view==='internal',
      areaLabel:role==='client'?'Área de cliente':role==='worker'?'Workspace':'Administración',nav,me,crumbs,notifs,unread,notifOpen:s.notifOpen,
      firstName:firstName(shown),meFirst:(shown.name||'').trim().split(/\s+/)[0]||'',meLast:(shown.name||'').trim().split(/\s+/).slice(1).join(' '),meEmail:shown.email,meSince:shown.created_at?fmtDate(shown.created_at).replace(/^\d+ /,''):'',
      logout:()=>this.props.onLogout(),
      isRealAdmin:U.role==='admin',panel:role,viewAs:s.viewAs||null,switching:!!s.switching,viewUsers:s.adminUsers||[],
      switchView:this.switchView,exitView:()=>this.switchView('admin',null),barsFrom:sb.from,barsTo:sb.to,roleOpts,
      toggleNotif:()=>this.setState({notifOpen:!s.notifOpen}),readAll:()=>this.setState({notifOpen:false}),
      askBudget:()=>this.props.onOpenLead?this.props.onOpenLead():this.flash('Abriría el formulario de solicitud.'),
      toast:s.toast,hasToast:!!s.toast,
      closeModal:()=>this.setState({modal:null}),
      mPerm:s.modal==='perm',
      phone:s.phone,onPhone:e=>this.setState({phone:e.target.value,profErr:''}),profErr:s.profErr,hasProfErr:!!s.profErr,phoneBd:s.profErr?'#D14A4A':'#D9D9D9',
      saveProfile:()=>{if(!phoneOk){this.setState({profErr:'Formato no válido. Usa 9 cifras, por ejemplo 655 638 219.'});return;}this.flash('Cambios guardados.');},
      isFisica:s.personType==='fisica',isEmpresa:s.personType==='empresa',
      ptypes:[['fisica','Persona física'],['empresa','Empresa']].map(([k,l])=>({label:l,go:()=>this.setState({personType:k}),bg:s.personType===k?'#fff':'transparent',fg:s.personType===k?'#0C062B':'#6B6B68',sh:s.personType===k?'0 1px 2px rgba(12,6,43,0.08)':'none'})),
      kpis:KPI,bars,queue,uf,urows,q:s.q,onQ:e=>this.setState({q:e.target.value}),noRows:urows.length===0,
      user,
      userIsClient:user.role==='client',userIsInternal:user.role!=='client',isSelf,notSelf:!isSelf,myIssues,hasIssues:myIssues.length>0,noIssues:myIssues.length===0,
      permGroups,diff,hasDiff:diff.length>0,noDiff:diff.length===0,effCount:effList.length+' permisos por rol',
      saveBg:diff.length?'#5567AE':'#D9D9D9',saveFg:diff.length?'#fff':'#6B6B68',
      openPerm:()=>diff.length&&this.setState({modal:'perm',reason:''}),reason:s.reason,onReason:e=>this.setState({reason:e.target.value}),
      permOk:!!s.reason.trim()&&!s.saving,permBtnBg:s.reason.trim()&&!s.saving?'#5567AE':'#D9D9D9',permBtnFg:s.reason.trim()&&!s.saving?'#fff':'#6B6B68',
      permConfirm:async()=>{if(!s.reason.trim()||!diff.length||s.saving)return;this.setState({saving:true});
        try{const r=await fetch(`/api/admin/users/${user.id}/role`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:roleEdit,reason:s.reason.trim()})});const d=await r.json().catch(()=>({}));
          if(!r.ok){this.setState({saving:false});this.flash(d.error||'No se pudo cambiar el rol.');return;}
          this.setState(st=>({saving:false,modal:null,roleEdit:null,reason:'',adminUsers:st.adminUsers.map(u=>u.id===d.user.id?d.user:u)}));this.flash('Rol actualizado y registrado en auditoría.');this.loadAudit();}
        catch{this.setState({saving:false});this.flash('Error de conexión. Inténtalo de nuevo.');}},
      discard:()=>this.setState({roleEdit:null}),
      audit,
      goUsers:()=>this.go('a_users'),
      obrasPanel:role,presuChanged:this.loadPresu
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
          {(v.nav || []).map((n, n_i) => n.header ? (
            <div key={n_i} className="plat-nav-group">{n.header}</div>
          ) : (
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
        {v.isRealAdmin ? <VerComoSelector panel={v.panel} viewAs={v.viewAs} users={v.viewUsers} busy={v.switching} onSwitch={v.switchView} /> : null}
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
          <button type="button" onClick={v.logout} aria-label="Cerrar sesi\u00f3n" title="Cerrar sesi\u00f3n" style={{ border: "0", background: "none", cursor: "pointer", width: "36px", height: "36px", borderRadius: "8px", display: "grid", placeItems: "center" }}>
            <i className="ri-logout-box-r-line" style={{ fontSize: "18px", color: "#6B6B68" }}></i>
          </button>
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
          {v.isRealAdmin ? <VerComoBanner panel={v.panel} viewAs={v.viewAs} onExit={v.exitView} /> : null}
          {v.isFin ? (
            <React.Suspense fallback={<div style={{ padding: "32px", color: "#6B6B68" }}>{"Cargando Gestión financiera…"}</div>}>
              <GestionFinanciera key={v.viewAs?.id || 'self'} tab={v.finTab} go={v.finGo} toast={v.flash} onPending={v.finPending} onBridgePending={v.finBridgePending} />
            </React.Suspense>
          ) : null}
          {v.obrasScreen ? (
            <React.Suspense fallback={<div style={{ padding: "32px", color: "#6B6B68" }}>{"Cargando…"}</div>}>
              <Obras key={(v.viewAs?.id || 'self') + v.obrasPanel} panel={v.obrasPanel} screen={v.obrasScreen} readOnly={!!v.viewAs} toast={v.flash} firstName={v.firstName} onCount={v.presuChanged} />
            </React.Suspense>
          ) : null}
          {v.is_c_perfil ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: "24px", alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "96px" }}>
                  <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "56px", height: "56px", borderRadius: "99px", background: "#EC6090", color: "#fff", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "18px" }}>
                        {v.me.initials}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "17px", fontWeight: "700" }}>
                          {v.me.name}
                        </span>
                        <span style={{ fontSize: "13px", color: "#6B6B68" }}>
                          {"Cliente desde "}{v.meSince}
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
                        <input value={v.meFirst} readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px", background: "#fff" }} />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" }}>
                        {"Apellidos"}
                        <input value={v.meLast} readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px" }} />
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
                        <input value={v.meEmail} readOnly style={{ height: "46px", border: "1px solid #D9D9D9", borderRadius: "8px", padding: "0 14px", fontSize: "15px", background: "#F7F7F5", color: "#3A3A38" }} />
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
                          {v.meEmail}
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
                        {v.barsFrom}
                      </span>
                      <span>
                        {v.barsTo}
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
                    {". Roles y auditoría salen de users.role y audit_log; obras y presupuestos todavía son datos de ejemplo. La última actividad se deriva de "}
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
                        {"Acceso"}
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
                          {"Acceso"}
                        </span>
                        <span>
                          {v.user.profS}
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
                    {v.notSelf ? (
                      <>
                        <div style={{ background: "#fff", border: "1px solid #EDEDEA", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
                          <h2 style={{ fontSize: "17px", fontWeight: "700" }}>
                            {"Rol"}
                          </h2>
                          <p style={{ fontSize: "13px", color: "#3A3A38", lineHeight: "1.5" }}>
                            {"Decide qué ve en la plataforma. El cambio pide un motivo y queda en auditoría."}
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", background: "#F7F7F5", border: "1px solid #EDEDEA", borderRadius: "10px", padding: "3px", alignSelf: "flex-start" }}>
                            {(v.roleOpts || []).map((r, r_i) => (
                              <React.Fragment key={r_i}>
                                <button type="button" onClick={r.go} aria-pressed={r.on} style={{ border: "0", borderRadius: "7px", padding: "8px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer", background: r.bg, color: r.fg, boxShadow: r.sh }}>
                                  {r.label}
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                          {v.hasDiff ? (
                            <>
                              <button type="button" onClick={v.openPerm} style={{ alignSelf: "flex-start", background: "#5567AE", color: "#fff", border: "0", borderRadius: "8px", padding: "11px 16px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }}>
                                {"Revisar y guardar"}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </>
                    ) : null}
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

export default function Plataforma(props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // RequireAuth guarantees a user here; key remounts the view if it changes.
  return (
    <PlataformaView
      {...props}
      key={user.id}
      user={user}
      onLogout={async () => { await logout(); navigate('/'); }}
    />
  );
}
