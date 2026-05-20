-- CreateTable
CREATE TABLE "DpohSubjectPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicOfficialId" TEXT NOT NULL,
    "subjectIds" TEXT[],
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL,
    "confirmedBy" TEXT NOT NULL,

    CONSTRAINT "DpohSubjectPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DpohSubjectPreference_tenantId_idx" ON "DpohSubjectPreference"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DpohSubjectPreference_tenantId_publicOfficialId_key" ON "DpohSubjectPreference"("tenantId", "publicOfficialId");

-- AddForeignKey
ALTER TABLE "DpohSubjectPreference" ADD CONSTRAINT "DpohSubjectPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpohSubjectPreference" ADD CONSTRAINT "DpohSubjectPreference_publicOfficialId_fkey" FOREIGN KEY ("publicOfficialId") REFERENCES "PublicOfficial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
