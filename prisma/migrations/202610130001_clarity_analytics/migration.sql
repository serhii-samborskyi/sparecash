CREATE TABLE "ClaritySnapshot" (
    "id" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "dimensions" TEXT[],
    "metrics" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaritySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClaritySnapshot_fetchedAt_idx" ON "ClaritySnapshot"("fetchedAt");
