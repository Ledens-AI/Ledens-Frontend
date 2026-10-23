# Gestión financiera de proyectos

Módulo de la plataforma (`/plataforma`) para imputar a proyectos los registros contables
de materiales, pagos a trabajadores y pagos de clientes, y para consultar la rentabilidad de
cada proyecto. Lo usan los **jefes de obra** (`users.role = 'jefe'`) y los **administradores**
(`admin`). Los clientes no ven el módulo y la API les devuelve 403.

## 1. Punto de partida (inspección del 23 oct 2026)

| Aspecto | Situación encontrada |
|---|---|
| Frontend | React 18 + Vite. `/plataforma` es un único componente (`Plataforma.jsx`) con estilos inline del diseño de Claude Design. No hay librería de componentes ni de gráficos. |
| Autenticación | Sesiones propias en PostgreSQL (cookie `ledens_session`). No se ha tocado. |
| Roles | `users.role` ∈ `admin`, `jefe`, `client`. Se exige con `requireRole()` en `src/auth/sessions.js`. |
| Backend | Express 4. Migraciones SQL numeradas en `src/db/migrations`, que se aplican al arrancar. |
| Base de datos | Esquema `ledens`. Lo crea y mantiene el proceso de importación contable, que no está en este repo. |
| Migraciones externas | Producción también tiene aplicadas `004_ledens_business` … `009_revolut_daily_sync`, en la misma tabla `schema_migrations`. Por eso la nueva es la **010**. |

### Nombres reales de las tablas

Los nombres que se usan en el negocio no coinciden con los de la base de datos:

| Nombre de negocio | Tabla real | Columna «Importe» |
|---|---|---|
| FactMateriales | `ledens.material_expenses` | `total` |
| FactPagoTrabajadores | `ledens.worker_payments` | `amount` |
| FactPagoClientes | `ledens.customer_payments` | `total` |
| FactDocumentos | `ledens.documents` | `total` |
| Proyectos | `ledens.projects` (+ `customers`, `project_statuses`) | — |
| Conciliación | `ledens.bank_document_allocations`, vistas `v_bank_balances` y `v_document_balances` | — |

Las tres tablas de registros **ya tenían** `project_id uuid → ledens.projects(id)`. No ha hecho
falta añadir esa columna ni modificar las tablas contables.

## 2. Modelo de datos (migración `010_finanzas_imputacion.sql`)

- **Asignación simple**: se escribe `project_id` en la propia fila de origen.
- **`ledens.project_allocations`**: reparte un registro entre varios proyectos por importe.
  - Columnas: `source_type`, `source_id`, `project_id`, `amount`, `pct`, `origin`, `assigned_by`, `assigned_at`.
  - Un registro repartido tiene `project_id = NULL`, y el importe original no se toca.
  - **Invariante**, comprobada por un trigger diferido en la propia base de datos:
    - cada parte tiene el mismo signo que el registro;
    - la suma de las partes no supera el importe del registro;
    - un registro no puede estar repartido y tener a la vez `project_id`.
  - Si la suma es menor que el importe, el registro queda en estado «Distribución parcial» y sigue
    apareciendo en pendientes.
- **`ledens.imputation_reviews`**: guarda «Marcar para revisión» y las **sugerencias**. Una
  sugerencia nunca escribe `project_id`.
- **`ledens.imputation_audit`**: registra cada cambio con:
  - el registro;
  - el proyecto anterior y el nuevo (o la distribución anterior y la nueva);
  - el usuario y la fecha y hora;
  - el origen (`manual` o `automatica`);
  - el motivo.

  Además se escribe una línea en `audit_log`, que aparece en la pantalla de Auditoría del admin.

La migración también funciona en una base de datos local sin las tablas contables (sigue el mismo
patrón que la 004). En ese caso las claves foráneas a `ledens.projects` solo se crean si la tabla existe.

### Estado de cada registro

El estado se calcula en el servidor, por este orden:

1. **Revisión**: tiene la marca de revisión.
2. **Asignado**: tiene `project_id`, o está repartido y las partes suman el total.
3. **Distribución parcial**: está repartido, pero las partes no suman el total.
4. **Pendiente**: no tiene proyecto.

## 3. API (`/api/finanzas`, roles `admin` y `jefe`)

| Método | Ruta | Uso |
|---|---|---|
| GET | `/proyectos?q=` | Buscar proyectos por nombre, código, dirección, municipio o cliente. Devuelve `label` («Municipio — Nombre»); el uuid nunca se muestra como texto principal. |
| GET | `/resumen` | Pendientes por tipo, importe pendiente y actividad reciente. |
| GET | `/registros?pendientes=1&tipo=&estado=&proyecto=&q=&desde=&hasta=&min=&max=&orden=&dir=&pagina=&tam=` | Listado unificado. Filtros, orden y paginación se hacen en el servidor. Incluye sugerencias. |
| GET | `/registros/:tipo/:id` | Detalle: documento, enlace seguro al PDF, movimiento bancario, conciliación, distribución e historial. |
| PUT | `/registros/:tipo/:id/proyecto` | `{ projectId \| null, expectedProjectId?, reason? }`. El motivo es obligatorio si se cambia o se quita un proyecto. `expectedProjectId` evita pisar un cambio ajeno (devuelve 409). |
| PUT | `/registros/:tipo/:id/distribucion` | `{ parts: [{ projectId, amount }], reason? }`. |
| PUT | `/registros/:tipo/:id/revision` | `{ needsReview, note? }`. |
| POST | `/registros/lote` | `{ action: 'assign' \| 'review', items: [{ type, id }], projectId?, reason?, note? }`. Usa una transacción con un *savepoint* por registro y devuelve el resultado de cada uno: los que fallan no se aplican y se informa de ellos. |
| GET | `/proyectos/:id/rentabilidad` | Indicadores, costes por categoría, evolución mensual, presupuesto frente a coste, e indicadores no disponibles con su motivo. |
| GET | `/conciliacion?vista=movimientos\|documentos` | Lo pendiente de conciliar, según las vistas existentes. |

`tipo` es `material`, `trabajador` o `cliente`.

**Seguridad:**

- El navegador solo envía ids, importes y textos. Todo el SQL está fijo en el servidor (`src/finanzas/service.js`).
- La ordenación solo admite columnas de una lista blanca.
- El enlace al PDF (`documents.enlacearchivo`) solo se devuelve si es `https://*.sharepoint.com`. Para abrirlo hace falta además el inicio de sesión propio de SharePoint.
- El módulo tiene su propio límite de peticiones (240 por minuto). El general de `/api` es 30 por minuto.

## 4. Rentabilidad: qué se calcula y qué no

Las cifras se calculan **solo a partir de imputaciones confirmadas**. Un registro repartido cuenta
por sus partes; el resto cuenta por su importe completo. Nunca se cuenta un registro dos veces.

| Indicador | Fuente |
|---|---|
| Presupuesto aceptado | `budget_lines` de la última versión `accepted` de cada presupuesto del proyecto, más las líneas heredadas sin versión. |
| Materiales imputados | `material_expenses.total` |
| Pagos a trabajadores | `worker_payments.amount`. Es lo **pagado**; la pantalla lo indica así. |
| Cobros recibidos | `customer_payments.total`. Es un **cobro**, no un ingreso reconocido. |
| Margen previsto | Presupuesto − coste imputado. Se calcula frente al presupuesto, no frente a ingresos. |

**No disponibles.** La pantalla los muestra con su motivo en lugar de estimarlos:

- **Ingresos reconocidos**: no hay facturación de venta ni certificaciones vinculadas a proyectos.
- **Margen de contribución**: depende de los ingresos reconocidos.
- **Saldo pendiente de cobro**: tampoco hay facturación por proyecto.
- **Otros costes directos**: `cash_movements` y `fixed_costs` no tienen proyecto.

Cuando exista facturación de venta por proyecto, hay que añadirla en `profitability()` y retirar
el aviso correspondiente.

## 5. Integración con la automatización de facturas

`FinanzasService.automaticImputation({ type, id, projectId, evidence })` es el punto de entrada para
el proceso de OneDrive, extracción y conciliación:

- **Sin evidencia**: solo guarda una *sugerencia*, que la persona ve como «Sugerido: … (sin confirmar)».
- **Con evidencia verificable** (por ejemplo, la referencia de obra que aparece en la factura): asigna
  con `origin = 'automatica'` y guarda la evidencia como motivo.
- **Nunca sobrescribe** una imputación existente; en ese caso devuelve 409.

La ingesta actual (`src/ingestion`) solo crea el documento (`ledens.documents`), y es idempotente por
el hash del contenido. Todavía **no crea** filas en `material_expenses`, `worker_payments` ni
`customer_payments`. Cuando se añada ese paso, tiene que ser idempotente (por ejemplo, con una clave
`documento + línea`) y llamar a `automaticImputation` en vez de escribir `project_id` directamente.

Además de las sugerencias de la automatización, la pantalla propone el proyecto al que más veces se
asignó antes ese mismo proveedor, trabajador o cliente. También es solo una sugerencia, y queda
marcada como tal.

## 6. Pruebas

```bash
cd ledens/backend
npm test
```

`test/finanzas.test.js` usa PGlite (PostgreSQL embebido) con `test/fixtures/ledens-accounting.sql`.
Ese fixture copia columnas, tipos, claves y vistas del catálogo de producción, y solo contiene datos
sintéticos. Las pruebas cubren:

- bandeja, filtros, orden y paginación;
- asignación con auditoría y conflicto 409;
- motivo obligatorio;
- lote con resultados parciales;
- reparto sin duplicar y la invariante en la base de datos;
- revisión;
- automatización: sugerencia, evidencia y que nunca sobrescribe;
- rentabilidad (presupuesto aceptado, cobros separados);
- enlace seguro;
- 401 y 403 en la API.

`test/admin.test.js` añade la prueba de roles con sesiones reales, que requiere `DATABASE_URL`.

## 7. Despliegue y verificación

1. Fusionar en `main`. Los workflows existentes reconstruyen la imagen del backend y el frontend.
2. Al arrancar, el backend aplica `010_finanzas_imputacion.sql`. Solo **añade** tablas, funciones y un
   trigger en `ledens`; no modifica ninguna tabla contable.
3. Comprobar que la migración se ha aplicado:
   ```bash
   az containerapp exec -g rg-ledens -n ledens-backend --command "npm run migrate"
   ```
4. Iniciar sesión como jefe de obra (`ana.anzola@ledens.es`) o como admin. En el menú aparece
   «Gestión financiera». Asignar un registro y comprobar que aparece en «Historial de cambios» y en
   Auditoría.
5. Iniciar sesión como cliente: el menú no muestra el módulo, y `GET /api/finanzas/resumen` devuelve 403.
