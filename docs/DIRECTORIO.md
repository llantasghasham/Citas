# Directorio público de proveedores y celebraciones

Plan, no código. Lo que sigue es lo que hay que decidir **antes** de escribir una
migración, con las razones y con lo que cuesta cada decisión.

Resumen en una frase: **se puede hacer, encaja con lo que ya hay, y el riesgo no
es técnico sino de privacidad** — un directorio público y las listas de invitados
de bodas reales viviendo en el mismo producto. Casi todo este documento existe
para que un fallo de ese lado no pueda pasar.

---

## 1. Auditoría del repositorio actual

Lo que ya existe y **se reutiliza** tal cual:

| Pieza | Dónde | Qué aporta al directorio |
|---|---|---|
| Dos planos de datos | `lib/db/client.ts` | dice exactamente dónde va cada tabla nueva |
| Guardia de la frontera | `scripts/check-planes.mjs` | impide escribir una consulta en la base equivocada |
| `TenantScope` marcado | `lib/db/tenant.ts` | el patrón de aislamiento, ya probado |
| Sesiones y OTP | `lib/auth/` | un proveedor entra igual que una oficina |
| Capacidades por rol | `lib/auth/permissions.ts` | seis capacidades, editables, con dos candados |
| Cobro | `lib/billing/`, `applySettlement` | atómico, monótono e idempotente; ya probado |
| Frenos contra abuso | OTP, callback de pago | el patrón exacto que necesita el formulario de contacto |
| Subida de imágenes | `lib/images/limits.ts` | tres frenos: tamaño, píxeles y concurrencia |
| Historial | `AuditLog` | moderación auditable desde el primer día |
| Diccionarios | `packages/core/locales` | cuatro idiomas, con el árabe como principal |
| Guardia de RTL | `scripts/check-logical-css.mjs` | el portal público nace en RTL correcto |

Lo que **no** encaja sin tocarlo, y hay que decidirlo antes:

1. **Todo es dinámico.** El layout raíz declara `dynamic = 'force-dynamic'` para
   la aplicación entera, y la razón está escrita: `documentLanguage()` lee la
   cookie y las cabeceras, así que ningún segmento puede ser estático. Un
   directorio público vive de lo contrario — páginas cacheables, indexables y
   una URL canónica por idioma. **Esto es lo primero que hay que resolver, y la
   solución cambia las rutas** (§4).
2. **`Locale` es `ar | es | pt | en`,** en el enum de Prisma y en
   `packages/core`. El francés no es un archivo más: es una migración de enum,
   un quinto diccionario completo y cada `Record<Locale, …>` del repositorio.
3. **Las imágenes van a PostgreSQL** (`BrandAsset`, `Render`, la foto de
   perfil), con una razón buena: un despliegue copia el código y se lleva por
   delante lo que se deje en el disco. Una galería de proveedores es otro orden
   de magnitud.
4. **`Order`, `Payment` y `Subscription` cuelgan de `tenantId`.** Un proveedor
   que paga no es una oficina.
5. **`Session` cuelga de `Tenant`** (`tenantId`, anulable). Un proveedor
   necesita una sesión que no sea de ninguna oficina.
6. **No hay `sitemap.xml` ni datos estructurados.** Hoy no hacían falta.

---

## 2. Arquitectura propuesta

### 2.1 El directorio va en el plano de CONTROL. No es negociable.

El registro de proveedores es **global**: se busca por región, no por oficina.
Con `TENANCY=fleet` cada oficina tendrá su propia base de datos, y una base de
oficina no puede servir un listado que cruza a todas. Así que `Provider` y todo
lo suyo van en la base de control, junto al registro de oficinas, los planes y
los cobros. `scripts/check-planes.mjs` aprende los modelos nuevos el mismo día
que se crean.

### 2.2 Un proveedor NO es una oficina

Tentador, porque heredaría membresías, sesiones, roles y facturación. Malo por
tres razones concretas:

- En `fleet`, dar de alta un `Tenant` **crea una base de datos**. Un proveedor no
  tiene datos privados que aislar: le sobra una base entera.
- `Tenant` significa «oficina» en todo el código: suspenderla, su marca blanca,
  su subdominio, su `databaseName`. Meterle otro significado encima es cómo un
  modelo se vuelve incomprensible.
- Los permisos de oficina (`event:write`, `tenant:staff`) no tienen sentido para
  un proveedor, y reutilizarlos es cómo un proveedor acaba con una capacidad que
  nadie quiso darle.

**Propuesta:** `Provider` como entidad propia, `ProviderMembership(userId,
providerId, role)` en paralelo a `Membership`, y `Session.providerId` anulable
junto al `tenantId` que ya existe. Una sesión es de una oficina, de un proveedor,
o de ninguna de las dos (el superadministrador). **Nunca de las dos a la vez**, y
eso lo impide la base con una restricción, no el cuidado de quien escribe.

Una misma persona puede ser las dos cosas —el dueño de un salón que además
gestiona bodas— con dos membresías y eligiendo con cuál trabaja, igual que hoy se
elige oficina.

### 2.3 La publicación de una fiesta es una COPIA, no una marca

Aquí discrepo del encargo, y es la decisión más importante del documento.

El plan pedía `isPublic`, `publicSlug`, `publicTitle`… **dentro de `Event`**. Eso
significa que la boda privada y su cara pública son la misma fila, y que lo único
que separa la lista de invitados de la calle es que ninguna consulta pública se
olvide de un `where isPublic = true`. Es exactamente el modelo que este proyecto
rechazó para las oficinas, y por la misma razón: **una red que depende de que
nadie se olvide no es una red.**

**Propuesta:** una tabla `PublicListing` en el plano de CONTROL con **solo los
campos que se publican**, escrita por una acción explícita del organizador. No es
una vista del evento: es un documento aparte, con su texto, su portada y su
región, que alguien redactó y aprobó. Consecuencias, todas buenas:

- La consulta pública **no puede** llegar a `Guest`, `Rsvp`, `GuestPreference` ni
  `CheckIn`, porque no están en esa base cuando el reparto sea `fleet`, y porque
  no hay ninguna clave foránea que las una.
- Despublicar es borrar una fila, no confiar en que un `where` filtre.
- Lo publicado no cambia solo cuando se corrige el evento privado. Si la boda
  cambia de salón, la página pública no se entera hasta que alguien lo decide —
  que es lo correcto para algo que ya se indexó y se compartió.
- El coste: hay que copiar. Es el coste de no poder equivocarse.

Del evento privado solo se guarda `sourceEventId` **sin clave foránea** y sin
consultarlo nunca desde lo público: sirve para que el panel de la oficina sepa
que su boda tiene publicación, y para nada más.

### 2.4 Los dos mundos no comparten ninguna clave foránea

Ni una. Igual que hoy ninguna cruza entre el plano de control y el de oficina, y
eso no es casualidad sino la comprobación de que la línea está bien puesta.

---

## 3. Modelo de datos

Todo en el plano de **control**. Nombres en inglés, como el resto del código.

```
Provider                 el negocio: nombre, descripción, estado, slug, verificación
ProviderMembership       quién lo administra (userId, providerId, role)
ProviderCategory         N:M contra una lista CERRADA de categorías (no texto libre)
ProviderLocation         gobernación, distrito, ciudad, dirección pública, coords
ProviderMedia            imágenes y vídeo, con orden y estado de moderación
ProviderContact          los canales, cada uno con su «esto se publica» aparte
ProviderPlan             gratuito, destacado, premium
ProviderSubscription     qué plan tiene y hasta cuándo
ProviderPromotion        destacado temporal, con ventana de fechas
ProviderLead             una solicitud de contacto, con su estado
ProviderStat             contadores por día: vistas y clics, agregados
ProviderReport           una denuncia pública, con motivo
PublicListing            la publicación de una fiesta (§2.3)
PublicListingProvider    qué proveedores participaron, si se autoriza
```

**Lo que NO se crea todavía** y estaba en el encargo: `ProviderReview`
—las reseñas son un producto entero, con fraude, con derecho de réplica y con
responsabilidad legal sobre lo que se publica de un negocio— y
`ProviderVerification` como tabla: la verificación es un estado y una fecha
dentro de `Provider` hasta que haya un flujo de documentos que justifique una
tabla.

### Decisiones concretas dentro del modelo

- **Las categorías son una lista cerrada en código** (como `PREFERENCE_KEYS` y
  como los versículos), no filas que cualquiera añade. Traducidas en los
  diccionarios. Añadir una es una decisión de producto: se escribe, se traduce y
  se despliega.
- **La ubicación es jerárquica y validada**: `governorate` (las ocho, enum),
  `district` (lista cerrada por gobernación), `city` (texto, porque son cientos y
  cambian). La dirección exacta y las coordenadas llevan **su propio interruptor
  de publicación**: un salón sí quiere que le lleguen; una repostera que trabaja
  desde su casa, no.
- **Los contactos se publican uno a uno.** Teléfono, WhatsApp, correo, web y
  redes, cada uno con su «esto se ve». Un solo interruptor global es cómo se
  publica sin querer un número personal.
- **Los contadores se agregan por día**, no una fila por visita. Una fila por
  visita es una tabla que crece sin techo y, además, un registro de quién miró
  qué que nadie pidió.

### Índices

`Provider(slug) único` · `Provider(status, publishedAt)` ·
`ProviderCategory(category, providerId)` ·
`ProviderLocation(governorate, district, city)` ·
`PublicListing(slug) único` · `PublicListing(status, publishedAt)` ·
`ProviderLead(providerId, status, createdAt)` ·
`ProviderSubscription(providerId) único` ·
`ProviderPromotion(providerId, startsAt, endsAt)`.

Y uno parcial, con la misma idea que los de la cola: **una sola suscripción viva
por proveedor**, que lo impida la base.

---

## 4. Rutas públicas, y el problema del idioma

**El idioma tiene que ir en la URL.** Hoy sale de una cookie y del
`Accept-Language`, y por eso la aplicación entera es dinámica. Para el portal
público eso no sirve por dos razones a la vez: los buscadores necesitan **una URL
canónica por idioma**, y una página que lee cookies no se puede cachear.

```
/[locale]/proveedores
/[locale]/proveedores/[categoria]
/[locale]/proveedores/[gobernacion]/[categoria]
/[locale]/p/[slug]                      ← el perfil del proveedor
/[locale]/fiestas
/[locale]/fiestas/[slug]
/[locale]/sitemap.xml
```

`/proveedores` sin idioma redirige al que corresponda por `Accept-Language`, con
`301` y sin leer cookies.

Lo de hoy **no se toca**: `/i/<slug>`, `/g/<token>`, `/crear`, `/panel` y
`/pagar/<token>` siguen exactamente donde están, con su idioma resuelto como
siempre. El portal es un mundo nuevo al lado, no una reescritura del actual.

**Qué hace falta para que sea cacheable:** el grupo de rutas públicas no puede
depender de la resolución por cookie del layout raíz. Es trabajo de verdad y hay
que presupuestarlo en la Fase 1, no descubrirlo en la Fase 3.

## 5. Rutas privadas

```
/panel/proveedor                        el perfil, para quien lo administra
/panel/proveedor/medios                 imágenes y vídeo
/panel/proveedor/leads                  las solicitudes, con su estado
/panel/proveedor/plan                   suscripción y facturas
/panel/proveedor/estadisticas           vistas y clics
/panel/moderacion                       SOLO plataforma: cola de revisión
/panel/moderacion/denuncias             SOLO plataforma
/panel/eventos/[eventId]/publicacion    la oficina publica SU boda
```

---

## 6. Permisos y roles

Dos capacidades nuevas, y ni una más:

```
provider:manage     editar su perfil, sus medios, sus leads, su plan
directory:moderate  aprobar, rechazar, suspender y verificar
```

Roles de proveedor: `PROVIDER_ADMIN` (todo lo suyo) y `PROVIDER_EDITOR` (perfil y
medios, **no** el plan ni la facturación).

Los dos candados que ya existen siguen intactos y ahora valen para más:
`SUPERADMIN` no se toca y **`platform:manage` no se reparte**. Añado un tercero
de la misma familia: **`directory:moderate` no se le puede conceder a un rol de
proveedor**, ni escribiéndolo ni leyéndolo de una fila vieja. Un proveedor que se
aprueba a sí mismo es el fallo entero de un directorio moderado.

`sessionCan` sigue siendo **síncrona**, por la misma razón de siempre.

---

## 7. Moderación

Estados: `draft → pending_review → approved` · `rejected` · `suspended` ·
`archived`.

- **Nada se publica solo.** Ni el perfil, ni una imagen nueva sobre un perfil ya
  aprobado, ni una publicación de fiesta.
- **Una imagen nueva no pasa por estar el perfil aprobado.** Es el camino
  clásico: se aprueba un perfil limpio y luego se sube otra cosa.
- **Suspendido desaparece de todo**: del buscador, del listado, de la portada, de
  los datos estructurados y del sitemap. Y su URL responde 404, no una página que
  diga «suspendido» — eso es contar algo de un negocio que no hace falta contar.
- **Todo movimiento queda en `AuditLog`** con su autor y su motivo.
- **Las denuncias son públicas y sin cuenta**, con los mismos tres frenos del
  callback de pago: tope al cuerpo, cupo por dirección y corte del repetido.
- Una decisión que hay que tomar y que no es técnica: **qué se hace con una
  denuncia de «usa mis fotos sin permiso»**. Es la que trae cartas de abogados.

---

## 8. Monetización

El orden importa: **primero que haya proveedores y visitas, después cobrarles.**
Un directorio vacío no se vende, y un proveedor que paga por aparecer en una
página que nadie visita no renueva.

- **Fase 1 y 2: gratis para todos.** Sirve para llenarlo y para saber si alguien
  busca.
- **Fase 3:** `gratuito` / `destacado` / `premium`, con lo que pedía el encargo.
  Reutiliza `Plan`, `Order`, `Payment` y `applySettlement` tal cual — está
  probado y no hay razón para un segundo camino del dinero.
  **Lo que hay que tocar:** `Order` cuelga hoy de `tenantId`. Propuesta: añadir
  `providerId` anulable y una restricción de la base que exija que **exactamente
  uno de los dos** esté puesto. Un pedido sin dueño o con dos es una factura que
  nadie sabe a quién cobrar.
- **Las promociones son una ventana de fechas**, no una marca. Un «destacado»
  que se apaga solo el día que toca no necesita que nadie se acuerde.
- **Las estadísticas son del proveedor y solo suyas.** Nunca «quién te miró».

Lo que **no** se hace en ninguna de estas fases: comisiones, pagos entre cliente
y proveedor, y cobrar por lead. Lo último suena bien y es la forma más rápida de
que un directorio se llene de leads falsos.

---

## 9. SEO

- Una URL canónica **por idioma**, con `hreflang` entre ellas.
- `sitemap.xml` por idioma, generado de la base, **sin lo suspendido ni lo
  pendiente**.
- Open Graph con la portada del proveedor o de la fiesta.
- Datos estructurados: `LocalBusiness` para el proveedor, `Event` para una fiesta
  publicada. **Sin `AggregateRating`** mientras no haya reseñas de verdad:
  inventar estrellas es una penalización y una mentira.
- `noindex` en: perfiles suspendidos, rechazados, borradores y en cualquier
  listado filtrado que no aporte nada (`?orden=…`).
- Slugs **estables**: cambiar el nombre comercial no cambia la URL.
- Y lo mismo que ya rige en los slugs de invitación: **un nombre árabe no se
  translitera**. El slug sale de lo que escriba el proveedor en latino o es
  aleatorio.

---

## 10. Traducciones y RTL

- El portal nace en los cuatro idiomas de hoy. **El francés es una decisión
  aparte** y hay que tomarla antes de la Fase 1: cuesta una migración del enum
  `Locale`, un quinto diccionario entero, cada `Record<Locale, …>` del
  repositorio y la app móvil. Después es más caro, no menos. Para el Líbano yo lo
  haría, y lo haría ya.
- Las categorías y las regiones **se traducen desde el diccionario**, no se
  guardan en un idioma.
- El nombre del negocio y su descripción los escribe el proveedor, y puede
  escribirlos **en más de un idioma**: `ProviderTranslation`, con la misma
  prioridad que ya usan los actos —traducción → original—.
- `lint:rtl` cubre el portal desde el primer archivo.
- Y lo que no cubre ningún guardia: **alguien que lea árabe tiene que mirar las
  pantallas**. Sigue pendiente desde hace tres tandas.

---

## 11. Riesgos de privacidad

Por orden de gravedad.

1. **Que una publicación pública arrastre la lista de invitados.** Es el riesgo
   que puede cerrar el producto. Lo ataca la §2.3: copia y no marca, plano
   distinto, ninguna clave foránea. Y una prueba que lo afirme.
2. **Publicar una boda sin que la pareja lo sepa.** La oficina tiene los datos,
   pero la fiesta no es suya. **Propuesta:** la publicación exige una
   autorización registrada —quién la dio, cuándo y con qué texto—, igual que el
   permiso para escribir por WhatsApp. Sin eso, no se publica.
3. **Un lead es un dato personal de quien lo manda.** Nombre, teléfono y la fecha
   de su boda. Necesita su propio plazo de retención y su propia baja, y el
   proveedor tiene que ver que eso existe.
4. **La dirección exacta de un negocio doméstico.** Separada y con su propio
   interruptor (§3).
5. **Las estadísticas.** Agregadas por día. Nunca una fila por visitante.
6. **Las fotos que sube un proveedor.** Se recodifican al entrar, como la foto de
   perfil, y por la misma razón: los metadatos del móvil llevan las coordenadas
   dentro.

---

## 12. Migraciones necesarias

En este orden, y ninguna destructiva:

1. `provider_base` — `Provider`, `ProviderMembership`, `ProviderCategory`,
   `ProviderLocation`, `ProviderContact`, más `Session.providerId` y la
   restricción de «oficina o proveedor, nunca los dos».
2. `provider_media` — `ProviderMedia` y su moderación.
3. `directory_moderation` — estados, `ProviderReport` y las capacidades nuevas.
4. `public_listing` — `PublicListing`, `PublicListingProvider` y la autorización
   del organizador.
5. `provider_leads` — `ProviderLead` y `ProviderStat`.
6. `provider_billing` — planes, suscripción, promociones y `Order.providerId` con
   su restricción.

Cada una con su comprobación en `db:check`: los índices únicos parciales, la
restricción de exclusividad de la sesión y que **ninguna clave foránea cruce**
entre lo público y lo privado.

---

## 13. Fases

**Fase 1 — el directorio.** `Provider`, categorías, ubicación, perfil público,
búsqueda, moderación básica, el panel del proveedor y las rutas con idioma. Al
final de esta fase el portal se puede enseñar y se puede llenar a mano.

**Fase 2 — publicaciones y leads.** `PublicListing` con su autorización, el
formulario de contacto con sus frenos, los leads en el panel y los contadores.

**Fase 3 — dinero.** Planes, destacados, suscripción, promociones y facturación.

**Fase 4 — nada de esto todavía.** Reservas, cotizaciones comparables, reseñas,
pagos entre cliente y proveedor, comisiones, contratos y calendario.

---

## 14. Pruebas

Las de aislamiento son obligatorias en la Fase 1, no en la última:

- Proveedor A contra todo lo de B: leer, editar, sus medios, sus leads, su plan.
- Un `providerId` cambiado en un formulario no encuentra nada.
- Una sesión de proveedor contra **cualquier** ruta de eventos, invitados, RSVP,
  QR, puerta o preferencias.
- Una oficina editando una publicación que no es suya.
- Quien no tiene `directory:moderate` aprobando un proveedor.
- Un rol de proveedor al que se intenta conceder `directory:moderate`, al
  escribir **y** al leer.
- Un perfil `suspended` en el buscador, en el listado, en el sitemap y en su
  propia URL.
- **Y la que más importa:** que desde una consulta pública no se pueda llegar a
  `Guest`, `Rsvp`, `GuestPreference` ni `CheckIn`. Con `lint:planes` extendido, y
  con una prueba que lo intente.

Cada fase cierra con: `typecheck`, `lint:rtl`, `lint:planes`, `db:check`,
`test:integration`, `verify:e2e` y `build`.

---

## 15. Lo que NO se debe implementar todavía

- **Reseñas.** Producto entero: fraude, derecho de réplica y responsabilidad
  legal sobre lo que se dice de un negocio.
- **Pagos entre cliente y proveedor, comisiones y contratos.** Eso es un
  marketplace y cambia qué es esta empresa, incluido a quién le reclama un
  cliente cuando algo sale mal.
- **Reservas y calendario de disponibilidad.** Solo tiene sentido cuando un
  proveedor ya entra todos los días, y eso hay que ganárselo.
- **Importar proveedores de otras webs para llenar el directorio.** Datos de
  negocios reales publicados sin su permiso, con sus fotos. Es la forma más
  rápida de recibir la primera carta de un abogado.
- **Publicar una boda sin autorización registrada.** Nunca.
- **Cobrar por lead.** Es cómo un directorio se llena de leads falsos.
- **Estrellas o valoraciones en los datos estructurados** sin reseñas reales.

---

## Lo que hace falta decidir antes de empezar

1. **¿Francés, sí o no?** Barato ahora, caro después. Mi recomendación: sí.
2. **¿La publicación de una fiesta es una copia (§2.3) o una marca en el
   evento?** Mi recomendación: copia, y con diferencia.
3. **¿Dónde van las imágenes?** Una galería no cabe en PostgreSQL como caben
   `Render` y `BrandAsset`. O se implementa el adaptador de almacenamiento de
   objetos detrás del puerto `RenderStore` que ya existe, o la Fase 1 sale con un
   tope duro de tres imágenes por proveedor.
4. **¿Quién modera?** El modelo funciona con una persona; hay que saber quién es
   y cuánto tarda, porque «pendiente de revisión» es un proveedor que no aparece.
5. **¿Qué se hace con una denuncia de derechos de imagen?**

Y una cosa que no depende de este documento: **el correo saliente sigue en
`console`**. Sin eso, un proveedor no puede recibir su código para entrar, así
que la Fase 1 no se puede ni probar con alguien de fuera.
