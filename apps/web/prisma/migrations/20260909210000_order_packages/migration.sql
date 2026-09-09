-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "packageGuests" INTEGER,
ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "clientPhone" TEXT,
ADD COLUMN     "payToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_payToken_key" ON "Order"("payToken");
