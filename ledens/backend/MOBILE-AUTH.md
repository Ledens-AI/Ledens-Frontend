# Autenticación de Ledens Mobile

Ledens Mobile (React Native + Expo) usa **el mismo sistema de usuarios y sesiones que la web**: tablas `users` y `sessions`, caducidad fija de 30 días y la misma revocación. No hay JWT ni un segundo sistema de identidad. Lo único que cambia es el transporte del token:

| Cliente | Cómo recibe el token | Cómo lo envía |
|---|---|---|
| Web | Cookie `ledens_session` (`HttpOnly`, `SameSite=Lax`) | Cookie automática |
| Mobile | Cuerpo JSON de `POST /api/auth/mobile/login` | `Authorization: Bearer <token>` |

Todo está desactivado mientras `MOBILE_AUTH_ENABLED` no valga exactamente `true` (por defecto no está definida).

Código:
- `src/routes/mobileAuth.js`: rutas de login y logout.
- `src/auth/credentials.js`: verificación y limitador compartidos con la web.
- `src/auth/sessions.js`: `readSessionCredential` y `requireAuth`.
- `src/auth/origin.js`: `requireSameOrigin`, el guard de origen (CSRF) común a todos los routers con escrituras.

Pruebas: `test/auth-mobile.test.js`, `test/auth-bearer.test.js` y `test/origin-guard.test.js`.

## Contratos

### `POST /api/auth/mobile/login`

```http
POST /api/auth/mobile/login
Content-Type: application/json

{ "email": "persona@ejemplo.es", "password": "••••••••" }
```

| Estado | Cuerpo | Cuándo |
|---|---|---|
| 200 | `{ token, tokenType: "Bearer", expiresAt, user: { id, email, name, role, created_at } }` | Credenciales correctas |
| 401 | `{ error: "Credenciales incorrectas" }` | Contraseña incorrecta, email inexistente o entrada mal formada (siempre la misma respuesta) |
| 429 | `{ error: "Demasiados intentos. Inténtalo de nuevo en unos minutos." }` | Más de 10 intentos en 15 min desde la misma IP, sumando login web y móvil |
| 403 | `{ error: "Origen no permitido" }` | La petición trae cabecera `Origin` (es un navegador) |
| 403 | `{ error: "Se requiere HTTPS" }` | Producción y la petición no llegó por HTTPS |
| 404 | `{ error: "No encontrado" }` | `MOBILE_AUTH_ENABLED` no vale exactamente `true` |
| 503 | `{ error: "Login no disponible todavía" }` | Sin base de datos |

Todas las respuestas llevan `Cache-Control: no-store` y **ninguna** lleva `Set-Cookie`.

### `POST /api/auth/mobile/logout`

```http
POST /api/auth/mobile/logout
Authorization: Bearer <token>
```

| Estado | Cuerpo | Cuándo |
|---|---|---|
| 200 | `{ ok: true }` | Sesión borrada. Idempotente: un token desconocido o caducado también recibe 200 |
| 401 | `{ error: "No autenticado" }` | Sin `Authorization`, cabecera mal formada, o cualquier cookie de sesión (sola o junto a Bearer) |
| 403 / 404 / 503 | igual que el login | |

Esta ruta nunca toca una sesión de cookie. La web sigue usando `POST /api/auth/logout`.

### El resto de la API

La app envía `Authorization: Bearer <token>` y **ninguna cookie**: en React Native, `fetch` con `credentials: 'omit'`.
- `GET /api/auth/me` devuelve el mismo objeto `user` que en la web.
- Todos los routers protegidos con `requireAuth` aplican los mismos roles y permisos que con cookie.
- Cookie de sesión y Bearer a la vez → `401`.
- Escrituras (todo lo que no es `GET`, `HEAD` u `OPTIONS`) en los siete routers con guard de origen (presupuestos, obras, invitaciones, herramientas, finanzas, finance y bridge): pasan todas por el mismo middleware, `requireSameOrigin` (`src/auth/origin.js`). La app **no envía `Origin`** y escribe con su Bearer.

Regla de `requireSameOrigin`, en este orden:

| Petición de escritura | Resultado |
|---|---|
| Cookie, o sin credencial | `Origin` debe ser exactamente `CORS_ORIGIN`; si no, `403` con el cuerpo de siempre de cada router |
| Bearer validado por `requireAuth`, flag activado, **sin** `Origin` | Pasa |
| Bearer validado con `Origin` igual a `CORS_ORIGIN` | Pasa |
| Bearer validado con cualquier otro `Origin` (también `null`) | `403` |
| Cualquier petición con `MOBILE_AUTH_ENABLED` distinto de `true` | Regla de la cookie: sin `Origin` correcto, `403` (o `401` antes, si no hay sesión) |
| `CORS_ORIGIN` sin definir | `403` siempre |
| Cookie y `Authorization` a la vez, o Bearer mal formado | `401 { error: "No autenticado" }` en `requireAuth`, antes del guard |

Cuerpos del `403`, sin cambios: `{ error: "Origen no permitido" }` en presupuestos, obras, invitaciones, herramientas y finanzas; `{ error: "invalid_origin" }` en finance y bridge.

Orden por router: el guard va siempre **después** de `requireAuth` (y de «Ver como» y del rol), salvo en invitaciones, cuyas rutas públicas `/aceptacion/*` no tienen sesión. Allí se divide en dos: antes de autenticar, `requireSameOriginBeforeAuth` responde igual que hoy a toda petición con cookie o anónima y solo deja seguir, sin comprobar, a la que no trae `Origin` y sí un Bearer bien formado (flag activado, sin cookie); después, `requireSameOrigin` completo: tras `requireAuth` en `/aceptacion/sesion` y en `/obras/*`, y sin autenticación en `consultar`, `contrasena` y `proveedor`, donde, al no haber `req.user`, se exige el `Origin` de la web aunque venga un Bearer. La app no puede aceptar una invitación con contraseña o con Google/Microsoft; sí con su sesión (`/aceptacion/sesion`).

## Decisiones de seguridad

- **El limitador se comparte con la web.** Es la misma instancia de `express-rate-limit`, así que un atacante no gana intentos por usar el endpoint móvil.
- **Nunca se entrega un token a un navegador.** Cualquier `Origin` recibe 403 antes de leer las credenciales, también el nuestro. Un token legible por JavaScript anularía la protección `HttpOnly` de la cookie, y la regla cierra además el login CSRF.
- **Solo HTTPS en producción.** Se comprueba con `req.secure`, que llega por `X-Forwarded-Proto` gracias a `trust proxy`.
- **Nada sensible en los logs.** Solo se registra el id de usuario en el login y el logout correctos; nunca el token, la contraseña ni el email.
- **El token nunca va en una URL.** Solo viaja en el cuerpo de la respuesta y en la cabecera `Authorization`.
- **La excepción de origen es solo para un Bearer validado.** `requireSameOrigin` nunca lee la cabecera `Authorization`: exige `req.authTransport === 'bearer'` y `req.user`, que solo pone `requireAuth` tras encontrar una sesión viva, y `MOBILE_AUTH_ENABLED=true` en esa petición. La mera presencia de la cabecera no exime de nada. Es seguro porque el CSRF necesita una credencial que el navegador añada solo (la cookie): un navegador nunca añade nuestro Bearer, una web ajena no puede poner `Authorization` sin un preflight CORS que solo pasa `CORS_ORIGIN`, y cookie más Bearer es `401`, así que una petición «bearer» no lleva sesión de cookie.
- **Un Bearer con `Origin` sigue necesitando el nuestro.** Un navegador siempre envía `Origin` en una escritura y nunca debería tener un token móvil (el login móvil rechaza cualquier `Origin`); si llega uno ajeno junto a un Bearer, algo va mal y se rechaza. El `Origin` nunca se reescribe ni se inventa.
- **Las peticiones anónimas no tienen excepción.** Las rutas públicas de invitaciones siguen exigiendo el `Origin` de la web.
- **`HEAD` y `OPTIONS` pasan como `GET`.** Antes los guards en línea solo dejaban pasar `GET`, así que un `HEAD` recibía `403`. Son métodos seguros (Express responde a `HEAD` con el manejador `GET`) y el preflight `OPTIONS` lo responde antes `cors()`.
- **bridge ya no deja escribir sin `CORS_ORIGIN`.** Su copia en línea comparaba con `process.env.CORS_ORIGIN` sin comprobar que existiera: con la variable sin definir, una escritura sin `Origin` pasaba. Ahora, como el resto, `403`.
- **Revocación inmediata.** El logout borra la fila. Una contraseña nueva o una invitación borran todas las sesiones del usuario, web y móviles.

## Probar en local

1. Arranca PostgreSQL:
   ```bash
   cd ledens && docker compose up -d db
   ```
2. Arranca el backend con el flag activado (solo en local):
   ```bash
   cd ledens/backend
   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens MOBILE_AUTH_ENABLED=true npm run dev
   ```
3. Crea un usuario de prueba (la contraseña temporal se imprime una vez):
   ```bash
   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm run users -- create prueba@example.com client "Usuario Prueba"
   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm run users -- set-password prueba@example.com
   ```
4. Login, `me` y logout con `curl`, sin cabecera `Origin`, como haría la app. Guarda el token en una variable de la shell y no lo pegues en ningún sitio:
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/mobile/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"prueba@example.com","password":"<contraseña>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
   curl -s http://localhost:4000/api/auth/me -H "Authorization: Bearer $TOKEN"
   curl -s -X POST http://localhost:4000/api/auth/mobile/logout -H "Authorization: Bearer $TOKEN"
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/api/auth/me -H "Authorization: Bearer $TOKEN"   # 401
   ```
5. Pruebas automatizadas, con la base de datos local:
   ```bash
   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens node --test test/auth-mobile.test.js test/auth-bearer.test.js test/auth.test.js
   ```

Desde un móvil físico, usa la IP LAN del equipo (`http://192.168.x.x:4000`). Es HTTP plano y solo vale en local, porque fuera de `NODE_ENV=production` no se exige HTTPS.

## Antes de activar el flag en producción

Requiere aprobación explícita. Hay que comprobar, en este orden:

1. Las peticiones web que SWA reenvía al Container App no traen `Authorization`; si la trajeran, la regla de cookie y Bearer juntos rompería la web.
2. Detrás de SWA y ACA, `req.secure` es `true`; si no, el login móvil devolverá 403 «Se requiere HTTPS».
3. `req.ip` es la IP real del cliente y no la del proxy; si no, el limitador de 10 intentos sería global para todos los usuarios.
4. La app nativa no envía `Origin`.
