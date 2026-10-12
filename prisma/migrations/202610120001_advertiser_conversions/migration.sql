CREATE TABLE "AdvertiserConversion" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "goal" INTEGER NOT NULL,
  "externalClickId" TEXT NOT NULL,
  "payout" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),

  CONSTRAINT "AdvertiserConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdvertiserConversion_applicationId_goal_key"
  ON "AdvertiserConversion"("applicationId", "goal");
CREATE INDEX "AdvertiserConversion_status_createdAt_idx"
  ON "AdvertiserConversion"("status", "createdAt");
ALTER TABLE "AdvertiserConversion"
  ADD CONSTRAINT "AdvertiserConversion_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "ApplicationClick"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
