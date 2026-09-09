# Proyecto: Plataforma de Invitaciones Digitales

## Qué es
App multiidioma para crear y enviar invitaciones de eventos.
Mercado inicial: Líbano. Idiomas: árabe (principal, RTL), español, portugués, inglés.

## Stack
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript estricto
- Tailwind CSS 4 (configuración en CSS, `@theme` en globals.css)
- PostgreSQL vía Prisma 7 (adaptador `@prisma/adapter-pg`)
- Render de imágenes en servidor (Chromium headless vía puppeteer-core)
- Expo/React Native para la app móvil (`apps/mobile`)
- Monorepo con espacios de trabajo de npm: `apps/web`, `apps/mobile`,
  `packages/core`

## Reglas innegociables

### RTL y i18n
- PROHIBIDO: margin-left, margin-right, padding-left, padding-right,
  text-align: left/right, left:, right:, float
- OBLIGATORIO: margin-inline-start/end, padding-inline-start/end,
  text-align: start/end, inset-inline-start/end
- Los atajos simétricos (`px-`, `mx-`, `inset-`) sí están permitidos: se
  comportan igual en ambas direcciones.
- `npm run lint:rtl` verifica esta regla sobre todo `src/`. Debe pasar siempre.
- Cero strings hardcodeados. Todo en /locales/{ar,es,pt,en}.json
- El interletraje (`tracking-*`) y las mayúsculas son recursos latinos: pasan
  por `latinOnly()` porque rompen las uniones cursivas del árabe.
- Todo componente nuevo se prueba en árabe RTL antes de darse por terminado

### Contenido religioso
- Los versículos coránicos y bíblicos vienen SIEMPRE de /data/verses.json,
  una lista fija y verificada.
- NUNCA generar, completar, parafrasear ni corregir un versículo con IA.
- Si un versículo no está en la lista, no se muestra (el loader lanza error).
- Una entrada nueva solo se añade tras verificación humana contra la edición
  citada, anotando el nombre en `verifiedBy`.

### Tipografía
- Fuentes en /public/fonts, cargadas localmente
- Árabe: Amiri, Cairo, Reem Kufi
- Latino: Playfair Display, Inter
- Verificar licencia comercial antes de agregar cualquier fuente
  (las tres actuales son SIL OFL 1.1 — ver public/fonts/README.md)

### Acceso
- Sin contraseñas para el cliente final: código de un solo uso por correo.
- El superadministrador y los administradores de oficina SÍ pueden tener
  contraseña, y solo ellos: el dueño de la máquina no puede quedarse fuera
  porque se caiga un servidor de correo que no controla. Se pone con
  `npm run auth:password`, que la lee por la entrada estándar y se niega a
  dársela a un operador o a un organizador. Se guarda con scrypt, nunca con un
  hash rápido, y cinco fallos por dirección cierran la puerta quince minutos.
  Fallar la contraseña responde exactamente lo mismo que fallar un código: no
  sirve para averiguar qué direcciones existen.
- Los secretos (token de sesión, código) se guardan SIEMPRE con hash. Un volcado
  de la base de datos no puede suplantar a nadie.
- Nunca se revela si una dirección tiene cuenta. La respuesta es la misma.
- La oficina se resuelve por `x-forwarded-host`, no por `host`: en las peticiones
  de una Server Action, Next reescribe `host`. El origen debe estar detrás del
  proxy que fija esa cabecera.
- Una vez dentro, la oficina la manda la SESIÓN, no el host.
- El envío de correo entra por el puerto `Mailer`. El emisor de consola está
  prohibido en producción y el código lo impide.
- Las contraseñas de servicios (hoy SMTP) van CIFRADAS en el `.env`
  (`SMTP_PASSWORD_ENC`), con la llave fuera del proyecto en
  `CITAS_SECRET_KEY_FILE`. En claro está prohibido en producción.
- Cifrar no sustituye a los permisos: el `.env` va en 600, fuera del repositorio,
  y una contraseña filtrada se rota. El cifrado solo evita que el `.env` la
  revele por sí solo.
- Un secreto se pasa por la entrada estándar, nunca como argumento: los
  argumentos quedan en la lista de procesos y en el historial.

### Creación
- La vista previa es el MISMO `InvitationCard`, renderizado en el servidor. Nunca
  una maqueta aparte que pueda desviarse de lo que se publica.
- El formulario habla el idioma de la invitación: elegir árabe lo pasa entero a
  árabe y a RTL.
- Sin JavaScript de cliente. Por eso hay casillas fijas en vez de «añadir otro».
- La lista de versículos es CERRADA: solo lo verificado en `data/verses.json`.
  Jamás un campo de texto libre para un texto sagrado.
- Publicar exige sesión. Publicar de forma anónima sería una puerta abierta para
  crear páginas en el dominio.
- El slug no translitera nombres árabes: sale `invitacion-<azar>`. Transliterar
  un apellido automáticamente es justo lo que este proyecto prohíbe.

### Monorepo y móvil
- Lo que comparten web y móvil vive en `packages/core`: tipos, los cuatro
  diccionarios y el formato de fechas y cifras. Un cambio de idioma se hace UNA
  vez.
- `packages/core` NO puede depender de Next, del navegador ni de Tailwind: en
  cuanto lo haga, deja de poder usarse desde React Native.
- La app móvil se autentica con el MISMO modelo de sesión que la web: un token
  bearer en vez de una cookie, la misma tabla y la misma caducidad.
- El token vive en el llavero del dispositivo (`expo-secure-store`), nunca en
  almacenamiento plano.
- React Native fija la dirección del texto al arrancar: cambiar a árabe exige
  reiniciar la app. Hay que decírselo al usuario, no medio invertir la interfaz.
- La app NO vende: las tiendas cobran comisión sobre bienes digitales. El pago
  se hace en la web.

### Planes y límites
- Un `maxEvents` a `null` significa SIN LÍMITE. Nunca colapsarlo con `??` contra
  el plan gratis: ese error facturó a una oficina fuera de sus propios eventos.
- El límite se comprueba al publicar, en el servidor.
- Los precios se guardan en centavos enteros.
- Solo la respuesta del proveedor marca una factura como pagada.

### Invitados y envío
- El enlace personal es `/g/<token>`: corto y sin el slug, para que reenviarlo no
  revele de quién es el evento. Abrirlo marca `openedAt` y recuerda al invitado.
- Se envía con enlaces `wa.me`, NO con la API de WhatsApp: abre el WhatsApp del
  operador con el mensaje escrito. Sin plantillas aprobadas, sin coste por
  mensaje y desde el número que el cliente ya conoce.
- El mensaje va en el idioma DEL INVITADO, no en el de la oficina.
- Reimportar la misma lista no duplica: se reconoce por teléfono, y por nombre
  cuando no hay teléfono.
- Los teléfonos se guardan normalizados a E.164. Una línea sin nombre se
  descarta y se cuenta; no se importa un invitado vacío.

### Confirmaciones
- El formulario de confirmación es PÚBLICO a propósito: la invitación se reenvía
  por WhatsApp y pedir cuenta al invitado cuesta más respuestas que el spam que
  evita. Por eso nada de lo que manda el cliente se cree: el evento sale del
  slug, y un token personal solo vale si pertenece a ese mismo evento.
- Sin `DATA_SOURCE=database` el formulario NO se muestra. Un formulario que no
  puede guardar es peor que ninguno.
- El formulario vive DEBAJO de la tarjeta, nunca dentro: la tarjeta también es
  la imagen que se exporta.
- El CSV lleva marca de orden de bytes o Excel destroza el árabe.

### Cobro
- Líbano cobra con **Whish**. Costa Rica, si se abre, con Tilopay (SINPE Móvil).
- El navegador NUNCA decide un pago. Un regreso a la URL de éxito no es una
  prueba de cobro: se confirma servidor contra servidor con `getStatus()`.
- El callback es un aviso, no una prueba, mientras no haya firma verificable.
- Importes SIEMPRE en entero, en la unidad menor de la moneda. Ningún decimal
  toca dinero.
- Todo proveedor entra por el puerto `PaymentProvider`. La aplicación no sabe
  qué pasarela hay detrás.
- El proveedor `mock` está prohibido en producción y el código lo impide.

### Render
- El PNG se genera UNA vez por versión y se guarda (`Render`), porque esa URL es
  también la vista previa que pide WhatsApp: sin caché, cada invitado del grupo
  arranca su propio Chromium.
- La huella (`contentHashOf`) cubre todo lo que cambia la imagen. Al tocar una
  plantilla hay que subir `RENDERER_VERSION` o se seguirá sirviendo la anterior.
- El almacenamiento entra por el puerto `RenderStore`. Hoy guarda los bytes en
  PostgreSQL; pasar a almacenamiento de objetos es cambiar ese archivo.
- La ruta responde `inline` por defecto y `attachment` solo con `?download=1`:
  la vista previa al compartir no es una descarga.
- Un memorial NUNCA usa la plantilla de celebración. `templateFor()` y
  `themeFor()` lo deciden por tipo de evento, no quien rellena el formulario.
- Las invitaciones se renderizan en el SERVIDOR, nunca en el cliente
- Salida: PNG 1080x1920 y página web responsive
- La página web y el PNG comparten el MISMO componente (`InvitationCard`);
  no se duplica nunca la maquetación
- Las plantillas son HTML/SVG con capas, nunca imágenes generadas por IA

### Código
- TypeScript estricto, sin `any`
- Componentes pequeños, un archivo por componente
- Nombres en inglés en el código, contenido de usuario en los 4 idiomas
- No instalar dependencias sin preguntarme primero

## Comandos
```
npm run dev        # servidor de desarrollo
npm run build      # build de producción
npm run typecheck  # tsc --noEmit
npm run lint:rtl   # guardia de CSS lógico (RTL)
```

## Documentos
- `MANUAL.md` — manual de uso: arrancar, crear invitaciones, idiomas, PNG,
  versículos, fuentes y problemas frecuentes.
- `docs/ARQUITECTURA.md` — producto completo: oficinas (multiempresa), roles,
  las tres formas de venderlo, apps móviles, descargas y despliegue.
- `apps/web/prisma/schema.prisma` — modelo de datos, aplicado y migrado.
- `docs/COBRO-WHISH.md` — cobro en Líbano con Whish: qué pedirle al proveedor y
  las reglas de la integración.
- `docs/DECISIONES-PENDIENTES.md` — lo que no es código y bloquea fases enteras.
- `docs/DESPLIEGUE.md` — cómo verlo en local y cómo publicarlo (Docker incluido).
- `docs/WINDOWS.md` — levantarlo en Windows.
- `docs/DESPLIEGUE-VPS.md` — desplegar en un VPS con aaPanel, paso a paso. XAMPP no sirve: esto es Node y
  PostgreSQL, y las variables van en `apps\web\.env`.

## Estado actual
Fases 1, 2 y 3 terminadas: motor de render, base de datos, acceso por código de
un solo uso, oficinas por subdominio, historial, confirmaciones, calendario,
exportación, formulario de creación, panel con oficinas, equipo, planes y
facturas, y la app móvil. Falta el cobro real: la especificación de Whish.
- `GET /i/[slug]` — página web de la invitación
- `GET /api/render/[slug]` — PNG 1080x1920 generado en servidor
- `GET /render/[slug]` — lienzo interno de captura (no indexado)
- Dos plantillas: `classic-gold` (celebración) y `sober-memorial` (duelo)
- Datos: `DATA_SOURCE=json` lee /data/invitations.json (por defecto),
  `DATA_SOURCE=database` lee PostgreSQL. Ambos detrás de `InvitationRepository`.
- Esquema aplicado y `npm run db:seed` carga los 4 ejemplos y el superadmin.
- `GET /entrar` — acceso por código de un solo uso; `GET /panel` — protegido,
  con los eventos de la oficina y sus confirmaciones.
- `GET /api/calendar/[slug]` — archivo `.ics`.
- `GET /api/events/[eventId]/guests` — CSV de invitados; exige sesión y oficina.
- `GET /crear` — creación en cinco pasos con vista previa; publicar exige sesión.
- `/panel/oficinas` (superadmin), `/panel/equipo` y `/panel/facturacion`.
- `POST /api/payments/[provider]/callback` — aviso del proveedor, nunca prueba.
- `/panel/eventos/[eventId]` — lista de invitados: importar, enviar por WhatsApp
  y ver quién abrió y quién respondió.
- `GET /g/[token]` — enlace personal del invitado.

## Orden de construcción
1. Base de datos, oficinas (multiempresa) y roles — **hecho**: esquema,
   migraciones, acceso OTP, sesiones, oficina por subdominio e historial
2. RSVP y entregables — **hecho**: confirmaciones, `.ics`, mapa y exportación
3. Formulario de creación con vista previa — **hecho**
4. Panel de oficina y facturación — **hecho**
5. Apps móviles — **hecho**: monorepo con Expo y API con token

Todas las fases están construidas. Lo único pendiente que no depende del código
es la especificación de Whish y la verificación humana de los versículos.

## Reglas de producto que no se rompen
- Todo dato de negocio cuelga de un tenant. Ninguna consulta sin filtrar por
  oficina: una oficina jamás ve los datos de otra. Se hace con `TenantScope`
  (`src/lib/db/tenant.ts`), que no es un string suelto sino un tipo marcado.
- La ÚNICA consulta sin tenant es buscar una invitación por su slug público.
  Cualquier otra excepción hay que discutirla.
- El invitado NO tiene cuenta ni instala nada. La invitación es un enlace web.
- Los permisos se comprueban en el servidor. Ocultar un botón no es un permiso.
- El acceso de soporte del superadmin a un evento ajeno queda siempre registrado.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
