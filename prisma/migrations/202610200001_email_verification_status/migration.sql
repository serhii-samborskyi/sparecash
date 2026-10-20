ALTER TABLE "Subscription"
ADD COLUMN "emailVerificationState" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
ADD COLUMN "emailVerificationCheckedAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationDiagnosis" TEXT;
