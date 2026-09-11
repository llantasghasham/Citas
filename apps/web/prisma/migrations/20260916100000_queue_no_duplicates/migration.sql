-- Que dos pulsaciones de «Enviar» no encolen al mismo invitado dos veces.
--
-- El código lee qué hay ya en cola y luego escribe. Entre las dos cosas cabe
-- otra petición: dos operadores pulsando a la vez leen los dos una cola vacía y
-- escriben los dos, y cada invitado recibe DOS mensajes. La lectura no protege
-- de eso; solo un índice puede.
--
-- El índice cubre `queued` y `processing`, que es donde un duplicado significa
-- todavía un envío de más. Una vez `sent`, volver a encolar es una decisión
-- humana y lenta, y de eso sí protege el código.
--
-- Y va por `kind`, porque un invitado recibe la invitación Y el recordatorio:
-- sin esa columna, el mismo índice que evita el doble envío habría impedido el
-- recordatorio.

ALTER TABLE "WhatsappMessage" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'invitation';

-- Los recordatorios que ya estén escritos: se reconocen porque el invitado
-- tiene fecha de recordatorio y el mensaje se escribió después.
UPDATE "WhatsappMessage" m SET "kind" = 'reminder'
  FROM "Guest" g
 WHERE m."guestId" = g.id
   AND g."remindedAt" IS NOT NULL
   AND m."createdAt" >= g."remindedAt" - INTERVAL '1 minute';

-- Duplicados que ya hubiera en cola. Solo se tocan los que NO han salido: se
-- cancelan los más nuevos y se deja el primero. Cambiarle el estado a uno ya
-- enviado sería mentir sobre lo que pasó.
WITH duplicados AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY "eventId", "guestId", "kind" ORDER BY "createdAt" ASC
         ) AS puesto
    FROM "WhatsappMessage"
   WHERE "guestId" IS NOT NULL
     AND "eventId" IS NOT NULL
     AND status IN ('queued', 'processing')
)
UPDATE "WhatsappMessage" SET status = 'canceled', error = 'duplicado al migrar'
 WHERE id IN (SELECT id FROM duplicados WHERE puesto > 1);

CREATE UNIQUE INDEX "WhatsappMessage_live_guest_key"
    ON "WhatsappMessage" ("eventId", "guestId", "kind")
 WHERE "guestId" IS NOT NULL
   AND "eventId" IS NOT NULL
   AND status IN ('queued', 'processing');
