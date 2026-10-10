import { rateLimit } from "express-rate-limit";
import { testDelivery } from "../services/delivery-tests.js";
import { roundSkyPixelSetup } from "../services/roundsky.js";
import {
  blueBubblesReplySetup,
  testProviderConnection,
  testProviderSchema,
} from "../services/integration-tests.js";
import { updateLeadTimezone, leadTiming } from "../services/timezones.js";
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
  saveExperiment,
  experimentResults,
  saveChain,
  settings,
  saveSettings,
  audit,
} from "../services/control.js";
import { sources, blockSource } from "../services/traffic.js";
import { tick } from "../services/engine.js";
import {
  unsubscribe,
  transitionLead,
  enrollExisting,
} from "../services/journeys.js";
export const adminRouter = Router();
adminRouter.use(requireAdmin, checkOrigin);
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
  const [items, total] = await Promise.all([
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
  ]);
  res.json({ items, total, page: query.page });
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
  res.json({ ...lead, timing: await leadTiming(lead) });
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
