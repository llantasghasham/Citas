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
navegador instalado. No hace falta configurarlo si Chrome o Chromium están en una
ruta habitual del sistema; si no, se indica con la variable `CHROMIUM_PATH`.

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
| `No Chromium executable found` | No hay navegador instalado o está en otra ruta. Definir `CHROMIUM_PATH`. |
| El PNG sale con la fuente equivocada | Falta el archivo en `public/fonts/` o el `@font-face` en `globals.css`. |
| `Invalid data at "…"` al arrancar | El mensaje señala el campo exacto de `data/invitations.json`. |
| El árabe sale con las letras sueltas | Se ha aplicado `letter-spacing` a texto árabe. Debe pasar por `latinOnly()`. |
| `npm run lint:rtl` falla | Se ha colado CSS físico. El error dice el archivo, la línea y con qué sustituirlo. |
