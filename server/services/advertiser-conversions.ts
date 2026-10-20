import { env } from "../config.js";
import { db } from "../db.js";

const BATCH_SIZE = 20;

function deliveryUrl(input: {
  externalClickId: string;
  goal: number;
  payout: { toString(): string };
}) {
  const url = new URL(env.PROPELLER_POSTBACK_URL);
  url.searchParams.set("visitor_id", input.externalClickId);
  if (input.goal === 1) url.searchParams.delete("goal");
  else url.searchParams.set("goal", String(input.goal));
  url.searchParams.set("payout", input.payout.toString());
  return url;
}

export async function processAdvertiserConversions() {
  if (!env.PROPELLER_POSTBACK_URL)
    return { advertiserConversionsSent: 0, advertiserConversionsPending: 0 };

  await db.advertiserConversion.updateMany({
    where: {
      status: "SENDING",
      attemptedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: {
      status: "UNCERTAIN",
      error: "Worker interrupted; check PropellerAds before resolving",
    },
  });
  const due = await db.advertiserConversion.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  let sent = 0;
  for (const conversion of due) {
    const attemptNumber = conversion.attempts + 1;
    const claimed = await db.advertiserConversion.updateMany({
      where: { id: conversion.id, status: "PENDING" },
      data: {
        status: "SENDING",
        attempts: { increment: 1 },
        attemptedAt: new Date(),
        error: null,
      },
    });
    if (!claimed.count) continue;
    const attempt = await db.advertiserConversionAttempt.create({
      data: {
        conversionId: conversion.id,
        attempt: attemptNumber,
        outcome: "SENDING",
      },
    });
    try {
      const response = await fetch(deliveryUrl(conversion), {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "text/plain, application/json" },
      });
      if (!response.ok) {
        const status =
          response.status >= 400 && response.status < 500
            ? "FAILED"
            : "UNCERTAIN";
        const error = `PropellerAds returned HTTP ${response.status}`;
        await db.advertiserConversion.update({
          where: { id: conversion.id },
          data: {
            status,
            error,
          },
        });
        await db.advertiserConversionAttempt.update({
          where: { id: attempt.id },
          data: {
            outcome: status,
            httpStatus: response.status,
            error,
            completedAt: new Date(),
          },
        });
        continue;
      }
      await db.advertiserConversion.update({
        where: { id: conversion.id },
        data: { status: "SENT", sentAt: new Date(), error: null },
      });
      await db.advertiserConversionAttempt.update({
        where: { id: attempt.id },
        data: {
          outcome: "SENT",
          httpStatus: response.status,
          completedAt: new Date(),
        },
      });
      sent++;
    } catch {
      // A timeout can occur after the provider accepted the request. Do not
      // automatically retry a non-idempotent advertiser conversion.
      await db.advertiserConversion.update({
        where: { id: conversion.id },
        data: {
          status: "UNCERTAIN",
          error:
            "Postback outcome is uncertain; check PropellerAds before retrying",
        },
      });
      await db.advertiserConversionAttempt.update({
        where: { id: attempt.id },
        data: {
          outcome: "UNCERTAIN",
          error:
            "Postback outcome is uncertain; check PropellerAds before retrying",
          completedAt: new Date(),
        },
      });
    }
  }
  return {
    advertiserConversionsSent: sent,
    advertiserConversionsPending: await db.advertiserConversion.count({
      where: { status: "PENDING" },
    }),
  };
}

export async function requeueAdvertiserConversions(input: {
  goal: 1 | 2 | 3;
  externalClickIds: string[];
  actor: string;
  reason: string;
}) {
  const externalClickIds = [...new Set(input.externalClickIds)];
  const existing = await db.advertiserConversion.findMany({
    where: {
      goal: input.goal,
      externalClickId: { in: externalClickIds },
    },
    select: { id: true, externalClickId: true, status: true, attempts: true },
  });
  await db.$transaction([
    db.advertiserConversion.updateMany({
      where: { id: { in: existing.map((item) => item.id) } },
      data: {
        status: "PENDING",
        attemptedAt: null,
        sentAt: null,
        error: `Manual replay requested: ${input.reason}`,
      },
    }),
    db.auditLog.create({
      data: {
        actor: input.actor,
        action: "advertiser_conversions.requeued",
        details: {
          goal: input.goal,
          reason: input.reason,
          requested: externalClickIds.length,
          matched: existing.length,
          previous: existing.map((item) => ({
            externalClickId: item.externalClickId,
            status: item.status,
            attempts: item.attempts,
          })),
        },
      },
    }),
  ]);
  return {
    requested: externalClickIds.length,
    requeued: existing.length,
    missing: externalClickIds.filter(
      (id) => !existing.some((item) => item.externalClickId === id),
    ),
  };
}
