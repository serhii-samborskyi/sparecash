CREATE TABLE "VisitEvent" (
  "id" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "questionId" TEXT NOT NULL DEFAULT '',
  "answer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VisitEvent_visitId_kind_questionId_key" ON "VisitEvent"("visitId", "kind", "questionId");
CREATE INDEX "VisitEvent_kind_createdAt_idx" ON "VisitEvent"("kind", "createdAt");
