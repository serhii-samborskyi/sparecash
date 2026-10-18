ALTER TABLE "Variant" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Variant_experimentId_archivedAt_idx"
  ON "Variant"("experimentId", "archivedAt");
