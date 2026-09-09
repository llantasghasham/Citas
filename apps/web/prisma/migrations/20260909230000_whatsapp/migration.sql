-- Conexiones de WhatsApp: multi-numero por oficina, multi-oficina.
CREATE TYPE "WhatsappStatus" AS ENUM ('pending', 'qr', 'connected', 'disconnected');

CREATE TABLE "WhatsappConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "WhatsappStatus" NOT NULL DEFAULT 'pending',
    "qrCode" TEXT,
    "authEnc" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "dailyCap" INTEGER NOT NULL DEFAULT 200,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentDay" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappConnection_tenantId_name_key" ON "WhatsappConnection"("tenantId", "name");
CREATE INDEX "WhatsappConnection_tenantId_status_idx" ON "WhatsappConnection"("tenantId", "status");

ALTER TABLE "WhatsappConnection" ADD CONSTRAINT "WhatsappConnection_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "guestId" TEXT,
    "eventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsappMessage_status_createdAt_idx" ON "WhatsappMessage"("status", "createdAt");
CREATE INDEX "WhatsappMessage_tenantId_eventId_idx" ON "WhatsappMessage"("tenantId", "eventId");

ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "WhatsappConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
