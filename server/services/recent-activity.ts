import { db } from "../db.js";
import { landingSchema } from "../domain.js";

export type PublicRecentActivity = {
  location: string;
  amount?: string;
};

type ActivityRow = {
  lead: { answers: unknown } | null;
  visit: {
    city: string | null;
    region: string | null;
    adContext: unknown;
    configSnapshot: unknown;
    engagementEvents: { answer: string | null }[];
  };
};

function plainLocation(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length >= 2 &&
    clean.length <= 60 &&
    /^[\p{L}\p{M} .'-]+$/u.test(clean)
    ? clean
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function publicRecentActivity(rows: ActivityRow[]) {
  const seen = new Set<string>();
  const result: PublicRecentActivity[] = [];
  for (const row of rows) {
    const context = record(row.visit.adContext);
    const location =
      plainLocation(row.visit.city) ??
      plainLocation(context.city) ??
      plainLocation(row.visit.region) ??
      plainLocation(context.region) ??
      "the U.S.";
    const parsed = landingSchema.safeParse(row.visit.configSnapshot);
    const allowed = parsed.success
      ? (parsed.data.questions.find((question) => question.id === "amount")
          ?.options ?? [])
      : [];
    const answers = record(row.lead?.answers);
    const candidate =
      typeof answers.amount === "string"
        ? answers.amount
        : row.visit.engagementEvents[0]?.answer;
    const amount =
      typeof candidate === "string" && allowed.includes(candidate)
        ? candidate
        : undefined;
    const key = `${location}|${amount ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ location, ...(amount ? { amount } : {}) });
    if (result.length === 3) break;
  }
  return result;
}

export async function recentApplicationActivity(experimentId: string) {
  const now = Date.now();
  const rows = await db.applicationClick.findMany({
    where: {
      visit: { experimentId, verified: true },
      createdAt: {
        gte: new Date(now - 30 * 86400000),
        lte: new Date(now - 15 * 60000),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      lead: { select: { answers: true } },
      visit: {
        select: {
          city: true,
          region: true,
          adContext: true,
          configSnapshot: true,
          engagementEvents: {
            where: { kind: "QUESTION_ANSWERED", questionId: "amount" },
            select: { answer: true },
            take: 1,
          },
        },
      },
    },
  });
  return publicRecentActivity(rows);
}
