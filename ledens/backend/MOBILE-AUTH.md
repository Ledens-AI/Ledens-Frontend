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

Pruebas: `test/auth-mobile.test.js` y `test/auth-bearer.test.js`.

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
- **Escrituras**: los routers con guard de origen (presupuestos, obras, invitaciones del equipo, finanzas, finance, bridge, herramientas) usan un único middleware, `requireSameOrigin` (`src/auth/origin.js`). Una escritura pasa:
  - con el `Origin` exacto de la web. Es la regla de siempre y la única para la cookie;
  - o **sin cabecera `Origin`**, pero solo si `requireAuth` ya validó un Bearer (`req.authTransport === 'bearer'`). Es el caso de la app nativa.

  Siguen recibiendo 403:
  - un Bearer que envía un `Origin` ajeno (es un navegador);
  - las rutas públicas de aceptación de invitaciones, que pueden crear una cookie de sesión.

  Pasar el guard no concede nada más: roles, permisos por fila y «Ver como» (solo lectura) se aplican igual.

## Decisiones de seguridad

- **El limitador se comparte con la web.** Es la misma instancia de `express-rate-limit`, así que un atacante no gana intentos por usar el endpoint móvil.
- **Nunca se entrega un token a un navegador.** Cualquier `Origin` recibe 403 antes de leer las credenciales, también el nuestro. Un token legible por JavaScript anularía la protección `HttpOnly` de la cookie, y la regla cierra además el login CSRF.
- **Solo HTTPS en producción.** Se comprueba con `req.secure`, que llega por `X-Forwarded-Proto` gracias a `trust proxy`.
- **Nada sensible en los logs.** Solo se registra el id de usuario en el login y el logout correctos; nunca el token, la contraseña ni el email.
- **El token nunca va en una URL.** Solo viaja en el cuerpo de la respuesta y en la cabecera `Authorization`.
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

Requiere aprobación explícita. Las comprobaciones se hacen sin credenciales con `GET /api/auth/mobile/diagnostico`. Responde con el flag activado o no, y devuelve solo booleanos y conteos sobre la propia petición, nunca direcciones ni valores:

```bash
# Como la app: sin Origin, sin cookie, sin Authorization
curl -s https://ledens.es/api/auth/mobile/diagnostico
# Con una entrada X-Forwarded-For inventada, para ver si req.ip se puede falsificar
curl -s https://ledens.es/api/auth/mobile/diagnostico -H 'X-Forwarded-For: 203.0.113.9'
```

| Campo | Valor esperado | Si no |
|---|---|---|
| `https` | `true` | El login móvil respondería 403 «Se requiere HTTPS» |
| `authorizationHeader` (petición sin `Authorization`) | `false` | SWA inyecta `Authorization`: con el flag activo, la regla cookie + Bearer rompería la web. **No activar** |
| `originHeader` / `cookieHeader` (petición sin ellos) | `false` | Un proxy añade cabeceras; revisar antes de activar |
| `forwardedFor.ipIsFirstEntry` sin XFF propio, `ipIsInternal` | `true`, `false` | `req.ip` es un proxy de Azure: el limitador de login (10 / 15 min) sería **global** para todos los usuarios |
| con XFF inventado: `ipIsFirstEntry` | `false` | `req.ip` sale de una cabecera que controla el cliente: el limitador se podría esquivar |
| `replica` en varias llamadas | uno o varios ids | Con N réplicas, cada una guarda su propio contador en memoria: el límite efectivo es N × 10 |

Además, una vez activado el flag, hay que comprobar desde la app (o con `curl`) que la app nativa no envía `Origin`.
