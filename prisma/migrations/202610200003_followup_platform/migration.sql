ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'HELD';

CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" TEXT NOT NULL DEFAULT 'CUSTOM',
    "destinationUrl" TEXT NOT NULL,
    "trackingParameter" TEXT NOT NULL DEFAULT 'subId3',
    "postbackKey" TEXT NOT NULL,
    "postbackSecret" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL DEFAULT '',
    "eyebrow" TEXT NOT NULL DEFAULT 'SPARECASH',
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Explore loan options',
    "accentColor" TEXT NOT NULL DEFAULT '#1f5b4d',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Experiment" ADD COLUMN "offerId" TEXT;
ALTER TABLE "Variant" ADD COLUMN "offerId" TEXT;
ALTER TABLE "ChainStep" ADD COLUMN "offerId" TEXT;
ALTER TABLE "ChainStep" ADD COLUMN "emailTemplateId" TEXT;
ALTER TABLE "ChainStep" ADD COLUMN "mediaAssetId" TEXT;
ALTER TABLE "Enrollment" ADD COLUMN "holdReason" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "htmlBody" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "offerId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "emailTemplateId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "mediaAssetId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN "openedAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN "openCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Delivery" ADD COLUMN "providerClickCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Delivery" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN "repliedAt" TIMESTAMP(3);
ALTER TABLE "ApplicationClick" ADD COLUMN "offerId" TEXT;
ALTER TABLE "ApplicationClick" ADD COLUMN "destinationUrl" TEXT;
ALTER TABLE "Postback" ADD COLUMN "offerId" TEXT;

CREATE TABLE "MessageEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerEventId" TEXT,
    "url" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Offer_postbackKey_key" ON "Offer"("postbackKey");
CREATE INDEX "Offer_status_isDefault_idx" ON "Offer"("status", "isDefault");
CREATE INDEX "EmailTemplate_status_updatedAt_idx" ON "EmailTemplate"("status", "updatedAt");
CREATE INDEX "MessageAsset_createdAt_idx" ON "MessageAsset"("createdAt");
CREATE UNIQUE INDEX "MessageEvent_deliveryId_providerEventId_type_key" ON "MessageEvent"("deliveryId", "providerEventId", "type");
CREATE INDEX "MessageEvent_deliveryId_occurredAt_idx" ON "MessageEvent"("deliveryId", "occurredAt");
CREATE INDEX "MessageEvent_type_occurredAt_idx" ON "MessageEvent"("type", "occurredAt");

-- Older application rows predate the delivery foreign key. Preserve the
-- application while clearing any historical dangling reference.
UPDATE "ApplicationClick" a
SET "deliveryId" = NULL
WHERE a."deliveryId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Delivery" d WHERE d.id = a."deliveryId");

ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChainStep" ADD CONSTRAINT "ChainStep_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MessageAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MessageAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationClick" ADD CONSTRAINT "ApplicationClick_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationClick" ADD CONSTRAINT "ApplicationClick_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Postback" ADD CONSTRAINT "Postback_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Offer" ("id", "name", "status", "provider", "destinationUrl", "trackingParameter", "postbackKey", "postbackSecret", "isDefault", "updatedAt")
SELECT
    'offer_roundsky_legacy',
    'RoundSky · current offer',
    'ACTIVE'::"RunStatus",
    'ROUNDSKY',
    "value"->>'roundskyUrl',
    COALESCE("value"->>'roundskySubIdParameter', 'subId3'),
    'roundsky-current',
    md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text),
    true,
    CURRENT_TIMESTAMP
FROM "Setting"
WHERE "key" = 'general'
  AND COALESCE("value"->>'roundskyUrl', '') <> ''
ON CONFLICT ("postbackKey") DO NOTHING;
