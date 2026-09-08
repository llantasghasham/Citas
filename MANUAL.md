# Manual de uso

Manual operativo del motor de invitaciones. Para la arquitectura del producto
completo (oficinas, roles, apps móviles, formas de venta) ver
[`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## 1. Requisitos

| Pieza | Versión | Para qué |
| --- | --- | --- |
| Node.js | 20 o superior | ejecutar la aplicación |
| Chromium o Google Chrome | cualquiera reciente | generar el PNG en el servidor |

El PNG se genera fotografiando una página real, así que el servidor necesita un
navegador instalado. Si Chrome o Chromium están en una ruta habitual del sistema
(`/usr/bin/chromium`, `/usr/bin/google-chrome`, la carpeta Aplicaciones en Mac)
se encuentran solos. En cualquier otro caso —entre ellos un navegador gestionado
por Playwright, que vive en una carpeta con número de versión— hay que indicarlo
con `CHROMIUM_PATH`.

## 2. Arrancar

```bash
npm install
npm run dev          # http://localhost:3000
```

En producción:

```bash
npm run build
npm start
```

Variables opcionales:

```bash
CHROMIUM_PATH=/ruta/al/chrome     # si el navegador no está donde se espera
NEXT_PUBLIC_SITE_URL=https://…    # dominio público, para las vistas previas al compartir
```

## 3. Las rutas

| Ruta | Qué devuelve |
| --- | --- |
| `/` | Índice interno con las invitaciones cargadas |
| `/i/[slug]` | La invitación que abre el invitado |
| `/api/render/[slug]` | El PNG de 1080×1920 |
| `/render/[slug]` | Lienzo interno de captura. No se comparte |

Ejemplos incluidos: `ejemplo-ar`, `ejemplo-es`, `ejemplo-en`, `ejemplo-pt`.

## 4. Crear o editar una invitación

Mientras no haya base de datos, las invitaciones viven en
`data/invitations.json`. Se añade un objeto al array `invitations`:

| Campo | Qué es | Reglas |
| --- | --- | --- |
| `id` | identificador interno | único |
| `slug` | lo que va en la URL | único, sin espacios ni acentos |
| `eventType` | tipo de evento | `wedding`, `graduation`, `birthday`, `baptism`, `memorial` |
| `locale` | idioma | `ar`, `es`, `pt`, `en` |
| `direction` | dirección del texto | `rtl` si el idioma es `ar`, `ltr` en el resto |
| `templateId` | plantilla | por ahora solo `classic-gold` |
| `numeralSystem` | cifras | `arabic` (٠١٢٣) o `latin` (0123) |
| `hosts` | quién invita | lista de `{ name, role }` |
| `honorees` | de quién es el evento | lista de `{ name }`, al menos uno |
| `date` | fecha | `AAAA-MM-DD` |
| `time` | hora local del lugar | `HH:mm` en 24h |
| `hijriDate` | fecha hijri | texto ya escrito; el sistema no la calcula |
| `venue` | lugar | `{ name, address, mapUrl, lat, lng }`, `mapUrl` debe ser http(s) |
| `message` | texto libre del anfitrión | ya escrito en el idioma de la invitación |
| `quoteId` | versículo | debe existir en `data/verses.json` |
| `theme` | colores | tres colores en formato `#rrggbb` |
| `rsvp` | confirmación | `{ enabled, deadline }`; `deadline` en `AAAA-MM-DD` o `null` |

Roles posibles en `hosts`: `parents`, `father`, `mother`, `family`, `couple`,
`self`, `institution`, `host`. El texto del rol se traduce solo; en el JSON solo
va la clave. Si dos anfitriones seguidos comparten rol, la etiqueta se imprime
una sola vez.

**Los datos se validan al arrancar.** Un color mal escrito, un slug repetido o
una fecha inválida detienen el arranque con un mensaje que dice exactamente qué
campo y en qué posición del archivo. Es intencionado: es mejor que romper en
producción con una invitación a medias.

## 4 bis. Usar PostgreSQL en vez del archivo JSON

El motor lee de `data/invitations.json` por defecto. Para leer de la base de
datos se cambia una variable, sin tocar código: las páginas hablan con un
repositorio, no con el archivo.

```bash
# 1. Configurar la conexión
cp .env.example .env         # y rellenar DATABASE_URL

# 2. Crear las tablas
npm run db:migrate           # en desarrollo
npm run db:deploy            # en producción

# 3. Cargar los ejemplos (idempotente: se puede repetir)
npm run db:seed

# 4. Activar la base de datos
DATA_SOURCE=database npm run dev
```

Notas:

- **El seed pasa por la misma validación** que el archivo JSON, así que lo que
  entra en la base de datos ya se comprobó campo por campo.
- Con `DATA_SOURCE=json` las invitaciones se pre-generan en el build. Con
  `database` se generan a demanda, para que publicar una invitación no exija
  recompilar.
- `npm run db:studio` abre un navegador de la base de datos.
- El cliente de Prisma se genera en `src/generated/` y **no se versiona**: lo
  regenera `npm install` automáticamente.

## 4 ter. Entrar al panel

No hay contraseñas. Se entra con un código de un solo uso enviado por correo.

```bash
npm run db:seed              # crea el superadministrador
npm run dev
# abrir http://app.localhost:3000/entrar
```

- El correo del superadministrador sale de `SUPERADMIN_EMAIL`
  (por defecto `admin@citas.local`).
- **En desarrollo el código se imprime en el log del servidor**, no se envía.
  El emisor de consola se niega a arrancar en producción, así que antes de
  desplegar hay que configurar un proveedor de correo real en `src/lib/mail/`.
- El código dura 10 minutos, admite 5 intentos y **muere en cuanto se usa**.
  Una dirección puede pedir 3 códigos cada 15 minutos.
- Si la dirección no tiene acceso, la respuesta es exactamente la misma: quién
  tiene cuenta no es algo que un desconocido pueda averiguar probando.

### La oficina sale del subdominio

`app.localhost:3000` es la plataforma; `agenciax.localhost:3000` sería una
oficina. La pantalla de entrada se muestra en el idioma de esa oficina — una
oficina de Beirut ve su panel en árabe y de derecha a izquierda.

Una vez dentro, **la oficina la manda la sesión, no el host**: cambiar el
subdominio no cambia a qué oficina perteneces.

## 4 quater. Confirmaciones y descargas

### El invitado confirma

Debajo de la invitación, cuando `rsvp.enabled` está activo, aparece el
formulario: **Confirmo / No puedo / Todavía no lo sé**, nombre, número de
asistentes y un mensaje opcional. Sale en el idioma de la invitación y en su
dirección de escritura.

- **Requiere `DATA_SOURCE=database`.** Sin base de datos el formulario no se
  muestra: enseñar un formulario que no puede guardar es peor que no enseñarlo.
- El formulario es **público a propósito**. En Líbano un enlace se reenvía a un
  grupo entero de WhatsApp, y pedirle cuenta a cada invitado costaría más
  respuestas de las que ahorraría en spam.
- El invitado que responde queda recordado en una cookie, así que puede volver y
  **cambiar su respuesta** sin crear ninguna cuenta.
- Contra el abuso: un máximo de 10 altas por IP cada 10 minutos, y quien vuelve
  a enviar el formulario actualiza su respuesta en vez de aparecer dos veces.
- El plazo es inclusivo: una fecha límite del día 3 admite respuestas durante
  todo el día 3.

### Añadir al calendario

`GET /api/calendar/[slug]` devuelve un archivo `.ics`. La hora se convierte
desde la hora local del lugar (campo `timeZone`, por defecto `Asia/Beirut`) a un
instante real, así que el invitado lo ve correcto esté donde esté.

### Descargar la lista de invitados

Desde el panel, el número de invitados de cada evento es un enlace a
`GET /api/events/[eventId]/guests`, que devuelve un CSV con nombre, idioma,
respuesta, acompañantes, mensaje y fecha.

- Lleva marca de orden de bytes, para que **Excel abra el árabe correctamente**.
- La autorización se comprueba en el servidor: sin sesión responde 401, y un
  evento de otra oficina responde 404 igual que uno que no existe.
- Cada descarga queda registrada en el historial.

## 4 quinquies. Crear una invitación desde la web

`/crear` es un formulario de cinco pasos con **vista previa al lado**:

1. Idioma y tipo de evento
2. Nombres de los homenajeados y de quién invita
3. Fecha, hora, zona horaria y lugar
4. Mensaje, versículo, forma de los números y confirmación de asistencia
5. Revisión y publicación

Detalles que conviene conocer:

- **El formulario habla el idioma de la invitación.** En cuanto se elige árabe
  en el paso 1, el resto del formulario pasa a árabe y a derecha-izquierda.
- **La vista previa es la invitación de verdad**, el mismo componente que
  produce la página pública y el PNG, renderizado en el servidor. No es una
  maqueta que pueda desviarse. Se actualiza al pasar de paso, no al teclear:
  las invitaciones se componen en el servidor, nunca en el cliente.
- **Funciona sin JavaScript de cliente.** Por eso los nombres son dos casillas
  fijas y no un botón de «añadir otro».
- **La lista de versículos es cerrada.** Solo se puede elegir entre los que ya
  están verificados en `data/verses.json`; no hay campo libre para un texto
  sagrado.
- **El borrador vive en una cookie** durante siete días, así que se puede cerrar
  el navegador y seguir después.
- **Publicar exige sesión.** Sin ella el formulario funciona y la vista previa
  también, pero el botón de publicar está desactivado: una puerta abierta aquí
  dejaría a cualquiera crear páginas en el dominio.
- **El enlace se genera solo.** Con nombres en alfabeto latino sale legible
  (`james-nadia-a1b2c3`); con nombres en árabe sale `invitacion-a1b2c3`, porque
  transliterar un nombre automáticamente es justo lo que este proyecto prohíbe.
- Si no se indica enlace de mapa, se genera una búsqueda con el nombre y la
  dirección del lugar.

## 4 sexies. El panel: oficinas, equipo y suscripción

El panel tiene cuatro secciones y **cada una se muestra solo si el rol la
permite** — la comprobación está en el servidor, no en si se ve el enlace.

| Sección | Quién entra | Para qué |
| --- | --- | --- |
| Eventos | todos | Eventos de la oficina y sus confirmaciones |
| Oficinas | superadmin | Alta y listado de oficinas, con su plan |
| Equipo | admin de oficina | Miembros y sus roles |
| Suscripción | admin de oficina | Plan, límites y facturas |

### Planes

| Plan | Precio | Eventos | Invitados |
| --- | --- | --- | --- |
| Gratis | 0 | 1 | 50 |
| Un evento | 30 US$ por evento | sin límite | 300 |
| Anual | 15 US$/mes | 10 | 500 |
| Oficina | 120 US$/mes | sin límite | sin límite |

Los precios se guardan en **centavos enteros**. El límite de eventos se
comprueba al publicar, en el servidor; si se alcanza, la publicación se rechaza.

### Cómo se cobra

1. Se elige un plan → se abre una **factura** (`Order`) y se pide un cobro al
   proveedor configurado en `PAYMENTS_PROVIDER`.
2. El navegador vuelve a la página de suscripción. **Eso no confirma nada.**
3. El botón «Pagar» de la factura pregunta al proveedor cuál es el estado real.
   Solo esa respuesta marca la factura como pagada y mueve la oficina de plan.

Con `PAYMENTS_PROVIDER=mock` la primera consulta devuelve «pendiente» y la
segunda «pagada», precisamente para poder probar ese camino. En producción el
proveedor será Whish, y el código no cambia: entra por el mismo puerto.

### Añadir a alguien al equipo

Se escribe su correo y se elige el rol. No se envía invitación ni se crea
contraseña: la cuenta queda creada y esa persona entra con un código de un solo
uso cuando quiera.

## 4 septies. La app móvil

```bash
npm install                        # desde la raíz: instala los tres paquetes
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000 npm run mobile
```

- `EXPO_PUBLIC_API_URL` debe apuntar al servidor web **accesible desde el
  teléfono**: `localhost` no vale desde un dispositivo real. Para una oficina,
  su propio subdominio.
- Se entra con el mismo código de un solo uso que en la web. El token se guarda
  en el llavero del dispositivo, no en almacenamiento plano.
- Una sola app para todo el equipo: con rol de organizador se ve un evento; con
  rol de oficina, la cartera entera. Lo que cambia es lo que el rol permite.
- **El árabe exige reiniciar la app.** React Native decide la dirección del texto
  al arrancar; al cambiar a un idioma RTL la app avisa en vez de quedarse a
  medias.
- La app no vende nada: las tiendas cobran comisión sobre bienes digitales, así
  que el pago se hace en la web.

> Estado: el paquete de Android compila y empaqueta correctamente (599 módulos),
> y la API que consume está verificada. **No se ha ejecutado en un dispositivo ni
> en un emulador**, porque no había ninguno disponible durante el desarrollo.

## 5. Cambiar textos e idiomas

Ningún texto visible está en el código. Todo vive en `locales/ar.json`,
`locales/es.json`, `locales/pt.json` y `locales/en.json`, con la misma estructura
en los cuatro.

- Para cambiar una frase: se edita en los cuatro archivos.
- Para añadir una clave nueva: se añade al tipo `Dictionary` en
  `src/lib/types.ts` y luego a los cuatro archivos. Si falta en uno,
  `npm run build` falla. Así no llega nunca un hueco vacío a producción.
- Los nombres de meses y días **no** están en estos archivos: los da el sistema
  operativo a través de `Intl`, ya localizados (en árabe se usa `ar-LB`, que da
  los meses levantinos: تشرين الأول, no أكتوبر).

## 6. Descargar el PNG

```bash
curl -o boda.png http://localhost:3000/api/render/ejemplo-ar
```

Sale a 1080×1920, la medida de story de Instagram y de estado de WhatsApp.
Desde el navegador, abrir esa URL descarga el archivo directamente.

## 7. Añadir un versículo

1. Verificar el texto contra la edición impresa o una fuente oficial. **Esto lo
   hace una persona, nunca la IA.**
2. Añadir la entrada a `data/verses.json` con su `id`, `locale`, `tradition`,
   `text`, `source` y tu nombre en `verifiedBy`.
3. Referenciarla desde la invitación con `quoteId`.

Si el `quoteId` no existe en la lista, la aplicación falla al arrancar en vez de
mostrar algo aproximado. Es deliberado.

## 8. Añadir una fuente

1. Comprobar que su licencia permite uso comercial e incrustación.
2. Copiar el archivo a `public/fonts/` y anotarlo en `public/fonts/README.md`.
3. Declarar el `@font-face` en `src/app/globals.css`.
4. Añadirla a `tailwind.config.ts` y usarla desde `src/lib/typography.ts`.

Nunca por CDN: el render en servidor necesita el archivo en disco y una CDN
metería un fallo de red en el camino crítico de la imagen.

## 9. Verificar antes de dar algo por terminado

```bash
npm run typecheck   # TypeScript estricto, sin any
npm run lint:rtl    # que no haya CSS físico (margin-left, pr-, text-right, float…)
npm run build
```

Y la regla que no comprueba ninguna máquina: **abrir la invitación en árabe**.
Si algo se rompe en RTL, se rompe ahí.

## 10. Problemas frecuentes

| Síntoma | Causa y solución |
| --- | --- |
| `No Chromium could be started` | No hay navegador instalado o está en otra ruta. El mensaje lista lo que se intentó; definir `CHROMIUM_PATH`. |
| El PNG sale con la fuente equivocada | Falta el archivo en `public/fonts/` o el `@font-face` en `globals.css`. |
| `Invalid data at "…"` al arrancar | El mensaje señala el campo exacto de `data/invitations.json`. |
| El árabe sale con las letras sueltas | Se ha aplicado `letter-spacing` a texto árabe. Debe pasar por `latinOnly()`. |
| `npm run lint:rtl` falla | Se ha colado CSS físico. El error dice el archivo, la línea y con qué sustituirlo. |
| `The console mailer must never run in production` | Correcto: hay que configurar un proveedor de correo real antes de desplegar. |
| El panel sale en el idioma equivocado | La oficina se resuelve por `x-forwarded-host`. El servidor debe estar detrás del proxy que fija esa cabecera. |
