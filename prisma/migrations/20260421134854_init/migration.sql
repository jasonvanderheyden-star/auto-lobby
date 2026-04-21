-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'federal',
    "registrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defaultSubjects" TEXT[],
    "keyInstitutions" TEXT[],
    "prepTimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calendarBodyOptIn" BOOLEAN NOT NULL DEFAULT false,
    "notesConnectors" JSONB,
    "filingVoice" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "isLobbyist" BOOLEAN NOT NULL DEFAULT true,
    "isRegistrant" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "bodyOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawCalendarEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "organizerEmail" TEXT,
    "attendees" JSONB NOT NULL,
    "body" TEXT,
    "location" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionRegistry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acronym" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "domains" TEXT[],
    "isDpohSource" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicOfficial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "isDpoh" BOOLEAN NOT NULL,
    "dpohBasis" TEXT,
    "ruleRef" TEXT,
    "resolvedFrom" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicOfficial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedMeeting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rawEventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "institutionId" TEXT,
    "hadDpoh" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT NOT NULL,
    "classificationConfidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'auto-drafted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectedMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "resolvedOfficialId" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "isDpoh" BOOLEAN,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationReason" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "ok" BOOLEAN,
    "text" TEXT NOT NULL,
    "citation" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "ClassificationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftMcr" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "subjects" JSONB NOT NULL,
    "institutionId" TEXT,
    "namedLobbyists" JSONB NOT NULL,
    "description" TEXT,
    "descriptionSource" TEXT,
    "provenance" JSONB NOT NULL,
    "certifiedAt" TIMESTAMP(3),
    "certifiedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lrsReceiptId" TEXT,
    "lrsScreenshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftMcr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoursLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'meeting',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoursLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OclPublicRegistration" (
    "id" TEXT NOT NULL,
    "registrationNum" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "registrantName" TEXT,
    "subjects" TEXT[],
    "institutions" TEXT[],
    "status" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OclPublicRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OclPublicCommReport" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "communicationDate" TIMESTAMP(3) NOT NULL,
    "institution" TEXT NOT NULL,
    "dpohName" TEXT NOT NULL,
    "dpohTitle" TEXT,
    "subjects" TEXT[],
    "rawPayload" JSONB NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OclPublicCommReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgProfile_tenantId_key" ON "OrgProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_email_key" ON "Employee"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_provider_providerAccountId_key" ON "CalendarConnection"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "RawCalendarEvent_startAt_idx" ON "RawCalendarEvent"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawCalendarEvent_connectionId_externalId_key" ON "RawCalendarEvent"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "InstitutionRegistry_domains_idx" ON "InstitutionRegistry"("domains");

-- CreateIndex
CREATE INDEX "PublicOfficial_email_idx" ON "PublicOfficial"("email");

-- CreateIndex
CREATE INDEX "PublicOfficial_institutionId_idx" ON "PublicOfficial"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "DetectedMeeting_rawEventId_key" ON "DetectedMeeting"("rawEventId");

-- CreateIndex
CREATE INDEX "DetectedMeeting_tenantId_startAt_idx" ON "DetectedMeeting"("tenantId", "startAt");

-- CreateIndex
CREATE INDEX "DetectedMeeting_tenantId_classification_idx" ON "DetectedMeeting"("tenantId", "classification");

-- CreateIndex
CREATE INDEX "MeetingAttendee_meetingId_idx" ON "MeetingAttendee"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftMcr_meetingId_key" ON "DraftMcr"("meetingId");

-- CreateIndex
CREATE INDEX "HoursLedgerEntry_tenantId_bucket_recordedAt_idx" ON "HoursLedgerEntry"("tenantId", "bucket", "recordedAt");

-- CreateIndex
CREATE INDEX "HoursLedgerEntry_tenantId_employeeEmail_recordedAt_idx" ON "HoursLedgerEntry"("tenantId", "employeeEmail", "recordedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_subject_idx" ON "AuditEvent"("tenantId", "subject");

-- CreateIndex
CREATE INDEX "OclPublicRegistration_companyName_idx" ON "OclPublicRegistration"("companyName");

-- CreateIndex
CREATE INDEX "OclPublicRegistration_registrationNum_idx" ON "OclPublicRegistration"("registrationNum");

-- CreateIndex
CREATE INDEX "OclPublicCommReport_registrationId_idx" ON "OclPublicCommReport"("registrationId");

-- CreateIndex
CREATE INDEX "OclPublicCommReport_communicationDate_idx" ON "OclPublicCommReport"("communicationDate");

-- CreateIndex
CREATE INDEX "OclPublicCommReport_dpohName_idx" ON "OclPublicCommReport"("dpohName");

-- AddForeignKey
ALTER TABLE "OrgProfile" ADD CONSTRAINT "OrgProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawCalendarEvent" ADD CONSTRAINT "RawCalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicOfficial" ADD CONSTRAINT "PublicOfficial_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "InstitutionRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedMeeting" ADD CONSTRAINT "DetectedMeeting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedMeeting" ADD CONSTRAINT "DetectedMeeting_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawCalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "DetectedMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationReason" ADD CONSTRAINT "ClassificationReason_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "DetectedMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftMcr" ADD CONSTRAINT "DraftMcr_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "DetectedMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursLedgerEntry" ADD CONSTRAINT "HoursLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursLedgerEntry" ADD CONSTRAINT "HoursLedgerEntry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "DetectedMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
