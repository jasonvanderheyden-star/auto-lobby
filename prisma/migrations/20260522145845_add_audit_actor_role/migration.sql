-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN "actorRole" TEXT,
ADD COLUMN "onBehalfOfTenantId" TEXT;
