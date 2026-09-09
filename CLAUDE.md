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
- WhatsApp por QR en un proceso APARTE (`apps/whatsapp`, Baileys): un socket de
  WhatsApp es una conexión larga y Next no puede sostenerla dentro de una
  petición.
- Monorepo con espacios de trabajo de npm: `apps/web`, `apps/mobile`,
  `apps/whatsapp`, `packages/core`

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
- La configuración del sistema —correo saliente, cobro, dirección del sitio— se
  edita en `/panel/configuracion`, NO en el `.env`. Quien monta esto no debería
  tener que abrir un archivo por SSH para cambiar un servidor de correo. El
  `.env` se sigue leyendo como RESPALDO, y solo como respaldo: si el valor está
  guardado en el panel, manda el panel.
- Lo único que SÍ tiene que estar en el entorno es lo que hace falta para
  arrancar y poder leer el resto: `DATABASE_URL`, `DATA_SOURCE`,
  `SUPERADMIN_EMAIL` y la llave de cifrado (`CITAS_SECRET_KEY_FILE`). La llave
  no puede vivir en la base de datos: sería guardar la llave dentro del cajón
  que abre.
- Las contraseñas de servicios (la del SMTP, la clave de Whish) se guardan
  CIFRADAS con AES-256-GCM, nunca en claro, estén en la base de datos o en el
  `.env` (`SMTP_PASSWORD_ENC`). La pantalla NUNCA las devuelve: se reemplazan,
  no se leen. Dejar el campo vacío significa «no la toques».
- Cifrar no sustituye a los permisos: el `.env` va en 600, fuera del repositorio,
  y una contraseña filtrada se rota. El cifrado solo evita que un volcado la
  revele por sí solo.
- Cambiar la configuración es cosa del superadministrador y queda registrado con
  su autor: esos campos deciden a qué cuenta de comercio va el dinero. En el
  historial se anota QUÉ campos cambiaron, jamás su valor.
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
- Hay DOS formas de enviar, y la segunda no sustituye a la primera.
  1. **`wa.me`**, invitado por invitado: abre el WhatsApp del operador con el
     mensaje escrito. Sin plantillas aprobadas, sin coste por mensaje y desde el
     número que el cliente ya conoce. Es lo que funciona SIEMPRE.
  2. **El número conectado por QR** (`apps/whatsapp`, Baileys), para no pegar
     doscientos enlaces a mano. La web ENCOLA filas; quien manda es ese proceso,
     de uno en uno.
- Automatizar un número personal va CONTRA los términos de WhatsApp y el número
  que pueden cerrar es el del cliente. Eso no se esconde: el aviso está arriba
  en la pantalla, en rojo, antes del botón. Y el código lleva freno —retardo al
  azar entre mensajes, tope diario por número, calentamiento del número nuevo,
  de uno en uno— porque sin él lo que se pierde es el número de una boda.
- La sesión de WhatsApp se guarda CIFRADA (`authEnc`), con la llave fuera de la
  base. Es el secreto más peligroso del proyecto: quien la tiene escribe desde
  el WhatsApp del cliente.
- Multi-número y multi-oficina. Cada `WhatsappConnection` cuelga de su
  `tenantId`, y toda acción resuelve la conexión con el `TenantScope` antes de
  tocarla: el id viaja en un campo oculto del formulario.
- El servicio NO expone «manda este mensaje». Solo «abre la sesión» y «ciérrala».
  Un extremo que manda al momento es un extremo con el que se vacía el cupo de
  un número en un bucle.
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
- `docs/WHATSAPP.md` — el envío por número propio con código QR: por qué lleva
  freno, qué se arriesga, cómo se monta y qué mirar cuando falla.
- `docs/APPS-MOVILES.md` — publicar en Apple y Google Play: qué trae el
  repositorio (`codemagic.yaml`, `eas.json`, identificadores) y qué no puede
  traer (las dos cuentas de tienda, las firmas, la política de privacidad).

## Estado actual
En producción, en `citas.posxml.com`. Todas las fases construidas. Lo único
pendiente que no es código: la especificación de Whish y la verificación humana
de los versículos.

### Público
- `GET /` — portada: `src/config/site.ts` es lo que trae DE FÁBRICA y
  `/panel/configuracion` lo tapa (`lib/home/site.ts` resuelve las dos capas);
  qué dice está en los cuatro diccionarios bajo `home`, y el panel puede tapar
  cada frase (`lib/settings/home.ts`). Idioma por `?lang=` o por
  `Accept-Language`. Vista previa al compartir en `public/og/home.png`, dibujada
  con `npm run og:build`.
- `GET /ejemplos` — las invitaciones de muestra, no indexado. Sale de la lista
  blanca de `site.ts`, NUNCA de un listado de la base: eso enseñaría las bodas
  reales de todas las oficinas.
- `GET /i/[slug]` — la invitación. Una por idioma; cada una con su slug.
- `GET /api/render/[slug]` — PNG 1080x1920 con caché en la tabla `Render`.
- `GET /render/[slug]` — lienzo interno de captura.
- `GET /g/[token]` — enlace personal del invitado. Lleva a la versión de SU
  idioma (`versionForLocale`), y a la original si nadie escribió la suya.
- `GET /api/calendar/[slug]` — archivo `.ics`.
- `GET /pagar/[token]` — el cobro del paquete, para la pareja que se casa. Sin
  sesión, en SU idioma, y sin un solo campo: el pago ocurre en la página de
  Whish, que aloja Whish. Volver a la URL de éxito no cobra ni prueba nada; lo
  decide `getStatus()`.

### Panel
- `GET /entrar` — correo y contraseña en la MISMA pantalla, con dos botones. La
  contraseña es opcional y solo la tienen el superadministrador y los
  administradores de oficina; el resto entra con el código.
- `/panel` (eventos), `/panel/oficinas` (superadmin), `/panel/equipo`,
  `/panel/facturacion`, `/panel/eventos/[eventId]` (invitados, idiomas que
  faltan, importar y enviar por WhatsApp).
- `/panel/manual` — el manual de uso, en los cuatro idiomas.
- `/panel/sistema` — SOLO superadministrador: once comprobaciones de salud,
  las versiones leídas en vivo y un botón que envía un correo de prueba y
  enseña la respuesta del proveedor.
- `/panel/configuracion` — SOLO superadministrador, por sectores (`?s=`):
  **correo**, **cobro**, **marca**, **portada** y **el sitio**. Cada campo dice
  de dónde sale hoy su valor —guardado aquí, heredado del servidor o sin
  poner— y las contraseñas se escriben pero no se leen. Guardar un sector no
  toca los demás: la acción solo escribe las claves que vienen en el envío.
  - **Cobro**: los medios se encienden por separado (`PAYMENT_METHODS`). Whish
    cobra en línea; el efectivo NO tiene pasarela y lo marca una persona con su
    nombre desde el panel; Tilopay (SINPE Móvil) aparece bloqueado hasta que
    haya credenciales, para que nadie crea que cobra.
  - **Portada**: cada texto del bloque `home`, en los cuatro idiomas. La lista
    se genera recorriendo el diccionario, así que una frase nueva aparece sola.
    Un campo vacío es «el texto original», y no se guarda fila.
  - Los cuatro botones de idioma son ahora un icono de mundo (`<details>`, sin
    JavaScript de cliente).
- `/panel/perfil` — cada persona edita LO SUYO: nombre, foto, teléfono, idioma
  y el país que maneja. El id sale de la sesión, nunca del formulario: un campo
  oculto con el id del usuario en una pantalla de perfil es cómo se edita el
  perfil de otro. El rol NO está aquí, para que nadie se ascienda a sí mismo.
- `/panel/equipo` — quién trabaja en la oficina, con qué rol, en qué idioma y
  con qué país. Cada fila se guarda por su cuenta.
- Un icono de mundo en la cabecera cambia el idioma del panel. Se guarda en
  `User.locale`, no en la oficina.

### Cómo se decide el idioma del documento
`src/proxy.ts` (en Next 16 se llama `proxy`, no `middleware`) anota la ruta y el
`?lang=`, y `src/lib/i18n/document.ts` termina de resolverlo para poner
`<html lang>` y `<html dir>`. El layout raíz nunca ve los parámetros de la
página, y por eso hace falta ese rodeo.

### Datos
- `DATA_SOURCE=json` lee /data/invitations.json (por defecto),
  `DATA_SOURCE=database` lee PostgreSQL. Detrás de `InvitationRepository`, que
  tiene UN solo método: buscar por slug público. No hay listado sin oficina.
- `npm run db:seed` carga los ejemplos y el superadministrador de
  `SUPERADMIN_EMAIL`.
- `npm run auth:password -- <correo>` pone contraseña por entrada estándar.
- `npm run og:build` redibuja la tarjeta de la portada.

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
- Hay DOS consultas sin tenant, y solo dos: buscar una invitación por su slug
  público, y buscar un pedido por el token de su enlace de pago
  (`/pagar/<token>`). Las dos valen por lo mismo: el token no se adivina,
  resuelve a UNA fila y nunca a un listado, y quien la abre no tiene cuenta aquí
  ni va a abrirse una. Cualquier otra excepción hay que discutirla.
- El invitado NO tiene cuenta ni instala nada. La invitación es un enlace web.
- Los permisos se comprueban en el servidor. Ocultar un botón no es un permiso.
- El reparto de permisos por rol se edita en `/panel/configuracion?s=roles`, con
  DOS candados que no se negocian: **SUPERADMIN no se toca** (recortarle
  permisos al único rol que puede volver a ampliarlos es cerrarse la puerta
  desde dentro) y **`platform:manage` no se reparte** (abre la configuración de
  todas las oficinas y el cobro; si se pudiera conceder, un administrador de
  oficina se lo concedería a su propio rol). Los dos se aplican al ESCRIBIR y al
  LEER, así que ni un envío fabricado a mano ni una fila vieja los saltan.
- `sessionCan` es SÍNCRONA a propósito, aunque el reparto sea configurable: los
  permisos se resuelven al abrir la sesión y viajan en ella. Si fuera asíncrona,
  un `await` olvidado devolvería una promesa —que es verdadera— y la
  comprobación pasaría siempre. Un permiso que falla abierto por un descuido de
  sintaxis no es un permiso.
- El país de cada persona (`User.country`) no es un adorno: decide el prefijo
  con el que se normaliza una lista pegada sin prefijo y la zona horaria por
  defecto. Los nombres de los países salen de `Intl.DisplayNames`, que ya habla
  los cuatro idiomas: cuatro listas de doscientos nombres a mano son cuatro
  listas que envejecen.
- El acceso de soporte del superadmin a un evento ajeno queda siempre registrado.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
