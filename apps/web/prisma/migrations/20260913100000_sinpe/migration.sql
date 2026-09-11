-- Cobro por SINPE Móvil (Costa Rica).
--
-- No es una pasarela: no hay a quién preguntarle si un pago entró. Lo único que
-- llega es un correo del banco, así que se guarda de qué buzón leerlo y qué se
-- leyó de cada correo.

ALTER TYPE "PaymentProviderId" ADD VALUE 'sinpe';

CREATE TYPE "SinpeMovementStatus" AS ENUM ('pending', 'applied', 'ignored');

-- El código que quien paga escribe en el detalle del SINPE. Sin él un
-- movimiento no se puede casar con nada: el comprobante lo inventa el banco al
-- mandar el dinero, y el monto solo no distingue a dos oficinas con el mismo
-- plan pagando el mismo día.
ALTER TABLE "Order" ADD COLUMN "payCode" TEXT;
CREATE UNIQUE INDEX "Order_payCode_key" ON "Order"("payCode");

CREATE TABLE "SinpeAccount" (
    "id" TEXT NOT NULL,
    -- NULO = la cuenta de la plataforma, donde las oficinas pagan su mensualidad.
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapUser" TEXT NOT NULL,
    -- Cifrada con AES-256-GCM. Nunca en claro, ni aquí ni en el .env.
    "imapPasswordEnc" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "forSubscriptions" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SinpeAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SinpeAccount_active_idx" ON "SinpeAccount"("active");
CREATE INDEX "SinpeAccount_tenantId_idx" ON "SinpeAccount"("tenantId");

ALTER TABLE "SinpeAccount"
    ADD CONSTRAINT "SinpeAccount_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SinpeMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "accountId" TEXT NOT NULL,
    "senderName" TEXT,
    "senderPhone" TEXT,
    -- Céntimos enteros, como Payment.amount.
    "amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'CRC',
    "reference" TEXT NOT NULL,
    "detail" TEXT,
    "bank" TEXT,
    "movementType" TEXT NOT NULL,
    "destinationNumber" TEXT,
    "status" "SinpeMovementStatus" NOT NULL DEFAULT 'pending',
    "paymentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "raw" TEXT NOT NULL,

    CONSTRAINT "SinpeMovement_pkey" PRIMARY KEY ("id")
);

-- El comprobante, único por cuenta: leer el mismo correo dos veces no puede
-- crear dos movimientos, y eso lo impide la BASE, no el código.
CREATE UNIQUE INDEX "SinpeMovement_accountId_reference_key" ON "SinpeMovement"("accountId", "reference");
CREATE UNIQUE INDEX "SinpeMovement_paymentId_key" ON "SinpeMovement"("paymentId");
CREATE INDEX "SinpeMovement_tenantId_status_idx" ON "SinpeMovement"("tenantId", "status");
CREATE INDEX "SinpeMovement_status_receivedAt_idx" ON "SinpeMovement"("status", "receivedAt");

ALTER TABLE "SinpeMovement"
    ADD CONSTRAINT "SinpeMovement_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "SinpeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
