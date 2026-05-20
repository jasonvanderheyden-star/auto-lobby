/*
  Warnings:

  - You are about to drop the column `subjectIds` on the `DpohSubjectPreference` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DpohSubjectPreference" DROP COLUMN "subjectIds",
ADD COLUMN     "oclCodes" TEXT[];
