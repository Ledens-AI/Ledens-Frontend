# Ledens Capital · especificación de traspaso

Estado: borrador para desarrollo · 27/10/2026
Diseño: https://claude.ai/artifact/PgmGZJaYfYqs4ge7Tb5Muq (copia en `project/`)

## 1. Qué es

La división de inversión de Ledens. Una plataforma **privada y solo por invitación**: un grupo cerrado de inversores participa en operaciones inmobiliarias que Ledens busca, estructura, ejecuta y gestiona (Málaga y Costa del Sol). No es un crowdfunding público: no hay registro abierto ni información indexable.

Hay dos interfaces separadas sobre un mismo registro de verdad:

- **Área del inversor** (partícipe): solo ve sus datos y las operaciones a las que ha sido invitado.
- **Back-office** del equipo Ledens, con permisos por función.

Instrumento previsto: **contrato de cuentas en participación** (arts. 239–243 del Código de Comercio). El **gestor** es la sociedad que opera (una del grupo Ledens o una sociedad vehículo por operación). El **partícipe** aporta capital y participa en el resultado según su contrato. El partícipe nunca figura como propietario del inmueble, socio del gestor ni titular de un instrumento transmisible.

## 2. Reglas de producto (no negociables)

1. **Lo real y lo estimado nunca se mezclan.** Cada cifra lleva su naturaleza: realizado (contabilidad conciliada) o estimado (escenario de un plan versionado). Las estimaciones van rotuladas «Estimado» y con su estilo propio (fondo `ledens-blue-050`, borde discontinuo `ledens-blue-300`).
2. **Cinco estados distintos de participación:** solicitado → asignación aprobada → compromiso firmado → pago recibido y conciliado → participación efectiva. Una inversión **no figura como activa** hasta el último. Pulsar un botón nunca la activa.
3. **Sin garantía de recuperar el capital.** Toda estructura de distribución admite resultado negativo, punto muerto, sobrecostes, retrasos, caja insuficiente, recuperación parcial y pérdida total. La pérdida asignada a un partícipe nunca supera su aportación.
4. **Los cálculos financieros viven en el backend.** El frontend solo muestra resultados calculados y versionados por el servidor. Los simuladores del diseño son la especificación de la fórmula, no la implementación.
5. **Segregación estricta:** un inversor nunca accede a contratos, identidad, aportaciones ni cartera de otro. Esto se comprueba fila a fila en el backend, como ya hacen `presupuestos` y `obras`.
6. **Auditoría inmutable** de aprobaciones financieras y cambios críticos. Las aprobaciones de asignaciones y distribuciones requieren **dos personas distintas** (cuatro ojos).
7. **Tono:** sin promesas («rentabilidad garantizada», «sin riesgo»), sin gamificación ni contadores animados. Una sola acción en rosa por pantalla.

## 3. Pantallas

| Artboard | Pantalla | Interacciones del prototipo |
|---|---|---|
| `Main` | Dirección visual y componentes | — |
| `Arquitectura` | Mapa del sitio, roles, recorridos, encaje técnico, roadmap | — |
| `Dashboard` | Panel del inversor: 7 KPI realizados + 1 estimado, flujos por trimestre, exposición, tabla de inversiones, actividad | Serie del gráfico; filtro activas / finalizadas / todas; vista previa de rol |
| `Oportunidades` | Operaciones con estado, captación, mínimo, escenario base y riesgo | Filtros por zona, estrategia, estado, duración y mínimo; estado vacío; tarjeta de acceso restringido |
| `Proyecto` | Microsite de la operación, secciones A–G | Simulador embebido (importe + escenario); antes/después en la galería |
| `Simulador` | Simulación avanzada | Proyecto venta / alquiler; modelos A, B y C/D; palancas; cascada; caja insuficiente; sensibilidad |
| `Acceso` | Landing privada, login con segundo factor, activación por invitación, solicitud de acceso, alta (paso 3) y los 8 estados de cuenta | — |
| `Compromiso` | Proceso de compromiso en 9 etapas con libro de estados | Avance y retroceso; los documentos bloquean «Continuar» hasta confirmarse uno a uno |
| `Admin` | Back-office: KPI, solicitudes a doble firma, operaciones, verificación de inversores, auditoría | Aprobar (1.ª y 2.ª firma), rechazar, deshacer; la auditoría registra cada acción |

**Pendientes de diseñar** (usar los mismos componentes): alta completa (pasos 1, 2, 4 y 5), panel de una inversión activa (avance de obra, presupuesto frente a real, informes mensuales), Mi cartera y movimientos con extracto CSV/PDF, centro de documentos, comunicaciones, perfil y seguridad, y creación de operación y modelo financiero en el back-office.

## 4. Sistema visual

Base: **Ledens Design System** (https://claude.ai/code/artifact/2c146412-b369-4133-aeee-d6599ca01e59). En producción, los tokens de `ledens/frontend/src/styles/tokens.css`.

- Navegación en tinta (`ink` #1D1D1B, activo `night-raised` #262624) y área de trabajo en `paper` sobre `ink-050`. El back-office usa `night-sunken` #161615 y la etiqueta «Back-office».
- DM Sans para el texto. **Manrope con `font-variant-numeric: tabular-nums` para toda cifra** (importes, %, fechas).
- Importes en formato español: `25.000 €`, `18,1 %`.
- Semántica de datos: realizado = `ledens-navy`; estimado = rayado `ledens-blue-300`; distribuido = `ledens-teal`; pérdida = `danger`; comprometido sin desembolsar = contorno discontinuo `ledens-blue`.
- **Oro Capital: tokens propios de la división, fuera del sistema Ledens.** Solo para el wordmark «CAPITAL», filetes de acento y la insignia «Miembro». Nunca para acciones, cifras ni estados financieros.

| Token | Valor | Uso |
|---|---|---|
| `capital-gold` | `#B8975A` | Wordmark y filete sobre ink (5,2:1) |
| `capital-gold-300` | `#D9C49A` | Texto de acento sobre ink |
| `capital-gold-700` | `#7A6234` | Único oro como texto sobre paper (5,8:1) |
| `capital-gold-050` | `#F7F2E8` | Fondo de la insignia «Miembro» |
| `capital-gold-line` | `rgba(184,151,90,0.35)` | Filetes y bordes |

- Iconos: Remix Icon 4.2 (en el prototipo están dibujados como SVG equivalentes).
- Fotografía: en el prototipo todo son marcadores. En producción, fotos reales de Ledens en Azure Blob.

## 5. Motor de cálculo (backend)

Especificación tomada de `project/Simulador.dc.html` (`run()`) y `project/Proyecto.dc.html` (`calc()`). Cada resultado se calcula sobre una **versión aprobada** del plan y de la estructura de distribución, y guarda la versión que usó.

### Entradas por operación

- `capital_total` = aportación del gestor + objetivo de partícipes (Marbella: 140.000 + 200.000 = 340.000 €).
- `pool_cap` = capital de partícipes; `share = pool_cap / capital_total`.
- **Venta:** precio de venta, presupuesto de reforma y desviación (%), duración (meses) frente a la del plan, coste por mes de retraso, gastos de salida (% del precio), gastos financieros.
- **Alquiler:** renta bruta anual, ocupación (%), gastos de explotación (% de la renta), años de tenencia, precio de salida, gastos de salida (%), gastos financieros.

### Caja distribuible `D`

- Venta: `D = precio_venta − obligaciones`. Las obligaciones son lo que no cubre el capital aportado: desviación de reforma, gastos de salida por encima de los presupuestados, gastos financieros y meses extra × coste por mes.
- Alquiler: `D = precio_salida + rentas_netas_acumuladas − gastos_salida − gastos_financieros`, con `renta_neta = renta × ocupación × (1 − gastos_explotación)`.

### Estructuras de distribución

- **A · Proporcional:** todo a prorrata de `share`, positivo o negativo.
- **B · Preferencia de capital:** 1) capital de partícipes hasta `pool_cap`; 2) capital del gestor; 3) el exceso a prorrata. Es un orden de prioridad, **no una garantía de devolución**.
- **C · Umbral:** si `D ≤ capital_total`, reparto a prorrata (pérdida compartida). Si no, `P = D − capital_total`, `P_pool = P × share`, `h = umbral_anual × años × pool_cap`, y a los partícipes `min(P_pool, h) + (1 − participación_gestor) × max(0, P_pool − h)`. El resto, al gestor.
- **D · Rentas + liquidación:** C aplicado al total, con distribuciones intermedias de renta a prorrata.
- **E · Personalizada:** pasos configurables por el administrador. Fase 2.

Para cada partícipe, `k = aportación / pool_cap`: distribución total = `k × (capital_devuelto_pool + resultado_pool)`, rentabilidad simple = total / aportación − 1, y anualizada simple = simple / años. **No se muestra anualizada si es ≤ 0.**

Valores de control (Marbella, base, aportación de 25.000 €, modelo C con umbral 8 % y 20 %): resultado del proyecto 70.000 €, a partícipes 36.141 €, distribución 29.518 € (+18,1 %). Escenario de estrés (venta 345.000 €, +30 % de reforma, 20 meses): −1.331 € (−5,3 %).

Estos casos deben ser **tests del motor**, junto con punto muerto, caja insuficiente con B y pérdida total.

## 6. Datos (propuesta)

Esquema nuevo **`capital`** en la misma PostgreSQL. No toca `public` (usuarios, presupuestos) ni `ledens.*` (contabilidad, propiedad de otra herramienta). Primera migración: `024_capital_*.sql`, comprobando antes los nombres que ya figuran en `schema_migrations` de producción (ver CLAUDE.md).

- `capital.members`: `user_id` → `users`, tipo (física / jurídica), estado de cuenta (`invited`, `accepted`, `pending_verification`, `pending_approval`, `approved`, `suspended`, `revoked`), MFA obligatorio.
- `capital.staff_roles`: `user_id`, rol (`super_admin`, `investment_manager`, `project_manager`, `finance_manager`, `compliance`, `investor_relations`). Se hace aparte de `users.role` para no alterar los roles de la plataforma de reformas.
- `capital.kyc_checks` y `capital.kyc_documents` (en Blob).
- `capital.projects`, `capital.project_plan_versions` (supuestos en jsonb, aprobada por / cuándo), `capital.distribution_structures` (modelo y parámetros, versionada) y `capital.project_invitations` (qué miembros ven qué operación).
- `capital.commitments`: importes solicitado, asignado y firmado; estado; marcas de tiempo por etapa.
- `capital.approvals`: doble firma, con un CHECK de que firman dos personas distintas.
- `capital.contracts`: versión y referencia del proveedor de firma.
- `capital.cash_movements`: aportación / devolución de capital / beneficio / pérdida asignada; estado `pending`, `received`, `reconciled`, `rejected`, `returned`.
- `capital.distributions`, `capital.documents` (metadatos; bytes en Blob privado, con registro de accesos), `capital.reports` y `capital.messages`.
- Auditoría: reutilizar `audit_log` o crear `capital.audit_log` solo de inserción (sin UPDATE ni DELETE para el rol de la aplicación).

## 7. API propuesta (`/api/capital/*`)

Montada en `ledens/backend/src/app.js` con su propio limitador. Toda ruta pasa por `requireAuth` y por una comprobación de pertenencia a Capital. Lectura fila a fila por `member_id`.

- Inversor: `GET /me`, `GET /portfolio`, `GET /opportunities`, `GET /projects/:id`, `POST /projects/:id/simulate` (motor del servidor), `POST /commitments`, `GET /commitments/:id`, `POST /commitments/:id/acknowledgements`, `GET /documents/:id` y `GET /statements?from&to&format=csv|pdf`.
- Back-office: `POST /admin/invitations`, `PATCH /admin/members/:id/status`, `POST /admin/projects`, `POST /admin/projects/:id/plan-versions`, `POST /admin/commitments/:id/approvals`, `POST /admin/cash-movements/:id/reconcile`, `POST /admin/distributions` y `GET /admin/audit`.

Reutilizable de lo que ya existe: sesiones y `requireAuth` (`src/auth/sessions.js`), el flujo de invitación por enlace con token hasheado (`src/invitaciones/`), la cola de notificaciones por email (`NOTIFICATIONS.md`), el almacenamiento en Blob (`src/obras/storage.js`) y la comprobación de origen en los POST.

## 8. Despliegue

El frontend de Capital es **una app aparte** (otro Static Web App y otro dominio), desarrollada en paralelo. Hay que resolverlo antes de conectar:

- **Un Container App solo puede enlazarse como backend a un Static Web App** (comprobar en la documentación de Azure SWA «linked backends»). Hoy `ledens-backend` está enlazado a `swa-ledens` y rechaza llamadas directas con 401. Opciones: a) un segundo Container App con la misma imagen (por ejemplo `ledens-capital-api`), enlazado al SWA de Capital; b) un API propio para Capital.
- **Cookie de sesión:** `ledens_session` es `sameSite=lax` y va ligada al host del SWA. Con un dominio distinto, la sesión de Capital es independiente de la de reformas, lo que es aceptable y probablemente deseable.
- **MFA:** el backend actual no lo tiene. Es requisito de la fase 1 de Capital (TOTP o WebAuthn), o pasar a Microsoft Entra External ID.

## 9. Fase 1 · MVP

Acceso por invitación con MFA; alta con KYC (revisión manual al principio); oportunidades, ficha y simulador con escenarios fijos del plan; solicitud → asignación a doble firma → contrato (firma con proveedor externo o, al principio, contrato subido y verificado por Ledens) → instrucciones de pago → **conciliación manual**; cartera, documentos y avisos; auditoría.

Fuera de la fase 1: el editor de estructuras E, el cálculo y pago automático de distribuciones, la conciliación automática con el puente bancario y la analítica avanzada.

## 10. Decisiones abiertas

1. ¿Backend de Capital dentro de `ledens/backend` (recomendado: reutiliza auth, invitaciones, Blob, notificaciones y Postgres) o en un servicio aparte?
2. ¿Segundo Container App con la misma imagen, o código separado?
3. ¿MFA propio (TOTP/WebAuthn) o Entra External ID?
4. Proveedor de firma electrónica y de KYC.
5. ¿El gestor es una sociedad por operación (como «Ledens Marbella I, S.L.» en el prototipo) o una sola sociedad?
6. Validación legal de las estructuras A–D antes de publicar ninguna operación real.
