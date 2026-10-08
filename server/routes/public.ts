import { createRoundSkyApplication } from "../services/roundsky.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomInt } from "node:crypto";
import { db } from "../db.js";
import { env } from "../config.js";
import {
  chooseVariant,
  landingSchema,
  normalizePhone,
  nextLeadStatus,
  visibleQuestions,
} from "../domain.js";
import { hash, ipHash, token, verifyToken, equal } from "../security.js";
import { settings } from "../services/control.js";
import { detectTimezone } from "../timezones.js";
import { trustedIpTimezone } from "../services/timezones.js";
import { sendVerification, verifyPush } from "../services/providers.js";
import {
  activateSubscription,
  unsubscribe,
  transitionLead,
} from "../services/journeys.js";
export const publicRouter = Router();
publicRouter.use(
  rateLimit({
    windowMs: 60000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
publicRouter.get("/info", async (_req, res) => {
  const s = await settings();
  res.json({
    businessName: s.businessName,
    contactEmail: s.contactEmail,
    businessAddress: s.businessAddress,
    privacyText: s.privacyText,
    termsText: s.termsText,
  });
});
publicRouter.post("/visit", async (req, res) => {
  const input = z
    .object({
      slug: z.string().max(70),
      campaignId: z.string().regex(/^\d*$/).max(30).optional(),
      zoneId: z.string().regex(/^\d*$/).max(30).optional(),
      clickId: z.string().max(200).optional(),
    })
    .parse(req.body);
  const experiment = await db.experiment.findUnique({
    where: { slug: input.slug },
    include: { variants: true },
  });
  if (!experiment || experiment.status !== "ACTIVE") {
    res.status(404).json({ error: "This page is not accepting visitors yet." });
    return;
  }
  const stored = verifyToken(
    String(req.cookies[`sc_visit_${experiment.slug}`] ?? ""),
    "visit",
  );
  let visit = stored
    ? await db.visit.findFirst({
        where: {
          id: stored,
          experimentId: experiment.id,
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      })
    : null;
  const stickyVariant = visit
    ? experiment.variants.find((v) => v.id === visit!.variantId && v.weight > 0)
    : undefined;
  if (visit && input.clickId && input.clickId !== visit.externalClickId)
    visit = null;
  if (!visit) {
    const variant =
      stickyVariant ??
      chooseVariant(experiment.variants, randomInt(1000000) / 1000000);
    const source =
      input.campaignId && input.zoneId
        ? await db.trafficSource.upsert({
            where: {
              campaignId_zoneId: {
                campaignId: input.campaignId,
                zoneId: input.zoneId,
              },
            },
            create: { campaignId: input.campaignId, zoneId: input.zoneId },
            update: {},
          })
        : null;
    const fingerprint = ipHash(req.ip ?? "unknown");
    const recent = await db.visit.count({
      where: {
        ipHash: fingerprint,
        createdAt: { gte: new Date(Date.now() - 60000) },
      },
    });
    const ua = (req.headers["user-agent"] ?? "").slice(0, 500),
      evidence: string[] = [];
    let score = 0;
    if (recent >= 15) {
      score += 30;
      evidence.push("High request rate from this IP hash");
    }
    if (!ua || /headless|python-requests|curl\//i.test(ua)) {
      score += 20;
      evidence.push("Automated or missing user agent");
    }
    visit = await db.visit.create({
      data: {
        experimentId: experiment.id,
        variantId: variant.id,
        configSnapshot: variant.config as any,
        sourceId: source?.id,
        externalClickId: input.clickId,
        ipHash: fingerprint,
        userAgent: ua,
        botScore: score,
        evidence,
      },
    });
  }
  const selected = experiment.variants.find((v) => v.id === visit.variantId)!;
  const visitToken = token("visit", visit.id, 86400);
  res.cookie(`sc_visit_${experiment.slug}`, visitToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 86400000,
    path: "/",
  });
  res.json({
    visitToken,
    visitId: visit.id,
    config: landingSchema.parse(
      Object.keys(visit.configSnapshot as object).length
        ? visit.configSnapshot
        : selected.config,
    ),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    oneSignalAppId: env.ONESIGNAL_APP_ID,
    deliveryEnabled: env.LIVE_DELIVERY === "true",
  });
});
publicRouter.post(
  "/subscribe",
  rateLimit({
    windowMs: 3600000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  async (req, res) => {
    const input = z
      .object({
        visitToken: z.string(),
        turnstileToken: z.string().max(2048),
        name: z.string().trim().min(1).max(80),
        timezone: z.string().max(80).optional(),
        answers: z.record(z.string().max(200)),
        email: z.string().email().max(254).optional(),
        phone: z.string().max(30).optional(),
        channels: z
          .array(z.enum(["EMAIL", "SMS", "PUSH"]))
          .min(1)
          .max(3),
        consent: z.literal(true),
        adultUS: z.literal(true),
        company: z.string().max(100).default(""),
      })
      .parse(req.body);
    const visitId = verifyToken(input.visitToken, "visit");
    if (!visitId) {
      res.status(400).json({ error: "Session expired. Refresh the page." });
      return;
    }
    const visit = await db.visit.findUniqueOrThrow({
      where: { id: visitId },
      include: { variant: true },
    });
    if (input.company) {
      await db.visit.update({
        where: { id: visitId },
        data: {
          botScore: 100,
          challenged: true,
          evidence: { push: "Hidden field completed" },
        },
      });
      res.status(400).json({ error: "Unable to verify this submission" });
      return;
    }
    if (!env.TURNSTILE_SECRET_KEY) {
      res
        .status(503)
        .json({ error: "Visitor verification is not configured yet." });
      return;
    }
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: input.turnstileToken,
          remoteip: req.ip,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error("Visitor verification temporarily unavailable");
    const verification = (await response.json()) as {
      success: boolean;
      hostname?: string;
      action?: string;
      cdata?: string;
      "error-codes"?: string[];
    };
    const localTest =
      env.NODE_ENV !== "production" &&
      env.TURNSTILE_SECRET_KEY.startsWith("1x000");
    if (
      !verification.success ||
      (!localTest &&
        (verification.hostname !== new URL(env.APP_URL).hostname ||
          verification.action !== "subscribe" ||
          verification.cdata !== visit.id))
    ) {
      const forged =
        verification["error-codes"]?.includes("invalid-input-response") ??
        false;
      await db.visit.update({
        where: { id: visit.id },
        data: {
          challenged: true,
          ...(forged
            ? {
                botScore: Math.max(80, visit.botScore),
                evidence: { push: "Invalid challenge response" },
              }
            : {}),
        },
      });
      res
        .status(400)
        .json({ error: "Verification failed or expired. Please try again." });
      return;
    }
    const detected = detectTimezone(
      input.timezone,
      trustedIpTimezone(req),
      await settings(),
    );
    const config = landingSchema.parse(
      Object.keys(visit.configSnapshot as object).length
        ? visit.configSnapshot
        : visit.variant.config,
    );
    const questions = visibleQuestions(config.questions, input.answers);
    for (const q of questions)
      if (!q.options.includes(input.answers[q.id])) {
        res.status(400).json({ error: `Choose an answer for: ${q.label}` });
        return;
      }
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (
      (input.channels.includes("EMAIL") && !input.email) ||
      (input.channels.includes("SMS") && !phone)
    ) {
      res
        .status(400)
        .json({ error: "Enter a valid address for each selected channel." });
      return;
    }
    const channels = [...new Set(input.channels)];
    const lead = await db.lead.create({
      data: {
        visitId: visit.id,
        name: input.name,
        ...detected,
        answers: Object.fromEntries(
          questions.map((q) => [q.id, input.answers[q.id]]),
        ),
      },
    });
    await db.visit.update({
      where: { id: visit.id },
      data: { verified: true, challenged: true },
    });
    const results = [];
    for (const channel of channels) {
      if (channel === "PUSH") continue;
      const address = channel === "EMAIL" ? input.email!.toLowerCase() : phone!;
      const existing = await db.subscription.findUnique({
        where: { channel_address: { channel, address } },
      });
      if (existing) {
        results.push({
          channel,
          state: "RECORDED",
          message:
            "This contact already has a subscription record. Use the preference link in your messages to manage it.",
        });
        continue;
      }
      const code = String(randomInt(100000, 1000000));
      const sub = await db.subscription.create({
        data: {
          leadId: lead.id,
          channel,
          address,
          consentText:
            channel === "EMAIL" ? config.emailConsent : config.smsConsent,
          consentVersion: config.consentVersion,
          consentIpHash: ipHash(req.ip ?? "unknown"),
          verificationHash: hash(`${env.TOKEN_SECRET}:${code}`),
          verificationExpiresAt: new Date(Date.now() + 600000),
        },
      });
      try {
        const delivery = await sendVerification(sub, code);
        results.push({
          channel,
          state: delivery.paused ? "PAUSED" : "PENDING",
          subscriptionToken: token("verify", sub.id, 600),
        });
      } catch {
        results.push({
          channel,
          state: "FAILED",
          message:
            "Confirmation could not be delivered. Please try again later.",
        });
      }
    }
    res.json({
      leadToken: token("lead", lead.id, 3600),
      leadId: lead.id,
      results,
      pushRequested: channels.includes("PUSH"),
    });
  },
);
publicRouter.post("/push", async (req, res) => {
  const input = z
    .object({
      leadToken: z.string(),
      subscriptionId: z.string().uuid(),
      consent: z.literal(true),
    })
    .parse(req.body);
  const leadId = verifyToken(input.leadToken, "lead");
  if (!leadId) {
    res.status(400).json({ error: "Session expired" });
    return;
  }
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { visit: { include: { variant: true } } },
  });
  if (!(await verifyPush(input.subscriptionId, leadId))) {
    // Keep this non-2xx so an already-open page running the old client cannot
    // mistake a pending verification for a confirmed CRM subscription.
    res.set("Cache-Control", "no-store").status(409).json({
      ok: false,
      code: "PUSH_CONFIRMATION_PENDING",
      error:
        "Your notification subscription is still being confirmed. Please try again shortly.",
    });
    return;
  }
  const config = landingSchema.parse(
    Object.keys(lead.visit.configSnapshot as object).length
      ? lead.visit.configSnapshot
      : lead.visit.variant.config,
  );
  const sub = await db.subscription.upsert({
    where: {
      channel_address: { channel: "PUSH", address: input.subscriptionId },
    },
    create: {
      leadId,
      channel: "PUSH",
      address: input.subscriptionId,
      consentText: config.pushConsent,
      consentVersion: config.consentVersion,
      consentIpHash: ipHash(req.ip ?? "unknown"),
    },
    update: {},
  });
  if (sub.leadId !== leadId) {
    res.status(409).json({
      error:
        "This browser already has a subscription. Manage it using your preference link.",
    });
    return;
  }
  if (sub.status === "UNSUBSCRIBED") {
    res.status(409).json({
      error:
        "Updates for this browser are turned off. Use your preference link to manage them.",
    });
    return;
  }
  await activateSubscription(sub.id);
  res.json({ ok: true });
});
publicRouter.post("/verify-phone", async (req, res) => {
  const input = z
    .object({ token: z.string(), code: z.string().regex(/^\d{6}$/) })
    .parse(req.body);
  const id = verifyToken(input.token, "verify");
  if (!id) {
    res.status(400).json({ error: "Confirmation expired" });
    return;
  }
  const sub = await db.subscription.findUniqueOrThrow({ where: { id } });
  const attempt = await db.subscription.updateMany({
    where: {
      id,
      status: "PENDING",
      channel: "SMS",
      verificationAttempts: { lt: 5 },
      verificationExpiresAt: { gt: new Date() },
    },
    data: { verificationAttempts: { increment: 1 } },
  });
  if (
    !attempt.count ||
    !equal(
      sub.verificationHash ?? "",
      hash(`${env.TOKEN_SECRET}:${input.code}`),
    )
  ) {
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }
  await activateSubscription(id);
  res.json({ ok: true });
});
publicRouter.post("/confirm", async (req, res) => {
  const id = verifyToken(String(req.body.token), "confirm");
  if (!id) {
    res.status(400).json({ error: "Confirmation link expired" });
    return;
  }
  const sub = await db.subscription.findUnique({ where: { id } });
  if (!sub || sub.channel !== "EMAIL") {
    res.status(400).json({ error: "Invalid confirmation" });
    return;
  }
  await activateSubscription(id);
  res.json({ ok: true });
});
publicRouter.get("/preferences", async (req, res) => {
  const id = verifyToken(String(req.query.token), "preferences");
  if (!id) {
    res.status(400).json({ error: "Invalid preference link" });
    return;
  }
  const sub = await db.subscription.findUniqueOrThrow({ where: { id } });
  res.json({ channel: sub.channel, status: sub.status });
});
publicRouter.post("/unsubscribe", async (req, res) => {
  const id = verifyToken(String(req.body.token), "preferences");
  if (!id) {
    res.status(400).json({ error: "Invalid preference link" });
    return;
  }
  await unsubscribe(id);
  res.json({ ok: true });
});
publicRouter.post("/application", async (req, res) => {
  const leadId = verifyToken(String(req.body.leadToken), "lead");
  if (!leadId) {
    res.status(400).json({ error: "Session expired" });
    return;
  }
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const config = await settings();
  if (!config.roundskyUrl) {
    res.status(503).json({ error: "Loan options are not connected yet." });
    return;
  }
  const url = await createRoundSkyApplication({
    leadId,
    visitId: lead.visitId,
  });
  res.set("Cache-Control", "no-store").json({ url });
});
publicRouter.post("/followup", async (req, res) => {
  const id = verifyToken(String(req.body.token), "click");
  if (!id) {
    res.status(400).json({ error: "This link has expired" });
    return;
  }
  const delivery = await db.delivery.findUniqueOrThrow({
    where: { id },
    include: { subscription: { include: { lead: true } } },
  });
  const config = await settings();
  if (!config.roundskyUrl) {
    res.status(503).json({ error: "Loan options are not connected yet." });
    return;
  }
  const lead = delivery.subscription.lead;
  await db.delivery.update({
    where: { id },
    data: {
      clickedAt: delivery.clickedAt ?? new Date(),
      clickCount: { increment: 1 },
    },
  });
  await transitionLead(
    lead.id,
    "ENGAGED",
    "Clicked through a follow-up to view loan options",
  );
  const url = await createRoundSkyApplication({
    leadId: lead.id,
    visitId: lead.visitId,
    deliveryId: id,
  });
  res.set("Cache-Control", "no-store").json({ url });
});
publicRouter.post("/answer", async (req, res) => {
  const input = z
    .object({
      token: z.string(),
      answer: z.enum(["DECLINED", "STILL_LOOKING"]),
    })
    .parse(req.body);
  const id = verifyToken(input.token, "click");
  if (!id) {
    res.status(400).json({ error: "Link expired" });
    return;
  }
  const d = await db.delivery.findUniqueOrThrow({
    where: { id },
    include: { subscription: true },
  });
  if (input.answer === "DECLINED")
    await transitionLead(
      d.subscription.leadId,
      "DECLINED",
      "Visitor reported being declined",
    );
  else
    await db.leadEvent.create({
      data: {
        leadId: d.subscription.leadId,
        type: "ANSWER",
        detail: "Visitor is still looking",
      },
    });
  res.json({ ok: true });
});

publicRouter.post("/continue", async (req, res) => {
  const visitId = verifyToken(String(req.body.visitToken), "visit");
  if (!visitId) {
    res.status(400).json({ error: "Session expired" });
    return;
  }
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  const config = await settings();
  if (!config.roundskyUrl) {
    res.status(503).json({ error: "Loan options are not connected yet." });
    return;
  }
  const url = await createRoundSkyApplication({ visitId: visit.id });
  res.set("Cache-Control", "no-store").json({ url });
});

publicRouter.get("/followup-info", async (req, res) => {
  const id = verifyToken(String(req.query.token), "click");
  if (!id) {
    res.status(400).json({ error: "This link has expired" });
    return;
  }
  const delivery = await db.delivery.findUniqueOrThrow({ where: { id } });
  res.json({
    preferenceToken: token("preferences", delivery.subscriptionId, 86400 * 365),
  });
});
