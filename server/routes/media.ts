import { Router, raw } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "../db.js";
import { equal, hash } from "../security.js";
import {
  completeLandingAssetUpload,
  MAX_ASSET_BYTES,
} from "../services/landing-assets.js";

export const mediaRouter = Router();
mediaRouter.post(
  "/api/media/landing-upload/:id",
  rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res, next) => {
    const ticket = await db.landingAssetUpload.findUnique({
      where: { id: String(req.params.id) },
    });
    const credential = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (
      !ticket ||
      !credential ||
      !equal(ticket.tokenHash, hash(credential)) ||
      ticket.usedAt ||
      ticket.expiresAt <= new Date()
    ) {
      res
        .status(401)
        .set("Cache-Control", "no-store")
        .json({ error: "Valid, unused upload credential required" });
      return;
    }
    next();
  },
  raw({ type: () => true, limit: MAX_ASSET_BYTES }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body))
      throw new Error("Send the image file as the request body");
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json(await completeLandingAssetUpload(String(req.params.id), req.body));
  },
);
mediaRouter.get("/media/landing/:file", async (req, res) => {
  const match = String(req.params.file).match(/^([a-z0-9]{20,40})\.webp$/);
  const asset = match
    ? await db.landingAsset.findUnique({ where: { id: match[1] } })
    : null;
  if (!asset) {
    res.status(404).set("Cache-Control", "no-store").end();
    return;
  }
  res.set({
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: `"${asset.sha256}"`,
  });
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  res.send(Buffer.from(asset.data));
});
