# Arquitectura del producto

Cómo pasa esto de un motor de render a un negocio con oficinas, clientes y apps
móviles. Este documento define el destino; el código todavía no lo implementa
(ver *Estado y orden de construcción* al final).

---

## 1. Tres formas de que alguien lo use

Las tres conviven en el mismo código. Lo único que cambia es **de quién es el
evento** y **quién lo compone**. Dónde viven los datos lo decide el reparto de
inquilinos, que se explica en el apartado 2.

### A. Autoservicio

El cliente final entra a la web, elige plantilla, escribe los datos de su boda,
paga y publica. No hay intermediario.

- Cobro: por evento (pago único) o plan anual para quien organiza varios.
- El evento pertenece al *tenant* raíz (la plataforma).
- Es el modelo que más escala y el que menos margen deja por unidad.

### B. Oficina licenciada — el alquiler

Una agencia de eventos, una imprenta o un salón alquila la plataforma. Trabaja
con **su marca y su propio subdominio** (`agenciax.tudominio.com`), y compone las
invitaciones de sus clientes.

- Cobro: mensualidad por oficina, o mensualidad más un porcentaje por invitación
  publicada. La mensualidad es lo que hace el ingreso predecible.
- El evento pertenece a esa oficina. **Una oficina nunca ve los datos de otra.**
- La oficina puede personalizar logo, colores e idioma por defecto, pero no las
  plantillas base: esas las controlas tú, porque son el producto.
- Es el modelo que pediste. Es también el que exige más disciplina técnica: en
  cuanto hay dos oficinas, cada consulta a la base de datos tiene que ir filtrada
  por oficina, sin excepción.

### C. Concierge — la haces tú

Tú compones la invitación desde el panel de superadmin y le entregas al cliente
el enlace y el PNG. El cliente no necesita cuenta, ni aprender nada, ni instalar
nada.

- Cobro: presupuesto por trabajo.
- El evento pertenece al tenant raíz, con una nota de a quién se le entregó.
- Es la vía para empezar: valida el producto y da ingresos antes de que exista
  ningún formulario de creación.

> **Recomendación de orden comercial:** empezar por C (concierge) mientras se
> construye A (autoservicio), y abrir B (licencias) cuando el producto ya
> aguante clientes sin ti delante. Vender licencias antes de tiempo obliga a dar
> soporte a terceros sobre algo inmaduro.

---

## 2. Multiempresa: cómo se aísla cada oficina

El modelo tiene **dos repartos**, y el interruptor es `TENANCY`. No conviven en
una misma instalación: se elige uno y se enciende (ver *Una base de datos por
oficina* en `CLAUDE.md`).

- **`shared`** — todas las oficinas en la misma base, separadas por `tenantId`.
  Es lo que había, y sigue siendo válido para una instalación de una sola
  oficina o para desarrollo.
- **`fleet`** — **una base de datos por oficina**. Alquilarle esto a una oficina
  es darle una empresa nueva: su propia base, vacía, sin una sola fila de nadie
  más. Lo que impide que una vea a otra deja de ser el filtro que el código no
  se olvida de poner y pasa a ser que dos bases de PostgreSQL no se consultan
  entre sí. La base de CONTROL guarda lo del arrendador —registro de oficinas,
  personas, planes, cobros, SINPE, configuración e historial— y cada oficina
  guarda su trabajo. `npm run lint:planes` vigila esa frontera en cada
  despliegue.

Lo de abajo vale en los DOS repartos: en `fleet` es la red de dentro, y la de
fuera es la base.

- Toda entidad de negocio cuelga de un `tenantId`.
- Existe un tenant raíz, el tuyo, para el autoservicio y el concierge.
- Ninguna consulta accede a datos sin filtrar por tenant. Esto se garantiza en
  una sola capa de acceso a datos, no repartiendo `where` por la aplicación.
- El tenant se resuelve por subdominio (o por dominio propio si la oficina lo
  aporta) y se confirma contra la sesión del usuario: quien entra por
  `agenciax.` y pertenece a otra oficina, no pasa.
- La resolución usa `x-forwarded-host`, porque en las peticiones que dispara una
  Server Action Next reescribe `host` al origen desnudo. Eso implica una
  condición de despliegue: **el servidor de origen solo puede ser alcanzable a
  través del proxy que fija esa cabecera**, nunca expuesto directamente.
- Después de iniciar sesión, la oficina sale de la sesión y no del host: la
  pertenencia a una oficina es parte de quién eres, y no puede cambiar porque
  cambie una cabecera.
- La invitación pública (`/i/[slug]`) es la única ruta sin tenant: el `slug` es
  global y no revela nada del resto.

Se descartó una base de datos por oficina: multiplica migraciones y copias de
seguridad por cada cliente nuevo, y el volumen de este producto no lo justifica.

---

## 3. Roles y permisos

| Rol | Quién es | Qué alcanza |
| --- | --- | --- |
| `SUPERADMIN` | Tú | Oficinas, planes y precios, plantillas, facturación, y acceso de soporte a cualquier evento (registrado en el historial) |
| `TENANT_ADMIN` | La oficina que alquila | Su equipo, su marca, sus clientes y todos los eventos de su oficina |
| `OPERATOR` | Quien compone en la oficina | Crear y editar eventos de esa oficina. No toca facturación ni usuarios |
| `ORGANIZER` | El cliente final | Solo su evento: invitados, confirmaciones y descargas |
| *(invitado)* | Quien recibe la invitación | Abrirla, confirmar y añadirla al calendario. **Sin cuenta** |

Principios:

- El invitado nunca se registra. Se identifica con un enlace firmado y de un solo
  uso por invitado. Pedirle una cuenta para confirmar una boda hunde la tasa de
  respuesta.
- El superadmin puede entrar a un evento ajeno para dar soporte, pero **cada
  acceso queda registrado**. Sin esa traza, el acceso de soporte es una puerta
  trasera.
- Los permisos se comprueban en el servidor. Ocultar un botón no es un permiso.

Autenticación prevista: email con código de un solo uso (OTP) para el cliente
final —no hay contraseñas que perder— y contraseña con segundo factor para
superadmin y admins de oficina.

---

## 4. Modelo de datos

El esquema completo está en [`prisma/schema.prisma`](../prisma/schema.prisma).
Las decisiones que importan:

- **`Event` y `InvitationVersion` están separados.** Un evento es la boda; una
  versión es esa boda compuesta en un idioma. Así una misma boda tiene su
  invitación en árabe y en inglés, cada una con su plantilla y sus cifras, sin
  duplicar la lista de invitados ni las confirmaciones.
- **Cada invitado tiene su idioma.** A la abuela le llega el enlace en árabe y a
  la prima de Londres el mismo evento en inglés.
- **Los renders se guardan.** El PNG y el PDF se generan una vez y se archivan;
  regenerarlos con Chromium en cada visita sería caro y lento.
- **Los versículos no están en la base de datos.** Siguen en el archivo fijo
  `data/verses.json`, versionado en git y verificado por una persona. Que no se
  puedan editar desde un panel es la garantía de que nadie publique un texto
  sagrado alterado.
- **Historial de cambios (`AuditLog`).** Quién tocó qué y cuándo. Imprescindible
  cuando hay oficinas de terceros manejando datos de sus clientes.

---

## 5. Apps móviles

**Un monorepo** con la web y la app compartiendo tipos y los cuatro diccionarios
de idioma. Un cambio en el texto árabe se hace una vez. **Ya está construido.**

```
apps/web      Next.js — invitación pública, paneles, API
apps/mobile   Expo (React Native) — app del organizador y de la oficina
packages/core Tipos, validación, diccionarios, formato de fechas y cifras
```

### La app del organizador (iOS y Android)

Crear el evento, ver las confirmaciones llegando en vivo, mandar la invitación
por WhatsApp y descargar la imagen. Es la app del cliente final.

### La misma app en modo oficina

Con rol `TENANT_ADMIN` u `OPERATOR` muestra la cartera de clientes y eventos en
vez de un solo evento. El superadmin ve además el listado de oficinas. **No son
tres aplicaciones: es una, y lo que cambia es lo que el rol permite ver.**

### El invitado no instala nada

La invitación es un enlace web y así se queda. Exigir una app para abrir una boda
mata la mitad de las confirmaciones.

### Notas de plataforma

- Las tiendas cobran comisión sobre pagos de bienes digitales hechos dentro de la
  app. El pago se hace en la web; la app no vende.
- El árabe RTL en React Native se activa con `I18nManager` y **exige reiniciar la
  app** al cambiar de dirección. Hay que preverlo en el primer arranque, no
  descubrirlo al final.
- Las fuentes van embebidas en el binario, igual que en la web.

---

## 6. Qué se descarga el cliente

| Formato | Para qué |
| --- | --- |
| PNG 1080×1920 | WhatsApp, Instagram, redes |
| PDF | Imprenta, invitación en papel |
| `.ics` | Añadir al calendario del invitado |
| Excel / CSV | Lista de invitados y confirmaciones, para el salón y el catering |

Los tres primeros salen del mismo motor de render que ya existe.

---

## 7. Datos personales

Una lista de invitados es una lista de nombres y teléfonos de gente que no ha
firmado nada. Trato mínimo:

- Los invitados de un evento se borran cuando el organizador borra el evento, y
  automáticamente pasado un plazo desde la fecha del evento.
- Una oficina no exporta datos de otra. Nunca.
- El enlace del invitado no es adivinable y caduca.
- Al vender licencias a oficinas europeas, el contrato de encargado de
  tratamiento (RGPD) es requisito, no trámite.

---

## 8. Despliegue

El render necesita Chromium, así que **no vale un entorno *edge* o *serverless*
puro** para esa ruta. Opciones, en orden de simplicidad:

1. Un contenedor con Chromium instalado, corriendo Next.js entero.
2. Next.js en la plataforma que sea, y el render en un pequeño servicio aparte
   con su navegador.

La base de datos, PostgreSQL gestionado. Las imágenes generadas, en
almacenamiento de objetos con CDN delante.

---

## 9. Estado y orden de construcción

**Hecho:** motor de render, cuatro idiomas con RTL verificado, plantilla
`classic-gold`, PNG 1080×1920, validación de datos, guardia automática contra CSS
físico.

**Siguiente, en este orden:**

1. **Base de datos, oficinas y roles.** Prisma, PostgreSQL, autenticación, tenant
   por subdominio, historial de cambios.
2. **RSVP y entregables.** Confirmaciones, `.ics`, mapa, exportar a Excel.
3. **Formulario de creación** con vista previa en vivo.
4. **Panel de oficina y facturación.** Planes, límites, cobro.
5. **Apps móviles.** Monorepo Expo.

El orden no es negociable en un punto: **las apps móviles necesitan cuentas y
roles detrás**. Construirlas antes obligaría a rehacerlas enteras.
