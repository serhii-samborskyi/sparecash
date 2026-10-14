import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../config.js";
import { browserContext } from "./visit-context.js";
import type { PropellerAdContext } from "../../shared/propeller-attribution.js";
import {
  advertiserStatistics,
  unavailableAds,
  type AdRow,
} from "./advertiser-statistics.js";
import { clarityReport } from "./clarity.js";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Choose a valid date.");
const id = z.string().regex(/^\d+$/).max(30);
export const statisticsSchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    groupBy: z
      .enum([
        "zone",
        "campaign",
        "landing",
        "country",
        "state",
        "city",
        "device",
        "browser",
        "os",
        "creative",
        "subzone",
        "connection",
        "carrier",
        "language",
        "browserVersion",
        "osVersion",
        "day",
      ])
      .default("zone"),
    campaignId: id.optional(),
    zoneId: id.optional(),
    variantId: z.string().max(100).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    region: z.string().min(1).max(100).optional(),
    city: z.string().min(1).max(100).optional(),
    device: z.enum(["Mobile", "Tablet", "Desktop", "Unknown"]).optional(),
    browser: z.string().min(1).max(50).optional(),
    os: z.string().min(1).max(50).optional(),
    refreshAds: z.boolean().default(false),
  })
  .strict();
export type StatisticsInput = z.input<typeof statisticsSchema>;
type Segment = {
  key: string;
  label: string;
  detail: string;
  filters: Partial<StatisticsInput>;
};
const ratio = (n: number, d: number) => (d ? n / d : null);
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
function counts(segment: Segment) {
  return {
    ...segment,
    visits: 0,
    verified: 0,
    suspectedBots: 0,
    unverified: 0,
    verificationFailed: 0,
    verificationErrors: 0,
    engaged: 0,
    verifiedEngaged: 0,
    quizStarted: 0,
    quizCompleted: 0,
    updatesOpened: 0,
    applicationVisitors: 0,
    applications: 0,
    subscribers: 0,
    activeSubscribers: 0,
    emailSubscribers: 0,
    smsSubscribers: 0,
    pushSubscribers: 0,
    soldVisitors: 0,
    sold: 0,
    revenue: 0,
    locatedVisits: 0,
    recordedClickCost: 0,
    costRecordedVisits: 0,
    impressions: null as number | null,
    adClicks: null as number | null,
    adSpend: null as number | null,
    matchedPaidVisits: 0,
    claritySessions: null as number | null,
    clarityHumanSessions: null as number | null,
    clarityBotSessions: null as number | null,
    clarityPagesPerSessionWeighted: 0,
  };
}
type Counts = ReturnType<typeof counts>;
function propellerContext(value: Prisma.JsonValue): PropellerAdContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ) as PropellerAdContext;
}
function finish(row: Counts) {
  const { clarityPagesPerSessionWeighted, ...visible } = row;
  const comparableCosts =
    row.adSpend !== null &&
    row.visits > 0 &&
    row.matchedPaidVisits === row.visits;
  return {
    ...visible,
    revenue: rounded(row.revenue),
    recordedClickCost: rounded(row.recordedClickCost),
    adSpend: row.adSpend === null ? null : rounded(row.adSpend),
    verifiedRate: ratio(row.verified, row.visits),
    botRate: ratio(row.suspectedBots, row.visits),
    unverifiedRate: ratio(row.unverified, row.visits),
    engagementRate: ratio(row.engaged, row.visits),
    verifiedEngagementRate: ratio(row.verifiedEngaged, row.verified),
    quizCompletionRate: ratio(row.quizCompleted, row.quizStarted),
    applicationRate: ratio(row.applicationVisitors, row.visits),
    subscriptionRate: ratio(row.subscribers, row.visits),
    saleRate: ratio(row.soldVisitors, row.visits),
    revenuePerVisit: ratio(row.revenue, row.visits),
    ctr:
      row.adClicks !== null && row.impressions !== null
        ? ratio(row.adClicks, row.impressions)
        : null,
    cpc:
      row.adSpend !== null && row.adClicks !== null
        ? ratio(row.adSpend, row.adClicks)
        : null,
    costPerSubscriber: comparableCosts
      ? ratio(row.adSpend!, row.subscribers)
      : null,
    costPerSale: comparableCosts ? ratio(row.adSpend!, row.sold) : null,
    adContribution: comparableCosts
      ? rounded(row.revenue - row.adSpend!)
      : null,
    returnOnAdSpend: comparableCosts ? ratio(row.revenue, row.adSpend!) : null,
    clarityBotRate:
      row.claritySessions === null
        ? null
        : ratio(row.clarityBotSessions ?? 0, row.claritySessions),
    clarityPagesPerSession:
      row.claritySessions === null
        ? null
        : ratio(clarityPagesPerSessionWeighted, row.claritySessions),
  };
}

function addClarity(
  target: Counts,
  row: {
    sessions: number;
    humanSessions: number;
    botSessions: number;
    pagesPerSession: number;
  },
) {
  target.claritySessions = (target.claritySessions ?? 0) + row.sessions;
  target.clarityHumanSessions =
    (target.clarityHumanSessions ?? 0) + row.humanSessions;
  target.clarityBotSessions =
    (target.clarityBotSessions ?? 0) + row.botSessions;
  target.clarityPagesPerSessionWeighted += row.pagesPerSession * row.sessions;
}

export async function statisticsReport(input: StatisticsInput = {}) {
  const query = statisticsSchema.parse(input);
  const observedAt = new Date();
  const today = observedAt.toISOString().slice(0, 10);
  const to = query.to ?? today;
  const from =
    query.from ??
    new Date(new Date(to).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  if (
    from > to ||
    to > today ||
    new Date(to).getTime() - new Date(from).getTime() > 92 * 86400000
  )
    throw new Error(
      "Choose a reporting period of up to 93 days ending today or earlier.",
    );
  const end = new Date(
    Math.min(new Date(to).getTime() + 86400000, observedAt.getTime()),
  );
  const where: Prisma.VisitWhereInput = {
    createdAt: { gte: new Date(from), lt: end },
    ...(query.campaignId || query.zoneId
      ? { source: { campaignId: query.campaignId, zoneId: query.zoneId } }
      : {}),
    ...(query.variantId ? { variantId: query.variantId } : {}),
    ...(query.country ? { country: query.country } : {}),
    ...(query.region ? { region: query.region } : {}),
    ...(query.city ? { city: query.city } : {}),
  };
  const allVisits = await db.visit.findMany({
    where,
    take: 50001,
    select: {
      id: true,
      createdAt: true,
      verified: true,
      verificationState: true,
      botScore: true,
      country: true,
      region: true,
      city: true,
      userAgent: true,
      adContext: true,
      cost: true,
      costRecorded: true,
      source: { select: { campaignId: true, zoneId: true } },
      variantId: true,
      variant: {
        select: { name: true, experiment: { select: { name: true } } },
      },
      engagementEvents: {
        where: { createdAt: { lte: observedAt } },
        select: { kind: true },
      },
      leads: {
        select: {
          subscriptions: {
            where: { confirmedAt: { lte: observedAt } },
            select: { channel: true, status: true },
          },
        },
      },
      applications: {
        where: { createdAt: { lte: observedAt } },
        select: {
          id: true,
          postbacks: {
            where: { event: "SOLD", createdAt: { lte: observedAt } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { revenue: true },
          },
        },
      },
    },
  });
  if (allVisits.length > 50000)
    throw new Error(
      "More than 50,000 visits match this report. Narrow the dates or campaign; no partial totals were returned.",
    );
  const visits = allVisits
    .map((v) => ({
      ...v,
      propeller: propellerContext(v.adContext),
      ...browserContext(v.userAgent),
    }))
    .filter(
      (v) =>
        (!query.device || v.device === query.device) &&
        (!query.browser || v.browser === query.browser) &&
        (!query.os || v.os === query.os),
    );
  const trackedCampaigns = await db.trafficSource.findMany({
    distinct: ["campaignId"],
    select: { campaignId: true },
  });
  const campaignIds = query.campaignId
    ? [query.campaignId]
    : trackedCampaigns
        .map((s) => s.campaignId)
        .filter((s) => {
          const campaignId = Number(s);
          return (
            /^\d+$/.test(s) &&
            Number.isSafeInteger(campaignId) &&
            campaignId > 0
          );
        })
        .sort();
  const supported =
    ["zone", "campaign", "country", "day"].includes(query.groupBy) &&
    !query.variantId &&
    !query.region &&
    !query.city &&
    !query.device &&
    !query.browser &&
    !query.os;
  const [ads, clarity] = await Promise.all([
    supported
      ? advertiserStatistics(
          {
            from,
            to,
            campaignIds,
            zoneId: query.zoneId,
            country: query.country,
          },
          query.refreshAds,
        )
      : Promise.resolve({
          ...unavailableAds(
            "Ad CTR and spend are available for zones, campaigns, countries and days without landing, state, city or device filters. Other views show measured landing activity.",
          ),
          status: "unsupported" as const,
        }),
    clarityReport(),
  ]);
  const groups = new Map<string, Counts>();
  const summary = counts({
    key: "total",
    label: "All traffic",
    detail: "",
    filters: {},
  });
  const make = (
    values: (string | null | undefined)[],
    label: string,
    detail = "",
    filters: Partial<StatisticsInput> = {},
  ): Segment => ({ key: JSON.stringify(values), label, detail, filters });
  function segment(v: (typeof visits)[number]): Segment {
    const campaign = v.source?.campaignId,
      zone = v.source?.zoneId;
    switch (query.groupBy) {
      case "zone":
        return make(
          [campaign, zone],
          zone ? `Zone ${zone}` : "Unattributed",
          campaign ? `Campaign ${campaign}` : "No campaign or zone",
          { campaignId: campaign, zoneId: zone },
        );
      case "campaign":
        return make(
          [campaign],
          campaign ? `Campaign ${campaign}` : "Unattributed",
          "",
          { campaignId: campaign },
        );
      case "landing":
        return make([v.variantId], v.variant.name, v.variant.experiment.name, {
          variantId: v.variantId,
        });
      case "country":
        return make(
          [v.country],
          v.country ?? "Unknown",
          "",
          v.country ? { country: v.country } : {},
        );
      case "state":
        return make(
          [v.country, v.region],
          v.region ?? "Unknown state",
          v.country ?? "Unknown country",
          { country: v.country ?? undefined, region: v.region ?? undefined },
        );
      case "city":
        return make(
          [v.country, v.region, v.city],
          v.city ?? "Unknown city",
          [v.region, v.country].filter(Boolean).join(", ") ||
            "No location recorded",
          {
            country: v.country ?? undefined,
            region: v.region ?? undefined,
            city: v.city ?? undefined,
          },
        );
      case "day":
        return make(
          [v.createdAt.toISOString().slice(0, 10)],
          v.createdAt.toISOString().slice(0, 10),
        );
      case "creative":
        return make(
          [v.propeller.bannerId],
          v.propeller.bannerId
            ? `Creative ${v.propeller.bannerId}`
            : "Unknown creative",
          campaign ? `Campaign ${campaign}` : "",
        );
      case "subzone":
        return make(
          [v.propeller.subzoneId],
          v.propeller.subzoneId
            ? `Subzone ${v.propeller.subzoneId}`
            : "Unknown subzone",
          zone ? `Zone ${zone}` : "",
        );
      case "connection":
        return make(
          [v.propeller.connectionType],
          v.propeller.connectionType ?? "Unknown connection",
        );
      case "carrier":
        return make(
          [v.propeller.carrier],
          v.propeller.carrier ?? "Unknown carrier",
        );
      case "language":
        return make(
          [v.propeller.language],
          v.propeller.language ?? "Unknown language",
        );
      case "browserVersion":
        return make(
          [v.propeller.browser, v.propeller.browserVersion],
          [v.propeller.browser, v.propeller.browserVersion]
            .filter(Boolean)
            .join(" ") || "Unknown browser version",
        );
      case "osVersion":
        return make(
          [v.propeller.os, v.propeller.osVersion],
          [v.propeller.os, v.propeller.osVersion].filter(Boolean).join(" ") ||
            "Unknown OS version",
        );
      default:
        return make([v[query.groupBy]], v[query.groupBy], "", {
          [query.groupBy]: v[query.groupBy],
        });
    }
  }
  function group(s: Segment) {
    if (!groups.has(s.key)) groups.set(s.key, counts(s));
    return groups.get(s.key)!;
  }
  function adSegment(a: AdRow) {
    switch (query.groupBy) {
      case "zone":
        return make(
          [a.campaignId, a.zoneId],
          `Zone ${a.zoneId}`,
          a.campaignName,
          { campaignId: a.campaignId, zoneId: a.zoneId },
        );
      case "campaign":
        return make(
          [a.campaignId],
          a.campaignName,
          `Campaign ${a.campaignId}`,
          { campaignId: a.campaignId },
        );
      case "country":
        return make([a.country], a.country, "", { country: a.country });
      default:
        return make([a.day], a.day);
    }
  }
  const adScopes = new Set(
    ads.rows.map((a) =>
      JSON.stringify([a.campaignId, a.zoneId, a.country, a.day]),
    ),
  );
  const adZoneScopes = new Set(
    ads.rows.map((a) => JSON.stringify([a.campaignId, a.zoneId, a.day])),
  );
  for (const visit of visits) {
    const row = group(segment(visit));
    const events = new Set(visit.engagementEvents.map((e) => e.kind));
    const subs = visit.leads.flatMap((l) => l.subscriptions);
    const quiz = events.has("QUESTION_ANSWERED");
    const engaged = quiz || visit.applications.length > 0 || subs.length > 0;
    const sold = visit.applications.filter((a) => a.postbacks.length > 0);
    const matched =
      ["country"].includes(query.groupBy) || query.country
        ? adScopes.has(
            JSON.stringify([
              visit.source?.campaignId,
              visit.source?.zoneId,
              visit.country,
              visit.createdAt.toISOString().slice(0, 10),
            ]),
          )
        : adZoneScopes.has(
            JSON.stringify([
              visit.source?.campaignId,
              visit.source?.zoneId,
              visit.createdAt.toISOString().slice(0, 10),
            ]),
          );
    for (const target of [row, summary]) {
      target.visits++;
      if (visit.verified) target.verified++;
      else if (visit.botScore >= 70) target.suspectedBots++;
      else target.unverified++;
      if (visit.verificationState === "FAILED") target.verificationFailed++;
      if (visit.verificationState === "ERROR") target.verificationErrors++;
      if (engaged) target.engaged++;
      if (engaged && visit.verified) target.verifiedEngaged++;
      if (quiz) target.quizStarted++;
      if (events.has("QUIZ_COMPLETED")) target.quizCompleted++;
      if (events.has("UPDATES_OPENED")) target.updatesOpened++;
      if (visit.applications.length) target.applicationVisitors++;
      target.applications += visit.applications.length;
      if (subs.length) target.subscribers++;
      if (subs.some((s) => s.status === "ACTIVE")) target.activeSubscribers++;
      if (subs.some((s) => s.channel === "EMAIL")) target.emailSubscribers++;
      if (subs.some((s) => s.channel === "SMS")) target.smsSubscribers++;
      if (subs.some((s) => s.channel === "PUSH")) target.pushSubscribers++;
      if (sold.length) target.soldVisitors++;
      target.sold += sold.length;
      target.revenue += sold.reduce(
        (sum, a) => sum + Number(a.postbacks[0].revenue),
        0,
      );
      if (visit.country) target.locatedVisits++;
      if (visit.costRecorded) {
        target.costRecordedVisits++;
        target.recordedClickCost += Number(visit.cost);
      }
      if (matched) target.matchedPaidVisits++;
    }
  }
  if (["ready", "stale"].includes(ads.status)) {
    summary.impressions = summary.adClicks = summary.adSpend = 0;
    for (const ad of ads.rows) {
      const s = adSegment(ad),
        row = group(s);
      row.label = s.label;
      row.detail = s.detail;
      for (const target of [row, summary]) {
        target.impressions = (target.impressions ?? 0) + ad.impressions;
        target.adClicks = (target.adClicks ?? 0) + ad.clicks;
        target.adSpend = (target.adSpend ?? 0) + ad.spend;
      }
    }
  }
  const clarityAligned =
    ["zone", "campaign"].includes(query.groupBy) &&
    !query.variantId &&
    !query.country &&
    !query.region &&
    !query.city &&
    !query.device &&
    !query.browser &&
    !query.os;
  const scopedClarityZones = clarity.zones.filter(
    (row) =>
      (!query.campaignId || row.campaignId === query.campaignId) &&
      (!query.zoneId || row.zoneId === query.zoneId),
  );
  if (clarityAligned) {
    for (const clarityZone of scopedClarityZones) {
      const segment =
        query.groupBy === "zone"
          ? make(
              [clarityZone.campaignId, clarityZone.zoneId],
              `Zone ${clarityZone.zoneId}`,
              `Campaign ${clarityZone.campaignId}`,
              {
                campaignId: clarityZone.campaignId,
                zoneId: clarityZone.zoneId,
              },
            )
          : make(
              [clarityZone.campaignId],
              `Campaign ${clarityZone.campaignId}`,
              "",
              { campaignId: clarityZone.campaignId },
            );
      addClarity(group(segment), clarityZone);
      addClarity(summary, clarityZone);
    }
  }
  const clarityAttributedSessions = clarity.zones.reduce(
    (total, row) => total + row.sessions,
    0,
  );
  const clarityBotSessions = clarity.zones.reduce(
    (total, row) => total + row.botSessions,
    0,
  );
  const clarityHumanSessions = clarity.zones.reduce(
    (total, row) => total + row.humanSessions,
    0,
  );
  const clarityPagesWeighted = clarity.zones.reduce(
    (total, row) => total + row.pagesPerSession * row.sessions,
    0,
  );
  const clarityStatus = !clarity.configured
    ? "unavailable"
    : !clarity.snapshot || clarity.snapshot.rowCount === 0
      ? "empty"
      : Date.now() - clarity.snapshot.fetchedAt.getTime() > 26 * 3600000
        ? "stale"
        : "ready";
  const nextClarityRefreshAt = clarity.snapshot
    ? new Date(clarity.snapshot.fetchedAt.getTime() + 3 * 3600000).toISOString()
    : null;
  const variants = [
    ...new Map(
      allVisits.map((v) => [
        v.variantId,
        {
          id: v.variantId,
          name: `${v.variant.experiment.name} · ${v.variant.name}`,
        },
      ]),
    ).values(),
  ];
  const locationCaptured = visits.filter(
    (v) =>
      v.country &&
      (query.groupBy === "city"
        ? v.city
        : query.groupBy === "state"
          ? v.region
          : true),
  ).length;
  return {
    window: { from, to, timezone: "UTC", observedAt: observedAt.toISOString() },
    groupBy: query.groupBy,
    advertiser: {
      status: ads.status,
      message: ads.message,
      fetchedAt: ads.fetchedAt,
      campaignIds,
    },
    clarity: {
      status: clarityStatus,
      message:
        clarityStatus === "unavailable"
          ? "Connect Microsoft Clarity in Integrations to add session quality evidence."
          : clarityStatus === "empty"
            ? "Clarity is connected and waiting for processed sessions."
            : clarityStatus === "stale"
              ? "The latest Clarity import is older than 26 hours."
              : "Latest Microsoft Clarity session quality export.",
      snapshot: clarity.snapshot,
      summary: {
        attributedSessions: clarityAttributedSessions,
        humanSessions: clarityHumanSessions,
        botSessions: clarityBotSessions,
        botRate: ratio(clarityBotSessions, clarityAttributedSessions),
        pagesPerSession: ratio(clarityPagesWeighted, clarityAttributedSessions),
        unattributedSessions: clarity.unattributedSessions,
      },
      aligned: clarityAligned,
      alignmentMessage: clarityAligned
        ? "Clarity rows are matched by the campaign_id and zone_id captured in landing URLs."
        : "Choose Campaign or Zone without landing, location, device, browser or OS filters to compare Clarity by source.",
      refreshAvailable:
        clarity.configured &&
        (!nextClarityRefreshAt ||
          Date.now() >= Date.parse(nextClarityRefreshAt)),
      nextRefreshAt: nextClarityRefreshAt,
    },
    location: {
      configured: !!env.CLOUDFLARE_GEO_TOKEN,
      captured: locationCaptured,
      missing: summary.visits - locationCaptured,
    },
    options: {
      campaigns: [
        ...new Set([...campaignIds, ...ads.rows.map((a) => a.campaignId)]),
      ],
      variants,
    },
    summary: finish(summary),
    rows: [...groups.values()]
      .map(finish)
      .sort(
        (a, b) =>
          b.visits - a.visits ||
          (b.adClicks ?? 0) - (a.adClicks ?? 0) ||
          a.key.localeCompare(b.key),
      ),
    definitions: {
      visits:
        "Recorded visit sessions, not unique people. New advertising clicks can create new visits.",
      verified:
        "Latest recorded browser verification passed. Verification is a quality signal, not guaranteed human identity. Legacy verified visits are included.",
      suspectedBots:
        "Unverified visits with bot score ≥70 from recorded abuse evidence. Failed checks, timeouts and unfinished checks alone do not mean bots.",
      engagement:
        "Unique visits with a quiz answer, a server-recorded application click, or a confirmed subscription, divided by all visits. Opening updates alone is excluded.",
      subscriptions:
        "Unique visits with at least one confirmed subscription, divided by all visits. Multiple channels count once. Later opt-outs remain in the confirmed rate.",
      ctr: "PropellerAds clicks ÷ impressions. Recomputed from totals, never averaged from row percentages. Ad clicks and tracked visits are different counts.",
      revenue:
        "Earliest SOLD commission per application, including follow-ups attributed to the original visit. Purchased leads are not funded loans.",
      costs:
        "PropellerAds spend is separate from recorded click costs. Cost per subscriber and ROAS require advertiser scope matching for every visit in the row. No estimated allocation to cities, devices or landing variants.",
      geography:
        "Approximate IP location from trusted edge headers. Missing historical locations stay unknown. Browser and device categories come from the stored user agent.",
      propellerAttribution:
        "Creative, subzone, carrier, connection, language and version breakdowns use URL tokens supplied by PropellerAds. They are attribution metadata, not security evidence. URL-declared cost is retained for reconciliation but never booked as trusted spend.",
      window:
        "Visits and advertiser impressions/clicks use the selected UTC dates. Subscription and sale outcomes are observed through report time. Recent visits have had less time to convert; current-day advertiser totals can change.",
      clarity:
        "Microsoft Clarity reports a separate rolling export window. Human and bot session estimates are supporting evidence, not proof. Clarity columns are only aligned for unfiltered campaign and zone views; empty values mean unavailable, not zero.",
    },
  };
}
export type StatisticsReport = Awaited<ReturnType<typeof statisticsReport>>;
