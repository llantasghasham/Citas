-- La cola de WhatsApp, con reclamo y arriendo.
--
-- Sin esto, dos repartidores leian la MISMA fila antes de que ninguno la
-- marcara, y el invitado recibia dos mensajes. Y un proceso que muere despues
-- de que WhatsApp acepte el mensaje dejaba la fila en "queued": al reiniciar se
-- reenviaba. Reenviar es duplicar y no reenviar es perderlo; lo que corresponde
-- es DECIRLO ("sent_unknown") y que una persona decida.
ALTER TABLE "WhatsappMessage" ADD COLUMN "claimedBy" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "WhatsappMessage" ADD COLUMN "providerMessageId" TEXT;

-- El repartidor filtra por conexion primero; el indice empezaba por status y no
-- le servia.
DROP INDEX IF EXISTS "WhatsappMessage_status_scheduledAt_createdAt_idx";
CREATE INDEX "WhatsappMessage_connectionId_status_scheduledAt_createdAt_idx"
  ON "WhatsappMessage" ("connectionId", "status", "scheduledAt", "createdAt");
CREATE INDEX "WhatsappMessage_status_leaseUntil_idx"
  ON "WhatsappMessage" ("status", "leaseUntil");

-- El repaso de recordatorios recorre solo los eventos que tienen uno puesto.
CREATE INDEX "Event_reminderDaysBefore_idx" ON "Event" ("reminderDaysBefore");
