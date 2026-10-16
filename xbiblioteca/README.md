# XBiblioteca — biblioteca personal de publicaciones de X

Aplicación web (PWA) para **guardar, clasificar y consultar publicaciones de X** desde la PC y el celular, con sincronización automática, categorías propias, etiquetas, favoritos, estados de lectura, búsqueda, panel de estadísticas y copias de seguridad.

**Costo de funcionamiento: $0.** Sin tarjeta de crédito, sin pruebas temporales, sin API paga de X, sin scraping, sin dependencias externas en el navegador.

> Investigación verificada el 16-oct-2026. Los planes gratuitos cambian: revisá la sección [Limitaciones y riesgos](#7-limitaciones-y-riesgos-de-costos-futuros) una vez al año.

---

## Índice
1. [Comparación de alternativas gratuitas](#1-comparación-de-alternativas-gratuitas)
2. [Arquitectura elegida (costo $0)](#2-arquitectura-elegida-costo-0)
3. [Puesta en marcha paso a paso](#3-puesta-en-marcha-paso-a-paso)
4. [Uso desde PC y celular](#4-uso-desde-pc-y-celular)
5. [Respaldo y restauración](#5-respaldo-y-restauración)
6. [Seguridad](#6-seguridad)
7. [Limitaciones y riesgos de costos futuros](#7-limitaciones-y-riesgos-de-costos-futuros)
8. [Funciones de la app](#8-funciones-de-la-app)
9. [Estructura del código y formato de datos](#9-estructura-del-código-y-formato-de-datos)
10. [Solución de problemas](#10-solución-de-problemas)

---

## 1. Comparación de alternativas gratuitas

### Base de datos + autenticación (sincronización)

| Opción | ¿Tarjeta? | Límites del plan gratis | Problema principal | Veredicto |
|---|---|---|---|---|
| **Supabase Free** | **No** | 500 MB de Postgres, 50.000 usuarios/mes, 5 GB de transferencia, 500.000 invocaciones de Edge Functions, 2 proyectos activos | **Se pausa tras ~7 días con poca actividad** (los datos no se borran; se reactiva gratis desde el panel) | ✅ **Elegida.** Postgres estándar (exportable), seguridad por filas (RLS), sin forma de generar cargos si no cargás tarjeta |
| Firebase Spark | No | Firestore 1 GiB, 50.000 lecturas y 20.000 escrituras por día | Base NoSQL propietaria (más dependencia del proveedor). Cloud Storage y Cloud Functions ya requieren el plan Blaze con tarjeta | ✅ Plan B válido: **no se pausa**. Requeriría reescribir la capa de sincronización |
| Appwrite Cloud Free | No | 2 proyectos, 75.000 usuarios | Se pausa a los 7 días **sin actividad de desarrollo en la consola** (no alcanza con usar la app) y desde jun-2026 borra proyectos pausados 90 días | ❌ Descartada |
| PocketBase autohospedado | No | Sin límites (tu hardware) | Necesita una máquina encendida y accesible; exponerla a Internet de forma segura no es trivial | ✅ Alternativa 100 % propia (ver §7) |
| Solo local (sin nube) | No | Espacio del navegador | No sincroniza: cada dispositivo es independiente | ✅ **Incluida en la app** como "modo local" |
| Neon / Turso / PlanetScale | — | — | Solo base de datos, sin autenticación integrada (habría que montar un backend). PlanetScale eliminó su plan gratis | ❌ No aportan sobre Supabase |

### Alojamiento de la app (archivos estáticos)

| Opción | ¿Tarjeta? | Límites | Nota |
|---|---|---|---|
| **GitHub Pages** | **No** | Sitio ≤ 1 GB, ~100 GB/mes de tráfico (límite blando) | ✅ **Elegida.** Requiere repositorio **público** en la cuenta gratuita: no es problema porque el código no contiene secretos |
| Cloudflare Pages | No | Ancho de banda ilimitado, 500 builds/mes | ✅ Alternativa si querés repositorio privado |
| Netlify / Vercel | No | Créditos / uso no comercial | Funcionan, pero con más condiciones |

### Obtención de datos de X

| Opción | Costo | Veredicto |
|---|---|---|
| API de X (v2) | Los niveles útiles son pagos | ❌ No se usa |
| Scraping de x.com | Gratis, pero viola las condiciones de X | ❌ No se usa |
| **oEmbed oficial** (`publish.twitter.com/oembed`) | **Gratis, sin autenticación**, es el mecanismo público de X para insertar publicaciones | ✅ Se usa para traer texto y autor. Como no permite llamadas directas desde el navegador (CORS), se consulta desde una Edge Function de Supabase |
| ID de la publicación | Gratis, sin red | ✅ La fecha exacta y el usuario se calculan del propio enlace |

---

## 2. Arquitectura elegida (costo $0)

```
 PC (navegador)            Celular (PWA instalada)
 ┌───────────────┐         ┌───────────────┐
 │ XBiblioteca   │         │ XBiblioteca   │   ← archivos estáticos servidos
 │ IndexedDB     │         │ IndexedDB     │     por GitHub Pages (gratis)
 └──────┬────────┘         └──────┬────────┘
        │  HTTPS + sesión del usuario (JWT)
        ▼                         ▼
 ┌──────────────────────────────────────────┐
 │ Supabase Free (sin tarjeta)              │
 │  • Auth: email + contraseña (registro    │
 │    público desactivado: solo vos)        │
 │  • Postgres: posts, categories + RLS     │
 │  • Edge Function x-oembed ──────────────────► publish.twitter.com/oembed (oficial, gratis)
 └──────────────────────────────────────────┘
```

**Principios de diseño**

- **Local primero.** Todo se guarda al instante en el dispositivo (IndexedDB). La app funciona sin conexión y la nube es una copia sincronizada. Si Supabase se pausara o desapareciera, **no perdés nada** y seguís usando la app.
- **Sincronización automática** al abrir la app, al volver a ella, al recuperar conexión, cada 2 minutos y tras cada cambio. Gana la edición más reciente; los borrados se propagan (borrado lógico).
- **Sin librerías externas** en el navegador: el cliente de Supabase está escrito a mano con `fetch` (≈150 líneas). Ningún script de terceros puede leer tus datos.
- **Datos portables:** Postgres estándar + exportación JSON/CSV documentada.

**Costo estimado: $0/mes.** Ningún servicio usado tiene tarjeta asociada, por lo que no existe un mecanismo por el cual se te pueda cobrar. Si alguna vez superaras un límite, el servicio se limita o se pausa; no factura.

---

## 3. Puesta en marcha paso a paso

Tiempo estimado: 20–30 minutos. Solo necesitás un email.

### Paso 0 · (Opcional) Probarla en tu PC antes de publicar
Los módulos JavaScript no funcionan abriendo `index.html` con doble clic; hace falta un servidor local. Con Python instalado:
```bash
cd xbiblioteca
python -m http.server 8000
```
Abrí `http://localhost:8000`. Funciona en **modo local** (sin sincronización).

### Paso 1 · Publicar la app en GitHub Pages
1. Creá una cuenta gratuita en <https://github.com> (no pide tarjeta).
2. **New repository** → nombre `xbiblioteca` → **Public** → *Create repository*.
3. En el repositorio: **Add file → Upload files** → arrastrá **el contenido** de la carpeta `xbiblioteca` (incluida la carpeta `.github` si querés el keep-alive opcional; si el explorador no la muestra, activá "mostrar archivos ocultos") → *Commit changes*.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main**, carpeta **/ (root)** → *Save*.
5. En 1–2 minutos tu app estará en `https://TU-USUARIO.github.io/xbiblioteca/`.

### Paso 2 · Crear el proyecto en Supabase (gratis, sin tarjeta)
1. Registrate en <https://supabase.com> (podés entrar con GitHub). **No agregues ningún método de pago.**
2. **New project** → plan **Free** → región **South America (São Paulo)** (la más cercana a Buenos Aires) → elegí una contraseña de base de datos y guardala.
3. Cuando el proyecto esté listo: **SQL Editor → New query** → pegá el contenido completo de `supabase/schema.sql` → **Run**. Debe terminar sin errores (se puede ejecutar de nuevo sin problema).

### Paso 3 · Crear tu usuario y cerrar el registro
1. **Authentication → Users → Add user → Create new user** → tu email y una contraseña fuerte → marcá **Auto Confirm User** → *Create*.
2. **Authentication → Sign In / Providers** (en algunas versiones: *Providers → Email*) → **desactivá "Allow new users to sign up"** → *Save*.
   Así nadie más puede crear una cuenta en tu proyecto.

### Paso 4 · Crear la función que trae el texto de X (recomendado)
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: **`x-oembed`** (exactamente así).
3. Borrá el código de ejemplo, pegá el contenido de `supabase/functions/x-oembed/index.ts` → **Deploy function**.
4. Dejá activada la verificación de JWT. Si al guardar una publicación aparece "Sesión inválida" o 401 de forma persistente, desactivá *Enforce JWT verification* en los ajustes de la función: el código igual verifica tu sesión por su cuenta.
5. (Opcional) En **Edge Functions → Secrets** agregá `ALLOWED_ORIGIN` = `https://TU-USUARIO.github.io` para restringir desde qué sitio se puede llamar.

> Sin este paso la app funciona igual: el usuario y la fecha se completan solos y el texto lo pegás a mano.

### Paso 5 · Conectar la app
1. En Supabase: **Project Settings → API Keys** (o *Data API*). Copiá:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **Publishable key** (`sb_publishable_…`) o, en proyectos antiguos, la clave **anon**.
   - ⚠️ **Nunca** copies la *secret key* ni la *service_role*. La app las rechaza.
2. Abrí tu app → **Ajustes** → pegá URL y clave → **Guardar configuración** → iniciá sesión con el usuario del paso 3.
3. Listo: lo que tenías en modo local se sube automáticamente.

---

## 4. Uso desde PC y celular

### Configurar el segundo dispositivo
En la PC: **Ajustes → "Copiar enlace de configuración para otro dispositivo"**, mandátelo (por ejemplo, por WhatsApp a vos mismo) y abrilo en el celular. Solo tenés que iniciar sesión. El enlace contiene la URL y la clave **pública**, nunca tu contraseña.

### Instalar como app
- **Android (Chrome/Edge):** abrí la app → **Ajustes → Instalar** (o menú ⋮ → *Instalar app*).
- **iPhone (Safari):** botón Compartir → **Agregar a pantalla de inicio**.
- **PC (Chrome/Edge):** icono de instalar en la barra de direcciones.

### Guardar con "Compartir" en Android
Con la app instalada, en la app de X: **Compartir → XBiblioteca**. Se abre el formulario con el enlace y, si configuraste la función, el texto y el autor ya completos. Elegí categorías y tocá **Guardar**.

### Guardar con "Compartir" en iPhone (Atajo gratuito de Apple)
iOS no permite que una web aparezca en el menú Compartir, así que se usa la app **Atajos** (incluida en iOS):
1. Atajos → **+** → nombre "Guardar en XBiblioteca".
2. Tocá el ícono de información (ⓘ) → activá **Mostrar en hoja para compartir** → tipos: **URL** y **Texto**.
3. Agregá la acción **Abrir URL** y escribí: `https://TU-USUARIO.github.io/xbiblioteca/?url=` y a continuación insertá la variable **Entrada del atajo**.
4. Desde X: Compartir → **Guardar en XBiblioteca**.

Alternativa sin atajo: en X "Copiar enlace" → en la app tocá **Guardar** y pegá.

### Guardar con un clic en la PC (bookmarklet)
**Ajustes → Guardado rápido**: arrastrá el botón "＋ Guardar en XBiblioteca" a la barra de marcadores. Estando en una publicación de x.com, hacé clic y se abre la app con todo completo.

### Guardado instantáneo al compartir (celular)
Por defecto, **Compartir → XBiblioteca** (Android) o el Atajo (iPhone) guardan la publicación **al instante, sin formulario**: aparece "✓ Guardada", el texto y el autor se completan solos y podés tocar categorías ahí mismo (opcional). Para volver al formulario completo: Ajustes → Guardado rápido → desactivar *Guardar al instante al compartir*.

### Botón "Guardar" dentro de x.com (PC) — extensión gratuita
La carpeta `xbiblioteca-extension` agrega un botón con forma de marcador en cada publicación de x.com. Un clic la guarda en tu biblioteca (con texto y autor vía oEmbed), y un aviso te deja elegir categorías.
1. Descomprimí `xbiblioteca-extension.zip` en una carpeta que no vayas a borrar (por ejemplo, Documentos).
2. En Chrome abrí `chrome://extensions` (en Edge: `edge://extensions`) y activá **Modo de desarrollador**.
3. **Cargar descomprimida** → elegí la carpeta `xbiblioteca-extension`.
4. Fijá la extensión (ícono de pieza de rompecabezas → 📌) y tocala: pegá la **clave pública** (la URL ya viene cargada) → Guardar → iniciá sesión.
5. Opcional: elegí una **categoría automática**. Recargá x.com.

No se publica en la tienda de Chrome (que cobra USD 5): se usa en modo desarrollador, gratis. Del sitio solo toma el enlace de cada publicación. Si X cambia su diseño y el botón deja de aparecer, hay que ajustar `content.js`. Chrome puede mostrar un aviso sobre extensiones en modo desarrollador: es normal.

### Atajos de teclado
`/` abre la búsqueda.

---

## 5. Respaldo y restauración

> El plan Free de Supabase **no incluye copias de seguridad automáticas descargables**. Tu respaldo real son los archivos que exportás. Hacelo al menos una vez por semana (el panel te avisa si pasaron más de 14 días).

**Exportar** (Ajustes → Copias de seguridad):
- **Respaldo .json**: toda la biblioteca (publicaciones, notas, categorías, etiquetas, estados, fechas). Es el formato para restaurar.
- **Planilla .csv**: para abrir en Excel / Google Sheets / LibreOffice (solo lectura humana).

Guardá los `.json` en al menos dos lugares (PC + pendrive o tu nube personal).

**Restaurar / importar**:
- **Combinar** (recomendado): agrega lo que falta y actualiza lo que esté más nuevo en el archivo. Reimportar el mismo archivo no duplica nada.
- **Reemplazar todo**: borra la biblioteca actual (también en la nube al sincronizar) y deja solo el contenido del archivo.

**Respaldo adicional de la base (opcional, avanzado):** con la contraseña de base de datos del paso 2 podés hacer un volcado completo con la herramienta libre `pg_dump` usando la cadena de conexión que aparece en Supabase → *Connect*.

**Migrar a otro proveedor:** el JSON es texto abierto (formato en §9) y las tablas son Postgres estándar; podés llevarlos a cualquier otra base.

---

## 6. Seguridad

- **Row Level Security** en todas las tablas: cada fila tiene `user_id` y las políticas solo permiten leer/escribir las propias. El rol anónimo no tiene ningún permiso sobre las tablas. Probado: otro usuario autenticado no ve ni puede modificar tus datos.
- **Registro público desactivado** (paso 3): solo existe tu cuenta.
- **Sin claves secretas en el navegador:** solo se usa la clave pública (diseñada para estar en el cliente). La app rechaza claves `sb_secret_…` y `service_role`. El repositorio público no contiene ninguna clave.
- **Política de seguridad de contenido (CSP)** estricta: solo se ejecuta código propio; las conexiones solo van a tu sitio y a `*.supabase.co`. No hay scripts de terceros ni analítica.
- Los textos de X se insertan siempre como texto (nunca como HTML), por lo que una publicación no puede inyectar código.
- La Edge Function solo responde a usuarios con sesión válida de tu proyecto y solo acepta enlaces de x.com / twitter.com.
- El servidor impide cambiar el dueño de una fila e ignora versiones más viejas que la guardada.
- Riesgo residual: la sesión se guarda en el almacenamiento del navegador. No uses la app en computadoras compartidas sin cerrar sesión.

---

## 7. Limitaciones y riesgos de costos futuros

### Riesgos de costo
| Riesgo | Probabilidad | Qué hacer |
|---|---|---|
| Supabase cambia o elimina su plan gratis | Baja–media (ya lo ajustó varias veces) | Sin tarjeta **no hay cobro posible**: en el peor caso el proyecto deja de estar disponible. La app sigue funcionando en modo local con todos tus datos; exportás el JSON y migrás (Firebase Spark, PocketBase o solo local) |
| Botón "Upgrade"/"Pro" en Supabase | — | **Nunca agregues un método de pago.** El plan Pro cuesta USD 25/mes |
| GitHub Pages cambia condiciones | Baja | Subí los mismos archivos a Cloudflare Pages (gratis) |
| Dominio propio | — | No hace falta: se usa `github.io` |

### Limitaciones conocidas
- **Pausa de Supabase:** un proyecto Free con poca actividad durante 7 días se pausa (avisan por email antes). Los datos no se borran, pero mientras está pausado no sincroniza; se reactiva gratis desde el panel. Supabase fija un plazo para restaurar proyectos pausados (su documentación menciona entre 90 días y 1 año según la versión), así que no lo dejes pausado meses.
  - Si usás la app a diario, no debería pausarse.
  - **Keep-alive opcional:** el archivo `.github/workflows/keepalive.yml` hace un "ping" cada 3 días usando GitHub Actions (gratis en repos públicos). Activarlo: repo → *Settings → Secrets and variables → Actions* → crear `SUPABASE_URL` y `SUPABASE_KEY` (clave **pública**). GitHub desactiva los workflows programados de repos sin actividad durante 60 días: si te llega ese aviso, reactivalo con un clic. Supabase no documenta qué volumen exacto de actividad evita la pausa, así que esto reduce el riesgo pero no lo garantiza.
- **Capacidad:** 500 MB alcanzan para varios cientos de miles de publicaciones de texto (≈1–2 KB cada una). Si se superara, la base pasa a solo lectura.
- **oEmbed de X:** solo funciona con publicaciones públicas. Si una publicación se borra o se protege, ya no se puede traer su texto (lo que ya guardaste queda en tu biblioteca). X podría modificar o cerrar este servicio en el futuro; en ese caso pegás el texto a mano.
- **No se guardan imágenes ni videos**, solo texto y el enlace (evita costos de almacenamiento).
- **iPhone:** no hay "Compartir" nativo para webs (se usa el Atajo). En modo local, Safari puede borrar los datos de sitios no usados por 7 días si **no** está instalada en la pantalla de inicio: usá la nube o exportá respaldos.
- **Conflictos:** si editás la misma publicación en dos dispositivos sin conexión, gana la edición más reciente completa (no se combinan campos).
- Fecha calculada del enlace: válida para publicaciones desde noviembre de 2010.
- Uso personal: no redistribuyas el contenido guardado de terceros.

### Alternativa 100 % propia (si no querés depender de ninguna nube)
1. **Solo local:** usá la app sin configurar la nube y mové los datos entre PC y celular con *Exportar* / *Importar → Combinar*.
2. **PocketBase en tu PC:** servidor libre de un solo archivo con base SQLite y autenticación. Funciona en tu red Wi‑Fi doméstica. Requiere adaptar `js/cloud.js` y `js/sync.js` a su API (la estructura de sincronización es la misma).

---

## 8. Funciones de la app

- **Guardar** pegando la URL (x.com o twitter.com, también de la app móvil). Detecta duplicados.
- Campos: texto, autor, usuario, fecha de publicación, nota personal, **varias categorías**, etiquetas, favorito, estado (*Pendiente de leer / Leído / Archivado*).
- **Categorías personalizadas** con color: crear, renombrar, recolorear, eliminar (las publicaciones no se borran).
- **Búsqueda instantánea** (sin conexión, ignora acentos y mayúsculas):
  - `palabras` → todas deben aparecer (texto, nota, autor, etiquetas, categorías)
  - `@usuario`, `#etiqueta`, `cat:Economía`, `cat:"Dos palabras"`
  - `pendiente`, `leido`, `archivado`, `fav`
  - `-palabra` excluye
  - Filtros por categoría, etiqueta, estado, favoritas y 5 órdenes distintos. Resalta coincidencias.
- **Panel:** totales, pendientes, favoritas, guardadas en la semana, ranking de categorías, autores y etiquetas, actividad de 12 semanas, recientes, estado de sincronización y recordatorio de respaldo.
- **Editar y eliminar** (con confirmación; el borrado se sincroniza).
- **Exportar / importar** JSON y CSV.
- **Sin conexión:** se abre y funciona sin Internet; los cambios se suben al volver la conexión.
- Tema claro/oscuro automático.

---

## 9. Estructura del código y formato de datos

```
xbiblioteca/
├── index.html               Página única (CSP estricta)
├── config.js                Configuración opcional por defecto (vacía)
├── manifest.webmanifest     PWA + destino de "Compartir" (Android)
├── sw.js                    Service worker (uso sin conexión)
├── css/styles.css
├── js/
│   ├── app.js               Interfaz y vistas
│   ├── db.js                IndexedDB (almacenamiento local)
│   ├── cloud.js             Cliente mínimo de Supabase (Auth/REST/Functions)
│   ├── sync.js              Sincronización local ⇄ nube
│   ├── xmeta.js             Datos de X: URL, fecha por ID, oEmbed
│   ├── search.js            Motor de búsqueda
│   ├── backup.js            Exportar / importar
│   └── util.js
├── icons/
├── supabase/
│   ├── schema.sql           Tablas, RLS, triggers, keep-alive
│   └── functions/x-oembed/index.ts
└── .github/workflows/keepalive.yml   (opcional)
```

**Formato del respaldo JSON**
```json
{
  "app": "xbiblioteca", "version": 1, "exported_at": "2026-10-16T13:00:00.000Z",
  "counts": { "posts": 1, "categories": 1 },
  "categories": [ { "id": "uuid", "name": "Economía", "color": "#4f7cff",
                    "created_at": "…", "updated_at": "…", "deleted_at": null } ],
  "posts": [ { "id": "uuid", "url": "https://x.com/usuario/status/123", "tweet_id": "123",
               "author_name": "Nombre", "author_handle": "usuario", "text": "…",
               "posted_at": "…", "note": "…", "categories": ["uuid"], "tags": ["datos"],
               "favorite": false, "status": "pendiente",
               "created_at": "…", "updated_at": "…", "deleted_at": null } ]
}
```

**Pruebas realizadas antes de la entrega:** el esquema SQL se aplicó dos veces sobre PostgreSQL 16 y se verificaron las políticas RLS por rol (dueño, otro usuario, anónimo), la regla de "gana la última edición" y las restricciones. La app se probó de punta a punta en Chromium con dos dispositivos simulados (PC y celular) contra un backend con esa misma base: modo local, búsqueda, categorías, login, sincronización en ambos sentidos, "Compartir", función oEmbed, borrado sincronizado, exportación/importación y aislamiento entre usuarios (32/32 comprobaciones correctas).

---

## 10. Solución de problemas

| Mensaje / síntoma | Causa y solución |
|---|---|
| "Faltan las tablas: ejecutá schema.sql" | No corriste el paso 2.3 o hubo un error: volvé a ejecutarlo |
| "El proyecto de Supabase parece pausado" | Supabase Dashboard → tu proyecto → **Restore/Resume**. Mientras tanto la app funciona en local |
| "Email o contraseña incorrectos" | Revisá el usuario creado en el paso 3 (que esté confirmado) |
| "No encontré la función x-oembed" | Revisá el paso 4: el nombre debe ser exactamente `x-oembed` |
| "Sesión inválida" al traer el texto | Paso 4.4: desactivá *Enforce JWT verification* (la función verifica la sesión igual) |
| "Publicación no encontrada, privada o eliminada" | oEmbed solo funciona con publicaciones públicas: pegá el texto a mano |
| No aparece XBiblioteca en Compartir (Android) | Tiene que estar **instalada** desde Chrome/Edge y abierta al menos una vez |
| Cambié el código y no veo cambios | Recargá dos veces (el service worker actualiza en segundo plano) o cambiá `VERSION` en `sw.js` |
| Quiero empezar de cero en un dispositivo | Ajustes → *Borrar datos de este dispositivo* (no toca la nube) |
