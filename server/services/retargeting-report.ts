import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(`${v}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === v
    );
  }, "Use a valid UTC calendar day");
export const spendSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            campaignId: z.string().regex(/^\d+$/).max(30),
            day,
            amount: z.number().finite().min(0).max(999_999.999999),
            currency: z.literal("USD"),
            reference: z.string().min(5).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export async function recordRetargetingSpend(raw: unknown) {
  const input = spendSchema.parse(raw);
  if (
    new Set(input.rows.map((r) => `${r.campaignId}:${r.day}`)).size !==
    input.rows.length
  )
    throw new Error("One total per campaign and UTC day is required");
  if (input.rows.some((r) => r.day > new Date().toISOString().slice(0, 10)))
    throw new Error("Spend cannot be imported for a future day");
  await db.$transaction(async (tx) => {
    for (const row of input.rows)
      await tx.retargetingSpend.upsert({
        where: { campaignId_day: { campaignId: row.campaignId, day: row.day } },
        create: row,
        update: row,
      });
    await tx.auditLog.create({
      data: {
        actor: "mcp",
        action: "retargeting.spend",
        details: {
          rows: input.rows.length,
          references: [...new Set(input.rows.map((r) => r.reference))],
        },
      },
    });
  });
  return {
    imported: input.rows.length,
    mode: "Replace campaign/day totals, never add them to per-click costs. Include zero-spend days to establish coverage.",
  };
}
export const retargetingReportSchema = z
  .object({
    from: day.optional(),
    through: day.optional(),
    groupBy: z
      .enum(["campaign", "audience", "original_angle", "group", "zone"])
      .default("campaign"),
    observationDays: z.number().int().min(1).max(90).default(7),
  })
  .strict();

type Sale = {
  id: string;
  applicationId: string;
  event: string;
  createdAt: Date;
  revenue: Prisma.Decimal;
};
// RoundSky can retry with/without transaction IDs; count one sale per application.
// APPROVED/FUNDED updates are not additional sales or additional commission.
export function deduplicateSales(postbacks: Sale[]) {
  const byApplication = new Map<string, Sale>();
  let repeatedSaleEvents = 0;
  for (const p of [...postbacks].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )) {
    if (p.event !== "SOLD") continue;
    if (byApplication.has(p.applicationId)) {
      repeatedSaleEvents++;
      continue;
    }
    byApplication.set(p.applicationId, p);
  }
  return {
    paidLeads: byApplication.size,
    commission: [...byApplication.values()]
      .reduce((total, p) => total.add(p.revenue), new Prisma.Decimal(0))
      .toNumber(),
    repeatedSaleEvents,
  };
}

const visitInclude = {
  source: true,
  variant: { select: { id: true, name: true } },
  journey: {
    select: {
      group: true,
      eligibleAt: true,
      visits: {
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
        take: 1,
        select: { id: true, variantId: true, createdAt: true },
      },
    },
  },
  engagementEvents: { select: { kind: true, verifiedAt: true } },
  applications: { include: { postbacks: true } },
  leads: { include: { subscriptions: true } },
} satisfies Prisma.VisitInclude;
type ReportVisit = Prisma.VisitGetPayload<{ include: typeof visitInclude }>;

export async function retargetingReport(raw: unknown) {
  const input = retargetingReportSchema.parse(raw),
    now = new Date();
  const from =
    input.from ??
    new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const through = input.through ?? now.toISOString().slice(0, 10);
  const start = new Date(`${from}T00:00:00Z`),
    end = new Date(new Date(`${through}T00:00:00Z`).getTime() + 86400_000);
  const days = Math.round((end.getTime() - start.getTime()) / 86400_000);
  if (
    days < 1 ||
    days > 90 ||
    start > now ||
    through > now.toISOString().slice(0, 10)
  )
    throw new Error("Choose a past/current window of 1–90 UTC calendar days");
  const where = { createdAt: { gte: start, lt: end } };
  if ((await db.visit.count({ where })) > 20_000)
    throw new Error(
      "Narrow the report window to at most 20,000 visits; totals are never truncated.",
    );
  const [visits, spend] = await Promise.all([
    db.visit.findMany({ where, include: visitInclude }),
    db.retargetingSpend.findMany({
      where: { day: { gte: from, lte: through } },
    }),
  ]);
  const rows = new Map<string, ReportVisit[]>();
  for (const v of visits) {
    const key =
      input.groupBy === "zone"
        ? v.source
          ? `${v.source.campaignId}:${v.source.zoneId}`
          : "DIRECT_OR_UNKNOWN"
        : input.groupBy === "campaign"
          ? (v.source?.campaignId ??
            v.retargetingCampaignId ??
            "DIRECT_OR_UNKNOWN")
          : input.groupBy === "audience"
            ? (v.retargetingAudienceId ?? "ACQUISITION_OR_UNMAPPED")
            : input.groupBy === "original_angle"
              ? (v.journey?.visits[0]?.variantId ?? `UNLINKED:${v.variantId}`)
              : (v.journey?.group ?? "UNLINKED");
    rows.set(key, [...(rows.get(key) ?? []), v]);
  }
  if (input.groupBy === "campaign")
    for (const row of spend)
      if (!rows.has(row.campaignId)) rows.set(row.campaignId, []);
  const result = [...rows].map(([key, cohort]) => {
    const sales = deduplicateSales(
      cohort.flatMap((v) => v.applications.flatMap((a) => a.postbacks)),
    );
    const subscriptions = new Set(
      cohort.flatMap((v) =>
        v.leads.flatMap((l) =>
          l.subscriptions.filter((s) => !!s.confirmedAt).map((s) => s.id),
        ),
      ),
    );
    const campaignSpend =
      input.groupBy === "campaign"
        ? spend.filter((s) => s.campaignId === key)
        : [];
    const complete =
      input.groupBy === "campaign" && campaignSpend.length === days;
    const importedSpend = campaignSpend
      .reduce((sum, s) => sum.add(s.amount), new Prisma.Decimal(0))
      .toNumber();
    return {
      key,
      rawVisits: cohort.length,
      verifiedVisits: cohort.filter((v) => v.verificationState === "VERIFIED")
        .length,
      everVerifiedVisits: cohort.filter((v) => !!v.verifiedAt).length,
      verifiedEngagedVisits: cohort.filter((v) =>
        v.engagementEvents.some(
          (e) =>
            !!e.verifiedAt &&
            ["QUESTION_ANSWERED", "APPLICATION_CONTINUED"].includes(e.kind),
        ),
      ).length,
      verificationFailed: cohort.filter((v) => v.verificationState === "FAILED")
        .length,
      verificationErrors: cohort.filter((v) => v.verificationState === "ERROR")
        .length,
      unverifiedVisits: cohort.filter(
        (v) => !["VERIFIED", "FAILED", "ERROR"].includes(v.verificationState),
      ).length,
      verifiedReturnVisits: cohort.filter(
        (v) =>
          !!v.verifiedAt && !!v.journey && v.journey.visits[0]?.id !== v.id,
      ).length,
      retargetingClicks: cohort.filter((v) => !!v.retargetingCampaignId).length,
      applicationClicks: cohort.reduce((n, v) => n + v.applications.length, 0),
      confirmedSubscriptions: subscriptions.size,
      ...sales,
      spend: complete ? importedSpend : null,
      knownImportedSpend: input.groupBy === "campaign" ? importedSpend : null,
      spendCoverage:
        input.groupBy === "campaign"
          ? { recordedDays: campaignSpend.length, requiredDays: days }
          : null,
      paidLeadAcquisitionCost:
        complete && sales.paidLeads ? importedSpend / sales.paidLeads : null,
      subscriptionAcquisitionCost:
        complete && subscriptions.size
          ? importedSpend / subscriptions.size
          : null,
    };
  });
  const matureBefore = new Date(
    now.getTime() - input.observationDays * 86400_000,
  );
  const controlWhere = {
    eligibleAt: {
      gte: start,
      lt: new Date(Math.min(end.getTime(), matureBefore.getTime())),
    },
  };
  const eligibleCount = await db.visitorJourney.count({ where: controlWhere });
  if (eligibleCount > 20_000)
    throw new Error(
      "Narrow the control report window to at most 20,000 eligible journeys.",
    );
  const journeys = await db.visitorJourney.findMany({
    where: controlWhere,
    include: {
      visits: {
        include: {
          applications: { include: { postbacks: true } },
          leads: { include: { subscriptions: true } },
        },
      },
    },
  });
  const arms = ["TREATMENT", "CONTROL"].map((group) => {
    const people = journeys.filter((j) => j.group === group);
    let converted = 0,
      confirmed = 0,
      applications = 0,
      commission = new Prisma.Decimal(0),
      contamination = 0;
    for (const j of people) {
      const start = j.eligibleAt!,
        until = new Date(start.getTime() + input.observationDays * 86400_000);
      const inside = (date: Date) => date >= start && date < until;
      // Include sales following any visit in this browser journey, rather than only return clicks.
      const canonicalSales = j.visits.flatMap((v) =>
        v.applications.flatMap((a) => {
          const sale = a.postbacks
            .filter((p) => p.event === "SOLD")
            .sort(
              (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() ||
                a.id.localeCompare(b.id),
            )[0];
          return sale ? [sale] : [];
        }),
      );
      const sales = deduplicateSales(
        canonicalSales.filter((p) => inside(p.createdAt)),
      );
      if (sales.paidLeads) converted++;
      commission = commission.add(sales.commission);
      applications += j.visits.reduce(
        (n, v) => n + v.applications.filter((a) => inside(a.createdAt)).length,
        0,
      );
      if (
        j.visits.some((v) =>
          v.leads.some((l) =>
            l.subscriptions.some((s) => s.confirmedAt && inside(s.confirmedAt)),
          ),
        )
      )
        confirmed++;
      if (
        group === "CONTROL" &&
        j.visits.some((v) => v.retargetingCampaignId && inside(v.createdAt))
      )
        contamination++;
    }
    return {
      group,
      eligibleJourneys: people.length,
      convertedJourneys: converted,
      paidLeadRate: people.length ? converted / people.length : null,
      subscriptionJourneys: confirmed,
      applicationClicks: applications,
      commission: commission.toNumber(),
      controlJourneysWithRetargetingClicks: contamination,
    };
  });
  const treatment = arms[0],
    control = arms[1];
  return {
    window: {
      from,
      through,
      timezone: "UTC",
      outcomesObservedThrough: now.toISOString(),
    },
    groupBy: input.groupBy,
    rows: result,
    totals: {
      rawVisits: visits.length,
      ...deduplicateSales(
        visits.flatMap((v) => v.applications.flatMap((a) => a.postbacks)),
      ),
    },
    controlStudy: {
      assignment:
        "Persistent browser journey; assignment precedes pixels. Analysis starts at common eligibility, with a complete observation window for both groups.",
      observationDays: input.observationDays,
      arms,
      observedRateDifference:
        treatment.paidLeadRate !== null && control.paidLeadRate !== null
          ? treatment.paidLeadRate - control.paidLeadRate
          : null,
      interpretation:
        "Observed difference, not proven incremental lift. Review sample sizes, cookie loss, targeting evidence, changing rules, and control contamination before drawing causal conclusions.",
    },
    definitions: [
      "Rows cohort visits by arrival date; application/subscription/sale outcomes can occur later, through report time. Latest verification states partition raw visits; everVerifiedVisits retains successful attempts before later errors.",
      "Commission is the first SOLD event per application. Repeated sale events are flagged, never added again. SOLD is not loan approval or funding.",
      "Campaign/day spend comes from PropellerAds MCP imports. Missing days mean unknown cost, not zero. No proportional allocation of campaign spend to audiences, angles, or groups.",
      "Each advertising click stays on its own visit. Audience attribution is snapshotted from the mapped campaign at arrival, not inferred from pixel attempts.",
      "Do not add this acquisition report to overlapping follow-up reports; they can describe the same application. No historical journey/control backfill.",
    ],
  };
}
