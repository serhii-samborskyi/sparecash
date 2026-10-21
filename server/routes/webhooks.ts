import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireWebhook, hash, equal } from "../security.js";
import { normalizePhone } from "../domain.js";
import { unsubscribe } from "../services/journeys.js";
import { normalizeRoundSkySale } from "../roundsky-contract.js";
import { requireRoundSkyWebhook } from "../services/roundsky.js";
import {
  recordPostback,
  PostbackConflictError,
} from "../services/postbacks.js";
import { recordMessageEvent } from "../services/message-events.js";
export const webhookRouter = Router();

const partnerPostbackSchema = z.object({
  eventId: z.string().min(1).max(200),
  applicationId: z.string().uuid(),
  event: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["SOLD", "APPROVED", "FUNDED", "DECLINED"]))
    .default("SOLD"),
  revenue: z.coerce.number().min(0).max(100000).default(0),
});

// Each offer has a separate secret URL so partner attribution cannot be mixed.
webhookRouter.all("/offers/:key/:secret", async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) {
    res
      .set("Allow", "GET, POST")
      .status(405)
      .json({ error: "Method not allowed" });
    return;
  }
  res.set("Cache-Control", "no-store");
  const offer = await db.offer.findUnique({
    where: { postbackKey: req.params.key },
  });
  if (!offer || !equal(req.params.secret, offer.postbackSecret)) {
    res.status(401).json({ error: "Invalid offer postback authentication" });
    return;
  }
  const source = req.method === "GET" ? req.query : req.body;
  const input = partnerPostbackSchema.parse({
    eventId: source.eventId ?? source.transactionId ?? source.transaction_id,
    applicationId:
      source.applicationId ??
      source.application_id ??
      source.hid ??
      source.subId3,
    event: source.event ?? "SOLD",
    revenue: source.revenue ?? source.payout ?? source.price ?? 0,
  });
  const application = await db.applicationClick.findUnique({
    where: { id: input.applicationId },
    select: { offerId: true },
  });
  if (!application || application.offerId !== offer.id) {
    res
      .status(409)
      .json({ error: "Application is not attributed to this offer" });
    return;
  }
  try {
    res.json(await recordPostback({ ...input, offerId: offer.id }));
  } catch (error) {
    if (error instanceof PostbackConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});
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
    .object({
      event: z.string(),
      email: z.string().email(),
      id: z.union([z.string(), z.number()]).optional(),
      ts_event: z.coerce.number().optional(),
      link: z.string().url().optional(),
      URL: z.string().url().optional(),
    })
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
  const custom = String(
    input["X-Mailin-custom"] ?? input["x-mailin-custom"] ?? "",
  );
  const embeddedDeliveryId = custom.match(/delivery:([0-9a-f-]{36})/i)?.[1];
  const messageId = String(
    input["message-id"] ?? input.messageId ?? input["message_id"] ?? "",
  );
  const delivery = embeddedDeliveryId
    ? await db.delivery.findUnique({ where: { id: embeddedDeliveryId } })
    : messageId
      ? await db.delivery.findFirst({ where: { providerId: messageId } })
      : null;
  const type = (
    {
      delivered: "DELIVERED",
      opened: "OPENED",
      unique_opened: "OPENED",
      proxy_open: "PROXY_OPENED",
      unique_proxy_open: "PROXY_OPENED",
      click: "PROVIDER_CLICKED",
      hard_bounce: "BOUNCED",
      soft_bounce: "BOUNCED",
      blocked: "BOUNCED",
      invalid_email: "BOUNCED",
      error: "FAILED",
    } as Record<string, string>
  )[input.event.toLowerCase()];
  if (delivery && type) {
    const occurredAt = input.ts_event
      ? new Date(input.ts_event * 1000)
      : new Date();
    await recordMessageEvent({
      deliveryId: delivery.id,
      type,
      providerEventId: `brevo:${input.id ?? hash(JSON.stringify(req.body))}`,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      url: input.link ?? input.URL,
      detail: { event: input.event },
    });
  }
  res.json({ ok: true });
});
webhookRouter.post("/bluebubbles", async (req, res) => {
  const input = z
    .object({
      type: z.string(),
      data: z
        .object({
          guid: z.string().min(1).max(250).nullish(),
          text: z.string().nullish(),
          isFromMe: z.boolean().optional(),
          isDelivered: z.boolean().optional(),
          isRead: z.boolean().optional(),
          dateDelivered: z.number().nullish(),
          dateRead: z.number().nullish(),
          error: z.union([z.string(), z.number()]).nullish(),
          handle: z.object({ address: z.string() }).nullish(),
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
    const text = input.data.text?.trim();
    if (phone && text) {
      const sub = await db.subscription.findUnique({
        where: { channel_address: { channel: "SMS", address: phone } },
      });
      if (sub) {
        // The provider GUID makes repeated or concurrent webhook deliveries idempotent.
        if (input.data.guid)
          await db.leadEvent.createMany({
            data: [
              {
                id: `bluebubbles:${hash(input.data.guid)}`,
                leadId: sub.leadId,
                type: "SMS_REPLY",
                detail: `Text reply: ${text.slice(0, 10000)}`,
              },
            ],
            skipDuplicates: true,
          });
        const delivery = await db.delivery.findFirst({
          where: { subscriptionId: sub.id, status: "SENT" },
          orderBy: { sentAt: "desc" },
        });
        if (delivery && input.data.guid)
          await recordMessageEvent({
            deliveryId: delivery.id,
            type: "REPLIED",
            providerEventId: `bluebubbles:${input.data.guid}:reply`,
            detail: { type: input.type },
          });
        if (
          sub.status !== "UNSUBSCRIBED" &&
          /^(stop|unsubscribe|cancel|end|quit|revoke|opt out)[.!\s]*$/i.test(
            text,
          )
        )
          await unsubscribe(sub.id, "Text opt-out received");
      }
    }
  }
  if (input.data.guid) {
    const delivery = await db.delivery.findFirst({
      where: { providerId: input.data.guid },
    });
    if (delivery) {
      if (input.data.isDelivered || input.data.dateDelivered)
        await recordMessageEvent({
          deliveryId: delivery.id,
          type: "DELIVERED",
          providerEventId: `bluebubbles:${input.data.guid}:delivered`,
          occurredAt: input.data.dateDelivered
            ? new Date(
                input.data.dateDelivered > 1_000_000_000_000
                  ? input.data.dateDelivered
                  : input.data.dateDelivered * 1_000,
              )
            : undefined,
          detail: { type: input.type },
        });
      if (input.data.isRead || input.data.dateRead)
        await recordMessageEvent({
          deliveryId: delivery.id,
          type: "READ",
          providerEventId: `bluebubbles:${input.data.guid}:read`,
          occurredAt: input.data.dateRead
            ? new Date(
                input.data.dateRead > 1_000_000_000_000
                  ? input.data.dateRead
                  : input.data.dateRead * 1_000,
              )
            : undefined,
          detail: { type: input.type },
        });
      if (input.data.error)
        await recordMessageEvent({
          deliveryId: delivery.id,
          type: "FAILED",
          providerEventId: `bluebubbles:${input.data.guid}:failed`,
          detail: { type: input.type, error: String(input.data.error) },
        });
    }
  }
  res.json({ ok: true });
});
