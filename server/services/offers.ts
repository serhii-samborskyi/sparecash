import { db } from "../db.js";
import { env } from "../config.js";
import { offerSchema } from "../domain.js";
import { randomToken } from "../security.js";
import { settings, audit } from "./control.js";

export function offerPostbackUrl(offer: {
  postbackKey: string;
  postbackSecret: string;
}) {
  return `${new URL(env.APP_URL).origin}/api/webhooks/offers/${encodeURIComponent(offer.postbackKey)}/${encodeURIComponent(offer.postbackSecret)}?applicationId=[APPLICATION_ID]&eventId=[TRANSACTION_ID]&event=SOLD&revenue=[PAYOUT]`;
}

export async function listOffers() {
  const offers = await db.offer.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    include: {
      _count: {
        select: {
          experiments: true,
          variants: true,
          chainSteps: true,
          applications: true,
        },
      },
    },
  });
  return offers.map((offer) => ({
    ...offer,
    postbackUrl: offerPostbackUrl(offer),
  }));
}

export async function saveOffer(input: unknown, actor: string) {
  const data = offerSchema.parse(input);
  const { id, ...fields } = data;
  const result = await db.$transaction(async (tx) => {
    if (fields.isDefault)
      await tx.offer.updateMany({ data: { isDefault: false } });
    const offer = await tx.offer.upsert({
      where: { id: id ?? "new" },
      create: {
        ...fields,
        postbackKey: `offer-${randomToken().slice(0, 12)}`,
        postbackSecret: randomToken(),
      },
      update: fields,
    });
    return offer;
  });
  await audit(actor, "offer.saved", result.id);
  return { ...result, postbackUrl: offerPostbackUrl(result) };
}

export async function resolveOffer(input: {
  visitId: string;
  deliveryId?: string;
}) {
  const [delivery, visit] = await Promise.all([
    input.deliveryId
      ? db.delivery.findUnique({
          where: { id: input.deliveryId },
          include: { offer: true },
        })
      : null,
    db.visit.findUniqueOrThrow({
      where: { id: input.visitId },
      include: {
        variant: { include: { offer: true } },
        experiment: { include: { offer: true } },
      },
    }),
  ]);
  const assigned =
    delivery?.offer ?? visit.variant.offer ?? visit.experiment.offer ?? null;
  if (assigned?.status === "ACTIVE") return assigned;
  const fallback = await db.offer.findFirst({
    where: { status: "ACTIVE", isDefault: true },
    orderBy: { updatedAt: "desc" },
  });
  if (fallback) return fallback;
  const config = await settings();
  if (!config.roundskyUrl) return null;
  return {
    id: null,
    name: "RoundSky · legacy fallback",
    provider: "ROUNDSKY",
    destinationUrl: config.roundskyUrl,
    trackingParameter: config.roundskySubIdParameter,
  };
}

export function buildOfferDestination(input: {
  offer: {
    provider: string;
    destinationUrl: string;
    trackingParameter: string;
  };
  applicationId: string;
  campaign: string;
  source: string;
  prepopulate?: {
    firstName?: string;
    email?: string;
    homePhone?: string;
    rla?: string;
  };
}) {
  const url = new URL(input.offer.destinationUrl);
  if (url.protocol !== "https:") throw new Error("Offer URL must use HTTPS");
  url.searchParams.set(input.offer.trackingParameter, input.applicationId);
  url.searchParams.set("subId", input.campaign);
  url.searchParams.set("subId2", input.source);
  const fields = input.prepopulate;
  if (fields?.firstName)
    url.searchParams.set("firstName", fields.firstName.trim().slice(0, 30));
  if (fields?.email) url.searchParams.set("email", fields.email);
  if (fields?.homePhone)
    url.searchParams.set(
      "homePhone",
      fields.homePhone.replace(/\D/g, "").slice(-10),
    );
  if (fields?.rla && /^\d+$/.test(fields.rla))
    url.searchParams.set("rla", fields.rla);
  return url.toString();
}
