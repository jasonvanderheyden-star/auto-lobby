-- AlterTable: add unique constraint on InstitutionRegistry.name
-- Safe on empty table; institution names are semantically unique.
ALTER TABLE "InstitutionRegistry" ADD CONSTRAINT "InstitutionRegistry_name_key" UNIQUE ("name");
