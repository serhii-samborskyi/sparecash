CREATE TABLE "LandingHit" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "campaignId" TEXT,
  "zoneId" TEXT,
  "externalClickId" TEXT,
  "userAgent" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "visitId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LandingHit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandingHit_campaignId_zoneId_createdAt_idx"
  ON "LandingHit"("campaignId", "zoneId", "createdAt");
CREATE INDEX "LandingHit_slug_createdAt_idx"
  ON "LandingHit"("slug", "createdAt");
CREATE INDEX "LandingHit_visitId_idx" ON "LandingHit"("visitId");
ALTER TABLE "LandingHit"
  ADD CONSTRAINT "LandingHit_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdvertiserConversion" ADD COLUMN "visitId" TEXT;
UPDATE "AdvertiserConversion" AS conversion
SET "visitId" = application."visitId"
FROM "ApplicationClick" AS application
WHERE conversion."applicationId" = application."id";
ALTER TABLE "AdvertiserConversion" ALTER COLUMN "visitId" SET NOT NULL;
ALTER TABLE "AdvertiserConversion" ALTER COLUMN "applicationId" DROP NOT NULL;

ALTER TABLE "AdvertiserConversion"
  DROP CONSTRAINT "AdvertiserConversion_applicationId_fkey";
DROP INDEX "AdvertiserConversion_applicationId_goal_key";

-- Align the durable event label with the goal it represents. Historical
-- delivery state remains intact; only the local goal label is corrected.
UPDATE "AdvertiserConversion"
SET "goal" = CASE WHEN "event" = 'SOLD' THEN 1 ELSE 2 END
WHERE "event" IN ('SOLD', 'APPLICATION');

-- Earlier application rows were unique per application. Retain one durable
-- row per Propeller click and goal before enforcing the stronger invariant.
DELETE FROM "AdvertiserConversion" AS duplicate
USING "AdvertiserConversion" AS keeper
WHERE duplicate."externalClickId" = keeper."externalClickId"
  AND duplicate."goal" = keeper."goal"
  AND duplicate."id" > keeper."id";

CREATE UNIQUE INDEX "AdvertiserConversion_externalClickId_goal_key"
  ON "AdvertiserConversion"("externalClickId", "goal");
CREATE INDEX "AdvertiserConversion_visitId_createdAt_idx"
  ON "AdvertiserConversion"("visitId", "createdAt");
ALTER TABLE "AdvertiserConversion"
  ADD CONSTRAINT "AdvertiserConversion_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvertiserConversion"
  ADD CONSTRAINT "AdvertiserConversion_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "ApplicationClick"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AdvertiserConversionAttempt" (
  "id" TEXT NOT NULL,
  "conversionId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "httpStatus" INTEGER,
  "outcome" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "AdvertiserConversionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdvertiserConversionAttempt_conversionId_attempt_key"
  ON "AdvertiserConversionAttempt"("conversionId", "attempt");
CREATE INDEX "AdvertiserConversionAttempt_createdAt_idx"
  ON "AdvertiserConversionAttempt"("createdAt");
ALTER TABLE "AdvertiserConversionAttempt"
  ADD CONSTRAINT "AdvertiserConversionAttempt_conversionId_fkey"
  FOREIGN KEY ("conversionId") REFERENCES "AdvertiserConversion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

