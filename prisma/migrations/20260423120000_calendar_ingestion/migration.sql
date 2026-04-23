-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('google', 'microsoft365');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('active', 'disconnected', 'token_refresh_failed');

-- DropForeignKey
ALTER TABLE "CalendarConnection" DROP CONSTRAINT "CalendarConnection_employeeId_fkey";

-- DropIndex
DROP INDEX "CalendarConnection_provider_providerAccountId_key";

-- DropIndex
DROP INDEX "RawCalendarEvent_startAt_idx";

-- AlterTable
ALTER TABLE "CalendarConnection" DROP COLUMN "bodyOptIn",
DROP COLUMN "employeeId",
DROP COLUMN "lastSyncAt",
DROP COLUMN "providerAccountId",
ADD COLUMN     "accessTokenEncrypted" TEXT NOT NULL,
ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "connectedByUserId" TEXT NOT NULL,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "externalAccountId" TEXT NOT NULL,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenEncrypted" TEXT NOT NULL,
ADD COLUMN     "scopes" TEXT[],
ADD COLUMN     "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "syncToken" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "provider",
ADD COLUMN     "provider" "CalendarProvider" NOT NULL DEFAULT 'google';

-- AlterTable
ALTER TABLE "RawCalendarEvent" DROP COLUMN "body",
DROP COLUMN "endAt",
DROP COLUMN "fetchedAt",
DROP COLUMN "startAt",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "descriptionIncluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "etag" TEXT,
ADD COLUMN     "eventStatus" TEXT,
ADD COLUMN     "icalUID" TEXT,
ADD COLUMN     "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rawPayload" JSONB NOT NULL,
ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "visibility" TEXT,
ALTER COLUMN "title" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CalendarConnection_tenantId_idx" ON "CalendarConnection"("tenantId");

-- CreateIndex
CREATE INDEX "CalendarConnection_status_idx" ON "CalendarConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_tenantId_provider_externalAccountId_key" ON "CalendarConnection"("tenantId", "provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "RawCalendarEvent_tenantId_startsAt_idx" ON "RawCalendarEvent"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "RawCalendarEvent_connectionId_idx" ON "RawCalendarEvent"("connectionId");

-- AddForeignKey
ALTER TABLE "RawCalendarEvent" ADD CONSTRAINT "RawCalendarEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
