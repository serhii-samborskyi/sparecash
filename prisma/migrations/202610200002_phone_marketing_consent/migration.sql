CREATE TABLE "PhoneMarketingConsent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentIpHash" TEXT NOT NULL,

    CONSTRAINT "PhoneMarketingConsent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PhoneMarketingConsent_phone_consentAt_idx" ON "PhoneMarketingConsent"("phone", "consentAt");
CREATE INDEX "PhoneMarketingConsent_leadId_idx" ON "PhoneMarketingConsent"("leadId");

ALTER TABLE "PhoneMarketingConsent" ADD CONSTRAINT "PhoneMarketingConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
