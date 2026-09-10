-- Envio programado y recordatorios.
--
-- scheduledAt: antes de esa hora el mensaje no sale. Nulo = en cuanto le toque,
-- que es como se comportaba toda la cola hasta ahora.
ALTER TABLE "WhatsappMessage" ADD COLUMN "scheduledAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "WhatsappMessage_status_createdAt_idx";
CREATE INDEX "WhatsappMessage_status_scheduledAt_createdAt_idx"
  ON "WhatsappMessage" ("status", "scheduledAt", "createdAt");

-- A quien no ha contestado se le recuerda N dias antes del evento.
ALTER TABLE "Event" ADD COLUMN "reminderDaysBefore" INTEGER;
ALTER TABLE "Guest" ADD COLUMN "remindedAt" TIMESTAMP(3);
