// Ledens Tools permissions. Like the rest of the platform, permissions follow
// the role (users.role); the keys are the ones the admin user screen lists
// (frontend plataforma/data.js, group «Herramientas»). The backend is the only
// authority: every service method checks them, whatever the screen shows.
export const TOOL_PERMS = [
  'tools.read', // see the tools of one's own obras and the availability one may consult
  'tools.read.all', // see the whole company's inventory, with every location and custodian
  'tools.manage', // register, edit, retire, label; economic data (cost, supplier, invoice)
  'tools.request', // ask for tools for an obra
  'tools.requests.approve', // approve / reject / prepare / dispatch requests; reserve directly
  'tools.transfer', // send tools that are in one's obras or custody
  'tools.receive', // confirm receptions addressed to oneself or one's obras
  'tools.maintenance.report', // report breakdowns, losses, missing accessories
  'tools.maintenance.manage', // open and close maintenance, resolve incidents
  'tools.audit.read', // full history including corrections
];

const BY_ROLE = {
  admin: TOOL_PERMS,
  jefe: ['tools.read', 'tools.request', 'tools.transfer', 'tools.receive', 'tools.maintenance.report'],
  client: [], // no access to Ledens Tools in the MVP
};

export const permissionsOf = (user) => BY_ROLE[user?.role] || [];
export const can = (user, perm) => permissionsOf(user).includes(perm);
