CREATE TABLE "LandingAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/webp',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LandingAsset_sha256_key" ON "LandingAsset"("sha256");
CREATE INDEX "LandingAsset_createdAt_id_idx" ON "LandingAsset"("createdAt", "id");

CREATE TABLE "LandingAssetUpload" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingAssetUpload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LandingAssetUpload_expiresAt_idx" ON "LandingAssetUpload"("expiresAt");
