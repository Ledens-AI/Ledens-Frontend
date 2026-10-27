// The backend answers in Spanish ({ error: '...' }). In Spanish we show its
// text as is; in English we swap the messages a client can see for their
// translation, and anything unknown for the caller's English fallback.
const EN = {
  'Registro/login no disponible todavía': 'Sign-up and login are not available yet.',
  'Demasiados intentos. Inténtalo de nuevo en unos minutos.': 'Too many attempts. Please try again in a few minutes.',
  'Nombre requerido': 'Please enter your name.',
  'Email no válido': 'Please enter a valid email.',
  'La contraseña debe tener al menos 8 caracteres': 'The password must be at least 8 characters long.',
  'Ese email ya está registrado': 'That email is already registered.',
  'No se pudo crear la cuenta': 'The account could not be created.',
  'Credenciales incorrectas': 'Incorrect email or password.',
  'No se pudo iniciar sesión': 'Could not log in.',
  // /api/presupuestos — the ones a client can run into
  'Presupuestos no disponibles todavía': 'Quotes are not available yet.',
  'Presupuesto no encontrado': 'Quote not found.',
  'Versión no encontrada': 'Version not found.',
  'No puedes comentar este presupuesto': 'You can’t comment on this quote.',
  'Solo el cliente puede decidir sobre su presupuesto': 'Only the client can decide on their quote.',
  'Este presupuesto ya está cerrado: aprobado o rechazado': 'This quote is already closed: approved or rejected.',
  'Este presupuesto ya no espera tu decisión': 'This quote is no longer waiting for your decision.',
  'Hay una versión más reciente de este presupuesto. Recárgalo.': 'There is a newer version of this quote. Please reload it.',
  'Selección de partidas no válida': 'Invalid selection of items.',
  'Solo puedes elegir partidas opcionales o pendientes de decisión de este presupuesto': 'You can only choose optional or pending-decision items of this quote.',
  'Origen no permitido': 'Origin not allowed.',
  // /api/invitaciones/aceptacion — the invitation link (InvitacionPage)
  'Invitaciones no disponibles todavía': 'Invitations are not available yet.',
  'El enlace de invitación no es válido o ha caducado': 'The invitation link is not valid or has expired.',
  'Ya tienes una contraseña: inicia sesión con ella para aceptar la invitación': 'You already have a password: log in with it to accept the invitation.',
  'Has iniciado sesión con otra cuenta. Cierra sesión y vuelve a abrir el enlace.': 'You are logged in with another account. Log out and open the link again.',
  'Entra con la cuenta del email al que se envió la invitación': 'Sign in with the account of the email the invitation was sent to.',
  'Proveedor no válido': 'Invalid sign-in provider.',
  'Acepta la invitación con Google, Microsoft o una contraseña nueva': 'Accept the invitation with Google, Microsoft or a new password.',
  'Login con Google no disponible todavía': 'Google sign-in is not available yet.',
  'Login con Microsoft no disponible todavía': 'Microsoft sign-in is not available yet.',
  'No autenticado': 'You are not logged in.',
};

export function apiErrorText(msg, lang, fallbackEn = 'Something went wrong. Please try again.') {
  if (lang !== 'en') return msg;
  const clean = String(msg || '').trim();
  return EN[clean] || EN[clean.replace(/\.$/, '')] || fallbackEn;
}
