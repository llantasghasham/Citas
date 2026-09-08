-- AlterTable
ALTER TABLE "Render" ADD COLUMN     "data" BYTEA,
ALTER COLUMN "url" DROP NOT NULL;
