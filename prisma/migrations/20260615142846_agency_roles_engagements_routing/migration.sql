-- CreateEnum
CREATE TYPE "AgencyMemberRole" AS ENUM ('admin', 'staff', 'consultant');

-- CreateEnum
CREATE TYPE "TenantMemberRole" AS ENUM ('admin', 'contributor', 'reviewer', 'certifier');

-- AlterTable
ALTER TABLE "DetectedMeeting" ADD COLUMN     "engagementConfidence" DOUBLE PRECISION,
ADD COLUMN     "engagementId" TEXT,
ADD COLUMN     "engagementSource" TEXT;

-- AlterTable
ALTER TABLE "DraftMcr" ADD COLUMN     "certifiedByUserId" TEXT,
ADD COLUMN     "routedByUserId" TEXT,
ADD COLUMN     "routedForCertificationAt" TIMESTAMP(3),
ADD COLUMN     "routedToEmail" TEXT,
ADD COLUMN     "routingTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "routingTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "agencyId" TEXT,
ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "isAgencyOwnTenant" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "supportEmail" TEXT;

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "productName" TEXT,
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyMember" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "AgencyMemberRole" NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "roles" "TenantMemberRole"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "consultantMemberId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientTenantId" TEXT,
    "registrationNum" TEXT,
    "clientDomains" TEXT[],
    "subjectKeywords" TEXT[],
    "subjects" TEXT[],
    "keyInstitutions" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_clerkOrgId_key" ON "Agency"("clerkOrgId");

-- CreateIndex
CREATE INDEX "AgencyMember_clerkUserId_idx" ON "AgencyMember"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyMember_agencyId_clerkUserId_key" ON "AgencyMember"("agencyId", "clerkUserId");

-- CreateIndex
CREATE INDEX "TenantMember_tenantId_idx" ON "TenantMember"("tenantId");

-- CreateIndex
CREATE INDEX "TenantMember_clerkUserId_idx" ON "TenantMember"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMember_tenantId_email_key" ON "TenantMember"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Engagement_agencyId_idx" ON "Engagement"("agencyId");

-- CreateIndex
CREATE INDEX "Engagement_clientTenantId_idx" ON "Engagement"("clientTenantId");

-- CreateIndex
CREATE INDEX "DraftMcr_routingTokenHash_idx" ON "DraftMcr"("routingTokenHash");

-- CreateIndex
CREATE INDEX "Tenant_agencyId_idx" ON "Tenant"("agencyId");

-- AddForeignKey
ALTER TABLE "AgencyMember" ADD CONSTRAINT "AgencyMember_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_consultantMemberId_fkey" FOREIGN KEY ("consultantMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_clientTenantId_fkey" FOREIGN KEY ("clientTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedMeeting" ADD CONSTRAINT "DetectedMeeting_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
