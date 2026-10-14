import { z } from "zod";
import { db } from "../db.js";
import { env } from "../config.js";
import { hash } from "../security.js";

const numeric = z
  .union([z.number(), z.string().min(1)])
  .pipe(z.coerce.number().finite().nonnegative());
const id = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(String);
const rowSchema = z.object({
  campaign_id: id,
  zone_id: id,
  campaign_name: z.string().nullish(),
  country: z.string(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impressions: numeric.pipe(z.number().int()),
  clicks: numeric.pipe(z.number().int()),
  spent: numeric,
});
const reportRowsSchema = z.array(rowSchema).max(50_000);
const reportSchema = z
  .union([
    z.object({
      result: reportRowsSchema,
      // This provider metadata has changed type across API gateways and is not
      // needed to reconcile advertiser totals. Do not reject valid rows because
      // of an unused request identifier.
      request_id: z.unknown().optional(),
    }),
    // The direct advertiser endpoint returns its rows as a bare array while
    // the MCP gateway wraps the same data in `result`.
    reportRowsSchema.transform((result) => ({ result })),
  ])
  .transform((report) => ({ result: report.result }));
function leafIssues(issues: z.ZodIssue[]): z.ZodIssue[] {
  return issues.flatMap((issue) =>
    issue.code === "invalid_union"
      ? issue.unionErrors.flatMap((error) => leafIssues(error.issues))
      : [issue],
  );
}
export type AdRow = {
  campaignId: string;
  campaignName: string;
  zoneId: string;
  country: string;
  day: string;
  impressions: number;
  clicks: number;
  spend: number;
};
type Query = {
  from: string;
  to: string;
  campaignIds: string[];
  zoneId?: string;
  country?: string;
};
export type AdvertiserResult = {
  status: "ready" | "stale" | "unavailable" | "unsupported";
  message: string;
  fetchedAt: string | null;
  rows: AdRow[];
};
const pending = new Map<string, Promise<AdvertiserResult>>();
const CACHE_MS = 15 * 60_000;
export const unavailableAds = (message: string): AdvertiserResult => ({
  status: "unavailable",
  message,
  fetchedAt: null,
  rows: [],
});

export function advertiserStatistics(
  query: Query,
  refresh = false,
): Promise<AdvertiserResult> {
  if (!env.PROPELLER_API_TOKEN)
    return Promise.resolve(
      unavailableAds(
        "Connect your PropellerAds API token in Integrations to see impressions, clicks, CTR and spend.",
      ),
    );
  const campaignIds = [
    ...new Set(
      query.campaignIds.filter((value) => {
        const campaignId = Number(value);
        return Number.isSafeInteger(campaignId) && campaignId > 0;
      }),
    ),
  ];
  if (!campaignIds.length)
    return Promise.resolve(
      unavailableAds(
        "No attributed campaigns yet. Enter a campaign ID to read its advertiser statistics.",
      ),
    );
  const scopedQuery = { ...query, campaignIds };
  // Token changes invalidate snapshots without storing or returning credentials.
  const key = hash(
    JSON.stringify({
      version: 3,
      ...scopedQuery,
      api: env.PROPELLER_API_URL,
      token: env.PROPELLER_API_TOKEN,
    }),
  );
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = load(key, scopedQuery, refresh).finally(() =>
    pending.delete(key),
  );
  pending.set(key, promise);
  return promise;
}

async function load(
  key: string,
  query: Query,
  refresh: boolean,
): Promise<AdvertiserResult> {
  const cached = await db.adStatisticsSnapshot.findUnique({
    where: { id: key },
  });
  const snapshot = (
    status: "ready" | "stale",
    message: string,
  ): AdvertiserResult => ({
    status,
    message,
    fetchedAt: cached!.fetchedAt.toISOString(),
    rows: cached!.rows as unknown as AdRow[],
  });
  if (!refresh && cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MS)
    return snapshot(
      "ready",
      "PropellerAds statistics · refreshed at most every 15 minutes.",
    );
  try {
    const rows: AdRow[] = [];
    const signal = AbortSignal.timeout(25_000);
    const response = await fetch(
      `${env.PROPELLER_API_URL.replace(/\/$/, "")}/adv/statistics`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PROPELLER_API_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          group_by: ["campaign_id", "zone_id", "country_id", "date_time"],
          day_from: `${query.from} 00:00:00`,
          day_to: `${query.to} 23:59:59`,
          tz: "+0000",
          order_by: "campaign_id",
          order_dest: "asc",
          campaign_id: query.campaignIds.map(Number),
          ...(query.zoneId ? { zone_id: [Number(query.zoneId)] } : {}),
          ...(query.country ? { geo: [query.country] } : {}),
        }),
        redirect: "error",
        signal,
      },
    );
    if (!response.ok)
      throw new Error(
        `PropellerAds statistics returned HTTP ${response.status}.`,
      );
    const data = reportSchema.parse(await response.json());
    for (const item of data.result) {
      const country = item.country.match(/(?:^|\()([A-Z]{2})\)?$/)?.[1];
      if (
        !country ||
        !query.campaignIds.includes(item.campaign_id) ||
        (query.zoneId && item.zone_id !== query.zoneId) ||
        (query.country && country !== query.country) ||
        item.date_time < query.from ||
        item.date_time > query.to
      )
        throw new Error("PropellerAds returned a different reporting scope.");
      rows.push({
        campaignId: item.campaign_id,
        campaignName: item.campaign_name ?? item.campaign_id,
        zoneId: item.zone_id,
        country,
        day: item.date_time,
        impressions: item.impressions,
        clicks: item.clicks,
        spend: item.spent,
      });
    }
    const fetchedAt = new Date();
    await db.adStatisticsSnapshot.upsert({
      where: { id: key },
      create: { id: key, query, rows, fetchedAt },
      update: { query, rows, fetchedAt },
    });
    return {
      status: "ready",
      message: "PropellerAds statistics · complete report · UTC.",
      fetchedAt: fetchedAt.toISOString(),
      rows,
    };
  } catch (error) {
    const issues = error instanceof z.ZodError ? leafIssues(error.issues) : [];
    const oversized = issues.some(
      (issue) => issue.code === "too_big" && issue.path[0] === "result",
    );
    const firstIssue =
      error instanceof z.ZodError
        ? issues.sort((a, b) => b.path.length - a.path.length)[0]
          ? `${issues[0].path.join(".") || "response"}: ${issues[0].code}`
          : "response: invalid"
        : null;
    const message =
      error instanceof z.ZodError
        ? oversized
          ? "PropellerAds returned too many statistics rows. Narrow the date range or campaign."
          : `PropellerAds returned an incompatible statistics response (${firstIssue}). Check the configured advertiser API endpoint.`
        : error instanceof Error && error.message.startsWith("PropellerAds")
          ? error.message
          : "PropellerAds statistics could not be refreshed. Try again shortly.";
    return cached
      ? snapshot("stale", `${message} Showing the last complete snapshot.`)
      : unavailableAds(message);
  }
}
