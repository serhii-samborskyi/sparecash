ALTER TABLE "Visit"
  ADD COLUMN "ipAddress" TEXT NOT NULL DEFAULT '';

ALTER TABLE "LandingHit"
  ADD COLUMN "ipAddress" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "country" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "geoSource" TEXT;

CREATE TABLE "IpLocationCache" (
  "ipHash" TEXT NOT NULL,
  "country" TEXT,
  "region" TEXT,
  "city" TEXT,
  "timezone" TEXT,
  "source" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpLocationCache_pkey" PRIMARY KEY ("ipHash")
);

CREATE INDEX "IpLocationCache_expiresAt_idx"
  ON "IpLocationCache"("expiresAt");
