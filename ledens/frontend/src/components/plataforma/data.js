/* Permission catalogue for the admin user screen of /plataforma, from the
 * Claude Design file "Ledens Plataforma.dc.html". Obras and presupuestos used
 * to be demo data here; they now come from /api/presupuestos (./obras/). */
const PERMS=[['Usuarios',[['users.read','Ver usuarios y perfiles'],['users.edit','Editar datos de usuarios'],['business.users.manage','Gestión de altas y permisos de negocio','sens']]],['Clientes',[['clients.read.assigned','Ver clientes asignados'],['clients.read.all','Ver todos los clientes']]],['Presupuestos',[['budgets.read','Ver presupuestos'],['budgets.manage','Crear y editar presupuestos']]],['Obras',[['works.read.assigned','Ver obras asignadas'],['works.progress.submit','Registrar avance'],['works.progress.publish','Validar y publicar avance','sens'],['works.photos.upload','Subir fotografías']]],['Documentos',[['docs.read','Ver documentos'],['docs.publish','Publicar documentos']]],['Administración',[['audit.read','Consultar auditoría'],['roles.manage','Gestionar roles y administradores','admin']]]];
const ALLP=PERMS.flatMap(g=>g[1].map(p=>p[0]));
const BASE={admin:ALLP,jefe:['works.read.assigned','works.progress.submit','works.photos.upload','docs.read','clients.read.assigned'],comercial:['clients.read.assigned','budgets.read','budgets.manage'],client:[]};
const ITYPE={'Automática':['#E3E7F3','#3E4D85'],'Revisión humana':['#FBF1DE','#7A4E0E'],'Documental':['#FBE0EA','#B84371'],'Perfil':['#EDEDEA','#3A3A38']};

export { PERMS, ALLP, BASE, ITYPE };
