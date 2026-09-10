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
- Solo la respuesta del proveedor marca una factura como pagada, y eso se decide
  en UN solo sitio (`applySettlement`): el enlace de la pareja, el botón de la
  oficina, EL AVISO DEL PROVEEDOR y el repaso periódico pasan por la misma
  función. El aviso no pasaba, y el agujero era grave: escribía el pago como
  pagado sin tocar el pedido, y como el repaso solo mira los pagos PENDIENTES,
  ese mismo aviso apagaba la red que lo habría arreglado después.
- `applySettlement` es ATÓMICO, MONÓTONO e IDEMPOTENTE, y las tres hacen falta.
  Todo en una transacción con la fila del pago bloqueada: morir entre dos
  escrituras dejaba un pedido cobrado sin plan activo. `paid` es terminal salvo
  reembolso: una respuesta atrasada no devuelve a pendiente lo que ya entró. Y el
  mismo aviso dos veces no activa el plan dos veces ni escribe dos líneas en el
  historial —que va DENTRO de la transacción, porque un historial que se pierde
  al morir el proceso no es un historial.
- El adaptador se resuelve por el proveedor GUARDADO en el pago (`providerFor`),
  no por el configurado hoy: preguntarle a la pasarela nueva por una referencia
  de la vieja devuelve «no existe», que se leería como pendiente.
- UN solo cobro abierto por pedido, y lo impide la BASE con un índice único
  parcial, no solo el código: dos peticiones simultáneas comprueban las dos que
  no hay ninguno. Un doble clic reutiliza el enlace en vez de abrir una segunda
  cobranza — dos enlaces vivos es la forma más tonta de que una pareja pague dos
  veces.
- `citas-conciliar.timer` repasa cada cinco minutos los cobros que llevan rato
  en `pending`. El callback no va firmado y se pierde; que una boda pagada se
  entere no puede depender de que alguien abra una pantalla.
- La moneda viaja CON la referencia al preguntar por un cobro. Whish lo busca
  por `(externalId, currency)` y preguntar en la moneda equivocada no da error,
  da «no existe» — que se leería como pendiente.

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
  `tenantId`, y toda acción resuelve la conexión con el `TenantScope` **antes de
  tocarla, y antes de llamar al servicio**: el id viaja en un campo oculto del
  formulario. Quitar un número lo hacía al revés —servicio primero, comprobación
  después— y eso era un agujero: el servicio acepta un id cualquiera con un token
  global, así que quien administra la oficina A y consiguiera el id de una
  conexión de B le cerraba el WhatsApp y le destruía las credenciales.
- La dirección del servicio solo puede apuntar al BUCLE LOCAL, o a lo que declare
  `WHATSAPP_GATEWAY_HOST` en el entorno. El token que viaja en esa llamada
  controla todos los números de todas las oficinas, y la dirección se edita desde
  el panel: sin filtro, cambiar un campo de texto convertía el servidor en un
  ariete con el token dentro. El panel puede cambiar el puerto, no la máquina. Y
  no se siguen redirecciones, que es el mismo problema por otra puerta.
- El servicio NO expone «manda este mensaje». Solo «abre la sesión» y «ciérrala».
  Un extremo que manda al momento es un extremo con el que se vacía el cupo de
  un número en un bucle.
- La cola se RECLAMA, no se lee. `claimNext` coge la fila con
  `FOR UPDATE SKIP LOCKED`, la pasa a `processing` y le pone un arriendo de dos
  minutos — todo en la misma transacción que RESERVA el hueco del cupo diario.
  Antes eran dos lecturas seguidas de dos escrituras: dos repartidores leían la
  misma fila y el invitado recibía dos mensajes, y los dos leían «van 199 de 200»
  y los dos mandaban.
- Un arriendo vencido NO se reencola: pasa a `sent_unknown`. Un repartidor puede
  morir DESPUÉS de que WhatsApp aceptara el mensaje; reenviar sería duplicar y
  callarse sería perderlo, y no hay forma de saber cuál. Así que se dice, sale en
  la pantalla distinguido de un fallo, y lo decide una persona — que es quien
  puede mirar el teléfono. `markSent` y `markFailed` solo escriben si el arriendo
  sigue siendo suyo.
- Cancelar marca `canceled`; no borra, y no toca lo que ya está en `processing`:
  esa fila puede estar en el aire, y borrarla no la detiene — solo borra el
  rastro de que salió.
- El día del cupo es UTC, dicho a las claras: una oficina en Beirut ve el
  contador reiniciarse a las tres de la madrugada. Un día por oficina daría dos
  medianoches al mismo número compartido, que es peor.
- Los recordatorios RECLAMAN al invitado antes de escribirle (`updateMany` con
  `remindedAt: null` y `rsvp: null` en el WHERE) y solo escriben a los
  reclamados. Al revés —escribir y luego marcar— dos repasos simultáneos
  escribían los dos, y una confirmación que llegara en medio recibía igualmente
  el recordatorio de que confirmara.
- El freno se ajusta en `/panel/configuracion?s=whatsapp` —retardo mínimo y
  máximo, calentamiento— y el servicio lo RELEE cada minuto: reiniciarlo para
  bajar unos segundos costaría que cada oficina volviera a escanear. En el
  entorno solo queda lo que hace falta para arrancar: el token (lo comparten dos
  procesos), `DATABASE_URL` y la llave.
- El freno se acorta, NO se quita. El mínimo son tres segundos, recortado al
  guardar Y al leer; lo que manda es el servicio, porque una fila escrita a mano
  tampoco puede quitarlo.
- El mensaje va en el idioma DEL INVITADO, no en el de la oficina.
- Una tanda puede llevar FECHA (`WhatsappMessage.scheduledAt`). Antes de esa hora
  el servicio no la coge, y quien decide que ha llegado es la BASE con su reloj:
  son dos procesos que pueden ir descuadrados. Vacío significa «ya», que es como
  se comportaba toda la cola antes. La hora se escribe en el reloj de QUIEN la
  escribe y se guarda en UTC (`lib/time/zoned.ts`): sin eso, una oficina en Costa
  Rica programando una boda de Beirut mandaría de madrugada.
- Un mensaje suelto de hoy adelanta a una tanda programada para el sábado. Lo
  contrario —que un envío programado taponara la cola— es lo que haría que nadie
  volviera a usar la programación.
- Lo programado se VE y se puede cancelar mientras no haya salido. Una promesa a
  plazo que no se puede deshacer no tranquiliza, asusta.
- `Event.reminderDaysBefore` recuerda UNA vez a quien no ha contestado, N días
  antes, en su idioma y solo si tiene teléfono. `citas-recordatorios.timer` mira
  cada cuarto de hora y ENCOLA; sigue mandando el servicio, porque un trabajo
  automático que mandara al momento es el que vacía el cupo de un número mientras
  nadie mira. Se marca `Guest.remindedAt` en la misma transacción que se encola.
  Sin número conectado no se marca a nadie: se reintenta cuando lo haya.
- Lo que se rindió a los tres intentos SE VE, con nombre, teléfono y motivo, y
  se puede volver a encolar. Antes solo salía el número: «12 fallidas» sobre
  doscientas preocupa y no deja hacer nada, y a esos doce hay que escribirles a
  mano. Reintentar reinicia el contador —reintentar sin darle intentos no es
  reintentar— y lo pulsa una PERSONA que ya ha visto el motivo: un reintento
  automático en bucle es como se quema el número de un cliente.
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
  - **Marca**: el logo y el icono de la pestaña se SUBEN, no se pega una
    dirección: nadie que monta su negocio tiene una URL de su logo, tiene un
    archivo. Se recodifican y van a la tabla `BrandAsset` en PostgreSQL —misma
    razón que `Render` y que la foto de perfil—, y se sirven por
    `/api/brand/<logo|icon>`, que SÍ es pública: es la marca, y sale en la
    portada y en la pestaña de cualquiera que abra una invitación. El logo se
    ajusta DENTRO de una caja y conserva su forma —recortar un logo apaisado a
    cuadrado es destrozarlo—; el icono sí es cuadrado. La dirección de imagen
    sigue existiendo, plegada, porque hay instalaciones que ya tienen una puesta
    y sin el campo no habría cómo quitarla.
  - **Portada**: cada texto del bloque `home`, en los cuatro idiomas. La lista
    se genera recorriendo el diccionario, así que una frase nueva aparece sola.
    Un campo vacío es «el texto original», y no se guarda fila.
  - Los cuatro botones de idioma son ahora un icono de mundo (`<details>`, sin
    JavaScript de cliente).
- `/panel/perfil` — cada persona edita LO SUYO: nombre, foto, teléfono, idioma,
  país y zona horaria; su contraseña; y dónde tiene la sesión abierta. El id sale
  de la sesión, nunca del formulario: un campo oculto con el id del usuario en
  una pantalla de perfil es cómo se edita el perfil de otro. El rol NO está aquí,
  para que nadie se ascienda a sí mismo, y el CORREO tampoco: es con lo que se
  entra, y cambiarlo desde dentro sin confirmar el nuevo regala la cuenta a quien
  se cuele una vez.
  - La foto se SUBE, no se pega una dirección. Se recodifica siempre —recorte
    cuadrado de 256 y WEBP— y por eso los metadatos del móvil, con las
    coordenadas de la casa dentro, no llegan nunca a la base. Los bytes van a
    PostgreSQL, no al disco: un despliegue copia el código y se lleva por delante
    lo que se hubiera dejado al lado, que es la misma razón de la tabla `Render`.
    Se sirven por `/api/avatar/<id>`, con sesión y solo a esa persona, a su
    oficina y al superadministrador; la huella va en `?v=` para poder cachear
    para siempre sin servir la foto vieja.
  - La contraseña solo la tienen el superadministrador y los administradores de
    oficina —la MISMA regla que aplica `npm run auth:password`, comprobada otra
    vez en el servidor— y cambiarla cierra las demás sesiones.
  - La lista de sesiones existe porque una sesión dura treinta días: sin ella,
    una dejada abierta en un ordenador ajeno se arreglaba esperando un mes.
- `/panel/equipo` — quién trabaja en la oficina, con qué rol, en qué idioma y
  con qué país. Cada fila se guarda por su cuenta.
- El idioma, «Mi perfil» y «Salir» van en UN solo menú de cuenta, al final de la
  cabecera, detrás de la foto (`UserMenu`, con `<details>` y sin JavaScript de
  cliente). Son cosas de QUIEN está dentro, no del sitio; sueltas ocupaban media
  cabecera, se caían a una segunda línea en cuanto la oficina tenía un nombre
  largo, y «Salir» subrayado al lado de los enlaces se pulsaba sin querer. El
  menú enseña además con qué oficina y qué rol se está trabajando. El idioma se
  guarda en `User.locale`, no en la oficina.

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
