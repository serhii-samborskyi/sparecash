ALTER TABLE "VisitEvent" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Visit" ADD COLUMN "verificationAttemptId" TEXT;
