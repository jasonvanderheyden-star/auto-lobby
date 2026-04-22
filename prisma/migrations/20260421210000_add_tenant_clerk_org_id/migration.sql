-- AlterTable: add clerkOrgId as nullable unique column on Tenant.
-- Nullable so existing tenants (seeded before Clerk was wired) are not broken.
-- The Clerk webhook handler populates this on organization.created / organization.updated.
ALTER TABLE "Tenant" ADD COLUMN "clerkOrgId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_clerkOrgId_key" ON "Tenant"("clerkOrgId");
