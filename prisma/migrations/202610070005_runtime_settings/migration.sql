CREATE TABLE "AppConfiguration" (
    "id" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "encryptedSecrets" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppConfiguration_pkey" PRIMARY KEY ("id")
);
