-- AlterTable: Add description to llm_connectors
ALTER TABLE "llm_connectors" ADD COLUMN IF NOT EXISTS "description" VARCHAR(500);

-- AlterTable: Restructure logstash_pipeline_logs
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "duration_ms" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "events_filtered" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "events_in" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "events_out" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "source" VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "logstash_pipeline_logs" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop deprecated column if it exists
ALTER TABLE "logstash_pipeline_logs" DROP COLUMN IF EXISTS "pipeline_name";

-- Alter column types
ALTER TABLE "logstash_pipeline_logs" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "logstash_pipeline_logs" ALTER COLUMN "level" SET DATA TYPE VARCHAR(20);

-- RenameIndex (safe: only if old name exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'notifications_tenant_id_recipient_user_id_read_at_created_at_id') THEN
    ALTER INDEX "notifications_tenant_id_recipient_user_id_read_at_created_at_id"
      RENAME TO "notifications_tenant_id_recipient_user_id_read_at_created_a_idx";
  END IF;
END $$;
