# Directorio — diseño final, antes de escribir código

Sigue a `docs/DIRECTORIO.md` (el plan) y recoge las siete decisiones aprobadas el
12 de septiembre de 2026. Esto es lo que se va a construir, con nombres de
tablas, de rutas y de archivos. Cuando esté revisado, empieza la Fase 1 y nada
más que la Fase 1.

**Lo aprobado:** francés ahora · `PublicListing` separada de `Event` ·
almacenamiento de objetos con tope de 10 imágenes y un vídeo externo ·
moderación en 24 horas hábiles y `pending_review` fuera del público ·
denuncias de copyright con ocultamiento temporal · y nada del piloto de
invitaciones mezclado aquí.

---

## 0. Una decisión que hay que tomar antes de la primera línea

**El francés no puede ser un valor más del enum `Locale`.**

`Locale` es `ar | es | pt | en` y está en tres sitios: el enum de Prisma,
`packages/core/src/types.ts` y cada `Record<Locale, …>` del repositorio. Añadir
`fr` ahí obliga a **traducir el producto entero al francés** —el panel, el
manual con sus veintidós capítulos, los correos, la app móvil—, porque el tipo
`Dictionary` exige todas las claves de todos los idiomas. Son unas mil
cuatrocientas frases, y el encargo dice lo contrario: «conserva los idiomas
existentes del producto actual».

**Propuesta:** dos conjuntos, separados a propósito.

```ts
// El producto: panel, invitaciones, manual, correos, app móvil. No se toca.
LOCALES = ['ar', 'es', 'pt', 'en']

// El portal público: su propio diccionario, con SOLO sus frases.
DIRECTORY_LOCALES = ['ar', 'en', 'fr', 'es', 'pt']
```

`packages/core/directory/{ar,en,fr,es,pt}.json` con un tipo
`DirectoryDictionary` propio. El portal nace en cinco idiomas —con el francés,
que en Líbano hace falta— y el panel sigue en cuatro sin que nadie tenga que
traducir el manual al francés para poder publicar un salón.

El árabe sigue siendo el principal y el portal en árabe es RTL desde el primer
archivo. `fr` se comporta como `en`: latino, LTR, `latinOnly()` aplicable.

Si algún día se quiere el producto entero en francés, es un trabajo aparte y
grande, y este diseño no lo estorba: `DIRECTORY_LOCALES` ya lo incluye.

---

## 1. Modelo de datos

Todo en el plano de **CONTROL** (`controlDb()`), porque el directorio es global y
tiene que seguir funcionando cuando cada oficina tenga su propia base.
`scripts/check-planes.mjs` aprende estos modelos en la misma migración que los
crea.

### 1.1 El proveedor

```
Provider
  id            cuid
  slug          único, estable, no se translitera del árabe
  legalName     interno, no se publica
  status        draft | pending_review | approved | rejected | suspended | archived
  verifiedAt    fecha, o nulo
  verifiedBy    userId de quien verificó
  submittedAt   cuándo pidió revisión (el reloj de las 24 horas)
  reviewedAt    cuándo se resolvió
  rejectedNote  el motivo, visible SOLO para el proveedor
  publishedAt   la primera vez que se aprobó
  governorate   enum de las ocho
  district      clave de la lista cerrada
  city          texto
  addressPublic texto, o nulo si no se publica
  lat / lng     opcionales, y solo si addressPublic no es nulo
  capacity      entero, o nulo
  since         año de inicio, o nulo
  priceFrom     entero en la unidad menor, o nulo
  priceCurrency LBP | USD
  createdAt / updatedAt
```

- **`legalName` no se publica nunca.** Lo que se enseña es `ProviderTranslation.name`.
- La dirección y las coordenadas van juntas y con **un solo interruptor**: sin
  `addressPublic` no hay mapa. Una repostera que trabaja desde su casa no
  publica dónde vive.
- `priceFrom` en entero, en la unidad menor, como todo el dinero de este
  proyecto. Y es «desde», no una tarifa: nadie cotiza una boda por una web.

### 1.2 Lo que se publica en cada idioma

```
ProviderTranslation
  providerId + locale        clave única compuesta
  name                       el nombre comercial
  tagline                    una línea
  description                hasta 2.000 caracteres
  services                   lista de líneas cortas
```

La prioridad al pintar es la misma que ya usan los actos: **traducción del idioma
pedido → la del idioma principal del proveedor → el nombre y nada más.** Nunca se
traduce automáticamente: lo escribe el proveedor o no está.

### 1.3 Quién lo administra

```
ProviderMembership
  userId + providerId        clave única compuesta
  role                       PROVIDER_ADMIN | PROVIDER_EDITOR
```

Y en `Session`, un campo nuevo:

```
Session.providerId   anulable, con clave foránea y ON DELETE CASCADE
```

Con **una restricción de la base** que impide que una sesión sea de las dos
cosas:

```sql
ALTER TABLE "Session" ADD CONSTRAINT "Session_one_scope"
  CHECK ("tenantId" IS NULL OR "providerId" IS NULL);
```

Una sesión es de una oficina, de un proveedor, o de ninguna (el
superadministrador). **Nunca de las dos**, y eso no depende de que el código se
acuerde. Una misma persona puede tener las dos membresías y elegir con cuál
trabaja, igual que hoy se elige oficina.

### 1.4 Categorías, en código y no en filas

```
ProviderCategory
  providerId + category      clave única compuesta
  primary                    booleana: una y solo una por proveedor
```

`category` es un valor de una **lista cerrada en TypeScript**, como
`PREFERENCE_KEYS` y como los versículos. Las cincuenta y tantas del plan,
agrupadas en seis familias, traducidas en los cinco diccionarios del portal.
Añadir una es escribirla, traducirla y desplegar — una decisión de producto, no
una fila que cualquiera inserta.

En la Fase 1: **hasta tres categorías** por proveedor, una de ellas principal.
El plan gratuito, una.

### 1.5 Los contactos, uno a uno

```
ProviderContact
  providerId + channel       phone | whatsapp | email | website | instagram | facebook | tiktok
  value                      normalizado (E.164 el teléfono, minúsculas el correo)
  isPublic                   booleana, POR CANAL
  verifiedAt                 para el WhatsApp, más adelante
```

Un interruptor global es cómo se publica sin querer un número personal.

### 1.6 Las imágenes y el vídeo

```
ProviderMedia
  providerId
  kind          image | video
  objectKey     la llave en el almacén (nulo si es vídeo externo)
  externalUrl   solo para vídeo: YouTube o Vimeo, lista blanca de dominios
  width/height  del original, para reservar el hueco y no dar saltos
  bytes         tamaño
  sortOrder     entero
  status        pending_review | approved | rejected | hidden
  hiddenReason  copyright | moderation | provider   (§5)
  createdAt
```

**Tope de la Fase 1: diez imágenes y un vídeo externo.** Un índice único parcial
no sirve para contar, así que el tope lo comprueba el servicio **dentro de la
misma transacción** que inserta, leyendo con `FOR UPDATE` la fila del proveedor —
si no, dos subidas a la vez pasan las dos.

El vídeo es **un enlace, no un archivo**. Alojar vídeo es otro producto.

### 1.7 Moderación y denuncias

```
ProviderReview                 un paso de la cola de moderación
  providerId, mediaId?          qué se revisó
  action        submitted | approved | rejected | suspended | restored | verified
  actorId, note, createdAt

ProviderReport                 una denuncia, pública y sin cuenta
  providerId, mediaId?
  reason        false_info | scam | offensive | wrong_number | closed | copyright
  message       hasta 1.000 caracteres
  reporterEmail opcional, y SOLO para copyright (§5)
  status        new | reviewing | upheld | dismissed
  ip            para el freno, y se purga a los 30 días
  createdAt, resolvedAt, resolvedBy, resolution
```

`ProviderReview` se llama así por «revisión de moderación». **No son reseñas de
clientes** — eso no se construye (§9).

### 1.8 La publicación de una fiesta

```
PublicListing
  id, slug único, locale
  status        draft | pending_review | approved | rejected | suspended
  title, description, coverKey
  eventType     el tipo, de la lista cerrada de siempre
  dateMode      exact | month | season | hidden
  date          solo si dateMode = exact
  governorate, district, city
  venueName     opcional, y solo si el salón lo autoriza
  contactMode   none | form | whatsapp
  sourceEventId SIN clave foránea, y no se consulta desde lo público
  authorizedBy  quién autorizó, cuándo y con qué texto
  publishedAt

PublicListingProvider
  listingId + providerId
  role          la categoría con la que participó
  approvedByProvider   booleana: el proveedor confirma que quiere aparecer
```

**Ninguna clave foránea cruza a `Event`, `Guest`, `Rsvp`, `GuestPreference`,
`CheckIn`, `Table` ni `GuestActRsvp`.** Ni una. La consulta pública no tiene
camino hasta ahí, no porque filtre bien sino porque no existe el camino. Y
`sourceEventId` es un texto, para que el panel de la oficina sepa que su boda
tiene publicación y para nada más.

- **`dateMode`** existe porque la fecha exacta de una boda que aún no ha ocurrido
  es una invitación a que aparezca gente. Por defecto, `month`.
- **`authorizedBy`** no es adorno: la fiesta no es de la oficina. Sin
  autorización registrada —quién, cuándo y con qué texto, igual que el permiso de
  WhatsApp— no se publica.
- **`approvedByProvider`**: un salón puede no querer salir en la boda de otro.

### 1.9 Lo que NO se crea en la Fase 1

`ProviderPlan`, `ProviderSubscription`, `ProviderPromotion`, `ProviderLead`,
`ProviderStat`. Son las fases 2 y 3. **Ni `ProviderRating` ni nada de reseñas,
reservas, comisiones o pagos entre cliente y proveedor**, en ninguna fase de
este documento.

### 1.10 Índices

```
Provider(slug)                                   único
Provider(status, publishedAt DESC)
Provider(governorate, district, status)
ProviderCategory(category, providerId)
ProviderCategory(providerId) WHERE primary       único parcial: una principal
ProviderTranslation(providerId, locale)          único
ProviderMembership(userId, providerId)           único
ProviderContact(providerId, channel)             único
ProviderMedia(providerId, sortOrder)
ProviderReport(providerId, status, createdAt)
PublicListing(slug)                              único
PublicListing(status, publishedAt DESC)
PublicListingProvider(listingId, providerId)     único
```

---

## 2. Rutas

### 2.1 Públicas, con el idioma en la dirección

```
/d/[locale]                                   la portada del directorio
/d/[locale]/proveedores
/d/[locale]/proveedores/[categoria]
/d/[locale]/proveedores/[gobernacion]
/d/[locale]/proveedores/[gobernacion]/[categoria]
/d/[locale]/p/[slug]                          el perfil
/d/[locale]/fiestas
/d/[locale]/fiestas/[slug]
/d/[locale]/denunciar/[slug]                  el formulario de denuncia
/d/sitemap.xml                                índice
/d/[locale]/sitemap.xml
```

**El prefijo `/d/`** y no la raíz, y esto es deliberado: la raíz ya es la portada
del producto de invitaciones, con su propio idioma resuelto por cookie y su
propio dueño. Meter el directorio en `/` obligaría a reescribir la portada
actual y el `proxy`, que es exactamente lo que el encargo prohíbe. Cuando el
directorio esté validado se decide si se lleva a la raíz; mover una ruta con
`301` es barato, y rehacer la portada en la Fase 1 no lo es.

`/d` sin idioma redirige con `301` por `Accept-Language`, sin leer cookies.

### 2.2 Cacheable: el detalle que decide si esto escala

El layout raíz declara `dynamic = 'force-dynamic'` para toda la aplicación,
porque `documentLanguage()` lee cookies y cabeceras. **Las rutas de `/d/` no
pueden depender de eso.** Diseño:

- El idioma sale **del segmento `[locale]`**, nunca de una cookie.
- Un layout propio en `src/app/d/[locale]/layout.tsx` que fija `lang` y `dir` a
  partir del segmento y **no lee cookies ni cabeceras**.
- Cada página pública declara `export const revalidate = 300`.
- La sesión **no se toca** en ninguna página de `/d/`. Ni para saludar. Leer la
  cookie de sesión es lo que convierte una página cacheable en una dinámica.

Lo que hay que comprobar en la Fase 1, y es un riesgo real: que el `force-dynamic`
del layout raíz **no gane** sobre el `revalidate` del hijo. Si gana, el portal
funciona igual pero sin caché, y entonces la alternativa es un grupo de rutas con
su propio layout raíz. **Se comprueba lo primero, con una ruta de prueba, antes
de escribir las pantallas.**

### 2.3 Privadas

```
/panel/proveedor                     perfil y traducciones
/panel/proveedor/medios              imágenes y vídeo
/panel/proveedor/estado              revisión, motivo del rechazo, verificación
/panel/moderacion                    cola: pendientes ordenados por antigüedad
/panel/moderacion/[providerId]
/panel/moderacion/denuncias
/panel/eventos/[eventId]/publicacion la oficina publica SU boda
```

`/panel/proveedor` **no** cuelga del layout del panel de oficina: ese resuelve
`getAdminContext(session.tenantId)` y redirige a `/entrar` sin sesión de oficina.
Necesita su propio layout con la cabecera del proveedor — y por eso la cabecera
ya está en un componente (`PanelHeader`), extraído esta misma semana.

---

## 3. Permisos

Dos capacidades nuevas y ni una más:

```
provider:manage      su perfil, sus traducciones, sus medios
directory:moderate    aprobar, rechazar, suspender, verificar, resolver denuncias
```

```
PROVIDER_ADMIN   → provider:manage
PROVIDER_EDITOR  → provider:manage   (en Fase 3 se separa el plan)
SUPERADMIN       → todo, como siempre
```

Y un **tercer candado** de la familia de los dos que ya existen:
**`directory:moderate` no se le puede conceder a un rol de proveedor**, ni al
escribir el reparto ni al leerlo de una fila vieja. Un proveedor que se aprueba a
sí mismo es el fallo entero de un directorio moderado.

`sessionCan` sigue **síncrona**, por la razón de siempre: una asíncrona a la que
se le olvida un `await` devuelve una promesa, que es verdadera.

`providerScope(session)` devuelve un tipo **marcado**, igual que `TenantScope`, y
toda consulta de proveedor lo exige. Un `providerId` que llegue de un formulario
no se usa nunca sin resolverlo contra ese ámbito.

---

## 4. Almacenamiento de objetos

### 4.1 El puerto

```ts
interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
```

Dos adaptadores: `s3ObjectStore` (cualquier almacén compatible con S3 — Hetzner,
Backblaze, MinIO) y `databaseObjectStore`, que guarda en PostgreSQL y **solo**
vale para desarrollo y para que las pruebas no necesiten una cuenta. En
producción, el de base de datos se niega a arrancar, igual que el emisor de
consola y el proveedor de pago de mentira.

### 4.2 Una dependencia, y hay que aprobarla

Firmar peticiones S3 necesita **AWS Signature V4**. Dos caminos:

- **Sin dependencia nueva:** escribirlo con `node:crypto`. Son unas ciento
  cincuenta líneas, es un algoritmo cerrado y bien documentado, y este proyecto
  ya escribe su cifrado y sus firmas a mano. **Es lo que recomiendo**, y no por
  purismo: el SDK de AWS son decenas de megas y docenas de paquetes en una imagen
  de producción que hoy no los tiene.
- **Con dependencia:** `@aws-sdk/client-s3`. Hay que aprobarla — la regla del
  proyecto es que no se instala nada sin preguntar.

### 4.3 Lo que hace falta de fuera, y no lo tengo

Un bucket y sus credenciales: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY_ENC`. **La clave se guarda cifrada con
AES-256-GCM**, como la del SMTP y la de Whish, y **nunca** en el repositorio.

Mientras no estén, la Fase 1 se desarrolla y se prueba con el adaptador de base
de datos. Esto **no** bloquea el trabajo; bloquea publicar galerías.

### 4.4 Las reglas de una imagen

- Se **recodifica siempre**: WEBP, lado mayor 1.600 px, y una miniatura de 400.
  Por lo mismo que la foto de perfil: los metadatos del móvil llevan las
  coordenadas de dónde se hizo la foto.
- Los tres frenos que ya existen (`lib/images/limits.ts`): tamaño de archivo,
  píxeles al descodificar y cuántas se abren a la vez.
- La llave es `providers/<providerId>/<uuid>.webp`. **Nunca el nombre del
  archivo que subió nadie.**
- El bucket es **privado**. Se sirve por `/api/d/media/<mediaId>`, que comprueba
  el estado antes de devolver los bytes: una imagen `pending_review`, `rejected`
  o `hidden` **no se sirve a nadie**, ni con la dirección exacta. Una URL pública
  de bucket no se puede retirar, y el ocultamiento por copyright (§5) tiene que
  ser inmediato.
- Cachear largo con la huella en la dirección, como los avatares.

---

## 5. Moderación y copyright

### 5.1 El reloj

`submittedAt` marca el momento. La cola de `/panel/moderacion` sale **ordenada
por antigüedad, lo más viejo arriba**, y lo que pase de **24 horas hábiles** se
marca en rojo — el mismo trato que los buzones de SINPE caídos, porque es el
mismo tipo de avería: desde fuera se ve igual que si no pasara nada.

`pending_review` **no aparece en público**: ni en listados, ni en búsqueda, ni en
el sitemap, ni en su propia URL, que responde 404.

Una **imagen nueva sobre un perfil ya aprobado vuelve a la cola** ella sola, sin
tumbar el perfil. Es el camino clásico: se aprueba un perfil limpio y luego se
sube otra cosa.

### 5.2 La denuncia de copyright, paso a paso

Es la única que oculta antes de revisar, y esa asimetría es a propósito: las
demás denuncias son opiniones sobre un negocio; esta es una reclamación de
derechos de un tercero, y el riesgo de dejarla publicada no lo corre el
denunciante.

1. **Entra** por `/d/[locale]/denunciar/[slug]`, sin cuenta, con los tres frenos
   del callback de pago: tope al cuerpo, cupo por dirección y minuto, y corte del
   mismo cuerpo repetido. Para `copyright` el correo del denunciante es
   **obligatorio** — sin alguien a quien responder no hay reclamación, hay un
   botón de sabotaje.
2. **Se oculta al momento**: la imagen señalada pasa a `hidden` con
   `hiddenReason = 'copyright'`. Si la denuncia es del perfil entero y no de una
   imagen, se ocultan **las imágenes**, no el perfil: cerrar el negocio de alguien
   con un formulario anónimo no.
3. **Se avisa al proveedor** por correo y en `/panel/proveedor/estado`, con qué se
   ocultó y por qué, y con un sitio donde responder.
4. **Lo revisa una persona** en las mismas 24 horas hábiles.
5. **Se resuelve**: `upheld` —la imagen se borra del almacén, de verdad, no solo
   de la vista— o `dismissed`, y vuelve a `approved`.
6. **Todo queda en `ProviderReview` y en `AuditLog`** con su autor y su motivo. Y
   la resolución se le comunica a las dos partes.

Lo que **no** se hace: publicar quién denunció, ni enseñarle al proveedor el
correo del denunciante sin que este lo autorice.

---

## 6. SEO

- Una URL canónica **por idioma** y `hreflang` entre las cinco, más `x-default`
  al árabe.
- `/d/sitemap.xml` índice, y uno por idioma, **generados de la base** y sin nada
  que no esté `approved`.
- Open Graph con la portada; sin portada, la marca.
- Datos estructurados: `LocalBusiness` para un proveedor **aprobado y
  verificado**, `Event` para una fiesta publicada. **Sin `aggregateRating`** —no
  hay reseñas, y las estrellas inventadas son una penalización y una mentira.
- `noindex` en: `draft`, `pending_review`, `rejected`, `suspended`, el formulario
  de denuncia y cualquier listado con parámetros de orden.
- **Slugs estables**: cambiar el nombre comercial no cambia la URL. Y el slug de
  un nombre árabe **no se translitera** — sale de lo que el proveedor escriba en
  latino, o es `p-<azar>`. Es la misma regla que los slugs de invitación.
- `robots.txt` permite `/d/` y sigue prohibiendo `/panel`, `/crear`, `/i/`, `/g/`
  y `/pagar/`. **Que una invitación no se indexe es más importante que que un
  salón sí.**

---

## 7. Migraciones

Cuatro, todas aditivas, en este orden:

1. **`provider_base`** — `Provider`, `ProviderTranslation`, `ProviderMembership`,
   `ProviderCategory`, `ProviderContact`, `Session.providerId` y la restricción
   `Session_one_scope`.
2. **`provider_media`** — `ProviderMedia`.
3. **`directory_moderation`** — `ProviderReview`, `ProviderReport` y los índices
   de la cola.
4. **`public_listing`** — `PublicListing`, `PublicListingProvider` y la
   autorización.

Cada una con sus comprobaciones en `db:check`, que **imprime** lo que crea, como
ya hace con los índices de la cola:

- `Session_one_scope` existe y es un `CHECK`.
- `ProviderCategory(providerId) WHERE primary` es único.
- `Provider(slug)` y `PublicListing(slug)` son únicos.
- **Y la que vale por todas: ninguna clave foránea desde una tabla del
  directorio hacia `Event`, `Guest`, `Rsvp`, `GuestPreference`, `CheckIn`,
  `Table`, `GuestActRsvp` ni `WhatsappMessage.`** Se comprueba consultando
  `pg_constraint`, no leyendo el esquema a ojo.

---

## 8. Pruebas

### Aislamiento, en la Fase 1 y no en la última

- Proveedor A contra todo lo de B: leer, editar, traducir, subir, borrar.
- Un `providerId` cambiado en un formulario **no encuentra nada**.
- Una sesión de proveedor contra `/panel`, `/panel/eventos/*`, la puerta, los
  invitados, las preferencias, el RSVP y las mesas: **todo 404 o redirección**.
- Una sesión de oficina contra `/panel/proveedor` de un proveedor que no
  administra.
- Una sesión con `tenantId` **y** `providerId` a la vez: la base la rechaza.
- Quien no tiene `directory:moderate` aprobando, suspendiendo o resolviendo.
- Un rol de proveedor al que se intenta conceder `directory:moderate`, **al
  escribir y al leer**.

### Visibilidad

- Un proveedor en cada uno de los seis estados: solo `approved` sale en el
  listado, en la búsqueda, en el sitemap y en su URL. Los otros cinco, 404.
- Una imagen `pending_review`, `rejected` o `hidden` **no la sirve**
  `/api/d/media/<id>` ni con la dirección exacta.
- Un `PublicListing` sin `authorizedBy` no se puede aprobar.

### Privacidad — la prueba que más importa

Una que recorra **todas** las consultas de las rutas de `/d/` y afirme que
ninguna toca una tabla de oficina. Con `lint:planes` extendido, y además una
prueba que lo intente a propósito y falle.

### Copyright

El recorrido entero: denuncia → oculto al momento → el proveedor lo ve → se
resuelve `upheld` → la imagen ya no está **en el almacén** → queda en la
auditoría. Y el mismo con `dismissed`, volviendo a `approved`.

### Imágenes

- La undécima imagen se rechaza, y **dos subidas a la vez** no dejan once.
- Se recodifica: lo guardado no lleva los metadatos de lo subido.
- Un vídeo de un dominio que no está en la lista blanca se rechaza.

Cada fase cierra con: `typecheck`, `lint:rtl`, `lint:planes`, `db:check`,
`test:integration`, `verify:e2e` y `build`.

---

## 9. Lo que NO se construye

En la Fase 1: planes, suscripciones, destacados, leads, estadísticas.

En ninguna fase de este documento: **reseñas y valoraciones** · **reservas y
calendario** · **pagos entre cliente y proveedor, comisiones y contratos** ·
**cobrar por lead** · **importar proveedores de otras webs** · **publicar una
boda sin autorización registrada** · **estrellas en los datos estructurados**.

---

## 10. Lo que hace falta de fuera antes de terminar la Fase 1

1. **El bucket y sus credenciales.** Sin ellos se desarrolla con el adaptador de
   base de datos, pero no se publican galerías.
2. **La decisión sobre la firma S3**: a mano con `node:crypto` (recomendado) o
   aprobar `@aws-sdk/client-s3`.
3. **El francés del portal.** Lo redacto y quien lo hable lo revisa. Igual que el
   árabe, que sigue esperando.
4. **Quién modera**, con nombre. Las 24 horas hábiles son una promesa de alguien,
   no una propiedad del código.
5. **El texto de la autorización** que firma un organizador para publicar una
   boda. Eso es del negocio, no mío.

Y lo de siempre, que no es de este módulo pero lo bloquea todo: **el correo
saliente sigue en `console`.** Un proveedor no puede recibir su código para
entrar, así que la Fase 1 no se puede probar con nadie de fuera.

---

## Orden de trabajo de la Fase 1

1. Comprobar que una ruta bajo `/d/[locale]` puede cachearse pese al
   `force-dynamic` del layout raíz. **Antes de todo**, porque si no se puede el
   diseño de rutas cambia.
2. `DIRECTORY_LOCALES`, `DirectoryDictionary` y los cinco archivos.
3. Migración `provider_base` + `db:check` + las pruebas de aislamiento.
4. Categorías y regiones, listas cerradas y traducidas.
5. El puerto `ObjectStore` con los dos adaptadores.
6. Migración `provider_media` y el servicio con su tope transaccional.
7. `/panel/proveedor` con su layout y sus tres pantallas.
8. Migración `directory_moderation`, `/panel/moderacion` y el reloj de 24 horas.
9. Las pantallas públicas: portada, listado, filtros, perfil.
10. Denuncias, con el recorrido de copyright completo.
11. SEO: sitemaps, `hreflang`, datos estructurados, `robots.txt`.
12. La tanda de comprobaciones completa y el despliegue.

`PublicListing` es lo último de la Fase 1 o lo primero de la Fase 2, y lo decide
una cosa: si hay alguna boda cuya pareja haya autorizado publicarla. Sin eso, es
una pantalla sin nada que enseñar.
