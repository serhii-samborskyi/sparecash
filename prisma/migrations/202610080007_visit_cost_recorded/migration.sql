ALTER TABLE "Visit" ADD COLUMN "costRecorded" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Visit" SET "costRecorded" = true WHERE "cost" > 0;
