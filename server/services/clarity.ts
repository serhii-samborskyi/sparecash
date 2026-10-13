import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config.js";
import { db } from "../db.js";
import { audit } from "./control.js";

const clarityMetricSchema = z
  .object({
    metricName: z.string().max(120),
    information: z.array(z.record(z.unknown())).max(1000),
  })
  .passthrough();
const clarityExportSchema = z.array(clarityMetricSchema).max(100);
export const clarityReportSchema = z.object({
  snapshotId: z.string().optional(),
  minimumSessions: z.number().int().min(1).max(100000).default(1),
});

class ClarityError extends Error {}

function requireConfiguration() {
  if (!env.CLARITY_PROJECT_ID || !env.CLARITY_EXPORT_TOKEN)
    throw new ClarityError(
      "Save the Clarity project ID and Data Export token first.",
    );
}

export async function fetchClarityInsights(days: 1 | 2 | 3 = 1) {
  requireConfiguration();
  const url = new URL(
    "https://www.clarity.ms/export-data/api/v1/project-live-insights",
  );
  url.searchParams.set("numOfDays", String(days));
  url.searchParams.set("dimension1", "URL");
  url.searchParams.set("dimension2", "Campaign");
  url.searchParams.set("dimension3", "Device");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env.CLARITY_EXPORT_TOKEN}`,
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ClarityError(
      "Could not reach Clarity. Check service availability and retry.",
    );
  }
  if (!response.ok) {
    const message =
      response.status === 401 || response.status === 403
        ? "Clarity rejected the Data Export token."
        : response.status === 429
          ? "Clarity's daily export limit was reached."
          : "Clarity could not complete the export.";
    throw new ClarityError(`${message} (HTTP ${response.status})`);
  }
  try {
    return clarityExportSchema.parse(await response.json());
  } catch {
    throw new ClarityError("Clarity returned an unexpected export format.");
  }
}

export async function importClarity(days: 1 | 2 | 3 = 1, actor = "worker") {
  const metrics = await fetchClarityInsights(days);
  const windowEnd = new Date();
  const rowCount = metrics.reduce(
    (total, metric) => total + metric.information.length,
    0,
  );
  const snapshot = await db.claritySnapshot.create({
    data: {
      days,
      dimensions: ["URL", "Campaign", "Device"],
      metrics: metrics as Prisma.InputJsonValue,
      rowCount,
      windowStart: new Date(windowEnd.getTime() - days * 86400000),
      windowEnd,
    },
  });
  await db.claritySnapshot.deleteMany({
    where: { fetchedAt: { lt: new Date(Date.now() - 90 * 86400000) } },
  });
  await db.setting.upsert({
    where: { key: "claritySyncState" },
    create: {
      key: "claritySyncState",
      value: {
        status: "ok",
        at: snapshot.fetchedAt.toISOString(),
        attemptedAt: windowEnd.toISOString(),
        snapshotId: snapshot.id,
        rowCount,
      },
    },
    update: {
      value: {
        status: "ok",
        at: snapshot.fetchedAt.toISOString(),
        attemptedAt: windowEnd.toISOString(),
        snapshotId: snapshot.id,
        rowCount,
      },
    },
  });
  await audit(actor, "clarity.imported", snapshot.id, { days, rowCount });
  return {
    id: snapshot.id,
    days,
    dimensions: snapshot.dimensions,
    rowCount,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    fetchedAt: snapshot.fetchedAt,
  };
}

export async function syncClarityIfDue() {
  if (!env.CLARITY_PROJECT_ID || !env.CLARITY_EXPORT_TOKEN)
    return { status: "not_configured" as const };
  const saved = await db.setting.findUnique({
    where: { key: "claritySyncState" },
  });
  const state = (saved?.value ?? {}) as Record<string, unknown>;
  const lastAttempt = Date.parse(String(state.attemptedAt ?? state.at ?? ""));
  if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 20 * 3600000)
    return { status: "not_due" as const, at: state.at ?? null };
  const attemptedAt = new Date().toISOString();
  try {
    const snapshot = await importClarity(1, "worker");
    return { status: "imported" as const, snapshot };
  } catch (error) {
    const message =
      error instanceof ClarityError
        ? error.message
        : "Clarity import could not be completed.";
    await db.setting.upsert({
      where: { key: "claritySyncState" },
      create: {
        key: "claritySyncState",
        value: { status: "error", attemptedAt, error: message },
      },
      update: {
        value: { ...state, status: "error", attemptedAt, error: message },
      },
    });
    return { status: "error" as const, error: message };
  }
}

function value(row: Record<string, unknown>, ...names: string[]) {
  const entry = Object.entries(row).find(([key]) =>
    names.some((name) => key.toLowerCase() === name.toLowerCase()),
  );
  return entry?.[1];
}

function number(row: Record<string, unknown>, ...names: string[]) {
  const parsed = Number(value(row, ...names) ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceFromRow(row: Record<string, unknown>) {
  const rawUrl = String(value(row, "URL", "url") ?? "");
  let url: URL | undefined;
  try {
    url = new URL(rawUrl, env.APP_URL);
  } catch {
    // Malformed provider dimensions remain unattributed rather than failing a report.
  }
  return {
    url: rawUrl,
    campaignId:
      url?.searchParams.get("campaign_id") ??
      String(value(row, "Campaign", "campaign") ?? ""),
    zoneId: url?.searchParams.get("zone_id") ?? "",
    device: String(value(row, "Device", "device") ?? "Unknown"),
  };
}

export async function clarityReport(raw: unknown = {}) {
  const input = clarityReportSchema.parse(raw);
  const snapshot = input.snapshotId
    ? await db.claritySnapshot.findUnique({ where: { id: input.snapshotId } })
    : await db.claritySnapshot.findFirst({ orderBy: { fetchedAt: "desc" } });
  if (!snapshot)
    return {
      configured: Boolean(env.CLARITY_PROJECT_ID && env.CLARITY_EXPORT_TOKEN),
      snapshot: null,
      zones: [],
      note: "No Clarity export has been imported yet.",
    };
  const metrics = clarityExportSchema.parse(snapshot.metrics);
  const traffic = metrics.find(
    (metric) => metric.metricName.toLowerCase() === "traffic",
  );
  const grouped = new Map<
    string,
    {
      campaignId: string;
      zoneId: string;
      sessions: number;
      botSessions: number;
      distinctUsers: number;
      pagesPerSessionWeighted: number;
      devices: Set<string>;
      urls: Set<string>;
    }
  >();
  let unattributedSessions = 0;
  for (const row of traffic?.information ?? []) {
    const source = sourceFromRow(row);
    const sessions = number(row, "totalSessionCount");
    if (!source.campaignId || !source.zoneId) {
      unattributedSessions += sessions;
      continue;
    }
    const key = `${source.campaignId}\u0000${source.zoneId}`;
    const current = grouped.get(key) ?? {
      campaignId: source.campaignId,
      zoneId: source.zoneId,
      sessions: 0,
      botSessions: 0,
      distinctUsers: 0,
      pagesPerSessionWeighted: 0,
      devices: new Set<string>(),
      urls: new Set<string>(),
    };
    current.sessions += sessions;
    current.botSessions += number(row, "totalBotSessionCount");
    current.distinctUsers += number(
      row,
      "distinctUserCount",
      "distantUserCount",
    );
    current.pagesPerSessionWeighted +=
      number(row, "PagesPerSessionPercentage", "pagesPerSession") * sessions;
    if (source.device) current.devices.add(source.device);
    if (source.url) current.urls.add(source.url);
    grouped.set(key, current);
  }
  const sourceKeys = [...grouped.values()];
  const sources = sourceKeys.length
    ? await db.trafficSource.findMany({
        where: {
          OR: sourceKeys.map(({ campaignId, zoneId }) => ({
            campaignId,
            zoneId,
          })),
        },
        select: { campaignId: true, zoneId: true, state: true, reason: true },
      })
    : [];
  const sourceState = new Map(
    sources.map((source) => [
      `${source.campaignId}\u0000${source.zoneId}`,
      { state: source.state, reason: source.reason },
    ]),
  );
  const zones = [...grouped.entries()]
    .map(([key, row]) => ({
      campaignId: row.campaignId,
      zoneId: row.zoneId,
      sessions: row.sessions,
      botSessions: row.botSessions,
      humanSessions: Math.max(0, row.sessions - row.botSessions),
      botRate: row.sessions ? row.botSessions / row.sessions : 0,
      distinctUsers: row.distinctUsers,
      pagesPerSession: row.sessions
        ? row.pagesPerSessionWeighted / row.sessions
        : 0,
      devices: [...row.devices].sort(),
      urlCount: row.urls.size,
      source: sourceState.get(key) ?? { state: "UNSEEN", reason: null },
    }))
    .filter((row) => row.sessions >= input.minimumSessions)
    .sort((a, b) => b.sessions - a.sessions);
  return {
    configured: Boolean(env.CLARITY_PROJECT_ID && env.CLARITY_EXPORT_TOKEN),
    snapshot: {
      id: snapshot.id,
      windowStart: snapshot.windowStart,
      windowEnd: snapshot.windowEnd,
      fetchedAt: snapshot.fetchedAt,
      rowCount: snapshot.rowCount,
      dimensions: snapshot.dimensions,
    },
    zones,
    unattributedSessions,
    note: "Clarity is supporting evidence. Compare these aggregates with SpareCash verification, applications, outcomes, cost and source evidence before excluding or scaling a zone.",
  };
}

export async function clarityStatus() {
  const [last, state] = await Promise.all([
    db.claritySnapshot.findFirst({
      orderBy: { fetchedAt: "desc" },
      select: { id: true, fetchedAt: true, rowCount: true, windowEnd: true },
    }),
    db.setting.findUnique({ where: { key: "claritySyncState" } }),
  ]);
  return {
    trackingConfigured: Boolean(env.CLARITY_PROJECT_ID),
    exportConfigured: Boolean(env.CLARITY_EXPORT_TOKEN),
    projectId: env.CLARITY_PROJECT_ID || null,
    lastSnapshot: last,
    sync: state?.value ?? null,
    automaticBlocking: false,
  };
}
