# Almacenamiento de imágenes del directorio — especificación

Lo que se pidió entregar antes de crear migraciones: la interfaz del adaptador,
el flujo de URL firmada, y las políticas de expiración, archivos permitidos,
eliminación y moderación, con las tres clases de pruebas de aislamiento.

Aprobado: **S3-compatible, Cloudflare R2 recomendado** · URLs firmadas **solo
del servidor** · subida 10 minutos, lectura privada 1 hora · las credenciales
solo en el entorno · nunca al navegador · 10 imágenes por proveedor en Fase 1.

---

## 0. Dos cosas del encargo que no se pueden cumplir las dos a la vez

Las digo primero porque cambian el flujo, no un detalle.

### 0.1 Una subida firmada al navegador y «quitar el EXIF» se excluyen

Si el navegador sube **directamente al bucket** con una URL firmada, el servidor
**nunca ve los bytes**. Entonces no puede:

- quitar el EXIF ni las coordenadas GPS,
- recodificar a WebP o AVIF,
- comprobar el MIME **real** (el que declara el navegador lo escribe el navegador),
- medir las dimensiones,
- ni rechazar un SVG con JavaScript dentro.

Lo que quedaría en el bucket es la foto del móvil tal cual, con la casa de
alguien en los metadatos. Y esas seis reglas también están en el encargo.

**Tres caminos:**

| | Cómo | Cumple EXIF y recodificado | Coste |
|---|---|---|---|
| **A** | navegador → **nuestro servidor** → recodifica → `PUT` firmado a R2 | **sí** | los bytes pasan por el servidor |
| **B** | navegador → R2 en una zona de **cuarentena** → el servidor la baja, valida, recodifica, escribe la definitiva y borra la cuarentena | sí, con retraso | dos viajes, un estado más, y el original con GPS existe en el bucket unos segundos |
| **C** | navegador → R2 a su sitio definitivo | **no** | — |

**Recomiendo A para la Fase 1.** Cumple las seis reglas, reutiliza los tres
frenos que ya existen (`lib/images/limits.ts`) y es lo que este proyecto ya hace
con los avatares y con el logo. Diez imágenes de dos megas por proveedor no es un
problema de ancho de banda; si algún día lo fuera, **B** es un cambio dentro del
puerto y no toca el resto del producto.

La URL **firmada de subida** se implementa igual —el servidor la usa para su
propio `PUT`— pero **no se le entrega nunca al navegador** en la Fase 1. Así la
regla «el bucket no es público para escritura» se cumple de la forma más fuerte
posible: la única credencial que existe está en el servidor y nadie más firma
nada.

### 0.2 «URL pública o CDN» y «retirada inmediata por copyright»

Un objeto servido por CDN se retira **al instante en el origen** y **hasta el
TTL en el borde**. Con un TTL largo —que es de lo que sirve un CDN— una imagen
denunciada puede seguir viéndose desde una caché durante ese rato.

**Propuesta, y es una secuencia, no un no:**

- **Fase 1:** todo se sirve por `/api/d/media/[mediaId]`, que mira el estado
  antes de devolver los bytes. La retirada es inmediata y de verdad. Un
  directorio nuevo no tiene tráfico que justifique un CDN.
- **Fase 2, cuando el tráfico lo pida:** los objetos `approved` se copian a una
  zona pública `public/` servida por CDN, con `Cache-Control` de **una hora** —
  corto a propósito, por esto mismo—. Al retirar: se borra el objeto, se purga la
  caché (R2 con Cloudflare lo permite) y se acepta una ventana de hasta una hora.
  Eso se decide entonces y se escribe donde se vea.

Nada se sirve nunca con credenciales privadas al navegador, en ninguna fase.

---

## 1. La interfaz del adaptador

```ts
/** La llave de un objeto. Tipo marcado, como `TenantScope`. */
type ObjectKey = string & { readonly __objectKey: unique symbol };

interface ObjectStore {
  readonly id: 's3' | 'memory';

  /** Escribe. `contentType` es el REAL, decidido por el servidor. */
  put(key: ObjectKey, body: Uint8Array, contentType: string): Promise<void>;

  /** Lee. `null` si no está: un objeto que falta no es una excepción. */
  get(key: ObjectKey): Promise<{ body: Uint8Array; contentType: string } | null>;

  /** Borra. Idempotente: borrar lo que ya no está no falla. */
  remove(key: ObjectKey): Promise<void>;

  /** Existe, y cuánto mide. Para conciliar la base con el almacén. */
  head(key: ObjectKey): Promise<{ bytes: number; contentType: string } | null>;

  /**
   * Una dirección firmada de LECTURA, con caducidad. Se usa para lo que no
   * pasa por nuestra ruta: una descarga que pide un moderador, o el día que
   * haya CDN. Nunca se le da al navegador para escribir.
   */
  signedReadUrl(key: ObjectKey, seconds: number): Promise<string>;

  /**
   * La dirección pública de un objeto YA aprobado, si esta instalación tiene
   * `STORAGE_PUBLIC_BASE_URL`. `null` cuando no la hay, y entonces se sirve por
   * nuestra ruta.
   */
  publicUrl(key: ObjectKey): string | null;
}
```

Lo que **no** lleva esta interfaz, y es a propósito:

- **Nada de `providerId`, `tenantId` ni permisos.** Es un almacén de bytes. Quién
  puede escribir qué lo decide la capa de arriba, con su ámbito marcado. Un
  puerto que además autoriza es un puerto en el que un día se autoriza distinto
  que en el resto del programa.
- **Ninguna función que firme una subida para el navegador** (§0.1). No se puede
  usar mal lo que no existe.
- **`list()` tampoco.** No hace falta y es la llamada que se paga caro cuando
  alguien la mete en un bucle.

### 1.1 Los dos adaptadores

```
s3ObjectStore      AWS Signature V4 escrito con node:crypto. Sirve para R2,
                   Amazon S3, Backblaze B2 y MinIO sin cambiar nada del dominio:
                   lo único que cambia son las seis variables de entorno.

memoryObjectStore  Un Map en memoria. Para desarrollo y para las pruebas.
                   En producción SE NIEGA A ARRANCAR, igual que el emisor de
                   consola y el proveedor de pago de mentira.
```

`storeFor()` resuelve uno u otro y es el único sitio que lo decide.

**No hay adaptador de PostgreSQL.** Fue explícito en el encargo y estoy de
acuerdo: la base guarda las once columnas de §2 y ni un byte de imagen.

### 1.2 Las variables, y cómo se guardan

```
STORAGE_ENDPOINT            https://<cuenta>.r2.cloudflarestorage.com
STORAGE_REGION              auto   (R2 usa «auto»)
STORAGE_BUCKET
STORAGE_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY   ← cifrada con AES-256-GCM, como la del SMTP
STORAGE_PUBLIC_BASE_URL     opcional; sin ella se sirve por nuestra ruta
```

En el entorno del **servidor** y en ningún otro sitio. `.env.example` lleva los
nombres y **ningún valor**. La secreta se cifra con `npm run secret:encrypt`,
igual que la del SMTP y la de Whish, y el panel **no la devuelve nunca**: se
reemplaza, no se lee.

Estas seis **no** se editan desde `/panel/configuracion`, y es deliberado: son
de las que hacen falta para arrancar, como `DATABASE_URL` y la llave. Una
dirección de almacén editable desde una pantalla es la misma puerta que ya hubo
que cerrar con la del servicio de WhatsApp.

### 1.3 Una dependencia que ya se usa y no está declarada

`sharp` se importa en `lib/profile/avatar.ts` y en `lib/brand/assets.ts`, y
**no está en ningún `package.json`**: funciona porque `next` la trae como
dependencia opcional. El día que Next la quite o cambie de versión mayor se
rompen los avatares, el logo y —con esto— las imágenes del directorio, y el
error no dirá nada parecido a la causa.

Hay que **declararla** en `apps/web/package.json` con la versión que ya está
instalada (0.35.4). No es instalar nada nuevo: es escribir lo que ya se usa, el
mismo caso que `qrcode` la semana pasada. Y trae AVIF, así que la regla de
recodificar a WebP **o AVIF** se cumple sin nada más.

---

## 2. Lo que guarda PostgreSQL

Las once columnas del encargo, tal cual:

```
ProviderMedia
  id                cuid
  providerId        con clave foránea, ON DELETE CASCADE
  objectKey         único
  mediaType         image | video
  mimeType          image/webp | image/avif   (lo que el servidor escribió)
  bytes             entero
  width / height    enteros
  altText           texto, hasta 120 caracteres
  moderationStatus  pending_review | approved | rejected | hidden
  createdAt
  publishedAt       cuándo se aprobó, o nulo
```

Y **dos columnas más**, con su razón:

- **`sortOrder`** (entero). El proveedor decide qué foto va primera y eso es la
  mitad de su perfil. Sin columna, el orden sería el de inserción y no se podría
  cambiar sin volver a subir.
- **`hiddenReason`** (`copyright | moderation | provider`, nulo si no está
  oculta). `moderationStatus = hidden` no dice **por qué**, y el flujo de
  copyright (§7) necesita distinguir «oculto por una reclamación de derechos,
  pendiente de resolver» de «lo ocultó el proveedor». Se resuelven distinto y se
  notifican distinto.

Un vídeo es **un enlace externo**, no un objeto: `mediaType = 'video'`,
`objectKey` nulo y la dirección en su columna, con lista blanca de dominios
(YouTube y Vimeo). Alojar vídeo es otro producto.

**`altText` es uno solo** en la Fase 1, en el idioma principal del proveedor. Un
`altText` por idioma es correcto y es una tabla más; se anota como deuda y se
decide en la Fase 2, cuando se sepa si alguien lo rellena.

---

## 3. El flujo, paso a paso

### 3.1 Subir

```
1. El navegador manda el archivo a la acción de servidor (multipart).
2. Sesión → ¿hay? Si no, a /entrar.
3. providerScope(session) → ¿administra ESTE proveedor? Se resuelve contra la
   base con la membresía. El providerId del formulario no decide nada.
4. ¿provider:manage? Si no, 403.
5. ¿Cuántas imágenes tiene? La cuenta se hace DENTRO de la transacción, con la
   fila del proveedor bloqueada (FOR UPDATE). Fuera, dos subidas a la vez dejan
   once.
6. Los tres frenos de lib/images/limits.ts: bytes del archivo, píxeles al
   descodificar y cuántas se abren a la vez.
7. sharp abre los bytes. Si no puede: no es una imagen, y da igual lo que diga
   la extensión o el tipo declarado.
8. .rotate() —las fotos de móvil vienen tumbadas— resize al lado mayor 1600,
   .webp({ quality: 82 }), SIN withMetadata(). Ahí se va el EXIF y el GPS.
9. Se decide la llave: providers/<providerId>/<uuid>.webp. Nunca el nombre del
   archivo de nadie.
10. store.put(key, bytes, 'image/webp').
11. La fila, con moderationStatus = 'pending_review'.
12. AuditLog: media.upload, con el providerId, el mediaId y los bytes. Nunca
    el nombre original ni el contenido.
```

Los pasos 10 y 11 **no son atómicos** y no pueden serlo: son dos sistemas. El
orden es **primero el almacén y después la fila**, y esa dirección importa:

- Si falla la fila, queda un objeto huérfano en el bucket. No se ve, no se sirve
  y lo barre el repaso de §6.
- Al revés quedaría una fila que promete una imagen que no existe, y eso sí se
  ve: un hueco roto en el perfil de alguien.

### 3.2 Leer

```
Fase 1, siempre:      /api/d/media/[mediaId]
  → lee la fila
  → si moderationStatus ≠ 'approved' → 404. Sin excepción, ni con la
    dirección exacta, ni para el propio proveedor en la vista pública.
  → store.get(objectKey) y se devuelven los bytes
  → Cache-Control: private, no-store  (§4.1: una caché de un año se come la
    retirada inmediata por copyright, y el ?v= no la arregla)

En el panel del proveedor y en moderación:
  → la misma ruta, pero con sesión: el dueño y quien modera SÍ ven las suyas
    en pending_review, rejected y hidden. Si no, no podrían revisarlas.

El puerto NO tiene `signedReadUrl` ni `publicUrl`, y eso es una decisión, no un
olvido: una dirección firmada que ya se entregó sigue valiendo hasta que caduque,
así que una imagen retirada se seguiría viendo con ella. Las dos funciones se
añadirán en la Fase 2 junto con el CDN y su purga. No se puede usar mal lo que no
existe.
```

### 3.3 Borrar

En §6.

---

## 4. Política de expiración

| Qué | Cuánto | Por qué |
|---|---|---|
| URL firmada de **subida** (servidor a R2) | **10 minutos** | lo pedido; y como no sale del servidor, sobra de largo |
| URL firmada de **lectura privada** | **1 hora** | lo pedido; suficiente para una descarga de moderación |
| Objeto **aprobado** por nuestra ruta, Fase 1 | **`private, no-store`** | ver abajo: es lo que hace posible la retirada inmediata |
| Objeto **aprobado** por CDN (Fase 2) | **1 hora**, con purga explícita | corto a propósito: acota la ventana de una retirada |
| Objeto en **cuarentena** (si algún día se hace B) | 24 horas y se barre | un original con GPS no se queda en el bucket |

### 4.1 Por qué NO se cachea largo, aunque duela

La primera versión de este documento decía dos cosas que no pueden ser verdad a
la vez: que una imagen retirada por copyright deja de servirse **al momento**, y
que lo aprobado se sirve con `max-age` de un año. Lo encontró una revisión
externa y tenía razón.

El motivo es que una caché no pregunta. Si el navegador de alguien —o un proxy
por el camino— se quedó la respuesta durante un año, la petición **no vuelve a
llegar al servidor**: da igual lo bien que la ruta compruebe que la fila está en
`hidden`. La imagen sigue apareciendo.

Y el truco de la huella en la dirección (`?v=`) **no lo arregla**, que era el
otro error. Sirve para que un cambio de imagen se vea, porque la dirección
cambia. Pero al pasar de `approved` a `hidden` **el archivo es el mismo**, así
que la huella es la misma; y aunque se le añadiera una versión de moderación,
quien ya tenga guardada la dirección anterior la sigue teniendo. Cambiar la
dirección nueva no caduca la vieja.

Así que en la Fase 1 la ruta responde **`Cache-Control: private, no-store`**, y
la retirada inmediata deja de ser una promesa para pasar a ser una propiedad. El
coste es real —cada imagen se pide cada vez— y es asumible justo ahora, que es
cuando hay pocos proveedores y poco tráfico. Si hiciera falta un respiro antes
del CDN, el escalón intermedio es
`public, max-age=300, must-revalidate`: cinco minutos de ventana, dicho a las
claras, en vez de un año callado.

**Fase 2, cuando el tráfico lo pida:** CDN, TTL de una hora como máximo, purga
explícita al retirar, y la ventana residual escrita donde se vea —no enterrada en
un comentario—.

Esto vale para la imagen. La **miniatura** va igual: es el mismo archivo
recortado, y una retirada que dejara la miniatura visible no sería una retirada.

Una URL firmada **no se guarda** en la base ni en una caché. Se firma cuando se
pide: guardarla es guardar un permiso con fecha, y el día que se filtre el
registro se filtra el permiso.

---

## 5. Política de archivos permitidos

**Aceptado:** JPEG, PNG, WebP, AVIF, HEIC y HEIF — las dos últimas porque es lo
que sale de un iPhone, y quien publica un salón desde su móvil no sabe convertir
nada. Todo sale convertido a WebP.

**Rechazado, y se comprueba por lo que el archivo ES y no por cómo se llama:**

- **SVG.** Es un documento XML que admite `<script>`. Es la vía clásica para
  ejecutar JavaScript desde una imagen «subida», y no hay ninguna razón para
  aceptarlo en la foto de un salón.
- HTML, JavaScript, PDF, ZIP, ejecutables, y cualquier cosa que `sharp` no sepa
  abrir como mapa de bits.
- GIF animado y WebP animado: se aceptan y se guarda **el primer fotograma**
  (`animated: false`). Un perfil no es un sitio para un GIF de tres megas.

**Los topes:**

```
por archivo         8 MB
al descodificar     MAX_INPUT_PIXELS (el que ya existe): para la bomba de
                    descompresión, que es un archivo pequeño que se abre enorme
lado mínimo         400 px: por debajo no sirve para nada y es casi siempre un
                    error de quien sube
lado máximo salida  1600 px, y una miniatura de 400
a la vez            el semáforo de withImageSlot, que ya existe
por proveedor       10 imágenes + 1 vídeo externo (Fase 1)
```

Y **el tope de Next para los formularios se pone POR ENCIMA** del que comprueba
el código, por lo que ya costó una vez: con el del framework por debajo, una foto
de dos megas se rechazaba con un error del framework en vez de con el mensaje
escrito para ese caso.

---

## 6. Política de eliminación

Quién puede: **el proveedor** las suyas, y **quien modera** cualquiera.

```
1. Se resuelve el media contra el ámbito del proveedor. Un mediaId de otro
   proveedor NO ENCUENTRA NADA — no da «prohibido», que ya diría que existe.
2. Se borra la FILA primero, y el objeto después.
3. store.remove(key), idempotente.
4. AuditLog: media.delete, con quién, cuándo y por qué.
```

La fila primero, y esta vez al contrario que al subir: en cuanto no hay fila, la
imagen ya no se sirve. Si el borrado del objeto falla, queda un huérfano que
nadie puede pedir. Al revés habría un momento en que la fila apunta a un objeto
que ya no está, y eso sí se ve.

**El repaso de huérfanos.** Un trabajo que compara el almacén con la base y borra
lo que no tiene fila y lleva más de 24 horas —el margen es por las subidas en
curso—. Va en la Fase 2 con su temporizador; en la Fase 1 es una orden que se
ejecuta a mano, porque un trabajo automático que borra archivos es lo último que
se automatiza.

**Borrar un proveedor** se lleva sus filas por la cascada y sus objetos en la
misma transacción de aplicación. Lo que quede, lo barre el repaso.

**Copyright con resolución `upheld`:** el objeto se borra **del almacén**, de
verdad, no solo de la vista. Es el único caso donde eso es obligatorio y no una
limpieza.

---

## 7. Política de moderación

```
pending_review → approved      lo ve todo el mundo
               → rejected      con motivo, visible SOLO para el proveedor
approved       → hidden        oculta: por copyright, por moderación o por él
hidden         → approved      restaurada
cualquiera     → (borrada)
```

**Reglas:**

1. **Nada se publica solo.** Una imagen nueva **sobre un perfil ya aprobado**
   entra en `pending_review` **ella sola**, sin tumbar el perfil. Es el camino
   clásico: se aprueba un perfil limpio y luego se sube otra cosa.
2. **`pending_review`, `rejected` y `hidden` no se sirven en público**, ni con la
   dirección exacta. El dueño y quien modera sí las ven, con sesión.
3. **24 horas hábiles.** El reloj arranca en `createdAt` de la imagen. La cola
   sale ordenada por antigüedad y lo que pase de ahí, en rojo.
4. **Copyright** (el recorrido completo):
   - la denuncia exige correo del denunciante — sin alguien a quien responder no
     hay reclamación, hay un botón de sabotaje;
   - la imagen pasa a `hidden` con `hiddenReason = 'copyright'` **al momento**,
     antes de que nadie revise;
   - si la denuncia es del perfil entero y no de una imagen, se ocultan **las
     imágenes, no el perfil**: cerrar el negocio de alguien con un formulario
     anónimo, no;
   - se avisa al proveedor, con qué se ocultó y dónde responder;
   - una persona resuelve: `upheld` → se borra del almacén; `dismissed` → vuelve
     a `approved`;
   - y se le contesta al denunciante.
5. **Todo movimiento va a `AuditLog`**: `media.upload`, `media.delete`,
   `media.approve`, `media.reject`, `media.hide`, `media.restore`, con autor,
   motivo y `mediaId`. **Nunca** el nombre del archivo original ni el correo del
   denunciante en los metadatos del historial.

---

## 8. Pruebas

Las tres que se pidieron, y lo que cada una tiene que afirmar.

### 8.1 Aislamiento entre dos proveedores

```
El proveedor B, con sesión propia y válida, contra todo lo de A:
  · subir una imagen a A               → no encuentra el proveedor
  · listar las de A                    → vacío
  · borrar una de A por su mediaId     → no encuentra nada (404, no 403)
  · reordenar las de A                 → nada cambia
  · cambiar el altText de una de A     → nada cambia
  · aprobar una de A                   → no tiene directory:moderate
  · pedir /api/d/media/<id> de una de A en pending_review → 404
Y después: las de A siguen exactamente como estaban. Contarlas.
```

### 8.2 Sin permiso no hay URL

```
· sin sesión                                → nada
· con sesión de OFICINA (tenantId puesto)   → nada, aunque sea del mismo dueño
· con sesión de proveedor pero de OTRO      → nada
· con PROVIDER_EDITOR donde haga falta admin → nada
· una sesión con tenantId Y providerId       → la BASE la rechaza
· quien no tiene directory:moderate pidiendo la firma de lectura privada de
  una imagen en pending_review               → nada
«Nada» es: ni URL firmada, ni bytes, ni la existencia confirmada.
```

### 8.3 Un proveedor no puede usar el objectKey de otro

Es la prueba que más importa y va por tres caminos, porque hay tres:

```
1. Al subir: B manda un objectKey fabricado que apunta a
   providers/<A>/<uuid>.webp. → El servidor NO acepta llaves de fuera: la
   llave la decide él con el providerId del ámbito. El campo ni se lee.
2. Al leer: B pide /api/d/media/<mediaId de A>. → La ruta resuelve el media
   por su id y comprueba el estado; para lo no aprobado exige ser el dueño.
3. Al borrar: B manda el mediaId de A. → El WHERE lleva el providerId del
   ámbito, así que no encuentra fila. El objeto de A sigue en el almacén:
   se comprueba con store.head() DESPUÉS.
```

Y una cuarta, por la forma de la llave: **una llave con `..`, con `/` de más o
con el providerId de otro no se puede construir.** `objectKeyFor(scope, uuid)` es
la única forma de hacer una, y valida con la misma idea que
`assertDatabaseName`: minúsculas, dígitos, guiones, y la ruta exacta.

### 8.4 Y las del propio almacén

```
· memoryObjectStore se niega a arrancar con NODE_ENV=production
· put → get → remove → get = null
· remove de algo que no está: no falla
· la firma V4 de una petición conocida coincide con el ejemplo oficial de AWS
  (vector de prueba fijo, sin red)
· un SVG renombrado a .webp se rechaza
· un JPEG con GPS en el EXIF: lo guardado NO lo lleva. Se comprueba leyendo
  los metadatos del resultado.
· la undécima imagen se rechaza, y DOS subidas a la vez no dejan once
```

Las pruebas del almacén usan el adaptador de memoria: **no hacen red y no
necesitan cuenta**, así que corren en integración continua como todo lo demás.

---

## 8.5 La sonda de cacheabilidad: hecha, y el resultado

Era el paso 1 del orden de trabajo, y estaba antes que las pantallas por si
cambiaba el diseño de rutas. Ya está medido, con una ruta de prueba y tres
compilaciones:

```
/d/[locale] con `revalidate = 300`                 → ƒ  (dinámica)
/d/[locale] con `dynamic = 'force-static'`         → ƒ  (dinámica)
… y quitando el `force-dynamic` del layout raíz    →    (estática)
```

**Conclusión:** lo que impide cachear no es la cookie del idioma, es la línea
`export const dynamic = 'force-dynamic'` del layout raíz, que se aplica a la
aplicación entera y **gana sobre lo que declare un hijo**.

Y esa línea no se toca. Está puesta por una razón escrita y cara: `/render/[slug]`
se quedó estática una vez, y el fallo salió como vistas previas de WhatsApp
devolviendo 500 — una página que no abre ningún invitado rompiendo lo único que
ven todos.

**Así que el diseño de rutas NO cambia**, y la caché se hace donde sí se puede,
que además es donde importa: **en el proxy**. Las páginas de `/d/` no leen la
sesión ni ninguna cookie, así que su respuesta solo depende de la dirección;
nginx o Cloudflare pueden guardarla por URL con un TTL corto. Lo que hay que
comprobar al montarlo —y es una comprobación, no una suposición— es que la
respuesta **no** salga con `Vary: Cookie`, porque entonces no cachea nada.

Y para la base de datos, que es el otro coste: las consultas del listado van
detrás de una caché de datos con su propio plazo, de modo que renderizar cien
veces no sean cien consultas.

Nada de esto vale para `/api/d/media/[mediaId]`, que por §4.1 no se cachea en la
Fase 1.

---

## 9. Lo que hace falta antes de terminar, y lo que no bloquea

**No bloquea empezar.** El puerto, el adaptador de memoria, el pipeline de
imagen, la fila, el panel, la moderación y todas las pruebas se hacen y se
prueban sin bucket.

**Bloquea publicar galerías de verdad:**

1. Las seis variables de un bucket R2. **No pongo valores de mentira en ningún
   archivo**, ni de ejemplo: un `STORAGE_ACCESS_KEY_ID="cambiame"` es cómo
   arranca algo en producción con una credencial de relleno — la misma piedra del
   `cambiame@ejemplo.com`.
2. Declarar `sharp` en `apps/web/package.json` (§1.3). Esto sí lo hago ya con lo
   demás: no es una dependencia nueva, es escribir la que ya se usa.

---

## Orden de trabajo

1. Declarar `sharp` y sincronizar el lockfile.
2. `ObjectKey`, `objectKeyFor()` y el puerto `ObjectStore`.
3. `memoryObjectStore` + las pruebas de §8.4 que no necesitan red.
4. La firma V4 con `node:crypto` + su prueba contra el vector oficial de AWS.
5. `s3ObjectStore` sobre esa firma, y `storeFor()` con la negativa en producción.
6. El pipeline de imagen: los frenos, `sharp`, la llave, el orden almacén→fila.
7. La migración `provider_media` con `sortOrder` y `hiddenReason`, y sus
   comprobaciones en `db:check`.
8. `/api/d/media/[mediaId]` con la regla de estado.
9. Las pruebas 8.1, 8.2 y 8.3 **antes** de las pantallas.
10. `/panel/proveedor/medios`, y la cola de moderación con su reloj.

Los pasos 2 a 7 son la Fase 1 del almacenamiento y no tocan nada de lo que ya
existe: ni invitaciones, ni actos, ni RSVP, ni QR, ni puerta, ni WhatsApp, ni
pagos, ni el aislamiento entre oficinas.
