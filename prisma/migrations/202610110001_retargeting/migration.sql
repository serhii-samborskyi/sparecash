-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "journeyId" TEXT,
ADD COLUMN     "retargetingAudienceId" TEXT,
ADD COLUMN     "retargetingCampaignId" TEXT,
ADD COLUMN     "verificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verificationState" TEXT NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VisitorJourney" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "controlPercent" INTEGER NOT NULL,
    "privacy" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "privacyAt" TIMESTAMP(3),
    "eligibleAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "suppressionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvertisingPrivacyEvent" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvertisingPrivacyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorVerification" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "errors" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetargetingAudience" (
    "id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "revision" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetargetingAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetargetingPixelAttempt" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "visitId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ISSUED',
    "reason" TEXT,
    "suppressionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedAt" TIMESTAMP(3),

    CONSTRAINT "RetargetingPixelAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetargetingSpend" (
    "campaignId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "amount" DECIMAL(12,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reference" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetargetingSpend_pkey" PRIMARY KEY ("campaignId","day")
);

-- CreateIndex
CREATE INDEX "AdvertisingPrivacyEvent_journeyId_createdAt_idx" ON "AdvertisingPrivacyEvent"("journeyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorVerification_tokenHash_key" ON "VisitorVerification"("tokenHash");

-- CreateIndex
CREATE INDEX "VisitorVerification_visitId_createdAt_idx" ON "VisitorVerification"("visitId", "createdAt");

-- CreateIndex
CREATE INDEX "RetargetingPixelAttempt_state_createdAt_idx" ON "RetargetingPixelAttempt"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetargetingPixelAttempt_journeyId_audienceId_action_key" ON "RetargetingPixelAttempt"("journeyId", "audienceId", "action");

-- CreateIndex
CREATE INDEX "Visit_journeyId_createdAt_idx" ON "Visit"("journeyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "VisitorJourney"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisingPrivacyEvent" ADD CONSTRAINT "AdvertisingPrivacyEvent_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "VisitorJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorVerification" ADD CONSTRAINT "VisitorVerification_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetargetingPixelAttempt" ADD CONSTRAINT "RetargetingPixelAttempt_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "VisitorJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetargetingPixelAttempt" ADD CONSTRAINT "RetargetingPixelAttempt_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "RetargetingAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
