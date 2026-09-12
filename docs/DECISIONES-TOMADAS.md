# Decisiones tomadas

Lo contrario de `DECISIONES-PENDIENTES.md`: lo que ya está decidido, con la
fecha, el porqué y qué hay que cambiar si se cambia de idea.

Existe porque una revisión externa señaló que el proyecto se contradecía a sí
mismo en dos sitios —la documentación decía una cosa y el código hacía otra— y
eso no se arregla escribiendo más código: se arregla escribiendo la decisión.
Cada punto de aquí manda sobre cualquier otro documento que diga otra cosa.

---

## 1. Reparto de inquilinos: las dos, con frontera explícita

**Decidido.** Hay dos repartos y el interruptor es `TENANCY`:

- `shared` — todas las oficinas en la misma base, separadas por `tenantId`. Es
  lo que había y sigue valiendo para una instalación de una sola oficina.
- `fleet` — **una base de datos por oficina**. Es el reparto para alquilarle
  esto a oficinas: lo que impide que una vea a otra deja de ser el filtro del
  código y pasa a ser que dos bases de PostgreSQL no se consultan entre sí.

No es una ambigüedad: es una elección por instalación, y **no conviven**. Lo
vigila `npm run lint:planes` en cada despliegue, que exige que cada consulta vaya
a la base que le toca y obliga a NOMBRAR y justificar cada excepción.

**Para cambiarlo:** `npm run db:split -- copiar`, encender `TENANCY=fleet`,
mirar, y solo entonces `npm run db:split -- limpiar`. El orden no se salta.

## 2. El acceso por defecto es por enlace personal

**Decidido.** Un acto nace `segmented`: no sale en la página pública y solo lo ve
quien tiene enlace personal y está autorizado. El organizador puede marcarlo
`public` a mano.

**Por qué así y no al revés:** una henna íntima listada en la página pública no
se puede volver a esconder — el enlace ya se reenvió al grupo de WhatsApp. No
enseñar de menos se arregla con una llamada.

**El auto-registro no abre puertas.** Quien se apunta solo desde el formulario
público no pertenece a ningún grupo, así que `agendaFor` solo le da los actos
públicos. No hay un caso en el que apuntarse dé acceso a un acto privado, y hay
prueba de ello.

## 3. WhatsApp: el número por QR es EXPERIMENTAL

**Decidido.** El envío por número propio (`apps/whatsapp`, Baileys) queda
declarado experimental y **no se vende como canal con garantías**. Ya estaba
dicho en rojo en la pantalla y en `CLAUDE.md`; esto lo fija como decisión.

Lo que eso significa, en concreto:

- El retardo al azar, el calentamiento y el tope diario son **controles
  operativos, no cumplimiento**. Reducen el riesgo de que cierren el número; no
  convierten en conforme algo que va contra los términos de WhatsApp.
- `wa.me` —abrir el WhatsApp del operador con el mensaje escrito— **no es lo
  mismo** y no está afectado: ahí manda una persona desde su teléfono. Es lo que
  funciona siempre y no se retira.
- **No se invierte en hacer el canal QR más sofisticado.** Nada de evadir
  límites ni de trucos para no llamar la atención: eso es construir encima de un
  riesgo, no reducirlo.

**Lo que queda por decidir, y es del dueño:** si se abre una cuenta de WhatsApp
Business Platform. Eso exige portfolio de negocio, número verificado, plantillas
aprobadas por idioma y consentimiento demostrable de cada contacto. Ninguna de
esas cuatro cosas las puede hacer el código: son trámites con Meta y con los
clientes. El diseño de la transición está en `docs/WHATSAPP-CLOUD.md`.

## 4. Un invitado es una PERSONA, no una relación

**Decidido.** No se duplica al invitado por acto. Un `Guest` por persona, y lo
que se multiplica son las relaciones (`GuestSegment`), los permisos
(`GuestActInvite`), las respuestas (`GuestActRsvp`) y los mensajes.

La familia puede ser la unidad con la que se trabaja —se asigna un grupo entero
a un acto de una vez— pero cada persona conserva su identidad, su permiso y su
enlace. Sin eso no hay forma de decir «la tía viene, el primo no» ni de dejar
pasar a alguien por la puerta.

## 5. La religión y el rito no son campos de este modelo

**Decidido.** No existe `religion`, ni `rito`, ni `denominación` en el esquema, y
no se van a inferir del idioma, de los nombres ni de la lista de invitados.

El tipo de acto (`ActType`) es una etiqueta para ordenar y elegir icono: lleva
`henna`, `zaffe` y `ceremony` porque son partes de una celebración, no porque
digan nada de quién la celebra. `label` deja que cada familia lo llame como lo
llama, y `other` existe para que ninguna celebración tenga que caber en la lista.

**Para cambiarlo** haría falta, antes que código: una razón de producto que no
sea «estaría bien tenerlo», consentimiento explícito y separado, visibilidad
limitada por rol, y revisión legal local. Mientras tanto, lo que necesite un
organizador cabe en una nota suya.

## 6. Un evento político es logística, no persuasión

**Decidido.** Si se abre el módulo institucional, será acceso, aforo, protocolo y
trazabilidad. **No** habrá afiliación, ni preferencia ideológica, ni puntuación
de persuasión, ni microsegmentación electoral — ni como campo, ni como cálculo,
ni como exportación.

Es una decisión de producto y no una limitación técnica: se puede construir y no
se va a construir.

## 7. La respuesta global es un RESUMEN

**Decidido.** La fuente de verdad es `GuestActRsvp`, por acto. `Rsvp` sigue
existiendo porque lo leen las mesas, la exportación y media docena de pantallas,
y se mantiene al día **en la misma transacción**. Se calcula, nunca se escribe
desde fuera: si se pudiera por los dos lados, un día dirían cosas distintas y
nadie sabría cuál creer.

## 8. Los precios que circulan son hipótesis

**No decidido, y dicho a las claras.** Las cifras que aparecen en los estudios
externos (29–59 por evento, 99–199 por boda, etc.) son hipótesis de quien los
escribió, no tarifas de Citas. No están en el código, no están en los planes y no
se le han dicho a ningún cliente. Se validan vendiendo, no discutiéndolas.
