ALTER TABLE "AppConfiguration"
    ADD COLUMN "secrets" JSONB,
    ADD COLUMN "credentialsNeedReview" BOOLEAN NOT NULL DEFAULT false,
    ALTER COLUMN "encryptedSecrets" DROP NOT NULL;
