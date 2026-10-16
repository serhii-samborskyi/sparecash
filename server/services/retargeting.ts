import type { Request, Response } from "express";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";
import { token, verifyToken } from "../security.js";
import { hasVisitorProof } from "./visitor-verification.js";
import {
  ADVERTISING_NOTICE,
  audienceSchema,
  retargetingConfiguration,
  validateConfiguration,
  validateRetargetingSetup,
  type Audience,
} from "./retargeting-config.js";

export async function visitorJourney(req: Request, res: Response) {
  const id = verifyToken(String(req.cookies.sc_journey ?? ""), "journey");
  let journey = id
    ? await db.visitorJourney.findUnique({ where: { id } })
    : null;
  if (!journey)
    journey = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(83923771)`;
      const setting = await tx.setting.findUnique({
        where: { key: "retargeting" },
      });
      const controlPercent =
        (setting?.value as { controlPercent?: number })?.controlPercent ?? 20;
      return tx.visitorJourney.create({
        data: {
          controlPercent,
          group: randomInt(100) < controlPercent ? "CONTROL" : "TREATMENT",
        },
      });
    });
  res.cookie("sc_journey", token("journey", journey.id, 90 * 86400), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 90 * 86400_000,
  });
  if (req.headers["sec-gpc"] === "1" && journey.privacy !== "DENIED")
    journey = await saveAdvertisingChoice(journey.id, "DENIED", "GPC");
  return journey;
}

export async function saveAdvertisingChoice(
  journeyId: string,
  choice: "GRANTED" | "DENIED",
  source: "CHOICE" | "GPC",
) {
  return db.$transaction(async (tx) => {
    await lockJourney(tx, journeyId);
    await tx.advertisingPrivacyEvent.create({
      data: { journeyId, choice, source, text: ADVERTISING_NOTICE },
    });
    return tx.visitorJourney.update({
      where: { id: journeyId },
      data: { privacy: choice, privacyAt: new Date() },
    });
  });
}
export async function lockJourney(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "VisitorJourney" WHERE id=${id} FOR UPDATE`;
}

export type JourneyFacts = {
  quiz: boolean;
  completed: boolean;
  application: boolean;
  subscribed: boolean;
  paid: boolean;
  verifiedApplication: boolean;
  verifiedSubscription: boolean;
};
export function audienceEligible(a: Audience, facts: JourneyFacts) {
  if (!a.enabled) return false;
  if (a.purpose === "PAID_EXCLUSION") return facts.paid;
  if (facts.paid) return false;
  const events = {
    QUIZ_PARTICIPATED: facts.quiz,
    QUIZ_COMPLETED: facts.completed,
    APPLICATION: facts.application,
    SUBSCRIBED: facts.subscribed,
    PAID: facts.paid,
  };
  const qualifying = {
    ...events,
    APPLICATION: facts.verifiedApplication,
    SUBSCRIBED: facts.verifiedSubscription,
  };
  return (
    a.qualifyingEvents.some((e) => qualifying[e]) &&
    !a.excludeOn.some((e) => events[e]) &&
    (a.applicationStatus === "ANY" ||
      (a.applicationStatus === "STARTED") === facts.application) &&
    (a.subscriptionStatus === "ANY" ||
      (a.subscriptionStatus === "CONFIRMED") === facts.subscribed)
  );
}

export async function journeyFacts(
  tx: Prisma.TransactionClient,
  journeyId: string,
  sourceCampaignIds: string[] = [],
): Promise<JourneyFacts> {
  // Only events on server-verified visits can supply qualifying engagement.
  // Negative outcomes suppress across the entire journey, including unverified returns.
  const visits = await tx.visit.findMany({
    where: {
      journeyId,
      ...(sourceCampaignIds.length
        ? { source: { campaignId: { in: sourceCampaignIds } } }
        : {}),
    },
    select: {
      verifiedAt: true,
      engagementEvents: { select: { kind: true, verifiedAt: true } },
      applications: { select: { postbacks: { select: { event: true } } } },
      leads: {
        select: {
          subscriptions: { select: { confirmedAt: true, status: true } },
        },
      },
    },
  });
  const verified = visits.filter((v) => !!v.verifiedAt);
  return {
    quiz: visits.some((v) =>
      v.engagementEvents.some(
        (e) =>
          ["QUESTION_ANSWERED", "CHANNEL_SELECTED"].includes(e.kind) &&
          !!e.verifiedAt,
      ),
    ),
    completed: visits.some((v) =>
      v.engagementEvents.some(
        (e) => e.kind === "QUIZ_COMPLETED" && !!e.verifiedAt,
      ),
    ),
    application: visits.some((v) => v.applications.length > 0),
    verifiedApplication: visits.some((v) =>
      v.engagementEvents.some(
        (e) => e.kind === "APPLICATION_CONTINUED" && !!e.verifiedAt,
      ),
    ),
    subscribed: visits.some((v) =>
      v.leads.some((l) =>
        l.subscriptions.some((s) => !!s.confirmedAt && s.status === "ACTIVE"),
      ),
    ),
    verifiedSubscription: verified.some((v) =>
      v.leads.some((l) =>
        l.subscriptions.some((s) => !!s.confirmedAt && s.status === "ACTIVE"),
      ),
    ),
    paid: visits.some((v) =>
      v.applications.some((a) => a.postbacks.some((p) => p.event === "SOLD")),
    ),
  };
}

// Both the signed visit token and first-party journey cookie are required by the
// routes. Reservations are serialized with sale callbacks and privacy changes.
export async function qualifyPixels(visitId: string, journeyId: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(83923771)`;
    const config = await retargetingConfiguration(tx);
    const ready =
      config.enabled && validateConfiguration(config).collectionReady;
    await lockJourney(tx, journeyId);
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id=${visitId} FOR UPDATE`;
    const [journey, visit] = await Promise.all([
      tx.visitorJourney.findUniqueOrThrow({ where: { id: journeyId } }),
      tx.visit.findUniqueOrThrow({ where: { id: visitId } }),
    ]);
    if (visit.journeyId !== journeyId)
      throw new Error("Journey does not match this visit");
    const facts = await journeyFacts(tx, journeyId);
    facts.paid ||= !!journey.suppressedAt;
    const audienceFacts = new Map(
      await Promise.all(
        config.audiences.map(
          async (audience) =>
            [
              audience.id,
              audience.sourceCampaignIds.length
                ? {
                    ...(await journeyFacts(
                      tx,
                      journeyId,
                      audience.sourceCampaignIds,
                    )),
                    // Suppression is journey-wide even when qualification is
                    // limited to acquisition campaigns.
                    application: facts.application,
                    subscribed: facts.subscribed,
                    paid: facts.paid,
                  }
                : facts,
            ] as const,
        ),
      ),
    );
    const attempts = await tx.retargetingPixelAttempt.findMany({
      where: { journeyId },
    });
    // Qualifying actions run automatically unless the browser has opted out.
    // UNKNOWN remains unchanged: automatic tracking is not a recorded consent.
    const adsAllowed = journey.privacy !== "DENIED";
    const verified = hasVisitorProof(visit);
    const eligible = config.audiences.filter((a) =>
      audienceEligible(a, audienceFacts.get(a.id) ?? facts),
    );
    // Use the same eligibility definition for both arms, before checking group.
    if (
      ready &&
      adsAllowed &&
      verified &&
      eligible.some((a) => a.purpose !== "PAID_EXCLUSION") &&
      !journey.eligibleAt
    )
      await tx.visitorJourney.update({
        where: { id: journeyId },
        data: { eligibleAt: new Date() },
      });
    const pixels: { id: string; url: string; action: string }[] = [];
    for (const enrollment of attempts.filter((a) => a.action === "ENROLL")) {
      const current = config.audiences.find(
        (a) => a.id === enrollment.audienceId,
      );
      const noLongerEligible =
        !adsAllowed ||
        !config.enabled ||
        !current ||
        !audienceEligible(current, audienceFacts.get(current.id) ?? facts);
      if (!noLongerEligible && !enrollment.suppressionReason) continue;
      const reason = facts.paid
        ? "PAID_LEAD"
        : !adsAllowed
          ? "PRIVACY"
          : "STAGE_OR_CONFIGURATION_CHANGED";
      if (!enrollment.suppressionReason)
        await tx.retargetingPixelAttempt.update({
          where: { id: enrollment.id },
          data: { suppressionReason: reason },
        });
      // Changing privacy to denied must not cause a fresh request to an ad provider.
      // Never attempt a server-side request in place of the visitor's cookie pixel.
      const snapshot = audienceSchema.parse(enrollment.config);
      const removal =
        snapshot.removal ??
        (current?.enrollment.url === snapshot.enrollment.url
          ? current.removal
          : undefined);
      if (
        !adsAllowed ||
        !verified ||
        !removal ||
        attempts.some(
          (a) =>
            a.audienceId === enrollment.audienceId && a.action === "REMOVE",
        )
      )
        continue;
      const attempt = await tx.retargetingPixelAttempt.create({
        data: {
          journeyId,
          visitId,
          audienceId: enrollment.audienceId,
          revision: enrollment.revision,
          config: enrollment.config as Prisma.InputJsonValue,
          action: "REMOVE",
          reason,
        },
      });
      pixels.push({ id: attempt.id, url: removal.url, action: "REMOVE" });
    }
    if (ready && verified && adsAllowed && journey.group === "TREATMENT")
      for (const a of eligible) {
        if (
          attempts.some((x) => x.audienceId === a.id && x.action === "ENROLL")
        )
          continue;
        const stored = await tx.retargetingAudience.findUniqueOrThrow({
          where: { id: a.id },
        });
        const attempt = await tx.retargetingPixelAttempt.create({
          data: {
            journeyId,
            visitId,
            audienceId: a.id,
            revision: stored.revision,
            config: stored.config as Prisma.InputJsonValue,
            action: "ENROLL",
          },
        });
        pixels.push({
          id: attempt.id,
          url: a.enrollment.url,
          action: "ENROLL",
        });
      }
    return {
      pixels,
      verified,
      privacy: journey.privacy,
      reason: !adsAllowed
        ? "ADVERTISING_OPTED_OUT"
        : !verified
          ? "VERIFICATION_REQUIRED"
          : !ready
            ? "SETUP_INCOMPLETE"
            : journey.group === "CONTROL"
              ? "CONTROL"
              : "EVALUATED",
    };
  });
}

export async function refreshJourneySuppression(journeyId: string) {
  await db.$transaction(async (tx) => {
    await lockJourney(tx, journeyId);
    const [config, facts, journey, attempts] = await Promise.all([
      retargetingConfiguration(tx),
      journeyFacts(tx, journeyId),
      tx.visitorJourney.findUniqueOrThrow({ where: { id: journeyId } }),
      tx.retargetingPixelAttempt.findMany({
        where: { journeyId, action: "ENROLL", suppressionReason: null },
      }),
    ]);
    const audienceFacts = new Map(
      await Promise.all(
        config.audiences.map(
          async (audience) =>
            [
              audience.id,
              audience.sourceCampaignIds.length
                ? {
                    ...(await journeyFacts(
                      tx,
                      journeyId,
                      audience.sourceCampaignIds,
                    )),
                    application: facts.application,
                    subscribed: facts.subscribed,
                    paid: facts.paid,
                  }
                : facts,
            ] as const,
        ),
      ),
    );
    for (const attempt of attempts) {
      const audience = config.audiences.find(
        (a) => a.id === attempt.audienceId,
      );
      if (
        journey.privacy === "DENIED" ||
        !config.enabled ||
        !audience ||
        !audienceEligible(audience, audienceFacts.get(audience.id) ?? facts)
      )
        await tx.retargetingPixelAttempt.update({
          where: { id: attempt.id },
          data: {
            suppressionReason: facts.paid
              ? "PAID_LEAD"
              : "STATUS_OR_PRIVACY_CHANGED",
          },
        });
    }
  });
}

export async function reportPixel(
  journeyId: string,
  id: string,
  state: "LOADED" | "FAILED" | "UNCERTAIN",
) {
  const result = await db.retargetingPixelAttempt.updateMany({
    where: { id, journeyId, state: "ISSUED" },
    data: { state, reportedAt: new Date() },
  });
  return { recorded: result.count === 1, confirmedAudienceMembership: false };
}

export async function retargetingStatus() {
  const config = await retargetingConfiguration();
  const [
    attempts,
    verifications,
    rawVisits,
    suppressionPending,
    saleSuppressed,
    controls,
    verificationAttempts,
    recentVerificationFailures,
    recentPixelFailures,
  ] = await Promise.all([
    db.retargetingPixelAttempt.groupBy({
      by: ["action", "state"],
      _count: true,
    }),
    db.visit.groupBy({ by: ["verificationState"], _count: true }),
    db.visit.count(),
    db.retargetingPixelAttempt.count({
      where: { action: "ENROLL", suppressionReason: { not: null } },
    }),
    db.visitorJourney.count({ where: { suppressedAt: { not: null } } }),
    db.visitorJourney.groupBy({ by: ["group"], _count: true }),
    db.visitorVerification.groupBy({ by: ["state"], _count: true }),
    db.visitorVerification.findMany({
      where: { state: { in: ["FAILED", "ERROR"] } },
      take: 20,
      orderBy: { createdAt: "desc" },
      select: { visitId: true, state: true, errors: true, createdAt: true },
    }),
    db.retargetingPixelAttempt.findMany({
      where: { state: { in: ["FAILED", "UNCERTAIN"] } },
      take: 20,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        visitId: true,
        audienceId: true,
        action: true,
        state: true,
        createdAt: true,
      },
    }),
  ]);
  const uncertain = await db.retargetingPixelAttempt.count({
    where: {
      state: "ISSUED",
      createdAt: { lt: new Date(Date.now() - 60_000) },
    },
  });
  return {
    config,
    validation: await validateRetargetingSetup(config),
    rawVisits,
    verifications,
    verificationAttempts,
    recentVerificationFailures,
    recentPixelFailures,
    attempts,
    staleUnacknowledgedAttempts: uncertain,
    suppressedEnrollments: suppressionPending,
    paidJourneysSuppressed: saleSuppressed,
    controls,
    confirmedAudienceMembership: null,
    note: "LOADED means the browser reported loading a resource, not confirmed membership. ISSUED without a receipt is uncertain, never retried automatically. Suppression records do not prove advertiser exclusion.",
  };
}
