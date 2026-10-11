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
  campaign_name: z.string().optional(),
  country: z.string(),
  date_time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impressions: numeric.pipe(z.number().int()),
  clicks: numeric.pipe(z.number().int()),
  spent: numeric,
});
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
  if (!query.campaignIds.length)
    return Promise.resolve(
      unavailableAds(
        "No attributed campaigns yet. Enter a campaign ID to read its advertiser statistics.",
      ),
    );
  // Token changes invalidate snapshots without storing or returning credentials.
  const key = hash(
    JSON.stringify({
      version: 1,
      ...query,
      api: env.PROPELLER_API_URL,
      token: env.PROPELLER_API_TOKEN,
    }),
  );
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = load(key, query, refresh).finally(() => pending.delete(key));
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
    let pages = 1,
      expectedItems: number | undefined;
    const signal = AbortSignal.timeout(25_000);
    for (let page = 1; page <= pages; page++) {
      const url = new URL(
        `${env.PROPELLER_API_URL.replace(/\/$/, "")}/adv/statistics`,
      );
      for (const dimension of [
        "campaign_id",
        "zone_id",
        "country_id",
        "date_time",
      ])
        url.searchParams.append("group_by[]", dimension);
      url.searchParams.set("day_from", `${query.from} 00:00:00`);
      url.searchParams.set("day_to", `${query.to} 23:59:59`);
      url.searchParams.set("tz", "+0000");
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "10000");
      url.searchParams.set("order_by", "campaign_id");
      url.searchParams.set("order_dest", "asc");
      for (const campaign of query.campaignIds)
        url.searchParams.append("campaign_id[]", campaign);
      if (query.zoneId) url.searchParams.append("zone_id[]", query.zoneId);
      if (query.country) url.searchParams.append("geo[]", query.country);
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${env.PROPELLER_API_TOKEN}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal,
      });
      if (!response.ok)
        throw new Error(
          `PropellerAds statistics returned HTTP ${response.status}.`,
        );
      const data = z
        .object({
          items: z.array(rowSchema).max(10000),
          total_pages: z.number().int().min(0).max(20),
          total_items: z.number().int().min(0).max(50000),
        })
        .parse(await response.json());
      if (
        expectedItems !== undefined &&
        (expectedItems !== data.total_items ||
          pages !== Math.max(1, data.total_pages))
      )
        throw new Error(
          "PropellerAds totals changed during pagination; refresh again.",
        );
      expectedItems = data.total_items;
      pages = Math.max(1, data.total_pages);
      for (const item of data.items) {
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
    }
    if (rows.length !== expectedItems)
      throw new Error("PropellerAds returned an incomplete report.");
    const fetchedAt = new Date();
    await db.adStatisticsSnapshot.upsert({
      where: { id: key },
      create: { id: key, query, rows, fetchedAt },
      update: { query, rows, fetchedAt },
    });
    return {
      status: "ready",
      message: "PropellerAds statistics · all pages loaded · UTC.",
      fetchedAt: fetchedAt.toISOString(),
      rows,
    };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "PropellerAds returned an unsupported or oversized report. Narrow the date range or campaign."
        : error instanceof Error && error.message.startsWith("PropellerAds")
          ? error.message
          : "PropellerAds statistics could not be refreshed. Try again shortly.";
    return cached
      ? snapshot("stale", `${message} Showing the last complete snapshot.`)
      : unavailableAds(message);
  }
}
