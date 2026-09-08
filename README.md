# Citas — motor de render de invitaciones

Fase 1 de la plataforma de invitaciones digitales multiidioma. Este repositorio
contiene **solo el motor de render**: recibe los datos de un evento y produce
(a) una página web para el invitado y (b) un PNG de 1080×1920 generado en el
servidor. Sin auth, sin base de datos, sin pagos.

## Arranque

```bash
npm install
npm run dev
```

| Ruta | Qué hace |
| --- | --- |
| `/` | Índice interno con las invitaciones sembradas |
| `/i/[slug]` | Página web que abre el invitado |
| `/api/render/[slug]` | Descarga el PNG 1080×1920 de esa misma invitación |
| `/render/[slug]` | Lienzo de captura de 1080×1920 (interno, `noindex`) |

Ejemplos sembrados: `ejemplo-ar` (árabe, RTL), `ejemplo-es`, `ejemplo-en`,
`ejemplo-pt`.

## Por qué Puppeteer y no @vercel/og (Satori)

Se evaluaron las dos opciones y se eligió **Chromium headless vía
`puppeteer-core`**:

1. **Modelado del árabe.** Satori hace su propio layout de texto y no ejecuta
   HarfBuzz: las uniones cursivas, las ligaduras y el posicionamiento de los
   diacríticos del árabe salen incorrectos o inconsistentes. Chromium usa el
   mismo motor de texto que ve el invitado en su navegador. Siendo el árabe el
   idioma principal del mercado inicial, esto no es negociable.
2. **Propiedades lógicas.** Satori soporta un subconjunto de CSS (flex, sin
   `container-type`, con soporte parcial de propiedades lógicas). Cumplir la
   regla de "solo CSS lógico" con Satori obligaría a escribir la plantilla dos
   veces, una por dirección.
3. **Una sola fuente de verdad.** El PNG es una captura de la misma ruta y el
   mismo componente React que sirve la web (`InvitationCard`), así que la imagen
   y la página no pueden divergir. Con Satori habría dos maquetaciones que
   mantener en paralelo.

El coste es que el runtime necesita un binario de Chromium (no funciona en Edge
Runtime). `src/lib/render/browser.ts` lo localiza por `CHROMIUM_PATH`,
`PUPPETEER_EXECUTABLE_PATH`, un directorio de navegadores de Playwright o las
rutas habituales del sistema, y reutiliza una única instancia por proceso.

Si más adelante hiciera falta desplegar en Edge, la salida para invitaciones
**latinas** podría generarse con Satori, pero el árabe seguiría necesitando
Chromium.

## Arquitectura

```
data/            invitations.json (datos sembrados) · verses.json (lista fija de versículos)
locales/         ar.json · es.json · pt.json · en.json  ← todo string visible
public/fonts/    Amiri · Playfair Display · Inter (TTF locales, OFL 1.1)
scripts/         check-logical-css.mjs  ← guardia de CSS físico
src/app/         layout · página índice · /i/[slug] · /render/[slug] · /api/render/[slug]
src/components/
  invitation/    piezas reutilizables (Kicker, HostsBlock, HonoreesBlock, …) + InvitationCard
  templates/     registry.ts + classic-gold/ (plantilla y sus ornamentos SVG)
src/lib/         types · validate · invitations · verses · dictionary · numerals · datetime · typography
src/lib/render/  browser.ts (Chromium) · png.ts (captura)
```

### Cómo se mantiene idéntica la composición en web y en PNG

La tarjeta es un **contenedor de consulta CSS** (`container-type: size`) con
relación de aspecto 1080/1920, y todas las medidas tipográficas y de espaciado
se expresan en unidades `cqw`. La misma tarjeta a 1080 px de ancho (captura) y a
340 px (móvil) produce exactamente la misma composición, sin transformaciones ni
hojas de estilo separadas.

### Internacionalización

- `dir` y `lang` se fijan en la raíz de la tarjeta a partir de la invitación.
- Cero texto en los componentes: todo sale de `/locales`. El tipo `Dictionary`
  se comprueba **en tiempo de compilación** contra los cuatro archivos, así que
  una clave que falte en `pt.json` rompe el `build`.
- `npm run lint:rtl` falla ante cualquier `margin-left`, `pr-*`, `text-right`,
  `float`, etc. en `src/`.
- Los ornamentos son SVG con simetría especular dibujados en su propio sistema
  de coordenadas: se ven igual en RTL que en LTR sin lógica de dirección.
- Los números se muestran en cifras arábigas orientales (٠١٢٣) o occidentales
  (0123) según `numeralSystem`; las fechas pasan por `Intl` con
  `-u-nu-arab`/`-u-nu-latn` y locale regional (`ar-LB` da los meses levantinos:
  تشرين الأول, no أكتوبر).
- Fechas y horas se anclan a UTC para que la web y el PNG coincidan siempre,
  sea cual sea la zona horaria del servidor.

### Datos

`data/invitations.json` se valida en tiempo de ejecución (`src/lib/validate.ts`,
`src/lib/invitations.ts`): un slug duplicado, un color mal formado, una URL de
mapa no http(s) o una `direction` que no case con el `locale` detienen el
arranque con un error que apunta a la ruta JSON exacta. Los tipos se definen en
`src/lib/types.ts`.

### Versículos

`data/verses.json` es una lista fija. Una invitación referencia un versículo por
`quoteId`; si el id no está en la lista, el loader lanza un error en vez de
mostrar nada aproximado. Nunca se genera, completa ni corrige un texto religioso
en tiempo de ejecución.

> Las entradas sembradas todavía tienen `verifiedBy: null`. Antes de producción,
> una persona debe cotejarlas con la edición citada y firmar el campo.

## Verificación

```bash
npm run typecheck   # TypeScript estricto, sin any
npm run lint:rtl    # guardia de CSS lógico
npm run build
```

## Siguiente fase

RSVP + persistencia en PostgreSQL vía Prisma, `.ics` y enlace a mapa.
