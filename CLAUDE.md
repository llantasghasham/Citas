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

### La marca
- El logo es GEOMETRÍA escrita a mano en `public/brand/mark.svg` —un arco
  apuntado con una estrella de cuatro puntas dentro—, nunca una imagen
  generada. El arco es la forma que comparten la arquitectura del Levante y la
  tarjeta de boda de siempre, y se lee a 16 píxeles, que es donde vive el icono
  de una pestaña.
- Todo lo demás SALE de ahí con `npm run brand:build`: el logotipo con el
  nombre, el icono de la pestaña, los cinco iconos de la app y la tarjeta al
  compartir. Cambiar la marca es cambiar el SVG y volver a ejecutarlo, no ir
  buscando doce PNG por el repositorio. Los resultados se commitean: son
  archivos estáticos y nadie va a arrancar Chromium para servirlos.
- El nombre va en HTML y no dentro del SVG: se escribe con Playfair Display, y
  un `font-family` dentro de un SVG cargado como `<img>` no encuentra nunca la
  fuente — se dibujaría con la de respaldo.
- La marca de fábrica es el SELLO (`mark.svg`), no el logotipo con el nombre
  dentro. `logo.png` lleva «Citas» escrito en crema, y eso venía de dar por
  buena una cosa que no lo era: la cabecera del PANEL es crema, no oscura. Ahí
  el nombre del logotipo se volvía invisible y solo se veía el arco — y al lado,
  en texto, «Citas» otra vez. El sello se lee sobre claro y sobre oscuro, y deja
  que el nombre lo ponga el texto de al lado UNA vez, que es además lo correcto
  cuando una oficina pone lo suyo: lo que se enseña es el nombre de la oficina.
- `DEFAULT_LOGO` y `DEFAULT_ICON` en `config/site.ts` son el último recurso, no
  un ajuste con capas: una instalación recién levantada enseñaba el nombre en
  texto pelado y una pestaña en blanco. Quien sube el suyo lo tapa, y quitarlo
  vuelve a la marca de fábrica — una cabecera sin nada no es un estado que
  nadie quiera dejar puesto.

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
- Las sesiones caducadas y los códigos gastados SE BORRAN (`purgeExpired`, en el
  temporizador de recordatorios). Una fila de `Session` guarda la IP y el
  navegador de quien entró; pasado el plazo ya no sirve para nada y lo único que
  sigue haciendo es guardar desde dónde se conectó una persona. Un dato que ya no
  hace falta y que nadie borra es un dato que solo puede filtrarse.
- La foto de perfil NO se dibuja desde una dirección de fuera, aunque quede
  alguna guardada de cuando el formulario las pedía: pintar una imagen alojada en
  otro sitio le cuenta a ese sitio la IP de todo el que abre la lista del equipo.
  El logo de la marca sí admite una dirección externa a propósito —es la marca,
  y sale en la portada—, y por eso va con `referrerPolicy="no-referrer"`.
- El código de un solo uso se GASTA con una escritura condicional
  (`updateMany … where consumedAt: null`), y la sesión se abre solo si se ganó
  ese gasto. Contar el intento y comprobar que quedan es también UNA sola
  escritura. Estaban separados, y entre leer y escribir cabe otra petición: dos
  peticiones con el mismo código válido abrían DOS sesiones, y dos intentos
  simultáneos con el último disponible pasaban los dos.
- Subir una imagen tiene TRES frenos, y los tres hacen falta: el tamaño del
  archivo, los píxeles al descodificar —que es lo que cuesta memoria— y cuántas
  se abren a la vez (`lib/images/limits.ts`). El límite de Next para los
  formularios se pone POR ENCIMA del que comprueba el código, para que quien
  decide y quien lo explica sean el mismo: estaba en un mega por defecto mientras
  el código decía ocho, así que una foto de dos megas se rechazaba con un error
  del framework en vez de con el mensaje escrito para ese caso.
- Nunca se revela si una dirección tiene cuenta. La respuesta es la misma.
- Pedir código tiene DOS frenos, y el segundo faltaba. El primero es por
  dirección: tres en quince minutos, para que la bandeja de nadie sea un arma.
  Pero solo por dirección, así que desde una máquina se podían pedir tres
  códigos para cada una de mil direcciones: averiguar si una existe seguía
  siendo imposible, y aun así el correo SALÍA — este servidor servía de ariete
  contra el equipo de una oficina, quemando de paso la reputación del dominio
  que envía. El segundo freno cuenta DIRECCIONES DISTINTAS por origen, no
  códigos, y esa diferencia es la que lo hace usable: una oficina entera sale a
  internet por una sola IP y ocho personas un lunes son ocho direcciones, no
  ochenta; quien reintenta lo suyo choca contra el freno de su dirección, no
  contra este. La firma de un ariete es la contraria — muchas direcciones desde
  un solo sitio. Vale lo que valga el proxy, y por eso es el SEGUNDO freno y no
  el único.
- La oficina se resuelve por `x-forwarded-host`, no por `host`: en las peticiones
  de una Server Action, Next reescribe `host`. El origen debe estar detrás del
  proxy que fija esa cabecera — y por eso Docker publica en `127.0.0.1:3000`, no
  en todas las interfaces: si se puede llegar sin pasar por el proxy, esa cabecera
  la escribe cualquiera.
- Los enlaces que SALEN de aquí —el de pago de la pareja, el personal del
  invitado, el aviso al proveedor— se escriben con `canonicalOrigin()`, que manda
  lo guardado en «la dirección del sitio» y no la cabecera de la petición. Un
  enlace de pago apuntando a un dominio ajeno es exactamente el correo que le roba
  el dinero a una pareja. Resolver la OFICINA sí sigue mirando el host, porque
  hace falta; y una vez dentro manda la sesión, no el host.
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
- Devolver el dinero devuelve el PRODUCTO, y no lo hacía. El pedido se escribía
  con `NOT: { status: 'paid' }` para que una respuesta atrasada no desactivara lo
  ya cobrado — y esa condición excluía justo el estado del que hay que sacarlo en
  un reembolso. Así que el pago quedaba `refunded`, el pedido seguía diciendo
  «pagado» y la oficina se quedaba con el plan. El reembolso es la ÚNICA
  excepción a esa condición, y además marca `Subscription.cancelledAt`. Un
  paquete de invitaciones no toca la suscripción, igual que al pagarlo: es una
  venta suelta para una boda.
- Una suscripción CANCELADA no da plan. `cancelledAt` se escribía y no lo leía
  nadie: `limitsFor` miraba el plan de la fila y ya, así que cancelar no
  cancelaba nada. Se compara con AHORA y no solo con si está puesta, y eso hace
  que «cancelada a fin de periodo» sea una fecha futura — sin otra columna y sin
  un trabajo que la aplique el día que toque.
- `applySettlement` es ATÓMICO, MONÓTONO e IDEMPOTENTE, y las tres hacen falta.
  Todo en una transacción con la fila del pago bloqueada: morir entre dos
  escrituras dejaba un pedido cobrado sin plan activo. `paid` es terminal salvo
  reembolso: una respuesta atrasada no devuelve a pendiente lo que ya entró. Y el
  mismo aviso dos veces no activa el plan dos veces ni escribe dos líneas en el
  historial —que va DENTRO de la transacción, porque un historial que se pierde
  al morir el proceso no es un historial.
- La fila del cobro se RESERVA antes de llamar a la pasarela, con la referencia
  ya decidida aquí (`lib/billing/reserve.ts`). Al revés —llamar y escribir
  después— el índice impedía guardar la segunda fila pero NO impedía que se
  hubiera creado la segunda cobranza: esa quedaba viva en Whish, con su enlace,
  esperando a que alguien la pagara. La segunda petición ni llega a la pasarela;
  espera un momento al enlace de la primera. Y si la pasarela falla, la reserva
  se suelta —solo si sigue siendo una reserva— o el pedido no se podría cobrar
  nunca más.
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
- Un mensaje cuelga de su conexión por `(id, tenantId)`, con clave foránea
  COMPUESTA. No es «el código siempre pone el tenant correcto»: es que la base no
  admite otra cosa. `tenantId`, `eventId` y `guestId` no tenían ninguna clave
  foránea, y una consulta a mano o un descuido futuro podía dejar un mensaje de
  una oficina colgando del número de otra. Borrar el evento o el invitado deja
  el mensaje con el campo a nulo, no lo borra: es el REGISTRO de lo que se mandó.
- Y QUITAR EL NÚMERO tampoco lo borra. Era lo único que sí lo hacía —la clave a
  la conexión iba en CASCADE— y es la operación más normal que hay: a un número
  lo cierran y la oficina conecta otro. Esa oficina perdía de golpe el registro
  entero de a quién le había escrito, que es exactamente lo que se mira cuando
  alguien pregunta si a un invitado le llegó su invitación. Ahora se desata a
  mano al quitarlo, en una transacción: lo que seguía EN COLA se cancela —sin
  número no puede salir nunca— y el resto se queda sin número. Lo que estaba
  `processing` también se desata en vez de tocarle el estado: puede estar en el
  aire, y `markSent`/`markFailed` miran el arriendo y el id, no el número, así
  que el repartidor todavía puede anotar lo que ya salió.
- Lo que se quedó sin número NO se puede reencolar. El repartidor pide trabajo
  POR conexión, así que una fila sin conexión reencolada se quedaría en la cola
  para siempre sin que nadie la reclame.
- El mensaje cuelga TAMBIÉN de su oficina, con clave foránea directa y en
  cascada, y sin eso lo de arriba no funciona: al dejar de ser CASCADE la del
  número, borrar una oficina pasó a FALLAR —la cascada se lleva sus conexiones y
  los mensajes seguían apuntando a ellas—. Es la tercera vez que este proyecto
  pisa esa piedra y la primera que se comprobó antes de subirla. Quitar un número
  deja el mensaje; cerrar la oficina se lo lleva.
- El servicio se apaga CON ORDEN: deja de repartir, espera al envío en curso,
  cierra los sockets, deja de escuchar y suelta la base, con tope de diez
  segundos. Era `process.exit(0)` en la misma línea que `server.close()`, lo que
  mataba el proceso con la escritura de las credenciales de Baileys posiblemente
  a medio hacer — y esas credenciales son el secreto más caro del proyecto.
- Abrir una sesión de WhatsApp guarda su promesa por conexión. Era
  comprobar-y-actuar, así que pulsar «Conectar» dos veces abría DOS sockets con
  las mismas credenciales, que es una manera excelente de que cierren el número.
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
- Encolar a un invitado dos veces lo impide un índice único PARCIAL sobre
  `(eventId, guestId, kind)` mientras el mensaje está `queued` o `processing`,
  no la lectura previa: entre leer qué hay en cola y escribir cabe otra
  petición, y dos operadores pulsando «Enviar» a la vez le mandaban dos mensajes
  a cada invitado. Va por `kind` —`invitation` o `reminder`— porque el mismo
  invitado recibe los dos, y sin esa columna lo que evita el doble envío habría
  impedido el recordatorio.
- Reimportar la misma lista no duplica: se reconoce por teléfono, y por nombre
  cuando no hay teléfono.
- Los teléfonos se guardan normalizados a E.164. Una línea sin nombre se
  descarta y se cuenta; no se importa un invitado vacío.

### Permiso para escribir
- Tener el teléfono de alguien NO es tener su permiso para escribirle, e importar
  doscientos números de un Excel tampoco. Son dos cosas distintas y se guardan
  separadas (`Consent`), por canal y por PARA QUÉ: quien acepta recibir su
  invitación no ha aceptado recibir ofertas, y meterlas en el mismo saco es lo
  que convierte un permiso en un pretexto.
- Se guarda DE DÓNDE salió el permiso y CON QUÉ TEXTO se pidió. Un permiso que no
  se puede enseñar no sirve para defenderse de una queja, que es justo para lo
  que hace falta. Cambiar el texto es un permiso nuevo.
- La BAJA (`OptOut`) gana SIEMPRE, y va en su tabla aparte por dos razones que
  importan las dos: tiene que poder existir sin que antes hubiera permiso —
  alguien escribe STOP sin haber dado nunca nada— y tiene que sobrevivir a que se
  reimporte la lista, cosa que un `revokedAt` dentro de `Consent` no hace. Su
  unicidad necesita DOS índices parciales, porque en PostgreSQL dos nulos no
  chocan: sin el segundo se podrían apuntar cien bajas totales del mismo
  contacto.
- Sin permiso vigente es que NO. Falla cerrado, como el lector del SINPE: un
  mensaje que no sale se arregla pidiendo el permiso; uno que sale sin permiso ya
  salió.
- El registro de auditoría anota el permiso, la revocación y la baja, pero NUNCA
  el contacto entero: los últimos dígitos bastan para reconocerlo y no repiten el
  dato personal en otra tabla.

### Envíos
- Una campaña es UN envío con nombre: a un grupo, para un acto, con una plantilla
  y su VERSIÓN. Existe para que «mandar las invitaciones de la henna a la familia
  de la novia» sea una cosa con autor, fecha y resultado, y no doscientas filas
  sueltas en una cola de las que nadie sabe de dónde salieron.
- Se guarda a los EXCLUIDOS y por qué (`MessageRecipient` con su motivo). Una
  campaña que solo enseña a quién le llegó esconde justo lo que hay que mirar:
  los ochenta que se quedaron fuera porque nadie les pidió permiso.
- La clave contra duplicados lleva el ACTO y la VERSIÓN de la plantilla dentro, y
  la impide la BASE con un índice único parcial, no una lectura previa. El mismo
  invitado recibe la invitación de la henna Y la de la recepción: sin el acto, lo
  que evita el doble envío impediría la segunda — el mismo fallo que ya obligó a
  meter `kind` en ese índice, otra vez y por otro lado.
- Nadie sin permiso entra en la cola. Es la regla que hace que esto valga.

### La puerta
- El código del QR se DERIVA del token que el invitado ya tiene más el id del
  acto, firmado con la llave. No hay una tabla más de códigos que caduquen mal, y
  uno fabricado a mano no pasa la firma.
- Es POR ACTO: el de la recepción no sirve para la henna. Y el tope de
  acompañantes también es por acto, no el del invitado.
- El segundo intento dice «ya entró» y la hora de la primera vez, y nada más: en
  una puerta hay gente delante mirando la pantalla.
- Una entrada por invitado y acto, y lo impide un índice único — no la lectura
  previa: dos operadores escaneando a la vez comprueban los dos que no había
  ninguna.
- Una entrada apuntada por error se DESHACE, con su registro de quién lo hizo.

### Preferencias
- Dieta, transporte, accesibilidad y fotos, en clave y valor y no una columna por
  cosa: lo que hace falta preguntar cambia de una boda a otra, y una columna
  nueva por pregunta es una migración por boda.
- Las claves son una LISTA CERRADA. Un campo libre acabaría guardando lo que a
  nadie se le ocurrió limitar, y esto son datos de salud de gente que no tiene
  cuenta aquí.

### Las tres pantallas nuevas
- **`/panel/eventos/<id>/envios`** está partida en dos a propósito: elegir y VER
  a quién le llegaría es un GET que no escribe nada; mandar es lo único que
  escribe. Pulsar «mandar» sobre doscientas personas no se deshace, así que quien
  lo pulsa tiene que haber visto antes a cuántos les llega, a cuántos no y por
  qué. Lo que se enseña sale de `previewCampaign`, la MISMA función que usa el
  envío por dentro.
- **`/panel/eventos/<id>/permisos`** enseña la diferencia entre «tengo su
  teléfono» y «me dio permiso», que no se ve en ninguna otra pantalla y es la que
  decide si un envío es una invitación o es spam. Los que faltan salen CON
  NOMBRE.
- **`/panel/eventos/<id>/puerta`** es la única pantalla del panel pensada para
  usarse DE PIE y con una cola delante: campos y botones más altos, el resultado
  de la última lectura arriba y grande, y el foco de vuelta en el código para
  encadenar lecturas sin tocar la pantalla.

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
- Una hora de reloj se RECHAZA si el día no existe. `Date.parse` no protesta ante
  un 30 de febrero: lo corre al 2 de marzo y devuelve un número tan válido como
  cualquier otro, así que un envío programado saldría otro día sin un aviso.
  `zonedToUtc` comprueba el camino de vuelta.
- El `.ics` escapa `\`, `;`, `,` y los saltos de línea, en ese orden. El punto y
  coma NO se escapaba —`'\;'` en JavaScript es un punto y coma a secas— y un
  salón llamado «Le Royal; piso 2» partía la línea y rompía el archivo.
- Las fechas que ve una persona pasan por `lib/time/display.ts`: en SU zona y en
  SU idioma. `toISOString().slice(0,10)` es UTC y es `2026-03-14` en los cuatro
  idiomas — una oficina de Costa Rica veía sus ventas de la tarde fechadas al día
  siguiente.

### Los actos
- Un `Event` NO es una fecha: es el CONTENEDOR. Lo que tiene hora y sede es el
  `EventAct`. Una boda libanesa puede ser compromiso, fiesta familiar, henna,
  preparación, zaffe, ceremonia, cena y despedida, repartidos en varios días, en
  sedes distintas y CON GENTE DISTINTA en cada uno. Con una sola fecha, una sola
  sede y una sola respuesta por invitado eso no se podía representar, y lo que
  faltaba no era otra plantilla.
- El `ActType` es una ETIQUETA para ordenar y elegir icono, jamás una
  obligación: `label` lo llama como lo llama esa familia y `other` existe para
  que ninguna celebración tenga que caber en la lista. No se infiere de nada —
  ni del idioma, ni de los nombres, ni de la lista de invitados. La religión, el
  rito y la denominación NO son campos de este modelo.
- NO se duplica al invitado por acto. Se duplican las relaciones, las respuestas
  y los mensajes; la persona es una. Un `Guest` por persona, y `GuestSegment`,
  `GuestActInvite` y `GuestActRsvp` para lo demás.
- `eventId` se repite en `GuestSegment`, `ActAudience`, `GuestActInvite` y
  `GuestActRsvp` A PROPÓSITO: es lo que ata las DOS claves foráneas al mismo
  evento. Sin él, la base admitiría meter al invitado de una boda en el grupo de
  otra, y lo único que lo impediría sería el cuidado de quien escribe la
  consulta — que aquí no vale como garantía.
- El orden de decisión de quién ve qué, y el orden importa: una EXCLUSIÓN con
  nombre gana sobre todo; una INVITACIÓN con nombre invita aunque no esté en
  ningún grupo y un `deny` no la tumba —quien escribió el nombre sabía lo que
  había—; un `deny` de grupo gana sobre un `allow`; un `allow` de grupo abre; un
  acto PÚBLICO lo ve cualquiera con el enlace; y si nada dice que sí, es que NO.
  Falla cerrado: no enseñar de menos se arregla con una llamada, enseñar de más
  no se arregla.
- `visibility` es `segmented` POR DEFECTO. Una henna íntima listada en la página
  pública no se puede volver a esconder: el enlace ya se reenvió al grupo.
- El tope de acompañantes es POR ACTO (`GuestActInvite.maxParty`, y el del
  invitado como respaldo). Quien trae acompañante a la recepción no lo trae por
  eso a la henna.
- Responder se comprueba OTRA VEZ al enviar (`mayRespondTo`), no solo al pintar
  la pantalla: entre abrirla y mandarla pueden pasar días, y en esos días el
  organizador puede haber quitado el acto o cerrado el plazo. Una pantalla
  pintada no es un permiso, igual que ocultar un botón no es un permiso.
- `Rsvp` sigue existiendo como RESUMEN y se mantiene al día en la MISMA
  transacción que la respuesta por acto —fuera, un proceso que muriera en medio
  dejaría las dos diciendo cosas distintas, y el resumen es lo que cuenta las
  sillas—. Se CALCULA y no se escribe desde fuera: manda el acto principal
  cuando hay respuesta suya, y si no la hay viene quien viene a algo, con el
  grupo MÁS GRANDE que haya confirmado a algún acto. Contar el último dejaría
  las mesas cortas.
- Un solo acto PRINCIPAL por evento, y lo impide un índice único parcial: dos
  principales serían dos respuestas globales distintas y ninguna mandaría.
- El editor vive en `/panel/eventos/[eventId]/actos`: los actos, su orden, sus
  sedes y qué grupo entra a cada uno. Sin JavaScript de cliente, como el resto —
  cada acto es un `<details>` con su formulario y cada regla de grupo es otro.
  El id del acto y el del grupo viajan en campos ocultos, así que son datos del
  cliente: `lib/acts/service.ts` resuelve oficina Y evento antes de tocar nada, y
  un id de otra boda no encuentra fila en vez de encontrarla y escribirla.
- Subir y bajar un acto INTERCAMBIA los dos `order` en una transacción, y por eso
  `order` no lleva índice único: con él, el intercambio tendría que pasar por un
  valor temporal para no chocar consigo mismo.
- La clave de un grupo sale del nombre solo cuando el nombre tiene letras
  latinas. «عائلة العروس» NO se translitera: sale `grupo-2`. Transliterar un
  nombre árabe automáticamente es lo que este proyecto prohíbe en los slugs, y no
  hay razón para hacerlo aquí y no allí.
- Meter gente en un grupo es un formulario de casillas, y por eso guardar
  REEMPLAZA la lista entera en vez de añadir: una casilla desmarcada no manda
  nada, así que lo que llega es quién se queda dentro y lo que falta es quién
  salió. Añadiendo sin quitar, desmarcar no serviría para nada — que es peor que
  no tener la casilla. Va en una transacción: entre quitar y poner, un grupo a
  medias deja a gente fuera de actos a los que sí estaba invitada, y eso se
  descubre cuando alguien no recibe su invitación.
- La VISTA PREVIA de «qué ve este invitado» llama a `agendaFor`, la MISMA función
  que decide lo que sale en su enlace. No es una maqueta: una que calculara por su
  cuenta se desviaría el día que alguien cambiara una regla, y el único que se
  enteraría sería el invitado. Es la única forma de comprobar una regla sin
  preguntársela a un invitado, y por eso el formulario es un GET: el enlace de
  «lo que ve Rami» se puede pasar a quien esté decidiendo las listas.
- La migración no rompe nada: cada evento que ya existía estrena su acto
  principal con su fecha y su sede, un grupo «todos» con todos sus invitados
  dentro, la regla que los deja pasar, y sus respuestas copiadas. Un evento de
  ayer se comporta hoy igual que ayer y ya puede tener un segundo acto mañana.

- El programa que ve quien abre la invitación lo decide `visitorAgenda` en el
  SERVIDOR: sin enlace personal, los actos públicos y nada más —la invitación se
  reenvía a grupos enteros—; con enlace personal, su agenda. Un token de otra
  boda se trata como si no hubiera ninguno: se enseña lo público y no se dice
  más, porque decir «ese token no es de aquí» ya es contar que existe en otro
  sitio.
- El formulario abierto de siempre contesta al acto PRINCIPAL y solo a ese, y
  escribe las dos filas —el resumen y la respuesta por acto— en la misma
  transacción. Quien llega por un reenvío no se apunta a una henna privada porque
  conozca el enlace público: para contestar a un acto concreto hace falta el
  enlace personal. Un auto-registrado no pertenece a ningún grupo, así que su
  agenda son los actos públicos y ya.
- `repliesEnabled` y `canRespond` son cosas distintas y van separados: «aquí no
  se confirma» es una nota del programa y «se te pasó el plazo» es un aviso a
  quien iba a contestar.
- El calendario devuelve un `VEVENT` POR ACTO, con la zona de cada uno. El `UID`
  sale de `(tenantId, eventId, actId)` por huella, estable entre llamadas: si
  mañana el mismo acto saliera con otro UID, el móvil de cada invitado tendría
  dos citas en vez de una corregida. `SEQUENCE` se deriva de `updatedAt` —en
  segundos desde 2024, no milisegundos desde 1970, que desbordan a los clientes
  de 32 bits— y el evento sin actos conserva su UID de siempre. El enlace que va
  DENTRO del archivo sale de `canonicalOrigin()`, y si no hay dirección
  configurada el archivo sale SIN enlace en vez de fallar: una cita con su hora y
  su sitio sigue sirviendo, y caer a la cabecera sería meterle a un invitado un
  enlace a un dominio ajeno en su propia agenda.
- Los recuentos por acto (`lib/acts/metrics.ts`) son EXACTOS, no una
  aproximación por grupos: aplican invitado a invitado la MISMA regla que decide
  la agenda, así que quien está en dos grupos permitidos se cuenta una vez y una
  exclusión con nombre resta de verdad. Y esa regla vive en UN solo sitio
  (`authorizes`, en `lib/acts/access.ts`): estuvo escrita dos veces, idénticas, y
  así es como empiezan a decir cosas distintas — alguien arregla un caso raro en
  una y queda un panel que promete una lista y una invitación que enseña otra.
- La vista de cobertura enseña los agujeros SILENCIOSOS, que son los peores:
  quien no entra a ningún acto —no hay invitación que mandarle— y quien no tiene
  ni teléfono ni correo. Con NOMBRES y no solo con un número, por la misma razón
  que los envíos fallidos de WhatsApp: «12 fallidos» preocupa y no deja hacer
  nada.
- La lista de un acto se exporta aparte (`/api/events/<id>/actos/<actId>`):
  la cena y la henna no tienen la misma gente ni el mismo día, y eso es lo que se
  le manda al salón y al catering. Usa el MISMO `buildCsv` que la exportación de
  invitados, con su marca de orden de bytes y su neutralización de fórmulas.

### Mesas
- Solo se sienta a quien CONFIRMÓ. Un invitado sin respuesta no ocupa silla:
  repartir doscientas sillas entre gente que a lo mejor no viene es la hoja de
  cálculo que esto viene a sustituir.
- Las sillas las cuenta `Rsvp.party`, que YA se cuenta a sí mismo. Quien
  confirmó por cuatro ocupa cuatro, no una.
- La clave foránea de `Guest` a `Table` es COMPUESTA y lleva el evento dentro
  (`(tableId, eventId)`): la BASE impide sentar a un invitado en la mesa de otra
  boda, no el cuidado de quien escribe la consulta.
- Es `ON DELETE NO ACTION`, y las dos razones importan. `SET NULL` sobre una
  clave compuesta pone a nulo TODAS sus columnas, y `eventId` no lo admite —
  quitar una mesa reventaba. Y `NO ACTION` en vez de `RESTRICT` porque se
  comprueba al final de la orden: borrar una boda entera se lleva sus mesas y
  sus invitados en la misma orden y no tropieza. Quitar UNA mesa levanta primero
  a quien esté en ella, en la misma transacción (`lib/tables/service.ts`).
- El tope de plazas es un AVISO, no una barrera: quien monta el salón sabe
  cuándo cabe una silla más y el programa no.
- Quien se sentó y luego dijo que no viene NO se levanta solo. Sigue en su mesa,
  señalado, contando cero sillas, hasta que lo decida una persona: la mesa la
  montó alguien y puede querer dejar el hueco donde está.
- El reparto automático no parte un grupo y va de mayor a menor: colocados los
  pequeños primero, el grupo de cuatro no cabría en ningún hueco. Es para el
  primer reparto de doscientas personas; a quién se pone al lado de quién lo
  decide la familia.
- Dos listas para imprimir, porque se usan en sitios distintos: por mesa, para
  el salón y el catering; por invitado en orden alfabético, para quien está en
  la puerta y tiene que responder «¿dónde me siento?» en dos segundos. La
  cabecera del panel no se imprime.
- El invitado ve su mesa en `/g/<token>`, el enlace que ya tiene en el móvil, y
  SOLO si ha confirmado: enseñarle mesa a quien dijo que no es prometerle un
  sitio que nadie le ha guardado.

### Cobro
- Un pago «pagado» no es un pago por el importe correcto. Cuando el proveedor
  dice por cuánto cobró, `applySettlement` lo compara con lo que se abrió y, si
  no cuadra, NO liquida nada: deja el cobro pendiente y escribe un
  `PaymentEvent` de `amount_mismatch` con lo esperado y lo recibido. Activar un
  plan porque alguien pagó mil de veinticinco mil es regalar el producto.
- El importe es OPCIONAL en la lectura del proveedor: se leen los nombres de
  campo corrientes, igual que ya se hacía con el estado, y cuando no viene se
  liquida igual — negarse a cobrar porque el proveedor no dice el importe
  dejaría sin cobrar todo. Con la especificación de Whish delante esto se ajusta
  en una línea.
- Un fallo al abrir una cobranza se clasifica: DEFINITIVO —la pasarela contestó
  que no, o un 4xx— suelta la reserva; AMBIGUO —tiempo agotado, un 500— la
  conserva. Ante la duda se conserva, porque la cobranza puede existir al otro
  lado y solo se haya perdido la respuesta: soltarla y reintentar sería abrir
  una SEGUNDA cobranza de verdad. Las que quedan en el aire las resuelve el
  repaso: pregunta por esa referencia, la liquida si se pagó, y si a los quince
  minutos el proveedor sigue sin conocerla la caduca para poder reintentar.
- Líbano cobra con **Whish**. Costa Rica, si se abre, con Tilopay (SINPE Móvil).
- El navegador NUNCA decide un pago. Un regreso a la URL de éxito no es una
  prueba de cobro: se confirma servidor contra servidor con `getStatus()`.
- El callback es un aviso, no una prueba, mientras no haya firma verificable. Y
  como es público y sin firmar, lleva TRES frenos que no deciden sobre dinero:
  tope de diez kilobytes al cuerpo —mirando la cabecera antes de leerlo y el
  cuerpo después, porque la cabecera la escribe quien llama—, cupo por dirección
  y minuto, y corte del MISMO aviso byte a byte durante un minuto. Que no pueda
  cobrar nada ya lo resolvía que nada del cuerpo decida; esto es para que
  llamarlo mil veces no cueste mil consultas a la pasarela ni mil filas de
  historial. El corte va por el CUERPO y no por la referencia: «pendiente» y
  «pagado» son cuerpos distintos del mismo cobro y los dos tienen que pasar.
- Importes SIEMPRE en entero, en la unidad menor de la moneda. Ningún decimal
  toca dinero.
- Todo proveedor entra por el puerto `PaymentProvider`. La aplicación no sabe
  qué pasarela hay detrás.
- El proveedor `mock` está prohibido en producción y el código lo impide.

### SINPE Móvil (Costa Rica)
- NO es una pasarela: no hay a quién preguntarle si un pago entró. Lo único que
  llega es un correo del banco, leído por IMAP cada cinco minutos
  (`citas-sinpe.timer`). Por eso el lector de esos correos es la pieza más
  peligrosa del proyecto: si falla, INVENTA DINERO.
- El lector FALLA CERRADO. Sin monto y comprobante ciertos no devuelve un
  movimiento a medias: no devuelve ninguno. Un pago no reconocido lo arregla una
  persona en un minuto; uno inventado activa un plan que nadie pagó.
- Un número sin marca de moneda ni etiqueta NUNCA es un monto. Es la raíz del
  fallo del CSS: un `width:402.812px` de una hoja de estilo daba ₡402.812 en
  todos los correos de Davivienda.
- Tres trampas, las tres con pruebas (`tests/sinpe.test.ts`):
  1. **Plata que SALE.** Un SINPE enviado también dice «Transferencia SINPE».
     «Débito en su cuenta» se descarta lo PRIMERO, antes de mirar nada más.
  2. **El mismo pago dos veces.** Por cada pago llegan dos correos: el del SINPE
     Móvil —con nombre y comprobante de 25 dígitos— y el de movimiento de
     cuenta, sin nombre y con una referencia corta que se repite siempre porque
     identifica al aviso, no al movimiento. Lo que los distingue es la
     REFERENCIA CORTA, no la frase: un «crédito en su cuenta» con comprobante
     largo sí es un cobro. El repetido se guarda como `ignored` con monto cero.
  3. **Bancos que mandan solo HTML.** `<script>` y `<style>` se van ENTEROS
     antes de nada, y los cierres de celda y fila se vuelven salto de línea o
     «Monto:» se pega a su valor. La referencia se busca en dígitos y solo
     dígitos: capturando letras salía «ncia», el final de «Referencia».
- Se casa por MONTO EXACTO Y CÓDIGO, nunca por monto solo: dos oficinas con el
  mismo plan pagan lo mismo el mismo día. El código (`Order.payCode`) lo escribe
  QUIEN PAGA en el detalle del SINPE — seis caracteres, sin O ni 0 ni I ni 1
  porque en la pantalla de un banco no se distinguen— y se busca en el correo
  ENTERO, porque cada banco llama a esa casilla de otra manera. El comprobante
  del banco no sirve para casar: lo inventa el banco al mandar el dinero.
- El comprobante ES el `providerRef`, único por proveedor, y además único por
  cuenta en `SinpeMovement`. Dos redes distintas contra el doble cobro.
- Lo que no casa se queda `pending` y lo asigna una PERSONA, que sigue exigiendo
  que el importe coincida: que lo pulse alguien no hace buena idea dar por
  pagado un plan de veinticinco mil con un SINPE de mil.
- El buzón se abre en SOLO LECTURA y no se marca nada. Es el correo personal de
  quien cobra, no uno de servicio — y no hace falta: releer los mismos correos
  cada cinco minutos no cobra nada dos veces.
- La contraseña del IMAP, cifrada con AES-256-GCM como la del SMTP, y el
  registro de auditoría anota el servidor y el usuario, jamás la contraseña.
  `logger: false` en el cliente IMAP: por defecto escribe el diálogo completo
  con el servidor —la línea de LOGIN incluida— en el journal.
- Los planes están escritos en DÓLARES y el SINPE solo mueve colones, así que
  se convierten con `CRC_PER_USD`, que se edita en el panel. Un tipo de cambio
  metido en el código envejece solo y el día que lo haga nadie se acordará de
  dónde estaba. El importe se redondea HACIA ARRIBA a los cien colones más
  cercanos: lo teclea una persona en el móvil y tiene que coincidir exacto, y
  redondear hacia abajo regala unos colones en cada cobro.
- El modelo distingue desde el principio el buzón de la PLATAFORMA
  (`tenantId` nulo, las oficinas pagando su mensualidad) del de una OFICINA
  (fase 2, sus clientes pagándole a ella). Hoy solo se usa el primero, pero
  cambiarlo después sería migrar filas de dinero.

### Una base de datos por oficina
- Alquilarle esto a una oficina es darle una EMPRESA nueva: su propia base de
  datos, vacía, sin una sola fila de nadie más. No comparte tabla, ni índice, ni
  fila con ninguna otra oficina, y lo que lo impide no es el filtro por
  `tenantId` que el código no se olvida de poner — es que dos bases de datos de
  PostgreSQL no se consultan entre sí. No hay consulta, descuido ni `where`
  olvidado que pueda cruzarlas.
- `TenantScope` NO desaparece: sigue filtrando dentro de la base de la oficina.
  Son dos redes, la misma idea que el comprobante del SINPE, único por proveedor
  Y por cuenta. La de fuera es la que no se puede saltar.
- Hay DOS planos y no se mezclan. El de CONTROL es la base del ARRENDADOR: el
  registro de oficinas, los planes, los pedidos y cobros de las oficinas al
  dueño, los buzones de SINPE de la plataforma y el superadministrador. El de la
  OFICINA es una base por oficina: sus bodas, sus invitados, sus mesas, su
  equipo, su WhatsApp, su marca. `controlDb()` y `db(scope)`, en
  `lib/db/client.ts`.
- El ámbito lleva la base dentro y se acuña UNA vez, al abrir la sesión, donde
  la oficina ya está leída. Por eso `db(scope)` es SÍNCRONA, por la misma razón
  que `sessionCan`: una función asíncrona a la que se le olvida un `await`
  devuelve una promesa, que es verdadera, y así es como un filtro deja de
  filtrar.
- Una oficina nueva no se migra: se COPIA de una plantilla ya migrada
  (`CREATE DATABASE … TEMPLATE`). Migrar exige la herramienta de Prisma, que es
  una dependencia de desarrollo y no está en la imagen de producción — dar de
  alta una oficina desde el panel no puede depender de algo que allí no existe.
  Y de regalo, el esquema de una oficina nueva es EXACTAMENTE el de una base
  migrada de verdad, `_prisma_migrations` incluida: no hay un segundo camino por
  el que pueda salir distinto.
- La base se crea ANTES que la fila del registro, y si la fila falla se borra la
  base. Al revés queda una oficina apuntada que no puede hacer nada: en este
  reparto, cada una de sus consultas fallaría.
- El nombre de la base se INCRUSTA en la orden —`CREATE DATABASE` no admite
  parámetros— así que pasa por `assertDatabaseName` en CADA frontera que escribe
  DDL. Minúsculas, dígitos y bajos, nada más. Los guiones del subdominio se
  vuelven bajos porque un guion obliga a entrecomillar el nombre en cada
  herramienta que lo toque, y el día que alguien se olvide de las comillas el
  error no es un fallo, es la base equivocada.
- Con una base por oficina, lo que se sirve SIN oficina deja de poder resolverse
  mirando: `/i/<slug>` y `/g/<token>` están en una de trescientas bases y no se
  sabe en cuál. Para eso están `PublicSlug` y `GuestToken` en la base de control,
  que dicen en qué base seguir buscando y nada más — ni el evento, ni la fecha,
  ni los novios.
- «Aplicar las migraciones» deja de ser una orden y pasa a ser una por oficina.
  `npm run db:fleet -- migrar` pone al día la plantilla y todas; `estado` enseña
  las atrasadas ARRIBA y en rojo, igual que los buzones de SINPE caídos: es el
  mismo tipo de avería —algo que desde fuera se ve igual que si no pasara nada—.
  Una oficina con el esquema viejo no falla al arrancar: falla la primera vez que
  alguien usa lo nuevo, que es cuando peor viene enterarse.
- Dónde vive cada cosa, y la línea no es arbitraria: en la base de la OFICINA va
  lo que es su trabajo —eventos, invitaciones, imágenes, invitados, mesas,
  confirmaciones, números de WhatsApp y sus mensajes—; en la de CONTROL va lo que
  es del arrendador —el registro de oficinas, las personas y sus sesiones, los
  planes, los pedidos y cobros, el SINPE, la configuración y el historial—. El
  esquema ya estaba partido así: NINGUNA clave foránea cruza la frontera, y eso
  no es casualidad sino la comprobación de que la línea está donde tenía que
  estar.
- Un trabajo automático que antes era UNA consulta con un `IN` ahora es una por
  oficina (`eachOffice`). No hay atajo: preguntarle a todas a la vez es
  exactamente lo que una base por oficina impide. Una oficina que falle no se
  lleva por delante a las demás.
- El interruptor es `TENANCY`, y el orden de encenderlo NO es negociable:
  `npm run db:split -- copiar` mueve lo que ya existe y COMPRUEBA los recuentos,
  luego se pone `TENANCY=fleet`, luego se MIRA —una boda, sus invitados, sus
  mesas, una invitación pública— y solo entonces `npm run db:split -- limpiar`
  borra de la común lo copiado. Son dos órdenes y no una porque entre copiar y
  borrar tiene que caber que alguien mire: una copia que se creyó buena y no lo
  era, con el original ya borrado, no tiene arreglo, y esto son listas de
  invitados de bodas ya pagadas. `limpiar` se niega si los recuentos no cuadran o
  si queda alguna oficina sin base.
- La frontera la vigila `npm run lint:planes`, y corre en el despliegue junto a
  la de RTL. Una consulta de una oficina escrita contra `controlDb()` NO da
  error: escribe en la base donde están todas y el aislamiento vuelve a depender
  de que nadie se olvide un `where`, que es de lo que veníamos. Sigue las
  variables y las transacciones, que heredan el plano de quien las abre. Cruzar
  la frontera a propósito se puede, pero hay que NOMBRAR el archivo y decir por
  qué: hoy son dos, el respaldo del directorio y el guion que mueve las filas.
- Encender la flota sin haber copiado no parte nada: deja a las oficinas sin
  base, ninguna consulta suya se atiende y `/panel/sistema` lo marca en rojo. Es
  el fallo correcto —ruidoso y sin pérdida— y por eso `db(scope)` se niega a caer
  en la base común cuando falta la propia: ahí está el registro de TODAS, y una
  consulta suya sin filtro las vería enteras.

### Lo que impide la base, no el código
- Una sesión cuelga de su oficina (`Session.tenantId` con clave foránea), y
  resolverla mira si esa oficina sigue abierta. Suspender una oficina no
  suspendía NADA: se comprobaba en cero sitios, y aunque se comprobara al
  entrar, una sesión dura treinta días — quien ya estaba dentro seguía
  trabajando hasta que se le ocurriera salir. El superadministrador se salva:
  es quien tiene que poder entrar a arreglar lo que llevó a suspenderla.
- Quién puede usar CONTRASEÑA se decide por el rol de AHORA (`mayUsePassword`),
  no por tener un hash guardado. Degradar a un administrador a operador le
  quitaba los permisos y le dejaba la contraseña: la mitad del trabajo. Una sola
  función, usada al entrar, en el perfil y por `npm run auth:password`.
- Un mensaje de WhatsApp cuelga de su evento por `(eventId, tenantId)` y de su
  invitado por `(guestId, eventId)`. El invitado no lleva oficina —cuelga de su
  evento— así que la cadena se cierra por ahí. Las dos claves van
  `DEFERRABLE INITIALLY DEFERRED` en la migración y sin eso NO funcionan: borrar
  una oficina fallaba, porque la cascada borra sus eventos y la comprobación
  saltaba ahí mismo aunque los mensajes se estuvieran borrando en la misma
  orden. Prisma no sabe declararlo, así que vive en el SQL.

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
- Chromium NO corre como root. Se niega a usar su recinto siéndolo, y entonces
  hay que quitárselo: una pared menos entre una página y la máquina, después del
  filtro de red de `render/origin.ts`. La unidad de systemd corre como `www` y
  la imagen de Docker declara `USER node`; si aun así se llega ahí,
  `/panel/sistema` lo marca en rojo y el diario lo dice.
- Un memorial NUNCA usa la plantilla de celebración. `templateFor()` y
  `themeFor()` lo deciden por tipo de evento, no quien rellena el formulario.
- Las invitaciones se renderizan en el SERVIDOR, nunca en el cliente
- Salida: PNG 1080x1920 y página web responsive
- La página web y el PNG comparten el MISMO componente (`InvitationCard`);
  no se duplica nunca la maquetación
- Las plantillas son HTML/SVG con capas, nunca imágenes generadas por IA

### Operación
- `GET /healthz` dice si el PROCESO está vivo y `GET /readyz` si puede ATENDER
  —que la base contesta, con dos segundos de tope—. No son lo mismo y
  confundirlos cuesta en las dos direcciones: un proxy que quite de rotación un
  proceso sano porque la base tarda deja el sitio sin servidores, y uno que
  mande tráfico a un proceso que no puede leer nada devuelve errores a los
  invitados. Las once comprobaciones con detalle siguen en `/panel/sistema`;
  esto es para un proxy, sin sesión y sin datos dentro.
- Un cobro que lleva un mes abierto se CIERRA a `expired` en el repaso. El
  repaso solo mira la ventana de los últimos treinta días, así que lo anterior
  se quedaba «pendiente» para siempre: pendientes eternos que ensucian la
  facturación y que, por el índice de «un cobro abierto por pedido», impiden
  abrir uno nuevo.
- Una invitación se dibuja UNA vez por versión aunque la pidan doscientos a la
  vez (`lib/render/once.ts`), y nunca hay más de dos Chromium dibujando. Es el
  caso normal, no el raro: la invitación se reenvía a un grupo y la abren todos
  en el mismo minuto, y la primera vez ninguna está en caché.

### Seguridad de borde
- La dirección que abre Chromium para hacer la foto sale de un origen FIJO
  (`lib/render/origin.ts`), NUNCA de la petición. Salía de `request.url`, que
  Next arma con la cabecera `Host` — la escribe quien llama: bastaba una
  petición con `Host: atacante.example` para que el servidor abriera un
  navegador contra esa dirección y el resultado se guardara en `Render` y se
  sirviera desde nuestro dominio. Y Chromium solo puede PEDIR lo que cuelga de
  ese origen: lista de permitidos, no de prohibidos, porque una de prohibidos se
  salta con una redirección o con un nombre que resuelve a una IP privada.
- `canonicalOrigin` no acepta cualquier cabecera: tiene que tener forma de
  dominio público y, en producción, ser un dominio que esta instalación conozca.
  Si no, no escribe el enlace. Fallar es arreglable; un enlace de pago hacia un
  dominio ajeno, no.
- Cabeceras de seguridad en `next.config.mjs`: CSP, HSTS, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`. `frame-ancestors 'self'` y no
  `'none'`, porque la espera del código QR vive en un marco de este mismo
  origen.
- El CSV neutraliza las celdas que empiezan por `=`, `+`, `-` o `@`: esas tres
  hojas de cálculo las EJECUTAN al abrir el archivo, y aquí el nombre lo escribe
  cualquiera — el formulario de confirmación es público a propósito. Los números
  no se tocan: la columna tiene que poder sumarse.

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
npm run lint:planes # guardia de la frontera: cada consulta en su base
npm run brand:build # redibuja el logo, los iconos y los de la app móvil
npm run db:check   # aplica las migraciones en una base nueva y comprueba el esquema
npm run db:fleet   # la flota: -- migrar | estado | crear <subdominio>
npm run db:split   # mueve cada oficina a su base: -- copiar | limpiar
npm run sinpe:check # revisa los buzones de SINPE (lo llama el temporizador)
npm test           # las pruebas (necesitan PostgreSQL; sin él se saltan)
```

### Las pruebas
- Con el corredor que trae Node (`node --test`), sin instalar nada.
- Contra PostgreSQL DE VERDAD, no contra un doble. Casi todo lo que cubren
  —bloqueos de fila, `SKIP LOCKED`, índices únicos parciales, claves foráneas
  compuestas— lo hace la base, no el código: un doble que no las implemente daría
  verde a los mismos fallos que estas pruebas existen para atrapar.
- **En serie** (`--test-concurrency=1`): comparten una sola base.
- Sin `DATABASE_URL` se saltan, pero lo DICEN en grande. Saltarse una prueba en
  silencio es peor que no tenerla: quien la ejecuta ve «0 fallos» y se queda
  tranquilo sin enterarse de que lo que protege el dinero no llegó a correr. Una
  revisión externa contó sesenta y seis pruebas donde hay ciento cuarenta y una,
  y la diferencia era exactamente esa.
- `npm run db:check` es lo otro que no se puede dar por hecho: aplica TODAS las
  migraciones sobre una base creada desde cero y comprueba que el esquema salió
  como dice el código. «Escritas» y «funcionan» no es lo mismo, y dos de este
  proyecto lo demostraron: la de las mesas reventaba al quitar una, y la de la
  cadena de oficina impedía borrar una oficina entera.
- Seis frentes, los que costaron dinero o confianza: el cobro y su liquidación,
  la concurrencia de la cola de WhatsApp, el aislamiento entre oficinas, las
  fechas con el calendario —que ahora se comprueban contra el CALENDARIO y no
  contra una expresión: un 30 de febrero pasaba y se publicaba—, el reparto de
  las mesas, el acceso, y el SINPE — que es el
  único que puede inventar dinero, y por eso lleva dos archivos de pruebas: el
  lector de correos y el casado contra la base.

## Documentos
- `MANUAL.md` — manual de uso: arrancar, crear invitaciones, idiomas, PNG,
  versículos, fuentes y problemas frecuentes.
- `docs/ARQUITECTURA.md` — producto completo: oficinas (multiempresa), roles,
  las tres formas de venderlo, apps móviles, descargas y despliegue.
- `apps/web/prisma/schema.prisma` — modelo de datos, aplicado y migrado.
- `docs/COBRO-WHISH.md` — cobro en Líbano con Whish: qué pedirle al proveedor y
  las reglas de la integración.
- `docs/DECISIONES-PENDIENTES.md` — lo que no es código y bloquea fases enteras.
- `docs/DECISIONES-TOMADAS.md` — lo que YA está decidido, con su porqué y qué
  habría que hacer para cambiarlo. Manda sobre cualquier otro documento que diga
  otra cosa; existe porque el proyecto llegó a contradecirse a sí mismo.
- `docs/WHATSAPP-CLOUD.md` — la transición del número por QR al canal oficial:
  qué cambia, en qué orden y las cuatro cosas que no puede hacer el código.
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
- `/panel/eventos/[eventId]/mesas` — el reparto del salón, y
  `/mesas/imprimir?vista=mesa|invitado` las dos listas de papel.
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
  - **SINPE Móvil**: los buzones de banco que se revisan y todo lo leído de
    ellos. Los que NO conectan salen arriba del todo y en rojo: un buzón caído
    es plata que deja de entrar, y desde fuera se ve igual que si nadie hubiera
    pagado. Hay además una caja para pegar un correo a mano — es la única forma
    de comprobar que los patrones de SU banco funcionan antes de confiarle el
    cobro, y sirve para un SINPE que llegó por mensaje.
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
  - La fila NO es `flex-wrap`: los enlaces se quedan con el hueco que sobra y se
    parten ellos. Envolviéndola entera, el menú de la cuenta era lo primero que
    se caía a una segunda línea, y es justo lo que tiene que estar siempre al
    final.
  - «Superadmin» NO es un nombre: es la etiqueta de un puesto que escribe
    `db:seed` porque tenía que escribir algo, y acababa saludando al dueño por
    su cargo en su propio panel. `displayName()` trata los marcadores del
    sembrado como «sin nombre» y cae a la parte local del correo, que al menos
    es de esa persona. Quien escriba su nombre en su perfil verá el suyo.

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
