-- Que un mensaje NO pueda colgar del evento o del invitado de otra oficina.
--
-- La conexión ya iba por (id, tenantId). El evento y el invitado no: eran claves
-- por id a secas, así que que fueran de la misma oficina dependía solo de que el
-- código lo hiciera bien siempre. Un script, un descuido o una migración futura
-- podían asociar un mensaje de la oficina A con la boda de B.
--
-- El invitado no lleva `tenantId` —cuelga de su evento— así que la cadena se
-- cierra por ahí: mensaje → evento (que sí lleva oficina) → invitado (que lleva
-- evento).
--
-- `NO ACTION` y no `SET NULL`: sobre una clave compuesta, `SET NULL` pone a nulo
-- TODAS sus columnas, y `tenantId` no lo admite.
--
-- Y DEFERRABLE INITIALLY DEFERRED, que es lo que hace que esto funcione de
-- verdad. Sin ello, borrar una oficina FALLABA: la cascada borra sus eventos y
-- la comprobación salta ahí mismo, aunque los mensajes que apuntaban a ese
-- evento se estén borrando en la misma orden por la cascada de la conexión.
-- Diferida, se comprueba al CERRAR la transacción, cuando ya no queda nada que
-- apunte a nada. Un intento de meter una fila cruzada sigue fallando en el acto,
-- porque una escritura suelta es su propia transacción.
--
-- Prisma no sabe declarar `DEFERRABLE`, así que esto vive solo en el SQL — como
-- el índice único parcial de los cobros, y por la misma razón: es la base la que
-- tiene que impedirlo, no el cliente.

-- Antes de poner la clave: soltar lo que ya no cuadre. No debería haber nada
-- —el código siempre los escribió juntos— pero una fila vieja no puede impedir
-- una migración.
UPDATE "WhatsappMessage" m SET "eventId" = NULL, "guestId" = NULL
 WHERE m."eventId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "Event" e WHERE e.id = m."eventId" AND e."tenantId" = m."tenantId"
   );

UPDATE "WhatsappMessage" m SET "guestId" = NULL
 WHERE m."guestId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "Guest" g WHERE g.id = m."guestId" AND g."eventId" = m."eventId"
   );

-- Las claves a las que se puede apuntar.
CREATE UNIQUE INDEX IF NOT EXISTS "Event_id_tenantId_key" ON "Event"("id", "tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Guest_id_eventId_key" ON "Guest"("id", "eventId");

-- Fuera las simples, que ya no dicen lo suficiente.
ALTER TABLE "WhatsappMessage" DROP CONSTRAINT IF EXISTS "WhatsappMessage_eventId_fkey";
ALTER TABLE "WhatsappMessage" DROP CONSTRAINT IF EXISTS "WhatsappMessage_guestId_fkey";

ALTER TABLE "WhatsappMessage"
  ADD CONSTRAINT "WhatsappMessage_eventId_tenantId_fkey"
  FOREIGN KEY ("eventId", "tenantId") REFERENCES "Event"("id", "tenantId")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "WhatsappMessage"
  ADD CONSTRAINT "WhatsappMessage_guestId_eventId_fkey"
  FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
