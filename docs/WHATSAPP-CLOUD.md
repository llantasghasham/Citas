# La transición a WhatsApp Business Platform

Diseño, no implementación. Lo que hay hoy y lo que haría falta para cambiarlo,
escrito antes de escribir código para que la discusión sea sobre el plan y no
sobre un plan a medias.

Lo de hoy está en `docs/WHATSAPP.md` y sigue funcionando. Esto no lo apaga.

---

## Por qué se plantea

El envío por número propio (Baileys, con código QR) va contra los términos de
WhatsApp, y el número que pueden cerrar es **el del cliente**, no el nuestro. Ese
riesgo no se reduce con más ingeniería: el retardo al azar, el calentamiento y el
tope diario son controles operativos, no cumplimiento.

Está declarado experimental (ver `docs/DECISIONES-TOMADAS.md`, punto 3) y esa
decisión no cambia mientras no haya una alternativa montada.

## Lo que NO cambia

- **`wa.me` se queda.** Abrir el WhatsApp del operador con el mensaje escrito no
  es automatización: manda una persona, desde su teléfono, al ritmo que quiera.
  Es lo que funciona siempre, no cuesta por mensaje y no necesita plantilla
  aprobada por nadie. Ningún canal oficial lo sustituye.
- **La cola se queda entera.** El aislamiento por oficina, `FOR UPDATE SKIP
  LOCKED`, los arriendos, los estados dudosos, la programación en UTC y el
  índice que impide encolar dos veces al mismo invitado son trabajo de
  ingeniería que vale para cualquier canal. Lo que cambia es quién entrega.
- **El freno mínimo se queda**, aunque deje de ser necesario por cumplimiento:
  mandar cuatrocientos mensajes en un minuto sigue siendo una mala idea.

## Lo que cambiaría, pieza a pieza

| Pieza | Hoy | Con el canal oficial |
|---|---|---|
| Conexión | QR, teléfono, credencial cifrada, socket vivo. | Identificadores de la cuenta de negocio y del número, secreto referenciado, estado de verificación. Sin socket que mantener. |
| Mensaje | Cuerpo libre. | Plantilla aprobada + idioma + parámetros, fuera de la ventana de atención. |
| Estado | Local: `queued`, `sent`, `failed`, `sent_unknown`. | El que diga el proveedor, reconciliado por el identificador del mensaje. |
| Resultado ambiguo | `sent_unknown`, lo decide una persona. | Se reconcilia por webhook. Sigue sin reenviarse a ciegas. |
| Consentimiento | **No existe.** | Obligatorio y por contacto, con fuente y fecha. |
| Baja | **No existe.** | STOP/BAJA suprime, y cancela lo que estuviera encolado. |

## El orden, y por qué es ese

1. **Consentimiento y baja PRIMERO**, antes de tocar ningún proveedor. Hoy el
   sistema no distingue «tengo su teléfono» de «me dio permiso», y esas dos cosas
   no son la misma. Importar una lista de un Excel no es un permiso. Mientras esa
   diferencia no esté en la base, un canal oficial solo automatizaría el mismo
   problema con mejor letra.
2. **El puerto del proveedor**, con el actual detrás. Igual que `PaymentProvider`:
   la aplicación no sabe qué hay al otro lado. Sin esto, cambiar de canal es
   reescribir el servicio.
3. **El extremo del webhook**, que guarda el aviso crudo, lo deduplica y contesta
   rápido. Todo lo que este proyecto ya aprendió con el aviso de cobro vale
   aquí: un aviso no es una prueba, un duplicado no puede contar dos veces, y
   responder despacio es como te dejan de avisar.
4. **Las plantillas**, en árabe, inglés y español, con su versión. Una plantilla
   cambiada es una plantilla nueva: la clave contra duplicados tiene que llevar
   la versión dentro.
5. **Un piloto con UNA oficina**, midiendo entrega de verdad. Y solo entonces,
   número a número, apagar el canal viejo.

**Congelar conexiones nuevas** va antes que todo lo anterior y no cuesta nada:
cada número que se conecta por QR desde hoy es un número más que habrá que migrar
—o que perder— después.

## Lo que no puede hacer el código

Cuatro cosas, y las cuatro son del dueño:

1. Abrir la cuenta de negocio y verificarla.
2. Dar de alta y verificar un número — que **no puede ser** uno que esté siendo
   usado por la aplicación de WhatsApp normal.
3. Redactar y mandar a aprobar las plantillas, en cada idioma.
4. Decidir **quién responde del consentimiento**: si Citas se lo exige a cada
   oficina y guarda la evidencia que ella aporte, o si se monta un flujo donde
   sea el invitado quien escriba primero.

La cuarta no es un detalle de implementación. Decide si esto se puede vender a
una oficina que llega con una lista de doscientos números y ninguna prueba de
nada, que es exactamente el caso normal.

## Lo que este documento NO afirma

No hay aquí cifras de precio por mensaje, ni límites concretos de envío, ni
plazos de aprobación de plantillas. Cambian, dependen de la cuenta y no los he
comprobado contra la fuente. Antes de comprometer nada con un cliente hay que
mirarlos ese día, en la documentación de Meta, y anotarlos con la fecha.
