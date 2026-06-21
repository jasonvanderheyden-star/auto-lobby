-- CreateEnum
CREATE TYPE "GovLevel" AS ENUM ('federal', 'provincial', 'municipal', 'funded_org');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('grant', 'repayable_contribution', 'loan', 'loan_guarantee', 'tax_credit', 'wage_subsidy', 'equity', 'advisory', 'in_kind');

-- CreateEnum
CREATE TYPE "IntakeCadence" AS ENUM ('continuous', 'window', 'first_come', 'closed');

-- CreateEnum
CREATE TYPE "IntakeFormType" AS ENUM ('online_portal', 'fillable_pdf', 'static_pdf', 'email_or_offline', 'unknown');

-- CreateEnum
CREATE TYPE "RuleDimension" AS ENUM ('sector', 'region', 'company_stage', 'headcount', 'revenue', 'incorporation_type', 'canadian_ownership_pct', 'project_type', 'eligible_cost', 'other');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('eq', 'neq', 'gte', 'lte', 'in', 'not_in', 'contains');

-- CreateEnum
CREATE TYPE "RuleSource" AS ENUM ('extracted_structured', 'llm_parsed', 'manual');

-- CreateTable
CREATE TABLE "FundingProgram" (
    "id" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "governmentLevel" "GovLevel" NOT NULL,
    "funderFr" TEXT,
    "nameFr" TEXT,
    "shortDescriptionEn" TEXT,
    "shortDescriptionFr" TEXT,
    "longDescriptionEn" TEXT,
    "longDescriptionFr" TEXT,
    "sourceUrl" TEXT,
    "sourceUrlFr" TEXT,
    "instrumentType" "InstrumentType",
    "valueMin" DECIMAL(65,30),
    "valueMax" DECIMAL(65,30),
    "intakeCadence" "IntakeCadence",
    "intakeUrl" TEXT,
    "intakeFormType" "IntakeFormType",
    "narrativeCriteria" TEXT,

    CONSTRAINT "FundingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityRule" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "dimension" "RuleDimension" NOT NULL,
    "operator" "RuleOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "RuleSource" NOT NULL,

    CONSTRAINT "EligibilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingProgramSource" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingProgramSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingDisbursement" (
    "id" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientRegion" TEXT,
    "funder" TEXT NOT NULL,
    "programNameRaw" TEXT NOT NULL,
    "programId" TEXT,
    "amount" DECIMAL(65,30),
    "disbursedOn" TIMESTAMP(3),
    "purpose" TEXT,

    CONSTRAINT "FundingDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingProgram_governmentLevel_instrumentType_idx" ON "FundingProgram"("governmentLevel", "instrumentType");

-- CreateIndex
CREATE UNIQUE INDEX "FundingProgram_funder_name_key" ON "FundingProgram"("funder", "name");

-- CreateIndex
CREATE INDEX "EligibilityRule_programId_idx" ON "EligibilityRule"("programId");

-- CreateIndex
CREATE INDEX "FundingProgramSource_programId_idx" ON "FundingProgramSource"("programId");

-- CreateIndex
CREATE INDEX "FundingDisbursement_programId_idx" ON "FundingDisbursement"("programId");

-- CreateIndex
CREATE INDEX "FundingDisbursement_funder_idx" ON "FundingDisbursement"("funder");

-- AddForeignKey
ALTER TABLE "EligibilityRule" ADD CONSTRAINT "EligibilityRule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "FundingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingProgramSource" ADD CONSTRAINT "FundingProgramSource_programId_fkey" FOREIGN KEY ("programId") REFERENCES "FundingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

