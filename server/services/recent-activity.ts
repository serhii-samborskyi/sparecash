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

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
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

function stateAbbreviation(value: unknown) {
  const region = plainLocation(value);
  if (!region) return undefined;
  if (/^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  return US_STATE_ABBREVIATIONS[region] ?? region;
}

function activityLocation(visit: ActivityRow["visit"]) {
  const context = record(visit.adContext);
  const city = plainLocation(visit.city) ?? plainLocation(context.city);
  const region =
    stateAbbreviation(visit.region) ?? stateAbbreviation(context.region);
  if (city && region) return `${city}, ${region}`;
  return city ?? region ?? "the U.S.";
}

function activityAmount(
  parsed: ReturnType<typeof landingSchema.safeParse>,
  candidate: unknown,
) {
  if (!parsed.success || typeof candidate !== "string") return undefined;
  const options =
    parsed.data.questions.find((question) => question.id === "amount")
      ?.options ?? [];
  if (options.includes(candidate)) return candidate;

  const field = parsed.data.customForm?.fields.find(
    (item) => item.id === "amount" && item.valueType !== "text",
  );
  if (!field) return undefined;
  const amount = Number(candidate);
  if (
    !Number.isFinite(amount) ||
    amount < (field.min ?? Number.NEGATIVE_INFINITY) ||
    amount > (field.max ?? Number.POSITIVE_INFINITY)
  )
    return undefined;
  if (field.step && field.min !== undefined) {
    const steps = (amount - field.min) / field.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) return undefined;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function publicRecentActivity(rows: ActivityRow[]) {
  const seen = new Set<string>();
  const result: PublicRecentActivity[] = [];
  for (const row of rows) {
    const location = activityLocation(row.visit);
    const parsed = landingSchema.safeParse(row.visit.configSnapshot);
    const answers = record(row.lead?.answers);
    const candidate =
      typeof answers.amount === "string"
        ? answers.amount
        : row.visit.engagementEvents[0]?.answer;
    const amount = activityAmount(parsed, candidate);
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
