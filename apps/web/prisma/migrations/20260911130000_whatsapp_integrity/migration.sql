-- Integridad de la cola de WhatsApp.
--
-- tenantId, eventId y guestId no tenian NINGUNA clave foranea. Que un mensaje
-- de la oficina A no cuelgue del numero de la B dependia solo de que el codigo
-- lo hiciera bien siempre. Ahora no lo admite la base.

-- Restos imposibles de versiones anteriores, si los hubiera.
DELETE FROM "WhatsappMessage" m
 WHERE NOT EXISTS (
   SELECT 1 FROM "WhatsappConnection" c
    WHERE c.id = m."connectionId" AND c."tenantId" = m."tenantId"
 );
UPDATE "WhatsappMessage" m SET "eventId" = NULL
 WHERE m."eventId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "Event" e WHERE e.id = m."eventId");
UPDATE "WhatsappMessage" m SET "guestId" = NULL
 WHERE m."guestId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "Guest" g WHERE g.id = m."guestId");

-- La clave por la que un mensaje puede apuntar a (id, tenantId) a la vez.
CREATE UNIQUE INDEX "WhatsappConnection_id_tenantId_key"
  ON "WhatsappConnection" ("id", "tenantId");

ALTER TABLE "WhatsappMessage" DROP CONSTRAINT IF EXISTS "WhatsappMessage_connectionId_fkey";
ALTER TABLE "WhatsappMessage"
  ADD CONSTRAINT "WhatsappMessage_connectionId_tenantId_fkey"
  FOREIGN KEY ("connectionId", "tenantId")
  REFERENCES "WhatsappConnection" ("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- El mensaje es el REGISTRO de lo que se mando: si el evento o el invitado
-- desaparecen, la fila se queda sin ellos pero no se borra.
ALTER TABLE "WhatsappMessage"
  ADD CONSTRAINT "WhatsappMessage_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsappMessage"
  ADD CONSTRAINT "WhatsappMessage_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "Guest" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
