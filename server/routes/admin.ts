import { rateLimit } from "express-rate-limit";
import { retargetingStatus } from "../services/retargeting.js";
import { retargetingReport } from "../services/retargeting-report.js";
import { testDelivery } from "../services/delivery-tests.js";
import { roundSkyPixelSetup } from "../services/roundsky.js";
import {
  blueBubblesReplySetup,
  testProviderConnection,
  testProviderSchema,
} from "../services/integration-tests.js";
import { updateLeadTimezone, leadTiming } from "../services/timezones.js";
import { deleteLead } from "../services/leads.js";
import { timezoneSchema } from "../timezones.js";
import {
  runtimeSettingsView,
  saveRuntimeSettings,
  revealRuntimeSecret,
} from "../runtime-config.js";
import { Router, json } from "express";
import {
  listLandingAssets,
  uploadLandingAsset,
} from "../services/landing-assets.js";
import { z } from "zod";
import { db } from "../db.js";
import { engagementReport } from "../services/marketing.js";
import { requireAdmin, checkOrigin } from "../security.js";
import {
  dashboard,
  deleteExperiment,
  duplicateExperiment,
  saveExperiment,
  experimentResults,
  saveChain,
  settings,
  saveSettings,
  audit,
} from "../services/control.js";
import { sources, blockSource } from "../services/traffic.js";
import { statisticsReport, statisticsVisits } from "../services/statistics.js";
import { refreshClarityForStatistics } from "../services/clarity.js";
import { browserContext } from "../services/visit-context.js";
import { tick } from "../services/engine.js";
import {
  controlManagedWorker,
  managedWorkerActionSchema,
  managedWorkerIdSchema,
  managedWorkerStatuses,
  runManagedWorker,
} from "../services/managed-workers.js";
import { requeueAdvertiserConversions } from "../services/advertiser-conversions.js";
import {
  EmailVerificationInconclusiveError,
  emailVerificationState,
  verifyEmailAddress,
} from "../services/email-verification.js";
import {
  unsubscribe,
  transitionLead,
  enrollExisting,
} from "../services/journeys.js";
export const adminRouter = Router();
adminRouter.use(requireAdmin, checkOrigin);
adminRouter.get("/retargeting/status", async (_req, res) => {
  res.set("Cache-Control", "no-store").json(await retargetingStatus());
});
adminRouter.get("/retargeting/report", async (req, res) => {
  res.set("Cache-Control", "no-store").json(
    await retargetingReport({
      ...req.query,
      ...(req.query.observationDays !== undefined
        ? { observationDays: Number(req.query.observationDays) }
        : {}),
    }),
  );
});
adminRouter.get("/landing-assets", async (req, res) => {
  res.set("Cache-Control", "no-store").json(await listLandingAssets(req.query));
});
adminRouter.post(
  "/landing-assets",
  json({ limit: "6mb" }),
  async (req, res) => {
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json(await uploadLandingAsset(req.body, "owner"));
  },
);
adminRouter.get("/configuration", async (_req, res) => {
  res.set("Cache-Control", "no-store").json(await runtimeSettingsView());
});
adminRouter.patch("/configuration", async (req, res) => {
  res
    .set("Cache-Control", "no-store")
    .json(await saveRuntimeSettings(req.body, "owner"));
});
adminRouter.post("/configuration/reveal", async (req, res) => {
  const { name } = z.object({ name: z.string().max(80) }).parse(req.body);
  res
    .set("Cache-Control", "no-store")
    .json({ value: await revealRuntimeSecret(name) });
});
adminRouter.post("/configuration/password", (_req, res) => {
  res.status(409).set("Cache-Control", "no-store").json({
    error: "Change OWNER_PASSWORD in your hosting environment and redeploy.",
  });
});
adminRouter.get("/integrations/roundsky/pixel", async (_req, res) => {
  res.set("Cache-Control", "no-store").json(roundSkyPixelSetup());
});
adminRouter.get("/integrations/bluebubbles/webhook", async (_req, res) => {
  res.set("Cache-Control", "no-store").json(blueBubblesReplySetup());
});
adminRouter.post("/integrations/:provider/test", async (req, res) => {
  const provider = testProviderSchema.parse(req.params.provider);
  const result = await testProviderConnection(provider);
  await audit("owner", "integration.tested", provider, {
    status: result.status,
  });
  res.set("Cache-Control", "no-store").json(result);
});
adminRouter.post(
  "/integrations/:provider/send-test",
  rateLimit({
    windowMs: 60000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    res
      .set("Cache-Control", "no-store")
      .json(await testDelivery({ ...req.body, provider: req.params.provider }));
  },
);
adminRouter.get("/dashboard", async (_req, res) => {
  res.json(await dashboard());
});
adminRouter.post(
  "/statistics/report",
  rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    res.set("Cache-Control", "no-store").json(await statisticsReport(req.body));
  },
);
adminRouter.post(
  "/statistics/visits",
  rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    res.set("Cache-Control", "no-store").json(await statisticsVisits(req.body));
  },
);
adminRouter.post(
  "/statistics/clarity/refresh",
  rateLimit({
    windowMs: 3 * 3600000,
    limit: 1,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .json(await refreshClarityForStatistics());
  },
);
adminRouter.get("/experiments/:id", async (req, res) => {
  res.json(await experimentResults(String(req.params.id)));
});
adminRouter.get("/experiments/:id/engagement", async (req, res) => {
  res.json(
    await engagementReport({
      experimentId: String(req.params.id),
      minimumAgeHours: 0,
    }),
  );
});
adminRouter.post("/experiments", async (req, res) => {
  res.json(await saveExperiment(req.body, "owner"));
});
adminRouter.post("/experiments/:id/duplicate", async (req, res) => {
  res.json(await duplicateExperiment(String(req.params.id), "owner"));
});
adminRouter.delete("/experiments/:id", async (req, res) => {
  res.json(await deleteExperiment(String(req.params.id), "owner"));
});
adminRouter.post("/chains", async (req, res) => {
  res.json(await saveChain(req.body, "owner"));
});
adminRouter.post("/chains/:id/enroll", async (req, res) => {
  const chain = await db.chain.findUniqueOrThrow({
    where: { id: String(req.params.id) },
  });
  if (chain.trigger !== "SUBSCRIBED" || chain.status !== "ACTIVE")
    throw new Error("Activate a subscription chain first");
  res.json(await enrollExisting(chain.channel, chain.trigger));
});
adminRouter.get("/leads", async (req, res) => {
  const query = z
    .object({
      q: z.string().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
      status: z
        .enum(["NEW", "ENGAGED", "SOLD", "APPROVED", "FUNDED", "DECLINED"])
        .optional(),
    })
    .parse(req.query);
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            {
              subscriptions: {
                some: {
                  address: { contains: query.q, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [items, total, optIns, activeOptIns, pendingOptIns] = await Promise.all(
    [
      db.lead.findMany({
        where,
        include: {
          subscriptions: true,
          visit: { include: { variant: true, source: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        skip: (query.page - 1) * 30,
      }),
      db.lead.count({ where }),
      db.subscription.count({
        where: { status: { in: ["ACTIVE", "PENDING"] }, lead: where },
      }),
      db.subscription.count({
        where: { status: "ACTIVE", lead: where },
      }),
      db.subscription.count({
        where: { status: "PENDING", lead: where },
      }),
    ],
  );
  res.json({
    items,
    total,
    optIns,
    activeOptIns,
    pendingOptIns,
    page: query.page,
  });
});
adminRouter.get("/leads/:id", async (req, res) => {
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: String(req.params.id) },
    include: {
      subscriptions: {
        include: {
          enrollments: { include: { chain: true } },
          deliveries: { take: 30, orderBy: { createdAt: "desc" } },
        },
      },
      events: { take: 100, orderBy: { createdAt: "desc" } },
      visit: { include: { source: true, variant: true } },
      applications: { include: { postbacks: true } },
    },
  });
  res.json({
    ...lead,
    visit: {
      ...lead.visit,
      browserContext: browserContext(lead.visit.userAgent),
    },
    timing: await leadTiming(lead),
  });
});
adminRouter.put("/leads/:id/timezone", async (req, res) => {
  const { timezone } = z.object({ timezone: timezoneSchema }).parse(req.body);
  res.json(await updateLeadTimezone(String(req.params.id), timezone, "owner"));
});
adminRouter.patch("/leads/:id", async (req, res) => {
  const input = z.object({ notes: z.string().max(10000) }).parse(req.body);
  res.json(
    await db.lead.update({ where: { id: String(req.params.id) }, data: input }),
  );
  await audit("owner", "lead.notes_updated", String(req.params.id));
});
adminRouter.delete("/leads/:id", async (req, res) => {
  res
    .set("Cache-Control", "no-store")
    .json(await deleteLead(String(req.params.id), "owner"));
});
adminRouter.post("/leads/:id/decline", async (req, res) => {
  res.json(
    await transitionLead(
      String(req.params.id),
      "DECLINED",
      "Owner recorded an explicit decline",
    ),
  );
});
adminRouter.post("/subscriptions/:id/unsubscribe", async (req, res) => {
  await unsubscribe(String(req.params.id), "Owner unsubscribed this contact");
  await audit("owner", "subscription.unsubscribed", String(req.params.id));
  res.json({ ok: true });
});
adminRouter.post("/subscriptions/:id/verify-email", async (req, res) => {
  const id = String(req.params.id);
  async function saveResult(state: string, diagnosis: string) {
    return db.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id },
        data: {
          emailVerificationState: state,
          emailVerificationCheckedAt: new Date(),
          emailVerificationDiagnosis: diagnosis,
        },
      });
      if (state !== "VERIFIED") {
        await tx.enrollment.updateMany({
          where: { subscriptionId: id, status: "ACTIVE" },
          data: { status: "STOPPED" },
        });
        await tx.delivery.updateMany({
          where: { subscriptionId: id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
      }
      return updated;
    });
  }
  const subscription = await db.subscription.findUniqueOrThrow({
    where: { id },
  });
  if (subscription.channel !== "EMAIL") {
    res
      .status(400)
      .json({ error: "This subscription is not an email address." });
    return;
  }
  try {
    const result = await verifyEmailAddress(subscription.address);
    const state = emailVerificationState(result);
    const updated = await saveResult(state, result.diagnosis || result.status);
    await audit("owner", "subscription.email_checked", id, {
      state: updated.emailVerificationState,
    });
    res.set("Cache-Control", "no-store").json({
      valid: result.valid,
      state,
      subscription: updated,
    });
  } catch (error) {
    if (error instanceof EmailVerificationInconclusiveError) {
      const updated = await saveResult("UNKNOWN", error.message);
      await audit("owner", "subscription.email_checked", id, {
        state: updated.emailVerificationState,
      });
      res.set("Cache-Control", "no-store").json({
        valid: false,
        state: "UNKNOWN",
        subscription: updated,
      });
      return;
    }
    await db.subscription.update({
      where: { id },
      data: {
        emailVerificationState: "ERROR",
        emailVerificationCheckedAt: new Date(),
        emailVerificationDiagnosis: "Verification service unavailable",
      },
    });
    await audit("owner", "subscription.email_verification_failed", id);
    res.status(503).set("Cache-Control", "no-store").json({
      error:
        "Email verification is unavailable. Check the MyEmailVerifier connection in Settings and retry.",
    });
  }
});
adminRouter.get("/sources", async (_req, res) => {
  res.json(await sources());
});
adminRouter.post("/sources/:id/block", async (req, res) => {
  res.json(await blockSource(String(req.params.id), "owner"));
});
adminRouter.get("/settings", async (_req, res) => {
  res.json(await settings());
});
adminRouter.patch("/settings", async (req, res) => {
  res.json(await saveSettings(req.body, "owner", true));
});
adminRouter.put("/settings", async (req, res) => {
  res.json(await saveSettings(req.body, "owner"));
});
adminRouter.get("/deliveries", async (_req, res) => {
  res.json(
    await db.delivery.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        subscription: { include: { lead: true } },
        enrollment: { include: { chain: true } },
      },
    }),
  );
});
adminRouter.get("/followups", async (_req, res) => {
  const [
    queue,
    enrollmentFacts,
    deliveries,
    deliveryStatuses,
    deliveryClicks,
    applications,
  ] = await db.$transaction([
    db.enrollment.findMany({
      take: 100,
      orderBy: [{ status: "asc" }, { nextAt: "asc" }],
      include: {
        subscription: { include: { lead: true } },
        chain: { include: { _count: { select: { steps: true } } } },
      },
    }),
    db.enrollment.findMany({
      select: {
        status: true,
        nextAt: true,
        deferredUntil: true,
        subscription: { select: { leadId: true } },
      },
    }),
    db.delivery.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        subscription: { include: { lead: true } },
        enrollment: { include: { chain: true } },
      },
    }),
    db.delivery.groupBy({
      by: ["status"],
      _count: true,
      orderBy: { status: "asc" },
    }),
    db.delivery.aggregate({ _sum: { clickCount: true } }),
    db.applicationClick.count({ where: { deliveryId: { not: null } } }),
  ]);
  const now = Date.now();
  const active = enrollmentFacts.filter((item) => item.status === "ACTIVE");
  const due = active.filter(
    (item) =>
      item.nextAt.getTime() <= now &&
      (!item.deferredUntil || item.deferredUntil.getTime() <= now),
  );
  const deliveryCount = (status: string) =>
    deliveryStatuses.find((item) => item.status === status)?._count ?? 0;
  res.json({
    summary: {
      people: new Set(enrollmentFacts.map((item) => item.subscription.leadId))
        .size,
      activePeople: new Set(active.map((item) => item.subscription.leadId))
        .size,
      enrollments: enrollmentFacts.length,
      active: active.length,
      due: due.length,
      scheduled: active.length - due.length,
      stopped: enrollmentFacts.filter((item) => item.status === "STOPPED")
        .length,
      completed: enrollmentFacts.filter((item) => item.status === "COMPLETED")
        .length,
      sent: deliveryCount("SENT"),
      failed: deliveryCount("FAILED"),
      uncertain: deliveryCount("UNCERTAIN"),
      linkClicks: deliveryClicks._sum.clickCount ?? 0,
      applications,
    },
    queue,
    deliveries,
  });
});
adminRouter.post("/deliveries/:id/resolve", async (req, res) => {
  const input = z
    .object({
      outcome: z.enum(["SENT", "FAILED"]),
      note: z.string().min(5).max(500),
    })
    .parse(req.body);
  const delivery = await db.delivery.findUniqueOrThrow({
    where: { id: String(req.params.id) },
    include: {
      enrollment: {
        include: {
          chain: { include: { steps: { orderBy: { position: "asc" } } } },
        },
      },
    },
  });
  if (!["UNCERTAIN", "FAILED"].includes(delivery.status))
    throw new Error("Only uncertain or failed deliveries can be resolved");
  if (input.outcome === "SENT") {
    const next = delivery.enrollment.chain.steps[delivery.step + 1];
    await db.$transaction([
      db.delivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", sentAt: new Date(), error: input.note },
      }),
      db.subscription.update({
        where: { id: delivery.subscriptionId },
        data: { lastSentAt: new Date() },
      }),
      db.enrollment.updateMany({
        where: {
          id: delivery.enrollmentId,
          status: "ACTIVE",
          step: delivery.step,
        },
        data: {
          step: { increment: 1 },
          status: next ? "ACTIVE" : "COMPLETED",
          nextAt: new Date(Date.now() + (next?.delayHours ?? 24) * 3600000),
        },
      }),
    ]);
  } else
    await db.delivery.update({
      where: { id: delivery.id },
      data: { status: "PENDING", error: input.note },
    });
  await audit("owner", "delivery.resolved", delivery.id, input);
  res.json({ ok: true });
});
adminRouter.get("/audit", async (_req, res) => {
  res.json(
    await db.auditLog.findMany({ take: 100, orderBy: { createdAt: "desc" } }),
  );
});
adminRouter.post("/worker/run", async (_req, res) => {
  res.json(await tick());
});
adminRouter.get("/workers", async (_req, res) => {
  res.set("Cache-Control", "no-store").json(await managedWorkerStatuses());
});
adminRouter.post("/workers/:id/:action", async (req, res) => {
  const id = managedWorkerIdSchema.parse(req.params.id);
  const action = managedWorkerActionSchema.parse(req.params.action);
  res
    .set("Cache-Control", "no-store")
    .json(await controlManagedWorker(id, action, "owner"));
});
adminRouter.post(
  "/advertiser-conversions/retry",
  rateLimit({
    windowMs: 60_000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    const input = z
      .object({
        goal: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        externalClickIds: z
          .array(z.string().regex(/^[A-Za-z0-9._:-]{6,200}$/))
          .min(1)
          .max(20),
        reason: z.string().min(10).max(500),
        confirmation: z.literal("REPLAY ADVERTISER CONVERSIONS"),
      })
      .parse(req.body);
    const requeue = await requeueAdvertiserConversions({
      goal: input.goal,
      externalClickIds: input.externalClickIds,
      actor: "owner",
      reason: input.reason,
    });
    res.set("Cache-Control", "no-store").json({
      requeue,
      delivery: await runManagedWorker("advertiser-conversions"),
    });
  },
);
