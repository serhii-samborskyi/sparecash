import type { Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import { env } from "../config.js";
import { equal } from "../security.js";
import {
  buildRoundSkyUrl,
  buildRoundSkyPixelUrl,
} from "../roundsky-contract.js";
import { settings } from "./control.js";

export function roundSkyWebhookSecret() {
  return env.ROUNDSKY_WEBHOOK_TOKEN;
}

export function requireRoundSkyWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const supplied = req.headers["x-webhook-token"] ?? req.query.token;
  if (
    typeof supplied !== "string" ||
    !equal(supplied, roundSkyWebhookSecret())
  ) {
    res.status(401).json({ error: "Invalid RoundSky webhook authentication" });
    return;
  }
  next();
}

export function roundSkyPixelSetup() {
  const origin = env.APP_URL;
  return {
    origin,
    pixelType: "Server 2 Server Requst Pixel",
    seller: "LeadTechX",
    event: "SOLD",
    pixelUrl: buildRoundSkyPixelUrl(origin, roundSkyWebhookSecret()),
  };
}

export async function createRoundSkyApplication(input: {
  visitId: string;
  leadId?: string;
  deliveryId?: string;
}) {
  const config = await settings();
  if (!config.roundskyUrl)
    throw new Error("Loan options are not connected yet.");
  const [visit, lead] = await Promise.all([
    db.visit.findUniqueOrThrow({
      where: { id: input.visitId },
      include: { source: true },
    }),
    input.leadId
      ? db.lead.findUniqueOrThrow({
          where: { id: input.leadId },
          include: {
            subscriptions: { where: { status: { in: ["PENDING", "ACTIVE"] } } },
          },
        })
      : Promise.resolve(null),
  ]);
  if (lead && lead.visitId !== visit.id)
    throw new Error("Application attribution does not match the contact");
  const application = await db.applicationClick.create({ data: input });
  const answers =
    lead?.answers &&
    typeof lead.answers === "object" &&
    !Array.isArray(lead.answers)
      ? lead.answers
      : {};
  return buildRoundSkyUrl({
    baseUrl: config.roundskyUrl,
    applicationId: application.id,
    campaign: visit.source?.campaignId ?? "direct",
    source: visit.source?.zoneId ?? "direct",
    prepopulate:
      lead && config.roundskyPrepopulate
        ? {
            firstName: lead.name,
            email: lead.subscriptions.find((s) => s.channel === "EMAIL")
              ?.address,
            homePhone: lead.subscriptions.find((s) => s.channel === "SMS")
              ?.address,
            rla: typeof answers.rla === "string" ? answers.rla : undefined,
          }
        : undefined,
  });
}
