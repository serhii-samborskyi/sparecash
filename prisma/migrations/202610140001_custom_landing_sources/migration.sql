CREATE TABLE "LandingSource" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "htmlBefore" TEXT NOT NULL,
  "htmlAfter" TEXT NOT NULL,
  "css" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LandingSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LandingSource_sha256_key" ON "LandingSource"("sha256");
CREATE INDEX "LandingSource_createdAt_id_idx" ON "LandingSource"("createdAt", "id");
