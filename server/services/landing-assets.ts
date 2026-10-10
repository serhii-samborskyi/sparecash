import sharp from "sharp";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";
import { hash, randomToken } from "../security.js";
import { landingImages } from "../landing-images.js";

export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const assetDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  alt: z.string().trim().min(3).max(240),
  kind: z.enum(["HERO", "LOGO", "SECTION"]).default("HERO"),
});
export const uploadAssetSchema = assetDetailsSchema.extend({
  base64: z
    .string()
    .min(4)
    .max(4 * Math.ceil(MAX_ASSET_BYTES / 3)),
});
export const listAssetsSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(120).default(""),
  kind: assetDetailsSchema.shape.kind.optional(),
});
const metadataSelect = {
  id: true,
  name: true,
  alt: true,
  kind: true,
  mimeType: true,
  width: true,
  height: true,
  byteSize: true,
  createdAt: true,
} satisfies Prisma.LandingAssetSelect;
type AssetMetadata = Prisma.LandingAssetGetPayload<{
  select: typeof metadataSelect;
}>;
const view = (asset: AssetMetadata) => ({
  ...asset,
  src: `/media/landing/${asset.id}.webp`,
  url: new URL(`/media/landing/${asset.id}.webp`, env.APP_URL).href,
});

export async function normalizeLandingAsset(data: Buffer, kind: string) {
  if (!data.length || data.length > MAX_ASSET_BYTES)
    throw new Error("Images must be between 1 byte and 4 MiB");
  const png = data
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const webp =
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpg && !webp)
    throw new Error("Upload a PNG, JPEG or WebP image");
  try {
    const image = sharp(data, {
      limitInputPixels: 25_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1)
      throw new Error("Animated images are not supported");
    const result = await image
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 86, alphaQuality: 100, lossless: kind === "LOGO" })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_ASSET_BYTES)
      throw new Error("Optimized image exceeds 4 MiB; upload a smaller image");
    return {
      data: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new Error(
      "Image could not be processed. Use a valid, non-animated PNG, JPEG or WebP under 4 MiB and 25 megapixels.",
    );
  }
}

async function storeAsset(
  tx: Prisma.TransactionClient,
  details: z.infer<typeof assetDetailsSchema>,
  normalized: Awaited<ReturnType<typeof normalizeLandingAsset>>,
  actor: string,
) {
  const sha256 = createHash("sha256")
    .update(details.kind)
    .update(normalized.data)
    .digest("hex");
  // Assets never change in place: old variants and visit snapshots keep their artwork.
  const asset = await tx.landingAsset.upsert({
    where: { sha256 },
    update: {},
    create: {
      ...details,
      ...normalized,
      sha256,
      byteSize: normalized.data.length,
    },
    select: metadataSelect,
  });
  await tx.auditLog.create({
    data: {
      actor,
      action: "landing_asset.uploaded",
      entityId: asset.id,
      details: { name: asset.name, kind: asset.kind, byteSize: asset.byteSize },
    },
  });
  return view(asset);
}

export async function uploadLandingAsset(input: unknown, actor: string) {
  const { base64, ...details } = uploadAssetSchema.parse(input);
  const data = Buffer.from(base64, "base64");
  if (data.toString("base64") !== base64)
    throw new Error(
      "Use plain, canonical base64 without a data URL prefix or whitespace",
    );
  const normalized = await normalizeLandingAsset(data, details.kind);
  return db.$transaction((tx) => storeAsset(tx, details, normalized, actor));
}

export async function listLandingAssets(input: unknown) {
  const { page, q, kind } = listAssetsSchema.parse(input);
  const where = {
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(kind ? { kind } : {}),
  };
  const [items, total] = await db.$transaction([
    db.landingAsset.findMany({
      where,
      select: metadataSelect,
      take: 50,
      skip: (page - 1) * 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.landingAsset.count({ where }),
  ]);
  return {
    items: items.map(view),
    total,
    page,
    pageSize: 50,
    bundled: landingImages,
  };
}

export async function createLandingAssetUpload(input: unknown) {
  const details = assetDetailsSchema.parse(input);
  const secret = randomToken();
  const expiresAt = new Date(Date.now() + 20 * 60_000);
  await db.landingAssetUpload.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  const ticket = await db.landingAssetUpload.create({
    data: { ...details, tokenHash: hash(secret), expiresAt },
  });
  await db.auditLog.create({
    data: {
      actor: "mcp",
      action: "landing_asset.upload_requested",
      entityId: ticket.id,
      details: { name: details.name, kind: details.kind },
    },
  });
  return {
    uploadUrl: new URL(`/api/media/landing-upload/${ticket.id}`, env.APP_URL)
      .href,
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/octet-stream",
    },
    expiresAt,
    maxBytes: MAX_ASSET_BYTES,
    instructions:
      "POST the local image file bytes to uploadUrl with these headers. This one-use credential only uploads this image. The response returns src and alt for save_experiment. Do not paste file bytes into chat. Artwork generation happens in your AI client's image tool, not in SpareCash.",
  };
}

export async function completeLandingAssetUpload(id: string, data: Buffer) {
  const ticket = await db.landingAssetUpload.findUniqueOrThrow({
    where: { id },
  });
  const normalized = await normalizeLandingAsset(data, ticket.kind);
  return db.$transaction(async (tx) => {
    const consumed = await tx.landingAssetUpload.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new Error(
        "Upload link expired or already used; request a new upload",
      );
    return storeAsset(
      tx,
      {
        name: ticket.name,
        alt: ticket.alt,
        kind: assetDetailsSchema.shape.kind.parse(ticket.kind),
      },
      normalized,
      "mcp",
    );
  });
}
