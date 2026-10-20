import { z } from "zod";
import { db } from "../db.js";
import { withRuntimeConfiguration } from "../runtime-config.js";
import { tick } from "./engine.js";
import { processAdvertiserConversions } from "./advertiser-conversions.js";

export const managedWorkerIdSchema = z.enum([
  "automation",
  "advertiser-conversions",
]);
export const managedWorkerActionSchema = z.enum(["start", "stop", "restart"]);
export type ManagedWorkerId = z.infer<typeof managedWorkerIdSchema>;

const definitions = {
  automation: {
    name: "Follow-up and automation worker",
    description:
      "Runs follow-up chains, consent enrollment, Clarity imports and source evaluation.",
    controlKey: "workerControl:automation",
    heartbeatKey: "workerHeartbeat",
  },
  "advertiser-conversions": {
    name: "Propeller conversion worker",
    description:
      "Sends durable Goal 1, Goal 2 and Goal 3 postbacks to PropellerAds.",
    controlKey: "workerControl:advertiser-conversions",
    heartbeatKey: "advertiserConversionHeartbeat",
  },
} satisfies Record<
  ManagedWorkerId,
  {
    name: string;
    description: string;
    controlKey: string;
    heartbeatKey: string;
  }
>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export async function managedWorkerEnabled(id: ManagedWorkerId) {
  const setting = await db.setting.findUnique({
    where: { key: definitions[id].controlKey },
  });
  return record(setting?.value).enabled !== false;
}

async function saveHeartbeat(id: ManagedWorkerId, value: JsonRecord) {
  const data = { at: new Date().toISOString(), ...value };
  await db.setting.upsert({
    where: { key: definitions[id].heartbeatKey },
    create: { key: definitions[id].heartbeatKey, value: data },
    update: { value: data },
  });
}

export async function runManagedWorker(id: ManagedWorkerId) {
  const startedAt = new Date().toISOString();
  try {
    const result =
      id === "automation"
        ? await tick()
        : await withRuntimeConfiguration(processAdvertiserConversions);
    await saveHeartbeat(id, { startedAt, outcome: "ok", result });
    return result;
  } catch (error) {
    await saveHeartbeat(id, {
      startedAt,
      outcome: "error",
      error: error instanceof Error ? error.message : "Worker cycle failed",
    });
    throw error;
  }
}

export async function runManagedWorkerIfEnabled(id: ManagedWorkerId) {
  if (!(await managedWorkerEnabled(id))) return { stopped: true };
  return runManagedWorker(id);
}

export function startManagedWorkerLoop(
  id: ManagedWorkerId,
  intervalMs = 30_000,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try {
      await runManagedWorkerIfEnabled(id);
    } catch (error) {
      console.error(
        error instanceof Error
          ? `${definitions[id].name} failed: ${error.message}`
          : `${definitions[id].name} failed`,
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void run(), intervalMs);
        timer.unref();
      }
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function controlManagedWorker(
  id: ManagedWorkerId,
  action: "start" | "stop" | "restart",
  actor: string,
) {
  const now = new Date().toISOString();
  await db.$transaction([
    db.setting.upsert({
      where: { key: definitions[id].controlKey },
      create: {
        key: definitions[id].controlKey,
        value: { enabled: action !== "stop", action, updatedAt: now },
      },
      update: {
        value: { enabled: action !== "stop", action, updatedAt: now },
      },
    }),
    db.auditLog.create({
      data: {
        actor,
        action: `worker.${action}`,
        entityId: id,
      },
    }),
  ]);
  if (action !== "stop") {
    void runManagedWorkerIfEnabled(id).catch((error) =>
      console.error(
        error instanceof Error
          ? `${definitions[id].name} failed: ${error.message}`
          : `${definitions[id].name} failed`,
      ),
    );
  }
  return managedWorkerStatuses();
}

export async function managedWorkerStatuses() {
  const ids = managedWorkerIdSchema.options;
  const keys = ids.flatMap((id) => [
    definitions[id].controlKey,
    definitions[id].heartbeatKey,
  ]);
  const [settings, conversionGroups, activeEnrollments, dueEnrollments] =
    await Promise.all([
      db.setting.findMany({ where: { key: { in: keys } } }),
      db.advertiserConversion.groupBy({ by: ["status"], _count: true }),
      db.enrollment.count({ where: { status: "ACTIVE" } }),
      db.enrollment.count({
        where: { status: "ACTIVE", nextAt: { lte: new Date() } },
      }),
    ]);
  const byKey = new Map(settings.map((item) => [item.key, item.value]));
  const conversions = Object.fromEntries(
    conversionGroups.map((item) => [item.status.toLowerCase(), item._count]),
  );
  const now = Date.now();
  return {
    workers: ids.map((id) => {
      const definition = definitions[id];
      const control = record(byKey.get(definition.controlKey));
      const heartbeat = record(byKey.get(definition.heartbeatKey));
      const enabled = control.enabled !== false;
      const heartbeatAt =
        typeof heartbeat.at === "string" ? heartbeat.at : null;
      const heartbeatTime = heartbeatAt ? Date.parse(heartbeatAt) : 0;
      const controlTime =
        typeof control.updatedAt === "string"
          ? Date.parse(control.updatedAt)
          : 0;
      const state = !enabled
        ? "STOPPED"
        : !heartbeatTime || controlTime > heartbeatTime
          ? "STARTING"
          : now - heartbeatTime > 180_000
            ? "STALE"
            : heartbeat.outcome === "error"
              ? "ERROR"
              : "RUNNING";
      return {
        id,
        name: definition.name,
        description: definition.description,
        enabled,
        state,
        lastRunAt: heartbeatAt,
        lastOutcome:
          typeof heartbeat.outcome === "string" ? heartbeat.outcome : null,
        lastError: typeof heartbeat.error === "string" ? heartbeat.error : null,
        queue:
          id === "automation"
            ? { active: activeEnrollments, due: dueEnrollments }
            : conversions,
      };
    }),
    checkedAt: new Date().toISOString(),
  };
}
