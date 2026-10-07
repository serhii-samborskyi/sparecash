import { withRuntimeConfiguration } from "../runtime-config.js";
import { db } from "../db.js";
import { env } from "../config.js";
import {
  canSend,
  withinSendingHours,
  shouldStop,
  renderMessage,
} from "../domain.js";
import { token } from "../security.js";
import { settings } from "./control.js";
import { deliver, ProviderError } from "./providers.js";
import { enroll } from "./journeys.js";
import { evaluateSources } from "./traffic.js";
import { sendingTimezone, nextSendingTime } from "../timezones.js";
export async function tick() {
  return withRuntimeConfiguration(runTick);
}
async function runTick() {
  // A transaction-scoped advisory lock works across web/worker replicas; durable delivery
  // records use separate committed transactions so a crash cannot erase send intent.
  return db.$transaction(
    async (lock) => {
      const [state] = await lock.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(9241027) AS locked`;
      if (!state.locked) return { busy: true };
      await db.delivery.updateMany({
        where: {
          status: "SENDING",
          createdAt: { lt: new Date(Date.now() - 15 * 60000) },
        },
        data: {
          status: "UNCERTAIN",
          error: "Worker interrupted; check provider logs before resolving",
        },
      });
      const config = await settings();
      const due = await db.enrollment.findMany({
        where: {
          status: "ACTIVE",
          nextAt: { lte: new Date() },
          OR: [{ deferredUntil: null }, { deferredUntil: { lte: new Date() } }],
          chain: { status: "ACTIVE" },
        },
        include: {
          chain: { include: { steps: { orderBy: { position: "asc" } } } },
          subscription: { include: { lead: true } },
        },
        take: 10,
        orderBy: { nextAt: "asc" },
      });
      let sent = 0;
      const started = Date.now();
      for (const enrollment of due) {
        if (Date.now() - started > 110000) break;
        const sub = enrollment.subscription,
          lead = sub.lead,
          now = new Date();
        if (
          sub.status !== "ACTIVE" ||
          shouldStop(lead.status, config.stopOn) ||
          now.getTime() - enrollment.startedAt.getTime() >
            enrollment.chain.maxDays * 86400000
        ) {
          await db.enrollment.update({
            where: { id: enrollment.id },
            data: { status: "STOPPED" },
          });
          continue;
        }
        if (
          !canSend(sub.lastSentAt, now) ||
          !withinSendingHours(
            sendingTimezone(lead, config),
            config.sendHourStart,
            config.sendHourEnd,
            now,
          )
        ) {
          const earliest = new Date(
            Math.max(
              now.getTime(),
              sub.lastSentAt ? sub.lastSentAt.getTime() + 86400000 : 0,
            ),
          );
          await db.enrollment.updateMany({
            where: { id: enrollment.id, status: "ACTIVE" },
            data: {
              deferredUntil: nextSendingTime(
                sendingTimezone(lead, config),
                config.sendHourStart,
                config.sendHourEnd,
                earliest,
              ),
            },
          });
          continue;
        }
        const step = enrollment.chain.steps[enrollment.step];
        if (!step) {
          await db.enrollment.update({
            where: { id: enrollment.id },
            data: { status: "COMPLETED" },
          });
          continue;
        }
        if (env.LIVE_DELIVERY !== "true") continue;
        const message = await db.delivery.upsert({
          where: {
            enrollmentId_step: {
              enrollmentId: enrollment.id,
              step: enrollment.step,
            },
          },
          create: {
            subscriptionId: sub.id,
            enrollmentId: enrollment.id,
            step: enrollment.step,
            subject: step.subject,
            body: step.body,
          },
          update: {},
        });
        if (message.status !== "PENDING") continue;
        // Claim once. Ambiguous sends are held for manual resolution, never silently retried.
        const claimed = await db.delivery.updateMany({
          where: {
            id: message.id,
            status: "PENDING",
            subscription: { status: "ACTIVE" },
            enrollment: { status: "ACTIVE" },
          },
          data: { status: "SENDING" },
        });
        if (!claimed.count) continue;
        const link = `${env.APP_URL}/follow-up?token=${encodeURIComponent(token("click", message.id, 86400 * 90))}`;
        const body = renderMessage(step.body, lead.name, link),
          subject = renderMessage(step.subject, lead.name, link);
        await db.delivery.update({
          where: { id: message.id },
          data: { body, subject },
        });
        try {
          const fresh = await db.subscription.findUniqueOrThrow({
            where: { id: sub.id },
            include: { lead: true },
          });
          const freshConfig = await settings();
          if (
            fresh.status !== "ACTIVE" ||
            shouldStop(fresh.lead.status, freshConfig.stopOn)
          ) {
            await db.delivery.update({
              where: { id: message.id },
              data: { status: "CANCELLED" },
            });
            continue;
          }
          // Recheck time rules immediately before dispatch; the owner may have changed them.
          const freshNow = new Date();
          if (
            !canSend(fresh.lastSentAt, freshNow) ||
            !withinSendingHours(
              sendingTimezone(fresh.lead, freshConfig),
              freshConfig.sendHourStart,
              freshConfig.sendHourEnd,
              freshNow,
            )
          ) {
            await db.delivery.update({
              where: { id: message.id },
              data: { status: "PENDING" },
            });
            continue;
          }
          const providerId = await deliver(
            fresh,
            { ...message, subject, body },
            link,
          );
          const next = enrollment.chain.steps[enrollment.step + 1];
          await db.$transaction([
            db.delivery.update({
              where: { id: message.id },
              data: { status: "SENT", providerId, sentAt: new Date() },
            }),
            db.subscription.update({
              where: { id: sub.id },
              data: { lastSentAt: new Date() },
            }),
            db.enrollment.updateMany({
              where: { id: enrollment.id, status: "ACTIVE" },
              data: {
                step: { increment: 1 },
                status: next ? "ACTIVE" : "COMPLETED",
                nextAt: new Date(
                  Date.now() + (next?.delayHours ?? 24) * 3600000,
                ),
                deferredUntil: null,
              },
            }),
          ]);
          sent++;
        } catch (error) {
          await db.delivery.update({
            where: { id: message.id },
            data: {
              status:
                error instanceof ProviderError &&
                error.status >= 400 &&
                error.status < 500
                  ? "FAILED"
                  : "UNCERTAIN",
              error: error instanceof Error ? error.message : "Delivery failed",
            },
          });
        }
      }
      const stale = await db.subscription.findMany({
        where: {
          status: "ACTIVE",
          lead: {
            status: { in: ["NEW", "ENGAGED"] },
            createdAt: {
              lt: new Date(
                Date.now() - config.maxDaysWithoutConversion * 86400000,
              ),
            },
          },
        },
        take: 100,
      });
      for (const sub of stale) await enroll(sub.id, "NO_CONVERSION");
      const traffic = await evaluateSources();
      await db.setting.upsert({
        where: { key: "workerHeartbeat" },
        create: {
          key: "workerHeartbeat",
          value: { at: new Date().toISOString(), sent },
        },
        update: { value: { at: new Date().toISOString(), sent } },
      });
      return { sent, ...traffic };
    },
    { timeout: 240000, maxWait: 1000 },
  );
}
