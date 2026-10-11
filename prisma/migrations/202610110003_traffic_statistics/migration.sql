ALTER TABLE "Visit"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "geoSource" TEXT;

CREATE INDEX "Visit_createdAt_idx" ON "Visit"("createdAt");

CREATE TABLE "AdStatisticsSnapshot" (
  "id" TEXT NOT NULL,
  "query" JSONB NOT NULL,
  "rows" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdStatisticsSnapshot_pkey" PRIMARY KEY ("id")
);
