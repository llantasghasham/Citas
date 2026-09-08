# Decisiones pendientes

Cosas que no son código y que deciden si esto funciona como negocio. Están sin
resolver, y varias bloquean fases enteras. Ordenadas por lo que muerde primero.

Cada punto marcado con **⚠ verificar** es un dato que hay que confirmar hoy antes
de diseñar nada encima: son cosas que cambian de un mes a otro.

---

## Bloque 1 — Cobrar

### 1.1 Hay dos países en juego, y cobran distinto

El producto apunta a Líbano, pero la operación está en Costa Rica. Son dos
sistemas de cobro sin nada que ver, y **hay que decidir en cuál entra el dinero**
antes de integrar nada:

- Si el cliente que paga está **en Costa Rica** (por ejemplo la comunidad árabe
  de aquí), el cobro está prácticamente resuelto y se puede empezar esta semana.
- Si el cliente que paga está **en Líbano**, hay que integrar Whish y/o una
  pasarela local, y eso sí es trabajo.

No son excluyentes. Pero el primero es barato y el segundo no, así que conviene
que el primer mercado sea el que ya se puede cobrar.

### 1.2 Costa Rica — resuelto con Tilopay (SINPE Móvil + tarjeta)

**Tilopay** cobra por SINPE Móvil de forma automatizada y también con tarjeta.
Alta 100 % en línea, sin coste de afiliación ni mensualidad, con enlaces de pago,
cobros recurrentes y API. Seguridad 3-D Secure 2.0 sobre PowerTranz.

| | Comisión |
| --- | --- |
| SINPE Móvil | 2 % + 0,35 US$ |
| Tarjeta | 4,25 % + 0,35 US$ |

Sobre una invitación de 30 US$ eso es 0,95 US$ por SINPE y 1,63 US$ por tarjeta.
Asumible.

Alternativas si hace falta algo más pegado al banco: **SINPE Móvil Empresarial**
de Davivienda (valida los pagos recibidos y los liga a facturas por API) y
**CyberSINPE** (aplica automáticamente los SINPE recibidos, con integración para
comercio electrónico).

Dos obligaciones que no son opcionales:

- **Facturación electrónica.** Desde septiembre de 2025 Hacienda exige registrar
  los pagos recibidos por SINPE en la factura electrónica, con el método de pago
  **código 06**. El sistema de facturación tiene que estar al día.
- **Límites de SINPE Móvil (desde el 1 de junio de 2026).** Por SMS o WhatsApp,
  ₡100.000 diarios; desde la app o la banca en línea, ₡500.000 diarios. Para
  tickets de invitación sobra, pero condiciona cualquier venta grande a una
  oficina.

### 1.3 Líbano — DECIDIDO: Whish

**Decidido: Líbano cobra con Whish.** El puerto de pagos y el adaptador ya están
en el código; lo único que falta es el contrato exacto del servicio web. La lista
de lo que hay que pedirle a Whish está en [`COBRO-WHISH.md`](COBRO-WHISH.md).

Whish tiene producto de comercio (**Whish Pay**) y un servicio web documentado
(**Whish Collect**) con operaciones de consulta de
saldo, consulta de tipo de cambio y cobro. Existe además un plugin de WordPress
que lo usa, lo que confirma que la integración por API es real y no una promesa
comercial.

Lo que hace falta para empezar: **una cuenta de comercio con Whish**, que es
quien entrega las credenciales y la especificación técnica. Sin cuenta no hay
documentación pública completa.

Para tarjeta en Líbano, **Areeba** (institución financiera libanesa con licencia:
POS, pasarela, pay-by-link, recurrentes, 3-D Secure) y **Tap Payments** como
alternativa a comparar. Y ahí sigue en pie lo más barato: si ya hay un POS
funcionando, preguntar si activan pay-by-link y comercio electrónico sobre esa
misma cuenta.

**Stripe queda descartado en ambos casos para Líbano:** no opera en el país. La
vía de una LLC en EE. UU. o Ltd en Reino Unido implica constituir y mantener otra
empresa, no es un atajo.

> Las comisiones y requisitos de arriba vienen de fuentes secundarias de 2026.
> Antes de firmar, confirmarlos con cada proveedor.

### 1.4 Moneda

El precio se fija en dólares y se indica en la factura en qué se cobra. En Costa
Rica hay que decidir además si se muestra en colones, porque SINPE mueve colones
y el redondeo lo paga alguien. En Líbano, dólar fresco y lira no son la misma
cosa, y una invitación vendida hoy se entrega dentro de meses.

### 1.5 El precio

No hay ni un número escrito. Sin precio no se puede decidir si el autoservicio
tiene sentido o si esto es solo un negocio de servicio.

Lo que hay que averiguar, preguntando en Beirut, no calculando:

- Qué cobra hoy una imprenta por 200 invitaciones en papel.
- Qué cobra un diseñador por una invitación digital.
- Qué pagaría un salón o una agencia al mes por tener esto con su marca.

Si una invitación digital se vende por menos de lo que cuesta atender una duda
por WhatsApp, el autoservicio pierde dinero por cada cliente.

---

## Bloque 2 — El canal

### 2.1 WhatsApp no es una integración: es el producto

En Líbano la invitación se manda por WhatsApp. Eso cambia el diseño:

- Cada invitado necesita **su propio enlace**, para saber quién abrió y quién
  confirmó. Ya está previsto en el modelo de datos (`Guest.token`).
- Al pegar el enlace, WhatsApp muestra una vista previa. Esa imagen es la
  primera impresión de la invitación, y hoy sale del render — hay que cuidar que
  cargue rápido y no se corte.
- Mandar a 200 invitados a mano no es viable. La API de WhatsApp Business exige
  número verificado, plantillas aprobadas y **se paga por mensaje**. **⚠ verificar**
  precios y requisitos actuales.

Decisión pendiente: ¿el envío masivo lo hace la plataforma (coste por mensaje,
alta complejidad) o el organizador copia y pega desde su propio WhatsApp (gratis,
menos control)? Empezar por lo segundo es defendible.

### 2.2 Quién abrió y quién no

Para el organizador, saber que 40 invitados no han abierto la invitación a una
semana del evento vale más que cualquier plantilla bonita. Es barato de construir
sobre `Guest.openedAt` y es probablemente la función que más se vende sola.

---

## Bloque 3 — Producto

### 3.1 El memorial no es una invitación

El tipo de evento `memorial` existe en el código y hoy se renderiza con el mismo
marco dorado festivo que una boda. Eso es un error que ofende, no un detalle
estético. Antes de que salga a cualquier cliente:

- Plantilla sobria propia, sin dorado ni floral.
- Texto propio: no se "invita" a una ceremonia de duelo, y en árabe la fórmula es
  otra.
- Revisión por alguien libanés antes de publicarla.

### 3.2 Líbano tiene 18 confesiones reconocidas

Una boda maronita, una musulmana suní y una drusa no llevan el mismo texto ni el
mismo tono. La plantilla no es una cuestión de gusto: es de pertenencia. Lo
sensato es agrupar las plantillas por familia (civil, cristiana, musulmana) y
dejar que el versículo y la fórmula de apertura cambien con ella, siempre desde
la lista verificada.

### 3.3 Los nombres en dos alfabetos

كريم y "Karim" son la misma persona. Si un invitado recibe la versión inglesa,
¿qué nombre lee? El modelo de datos ya guarda transliteraciones por idioma
(`EventHost.names`), pero la decisión de producto es: **las escribe el
organizador, nunca se transliteran solas**. Un apellido mal transliterado en una
invitación de boda es una ofensa doméstica.

### 3.4 Imprimir de verdad

El PNG de 1080×1920 es para pantalla. Una imprenta pide PDF en CMYK, a 300 dpi,
con sangrado y marcas de corte. Si el plan es vender a salones e imprentas —los
mismos que serían tus oficinas licenciadas— esto es un módulo aparte, no una
casilla más de descarga.

### 3.5 La marca

"Citas" es el nombre de la carpeta, no una marca. Hace falta un nombre que
funcione en árabe y en latino, el dominio libre, y decidir si las invitaciones
llevan una firma discreta al pie (marketing gratis) o no (las oficinas
licenciadas no la querrán).

---

## Bloque 4 — El día del evento

### 4.1 No se puede caer

Una boda ocurre una vez. Si la invitación no abre la tarde que se manda el
WhatsApp, no hay disculpa que lo arregle.

- La página del invitado tiene que servirse **estática desde CDN**, de forma que
  siga viva aunque el servidor de la aplicación esté caído.
- El PNG se genera una vez y se archiva; Chromium no puede intervenir en cada
  visita. Ya está previsto en el modelo (`Render`), falta implementarlo.
- 300 aperturas en dos horas es el pico normal en cuanto se manda el mensaje.

### 4.2 Quien abre esto tiene 70 años y un Android viejo

- Peso de la página al mínimo: hoy la invitación no lleva JavaScript de cliente y
  conviene que siga así.
- Contraste y tamaño de letra revisados de verdad, no por encima.
- Que funcione con conexión mala. Las fuentes árabes pesan; conviene subsetearlas
  cuando haya tráfico real.

---

## Bloque 5 — Legal

- **Versículos**: sigue pendiente que una persona verifique las cuatro entradas
  de `data/verses.json` y firme el campo `verifiedBy`.
- **Datos de invitados**: son nombres y teléfonos de gente que no firmó nada. Hay
  que fijar un plazo de borrado automático tras el evento.
- **Contrato con oficinas**: si una oficina europea usa la plataforma, el contrato
  de encargado de tratamiento (RGPD) es requisito.
- **Licencias de fuentes**: las tres actuales son OFL y valen para uso comercial.
  Cualquier fuente nueva se comprueba antes, no después.
