-- Permiso, baja, campañas, puerta y preferencias.
--
-- La pieza que faltaba para poder hablar de cumplimiento y no solo de envío:
-- tener el teléfono de alguien no es tener su permiso, e importar doscientos
-- números de un Excel tampoco. Sin esto, cualquier canal —el de ahora o el
-- oficial— automatiza el mismo problema con mejor letra.

CREATE TYPE "ContactChannel" AS ENUM ('whatsapp', 'email', 'sms');
CREATE TYPE "ConsentPurpose" AS ENUM ('invitation', 'reminder', 'marketing');
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'queued', 'sending', 'done', 'canceled');
CREATE TYPE "RecipientStatus" AS ENUM ('excluded', 'queued', 'sent', 'failed');

CREATE TABLE "Consent" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "channel"     "ContactChannel" NOT NULL,
    "purpose"     "ConsentPurpose" NOT NULL,
    "contact"     TEXT NOT NULL,
    "source"      TEXT NOT NULL,
    "textVersion" TEXT,
    "actorId"     TEXT,
    "grantedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"   TIMESTAMP(3),
    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Consent_tenantId_channel_purpose_contact_key"
    ON "Consent"("tenantId", "channel", "purpose", "contact");
CREATE INDEX "Consent_tenantId_contact_idx" ON "Consent"("tenantId", "contact");
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La baja va en su propia tabla y no como un campo del permiso, a propósito:
-- tiene que poder existir SIN que antes hubiera permiso —alguien escribe STOP
-- sin haber dado nunca nada— y tiene que sobrevivir a que se reimporte la lista.
-- Un `revokedAt` dentro de `Consent` lo borraría la siguiente importación.
CREATE TABLE "OptOut" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "channel"   "ContactChannel" NOT NULL,
    "contact"   TEXT NOT NULL,
    "purpose"   "ConsentPurpose",
    "reason"    TEXT,
    "actorId"   TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OptOut_pkey" PRIMARY KEY ("id")
);
-- `purpose` nulo significa «para todo», y en PostgreSQL dos nulos NO chocan en
-- un índice único. Así que la unicidad de la baja total va aparte, con un índice
-- parcial: sin él se podrían apuntar cien bajas totales del mismo contacto.
CREATE UNIQUE INDEX "OptOut_tenantId_channel_contact_purpose_key"
    ON "OptOut"("tenantId", "channel", "contact", "purpose") WHERE "purpose" IS NOT NULL;
CREATE UNIQUE INDEX "OptOut_all_key"
    ON "OptOut"("tenantId", "channel", "contact") WHERE "purpose" IS NULL;
CREATE INDEX "OptOut_tenantId_contact_idx" ON "OptOut"("tenantId", "contact");
ALTER TABLE "OptOut" ADD CONSTRAINT "OptOut_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MessageCampaign" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "eventId"      TEXT NOT NULL,
    "actId"        TEXT,
    "segmentId"    TEXT,
    "kind"         TEXT NOT NULL DEFAULT 'invitation',
    "template"     TEXT NOT NULL,
    "version"      TEXT NOT NULL DEFAULT '1',
    "status"       "CampaignStatus" NOT NULL DEFAULT 'draft',
    "connectionId" TEXT,
    "scheduledAt"  TIMESTAMP(3),
    "actorId"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessageCampaign_eventId_status_idx" ON "MessageCampaign"("eventId", "status");
ALTER TABLE "MessageCampaign" ADD CONSTRAINT "MessageCampaign_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageCampaign" ADD CONSTRAINT "MessageCampaign_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MessageRecipient" (
    "id"         TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "guestId"    TEXT NOT NULL,
    "eventId"    TEXT NOT NULL,
    "status"     "RecipientStatus" NOT NULL DEFAULT 'queued',
    "reason"     TEXT,
    "messageId"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessageRecipient_campaignId_guestId_key"
    ON "MessageRecipient"("campaignId", "guestId");
CREATE INDEX "MessageRecipient_campaignId_status_idx" ON "MessageRecipient"("campaignId", "status");
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "MessageCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_guestId_eventId_fkey"
    FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CheckIn" (
    "id"         TEXT NOT NULL,
    "eventId"    TEXT NOT NULL,
    "actId"      TEXT NOT NULL,
    "guestId"    TEXT NOT NULL,
    "people"     INTEGER NOT NULL DEFAULT 1,
    "operatorId" TEXT,
    "gate"       TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);
-- Uno por invitado y acto: el segundo intento tiene que poder distinguirse de
-- una entrada nueva, que es la diferencia entre «ya entró» y «entra otra vez».
CREATE UNIQUE INDEX "CheckIn_actId_guestId_key" ON "CheckIn"("actId", "guestId");
CREATE INDEX "CheckIn_actId_createdAt_idx" ON "CheckIn"("actId", "createdAt");
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_actId_eventId_fkey"
    FOREIGN KEY ("actId", "eventId") REFERENCES "EventAct"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_guestId_eventId_fkey"
    FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GuestPreference" (
    "id"        TEXT NOT NULL,
    "guestId"   TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "actId"     TEXT,
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuestPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuestPreference_guestId_actId_key_key"
    ON "GuestPreference"("guestId", "actId", "key");
CREATE UNIQUE INDEX "GuestPreference_global_key"
    ON "GuestPreference"("guestId", "key") WHERE "actId" IS NULL;
CREATE INDEX "GuestPreference_eventId_key_idx" ON "GuestPreference"("eventId", "key");
ALTER TABLE "GuestPreference" ADD CONSTRAINT "GuestPreference_guestId_eventId_fkey"
    FOREIGN KEY ("guestId", "eventId") REFERENCES "Guest"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InvitationVisit" (
    "id"        TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "guestId"   TEXT,
    "via"       TEXT NOT NULL DEFAULT 'public',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvitationVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvitationVisit_eventId_createdAt_idx" ON "InvitationVisit"("eventId", "createdAt");
ALTER TABLE "InvitationVisit" ADD CONSTRAINT "InvitationVisit_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------ la cola aprende de actos
ALTER TABLE "WhatsappMessage" ADD COLUMN "actId" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN "campaignId" TEXT;

-- Y el índice que impide encolar dos veces al mismo invitado pasa a mirar el
-- ACTO. Tiene que mirarlo: el mismo invitado recibe la invitación de la henna Y
-- la de la recepción, y sin el acto lo que evita el doble envío impediría la
-- segunda — exactamente el fallo que ya obligó a meter `kind` en este índice.
--
-- `actId` nulo significa «la celebración entera», y en PostgreSQL dos nulos no
-- chocan en un índice único, así que hacen falta los dos índices parciales.
DROP INDEX "WhatsappMessage_live_guest_key";
CREATE UNIQUE INDEX "WhatsappMessage_live_guest_key"
    ON "WhatsappMessage" ("eventId", "guestId", "kind", "actId")
 WHERE "guestId" IS NOT NULL AND "eventId" IS NOT NULL AND "actId" IS NOT NULL
   AND status IN ('queued', 'processing');
CREATE UNIQUE INDEX "WhatsappMessage_live_guest_whole_key"
    ON "WhatsappMessage" ("eventId", "guestId", "kind")
 WHERE "guestId" IS NOT NULL AND "eventId" IS NOT NULL AND "actId" IS NULL
   AND status IN ('queued', 'processing');
