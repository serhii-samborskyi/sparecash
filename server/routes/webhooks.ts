import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireWebhook } from "../security.js";
import { normalizePhone } from "../domain.js";
import { unsubscribe } from "../services/journeys.js";
import { normalizeRoundSkySale } from "../roundsky-contract.js";
import { requireRoundSkyWebhook } from "../services/roundsky.js";
import {
  recordPostback,
  PostbackConflictError,
} from "../services/postbacks.js";
export const webhookRouter = Router();
// RoundSky's account supplies a sold-lead S2S GET pixel, authenticated by its own secret.
webhookRouter.all(
  "/roundsky/sold",
  requireRoundSkyWebhook,
  async (req, res) => {
    if (!["GET", "POST"].includes(req.method)) {
      res
        .set("Allow", "GET, POST")
        .status(405)
        .json({ error: "Method not allowed" });
      return;
    }
    res.set("Cache-Control", "no-store");
    const input = normalizeRoundSkySale(
      req.method === "GET" ? req.query : req.body,
    );
    try {
      res.json(await recordPostback(input));
    } catch (error) {
      if (error instanceof PostbackConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

// Retain the normalized ingestion contract for separately verified future events.
webhookRouter.use(requireWebhook);
const postbackSchema = z.object({
  eventId: z.string().min(1).max(200),
  applicationId: z.string().uuid(),
  event: z.enum(["SOLD", "APPROVED", "FUNDED", "DECLINED"]),
  revenue: z.coerce.number().min(0).max(100000).default(0),
});
webhookRouter.all("/roundsky", async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) {
    res
      .set("Allow", "GET, POST")
      .status(405)
      .json({ error: "Method not allowed" });
    return;
  }
  res.set("Cache-Control", "no-store");
  const input = postbackSchema.parse(
    req.method === "GET" ? req.query : req.body,
  );
  try {
    res.json(await recordPostback(input));
  } catch (error) {
    if (error instanceof PostbackConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});
webhookRouter.post("/brevo", async (req, res) => {
  const input = z
    .object({ event: z.string(), email: z.string().email() })
    .passthrough()
    .parse(req.body);
  if (
    ["unsubscribe", "unsubscribed", "spam", "hard_bounce", "blocked"].includes(
      input.event,
    )
  ) {
    const sub = await db.subscription.findUnique({
      where: {
        channel_address: {
          channel: "EMAIL",
          address: input.email.toLowerCase(),
        },
      },
    });
    if (sub) await unsubscribe(sub.id, `Brevo: ${input.event}`);
  }
  res.json({ ok: true });
});
webhookRouter.post("/bluebubbles", async (req, res) => {
  const input = z
    .object({
      type: z.string(),
      data: z
        .object({
          text: z.string().nullish(),
          isFromMe: z.boolean().optional(),
          handle: z.object({ address: z.string() }).optional(),
        })
        .passthrough(),
    })
    .parse(req.body);
  if (
    input.type === "new-message" &&
    input.data.isFromMe === false &&
    input.data.handle
  ) {
    const phone = normalizePhone(input.data.handle.address);
    if (
      phone &&
      /^(stop|unsubscribe|cancel|end|quit|revoke|opt out)[.!\s]*$/i.test(
        input.data.text?.trim() ?? "",
      )
    ) {
      const sub = await db.subscription.findUnique({
        where: { channel_address: { channel: "SMS", address: phone } },
      });
      if (sub) await unsubscribe(sub.id, "Text opt-out received");
    }
  }
  res.json({ ok: true });
});
