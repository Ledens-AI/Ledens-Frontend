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
};

export function apiErrorText(msg, lang, fallbackEn = 'Something went wrong. Please try again.') {
  if (lang !== 'en') return msg;
  const clean = String(msg || '').trim();
  return EN[clean] || EN[clean.replace(/\.$/, '')] || fallbackEn;
}
