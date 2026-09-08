# Decisiones pendientes

Cosas que no son código y que deciden si esto funciona como negocio. Están sin
resolver, y varias bloquean fases enteras. Ordenadas por lo que muerde primero.

Cada punto marcado con **⚠ verificar** es un dato que hay que confirmar hoy antes
de diseñar nada encima: son cosas que cambian de un mes a otro.

---

## Bloque 1 — Cobrar

### 1.1 Cómo se cobra en Líbano

**Confirmado (septiembre 2026): Stripe no opera en Líbano.** Líbano no está entre
los países soportados. El camino habitual —constituir una LLC en EE. UU. o una
Ltd en Reino Unido para acceder a Stripe— es real, pero implica una entidad
extranjera con sus obligaciones fiscales y contables. No es un atajo, es otra
empresa.

Las opciones locales, que sí existen:

| Vía | Qué es | Sirve para |
| --- | --- | --- |
| **Areeba** | Institución financiera libanesa con licencia. POS, pasarela de comercio electrónico, **pay-by-link**, cobros recurrentes y 3-D Secure | Cobrar con tarjeta, dentro y fuera de Líbano |
| **Whish Money** | Billetera móvil local, con integración por API. Enorme alcance, incluida la población sin banco | El cliente libanés medio |
| **OMT** | Red de transferencia en efectivo | Quien no tiene tarjeta ni billetera |
| **Tap Payments** | Pasarela del Golfo, alternativa a Areeba | Comparar contra Areeba antes de firmar |

> Las tarifas y los requisitos de alta hay que pedirlos directamente a cada uno:
> lo publicado en blogs no sirve para firmar un contrato.

**Lo más inteligente: reutilizar la relación que ya existe por el POS.**

Si ya hay un TPV funcionando en otro negocio, ya hay un contrato de comercio, una
entidad registrada y un historial. En ese caso **añadir cobros por internet suele
ser una ampliación del contrato existente, no un alta nueva**: Areeba, por
ejemplo, vende POS y pasarela online bajo el mismo paraguas. Preguntar al
proveedor del POS actual «¿me activáis pay-by-link y comercio electrónico sobre
esta misma cuenta?» puede ahorrar meses y el coste de constituir nada.

Lo que hay que averiguar, en este orden:

1. **Quién provee el POS actual** y si ofrece pasarela online o pay-by-link.
2. **Qué entidad legal está detrás** de ese contrato (empresa individual, SARL) y
   si sirve para facturar invitaciones o hace falta otra.
3. **Comisión por transacción** de cada vía, sobre un ticket realista.

**Plan escalonado sugerido** (sin escribir una línea de código para empezar):

1. **Concierge.** Pay-by-link del proveedor del POS + Whish + efectivo. Se manda
   el enlace de pago por WhatsApp, igual que la invitación. Cero integración.
2. **Autoservicio en Líbano.** Whish integrado por API para el cliente local, más
   tarjeta por la pasarela del POS. Aquí sí hay trabajo de código.
3. **Fuera de Líbano.** Solo si aparecen oficinas licenciadas en Europa o el
   Golfo: ahí sí compensa la entidad extranjera con Stripe o Paddle.

**Moneda.** El precio se fija en dólares y se indica claramente en la factura en
qué se cobra. Dólar fresco y lira no son la misma cosa, y una invitación vendida
hoy se entrega dentro de meses.

### 1.2 El precio

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
