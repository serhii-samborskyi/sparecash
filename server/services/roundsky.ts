import type { Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import { env } from "../config.js";
import { equal } from "../security.js";
import { buildRoundSkyPixelUrl } from "../roundsky-contract.js";
import { settings } from "./control.js";
import { lockJourney, refreshJourneySuppression } from "./retargeting.js";
import { hasVisitorProof } from "./visitor-verification.js";
import { queueAdvertiserConversion } from "./advertiser-conversion-events.js";
import { buildOfferDestination, resolveOffer } from "./offers.js";

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
  requireVerification?: boolean;
}) {
  const config = await settings();
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
  const offer = await resolveOffer({
    visitId: visit.id,
    deliveryId: input.deliveryId,
  });
  if (!offer) throw new Error("Loan options are not connected yet.");
  const application = await db.$transaction(async (tx) => {
    if (visit.journeyId) await lockJourney(tx, visit.journeyId);
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id=${visit.id} FOR UPDATE`;
    const current = await tx.visit.findUniqueOrThrow({
      where: { id: visit.id },
    });
    if (input.requireVerification && !hasVisitorProof(current))
      throw new Error("Finish browser verification, then continue.");
    const application = await tx.applicationClick.create({
      data: {
        visitId: input.visitId,
        leadId: input.leadId,
        deliveryId: input.deliveryId,
        offerId: offer.id,
        destinationUrl: offer.destinationUrl,
      },
    });
    await queueAdvertiserConversion(tx, {
      visit: current,
      applicationId: application.id,
      event: "APPLICATION",
      goal: 2,
    });
    await tx.visitEvent.createMany({
      data: [
        {
          visitId: visit.id,
          kind: "APPLICATION_CONTINUED",
          verifiedAt: hasVisitorProof(current) ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    });
    if (hasVisitorProof(current))
      await tx.visitEvent.updateMany({
        where: {
          visitId: visit.id,
          kind: "APPLICATION_CONTINUED",
          verifiedAt: null,
        },
        data: { verifiedAt: new Date() },
      });
    return application;
  });
  if (visit.journeyId) await refreshJourneySuppression(visit.journeyId);
  const answers =
    lead?.answers &&
    typeof lead.answers === "object" &&
    !Array.isArray(lead.answers)
      ? lead.answers
      : {};
  return buildOfferDestination({
    offer,
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
