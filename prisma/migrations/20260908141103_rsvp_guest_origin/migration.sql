-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "createdIp" TEXT,
ADD COLUMN     "selfAdded" BOOLEAN NOT NULL DEFAULT false;
