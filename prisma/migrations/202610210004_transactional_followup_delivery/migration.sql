-- Brevo rejected these legacy campaign requests before accepting a message.
-- Requeue only identifier-free HTTP 405 failures for the transactional path.
UPDATE "Delivery"
SET "status" = 'PENDING'::"DeliveryStatus",
    "error" = NULL
WHERE "status" = 'FAILED'::"DeliveryStatus"
  AND "providerId" IS NULL
  AND "sentAt" IS NULL
  AND "error" = 'Brevo request failed (HTTP 405); check provider logs';
