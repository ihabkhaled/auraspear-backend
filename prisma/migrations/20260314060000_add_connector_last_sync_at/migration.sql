-- AlterTable
ALTER TABLE "connector_configs" ADD COLUMN "last_error" TEXT;
ALTER TABLE "connector_configs" ADD COLUMN "last_sync_at" TIMESTAMP(3);
ALTER TABLE "connector_configs" ADD COLUMN "sync_enabled" BOOLEAN NOT NULL DEFAULT true;
