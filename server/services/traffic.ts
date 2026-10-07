import { db } from "../db.js";
import { env } from "../config.js";
import { sourceDecision } from "../domain.js";
import { settings, audit } from "./control.js";
import { excludeZone } from "./providers.js";
export async function sources() {
  const config = await settings();
  const since = new Date(Date.now() - config.lookbackDays * 86400000);
  const [list, totals, bad, verified, subscriptions] = await Promise.all([
    db.trafficSource.findMany({
      include: { actions: { take: 3, orderBy: { createdAt: "desc" } } },
    }),
    db.visit.groupBy({
      by: ["sourceId"],
      where: { createdAt: { gte: since } },
      _count: true,
      _min: { createdAt: true },
    }),
    db.visit.groupBy({
      by: ["sourceId"],
      where: {
        createdAt: { gte: since },
        botScore: { gte: 70 },
        verified: false,
      },
      _count: true,
    }),
    db.visit.groupBy({
      by: ["sourceId"],
      where: { createdAt: { gte: since }, verified: true },
      _count: true,
    }),
    db.$queryRaw<
      { sourceId: string; count: bigint }[]
    >`SELECT v."sourceId", COUNT(*) AS count FROM "Subscription" s JOIN "Lead" l ON l.id=s."leadId" JOIN "Visit" v ON v.id=l."visitId" WHERE s.status='ACTIVE' AND v."createdAt">=${since} GROUP BY v."sourceId"`,
  ]);
  const totalMap = new Map(totals.map((v) => [v.sourceId, v])),
    badMap = new Map(bad.map((v) => [v.sourceId, v._count])),
    verifiedMap = new Map(verified.map((v) => [v.sourceId, v._count])),
    subMap = new Map(subscriptions.map((v) => [v.sourceId, Number(v.count)]));
  return list
    .map((source) => {
      const counts = totalMap.get(source.id);
      return {
        ...source,
        verified: verifiedMap.get(source.id) ?? 0,
        subscribers: subMap.get(source.id) ?? 0,
        ...sourceDecision(
          {
            total: counts?._count ?? 0,
            bad: badMap.get(source.id) ?? 0,
            oldest: counts?._min.createdAt ?? new Date(),
          },
          config,
        ),
      };
    })
    .sort((a, b) => b.lower - a.lower);
}
export async function blockSource(id: string, actor: string) {
  const source = (await sources()).find((s) => s.id === id);
  if (!source) throw new Error("Source not found");
  if (source.state === "BLOCKED") return { status: "already_blocked" };
  const evidence = {
    total: source.total,
    bad: source.bad,
    rate: source.rate,
    lower: source.lower,
  };
  if (!source.eligible)
    throw new Error("Source does not meet the configured evidence threshold");
  if (env.LIVE_SOURCE_BLOCKING !== "true") {
    await db.trafficSource.update({
      where: { id },
      data: {
        state: "RECOMMENDED",
        reason: "Evidence threshold reached; live blocking disabled",
      },
    });
    if (!source.actions.some((a) => a.status === "DRY_RUN"))
      await db.sourceAction.create({
        data: {
          sourceId: id,
          action: "EXCLUDE_ZONE",
          status: "DRY_RUN",
          evidence,
        },
      });
    return { status: "dry_run", evidence };
  }
  const action = await db.sourceAction.create({
    data: { sourceId: id, action: "EXCLUDE_ZONE", status: "PENDING", evidence },
  });
  try {
    await excludeZone(source.campaignId, source.zoneId);
    await db.$transaction([
      db.trafficSource.update({
        where: { id },
        data: {
          state: "BLOCKED",
          blockedAt: new Date(),
          reason: "Bot evidence exceeded configured threshold",
        },
      }),
      db.sourceAction.update({
        where: { id: action.id },
        data: { status: "APPLIED" },
      }),
    ]);
    await audit(actor, "source.blocked", id, evidence);
    return { status: "blocked", evidence };
  } catch (error) {
    await db.sourceAction.update({
      where: { id: action.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Provider failure",
      },
    });
    throw error;
  }
}
export async function evaluateSources() {
  const config = await settings();
  if (!config.sourceAutomation) return { evaluated: 0 };
  const candidates = (await sources())
    .filter(
      (s) =>
        s.state !== "BLOCKED" &&
        s.eligible &&
        (!s.actions[0] ||
          s.actions[0].createdAt.getTime() < Date.now() - 3600000),
    )
    .slice(0, config.maxBlocksPerRun);
  for (const candidate of candidates) {
    try {
      await blockSource(candidate.id, "worker");
    } catch {
      /* Detailed failure retained on SourceAction. */
    }
  }
  return { evaluated: candidates.length };
}
