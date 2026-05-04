-- AddForeignKey
ALTER TABLE "DetectedMeeting" ADD CONSTRAINT "DetectedMeeting_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "InstitutionRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
