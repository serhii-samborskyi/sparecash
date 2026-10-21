import { z } from "zod";
import { db } from "../db.js";
import { audit } from "./control.js";

const uploadSchema = z.object({
  name: z.string().min(2).max(100),
  fileName: z.string().min(1).max(180),
  mimeType: z.enum(["video/mp4", "video/quicktime"]),
  base64: z.string().min(1),
});

export async function uploadMessageAsset(input: unknown, actor: string) {
  const data = uploadSchema.parse(input);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data.base64))
    throw new Error("Invalid video encoding");
  const bytes = Buffer.from(data.base64, "base64");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new Error("Video files must be 20 MB or smaller");
  const asset = await db.messageAsset.create({
    data: {
      name: data.name,
      fileName: data.fileName.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 180),
      mimeType: data.mimeType,
      byteSize: bytes.length,
      data: bytes,
    },
  });
  await audit(actor, "message_asset.uploaded", asset.id, {
    name: asset.name,
    byteSize: asset.byteSize,
    mimeType: asset.mimeType,
  });
  return { ...asset, data: undefined };
}

export async function listMessageAssets() {
  return db.messageAsset.findMany({
    select: {
      id: true,
      name: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
