import {
  initializeRuntimeConfiguration,
  saveRuntimeSettings,
  readRuntimeConfiguration,
  withRuntimeConfiguration,
} from "../server/runtime-config";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { Server } from "node:http";
import { Prisma } from "@prisma/client";
import { app } from "../server/index";
import { db } from "../server/db";
import { env, runtimeContext } from "../server/config";
import { token, hash } from "../server/security";
import { landingSchema, settingsSchema } from "../server/domain";
import { activateSubscription, unsubscribe } from "../server/services/journeys";
import {
  saveChain,
  saveSettings,
  settings,
  saveExperiment,
} from "../server/services/control";
import {
  trafficReport,
  followupReport,
  quizAnswerReport,
  recordVisitCosts,
  engagementReport,
} from "../server/services/marketing";
import { sources, blockSource } from "../server/services/traffic";
import { tick } from "../server/services/engine";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import {
  retargetingConfiguration,
  saveRetargetingPlan,
  saveRetargetingSettings,
  validateConfiguration,
  validateRetargetingSetup,
} from "../server/services/retargeting-config";
import {
  qualifyPixels,
  retargetingStatus,
} from "../server/services/retargeting";
import {
  recordRetargetingSpend,
  retargetingReport,
} from "../server/services/retargeting-report";
import { recordPostback } from "../server/services/postbacks";
import {
  statisticsReport,
  statisticsVisits,
} from "../server/services/statistics";
import { landingDesignExamples } from "../server/landing-design-guide";
import { clarityReport } from "../server/services/clarity";
import { recordPreQuizActivity } from "../server/services/engagement";
import { createRoundSkyApplication } from "../server/services/roundsky";
import {
  resetMarketingWorkspace,
  workspaceResetConfirmation,
} from "../server/services/workspace-reset";
let server: Server,
  base: string,
  cookie: string,
  experiment: any,
  visitToken: string,
  visitId: string,
  leadId: string,
  applicationId: string,
  emailId: string,
  initialEmailChainId: string;
const originalFetch = globalThis.fetch,
  providerCalls: any[] = [];
function daytimeTimezone() {
  const zones = [
    "America/Chicago",
    "America/Los_Angeles",
    "Europe/London",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Honolulu",
  ];
  return zones.find((z) => {
    const h = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: z,
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()),
    );
    return h >= 9 && h < 20;
  })!;
}
async function request(
  path: string,
  method = "GET",
  body?: any,
  admin = false,
  headers: Record<string, string> = {},
) {
  const response = await originalFetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: env.APP_URL,
      ...(admin ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}
beforeAll(async () => {
  if (new URL(env.DATABASE_URL).searchParams.get("schema") !== "sparecash_test")
    throw new Error("Tests require the isolated sparecash_test schema");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'sparecash_test' AND tablename <> '_prisma_migrations'`;
  for (const { tablename } of tables)
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE "sparecash_test"."${tablename.replaceAll('"', '""')}" CASCADE`,
    );
  await db.setting.create({
    data: {
      key: "general",
      value: settingsSchema.parse({
        roundskyUrl: "https://roundsky.example.test/offer",
        stopOn: "FUNDED",
        businessAddress: "Test address",
        sendHourStart: 9,
        sendHourEnd: 20,
      }),
    },
  });
  await initializeRuntimeConfiguration({
    APP_URL: "https://sparecash.leadtechx.com",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    LIVE_DELIVERY: "true",
    LIVE_SOURCE_BLOCKING: "false",
    BREVO_API_KEY: "test-brevo",
    BREVO_SENDER_EMAIL: "test@example.com",
    BREVO_FOLDER_ID: 1,
    BLUEBUBBLES_URL: "https://bluebubbles.example.test",
    BLUEBUBBLES_PASSWORD: "test-only",
    ONESIGNAL_APP_ID: "test-app",
    ONESIGNAL_API_KEY: "test-only",
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: any, init: any) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:"))
        return originalFetch(input, init);
      providerCalls.push({ url, ...init });
      if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify")
        return Response.json({ success: true, hostname: "localhost" });
      if (url.includes("/smtp/email"))
        return Response.json({ messageId: "confirmation-test" });
      if (url.includes("/contacts/lists")) return Response.json({ id: 42 });
      if (url.includes("/contacts")) return Response.json({ id: 1 });
      if (url.includes("/emailCampaigns") && url.endsWith("/sendNow"))
        return new Response(null, { status: 204 });
      if (url.includes("/emailCampaigns")) return Response.json({ id: 100 });
      throw new Error(
        `Unexpected outbound provider call: ${new URL(url).hostname}`,
      );
    },
  );
  const initialEmailChain = await saveChain(
    {
      name: "Initial email subscription path",
      channel: "EMAIL",
      status: "ACTIVE",
      trigger: "SUBSCRIBED",
      maxDays: 14,
      steps: [
        {
          delayHours: 24,
          subject: "Your options",
          body: "Hello {{name}}, explore these options: {{link}}",
        },
        {
          delayHours: 24,
          subject: "Next day",
          body: "Here are your next options, {{name}}: {{link}}",
        },
      ],
    },
    "test",
  );
  initialEmailChainId = initialEmailChain.id;
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}, 20000);
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
  await db.$disconnect();
});
it("requires owner authentication and same-origin writes", async () => {
  expect((await request("/api/admin/dashboard")).status).toBe(401);
  expect((await request("/mcp", "POST", {})).status).toBe(401);
  expect(
    (
      await request(
        "/api/auth/login",
        "POST",
        { password: "test-owner-password" },
        false,
        { Origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(403);
  const r = await request("/api/auth/login", "POST", {
    password: "test-owner-password",
  });
  expect(r.status).toBe(200);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  expect(
    (await request("/api/admin/dashboard", "GET", undefined, true)).status,
  ).toBe(200);
});
it("preserves credentials and owner sessions during simultaneous process startup", async () => {
  const original = await readRuntimeConfiguration();
  const configurations = await Promise.all([
    initializeRuntimeConfiguration(),
    initializeRuntimeConfiguration(),
    initializeRuntimeConfiguration(),
  ]);
  for (const configuration of configurations)
    expect(configuration).toEqual(original);
  expect(
    (await request("/api/admin/configuration", "GET", undefined, true)).status,
  ).toBe(200);
});
it("keeps paused experiments out of the owner workspace without deleting them", async () => {
  const paused = await saveExperiment(
    {
      name: "Archived landing",
      slug: "archived-landing",
      status: "PAUSED",
      variants: [
        {
          name: "Control",
          weight: 100,
          config: {
            title: "Archived landing",
            description: "Historical landing retained for reporting.",
          },
        },
      ],
    },
    "test",
  );
  try {
    const workspace = await request(
      "/api/admin/dashboard",
      "GET",
      undefined,
      true,
    );
    expect(workspace.status).toBe(200);
    expect(workspace.data.experiments).not.toContainEqual(
      expect.objectContaining({ id: paused.id }),
    );

    const historical = await request(
      `/api/admin/experiments/${paused.id}`,
      "GET",
      undefined,
      true,
    );
    expect(historical.status).toBe(200);
    expect(historical.data).toMatchObject({ id: paused.id, status: "PAUSED" });
  } finally {
    await db.variant.deleteMany({ where: { experimentId: paused.id } });
    await db.experiment.delete({ where: { id: paused.id } });
  }
});
it("publishes a weighted experiment and keeps visitor assignment stable", async () => {
  const r = await request(
    "/api/admin/experiments",
    "POST",
    {
      name: "Integration experiment",
      slug: "integration",
      status: "ACTIVE",
      objective: "FUNDED",
      variants: [
        {
          name: "A",
          weight: 50,
          config: landingSchema.parse({
            title: "Explore your options",
            description: "A test page for confirmed preferences.",
          }),
        },
        {
          name: "B",
          weight: 50,
          config: landingSchema.parse({
            title: "Your next step",
            description: "A different test page for confirmed preferences.",
          }),
        },
      ],
    },
    true,
  );
  expect(r.status).toBe(200);
  experiment = r.data;
  const a = await request("/api/public/visit", "POST", {
    slug: "integration",
    campaignId: "123",
    zoneId: "456",
    clickId: "click-test",
    adContext: {
      bannerId: "27516444",
      browser: "Chrome",
      browserVersion: "130",
      carrier: "Verizon",
      propellerClickId: "provider-click-test",
      connectionType: "cellular",
      declaredCost: "0.031",
      country: "US",
      device: "Mobile",
      language: "en",
      os: "Android",
      osVersion: "15",
      region: "Illinois",
      subzoneId: "7",
      userAgent: "Propeller supplied agent",
      utmSource: "propellerads",
      utmMedium: "push",
      utmCampaign: "integration",
      utmContent: "27516444",
    },
  });
  expect(a.status).toBe(200);
  visitToken = a.data.visitToken;
  visitId = a.data.visitId;
  expect(
    await db.visit.findUniqueOrThrow({ where: { id: visitId } }),
  ).toMatchObject({
    externalClickId: "click-test",
    adContext: {
      bannerId: "27516444",
      propellerClickId: "provider-click-test",
      declaredCost: "0.031",
      subzoneId: "7",
    },
    costRecorded: false,
  });
  const b = await request(
    "/api/public/visit",
    "POST",
    { slug: "integration" },
    false,
    {
      Cookie: a.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    },
  );
  expect(b.data.visitId).toBe(visitId);
  expect(b.data.config.title).toBe(a.data.config.title);
});
it("rejects honeypots without sending a verification message", async () => {
  const before = providerCalls.length;
  const r = await request("/api/public/subscribe", "POST", {
    visitToken,
    turnstileToken: "test",
    name: "Bot",
    timezone: "America/Chicago",
    answers: {},
    email: "bot@example.com",
    channels: ["EMAIL"],
    consent: true,
    adultUS: true,
    company: "filled",
  });
  expect(r.status).toBe(400);
  expect(providerCalls.length).toBe(before);
  expect(
    (await db.visit.findUniqueOrThrow({ where: { id: visitId } })).botScore,
  ).toBe(100);
});
it("rejects subscriptions without storing contacts or contacting providers when delivery is paused", async () => {
  const previous = await readRuntimeConfiguration();
  const leads = await db.lead.count();
  const subscriptions = await db.subscription.count();
  const calls = providerCalls.length;
  await saveRuntimeSettings({ values: { LIVE_DELIVERY: "false" } }, "test");
  try {
    const response = await request("/api/public/subscribe", "POST", {
      visitToken,
      channels: ["EMAIL"],
      email: "paused@example.com",
      answers: {},
      consent: true,
      adultUS: true,
    });
    expect(response.status).toBe(503);
    expect(await db.lead.count()).toBe(leads);
    expect(await db.subscription.count()).toBe(subscriptions);
    expect(providerCalls.length).toBe(calls);
  } finally {
    await saveRuntimeSettings(
      {
        values: { LIVE_DELIVERY: previous.LIVE_DELIVERY },
        credentialsReviewed: true,
      },
      "test",
    );
  }
});
it("records the rendered consent snapshot and waits for email confirmation", async () => {
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  await db.visit.update({
    where: { id: visitId },
    data: {
      verified: true,
      verificationState: "VERIFIED",
      verificationExpiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const oldConsent = (visit.configSnapshot as any).emailConsent;
  await db.variant.update({
    where: { id: visit.variantId },
    data: {
      config: {
        ...(visit.configSnapshot as any),
        emailConsent: "A newer consent sentence not shown to this visitor.",
      },
    },
  });
  const r = await request("/api/public/subscribe", "POST", {
    visitToken,
    turnstileToken: "test",
    name: "Test Visitor",
    timezone: "America/Chicago",
    answers: {},
    email: "visitor@example.com",
    channels: ["EMAIL"],
    consent: true,
    adultUS: true,
    company: "",
  });
  expect(r.status).toBe(200);
  leadId = r.data.leadId;
  const sub = await db.subscription.findFirstOrThrow({ where: { leadId } });
  emailId = sub.id;
  expect(sub.status).toBe("PENDING");
  expect(sub.consentText).toBe(oldConsent);
  expect(
    providerCalls.filter((c) => c.url.includes("/smtp/email")),
  ).toHaveLength(1);
  expect(
    (
      await request("/api/public/confirm", "POST", {
        token: token("confirm", sub.id),
      })
    ).status,
  ).toBe(200);
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
  ).toBe("ACTIVE");
  const offer = await request("/api/public/application", "POST", {
    leadToken: r.data.leadToken,
  });
  expect(offer.status).toBe(200);
  applicationId = new URL(offer.data.url).searchParams.get("subId3")!;
  expect(applicationId).toBeTruthy();
});
it("sends a due email once and enforces the next-day cap", async () => {
  const timezone = daytimeTimezone();
  await db.lead.update({ where: { id: leadId }, data: { timezone } });
  const enrollment = await db.enrollment.findFirstOrThrow({
    where: {
      chainId: initialEmailChainId,
      subscriptionId: emailId,
      status: "ACTIVE",
    },
  });
  await db.enrollment.update({
    where: { id: enrollment.id },
    data: { nextAt: new Date(Date.now() - 1000) },
  });
  expect(((await tick()) as any).sent).toBe(1);
  await tick();
  expect(
    await db.delivery.count({
      where: { subscriptionId: emailId, status: "SENT" },
    }),
  ).toBe(1);
  expect(providerCalls.filter((c) => c.url.endsWith("/sendNow"))).toHaveLength(
    1,
  );
  const sent = await db.delivery.findFirstOrThrow({
    where: { subscriptionId: emailId },
  });
  expect(sent.body).toContain("/follow-up?token=");
  expect(sent.body).not.toContain("{{name}}");
});
it("deduplicates postbacks, stops funded journeys, and rejects downgrades", async () => {
  const headers = { "x-webhook-token": env.WEBHOOK_TOKEN };
  expect(
    (
      await request("/api/webhooks/roundsky", "POST", {
        eventId: "sale-1",
        applicationId,
        event: "SOLD",
        revenue: 25,
      })
    ).status,
  ).toBe(401);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await request(
          "/api/webhooks/roundsky",
          "POST",
          { eventId: "sale-1", applicationId, event: "SOLD", revenue: 25 },
          false,
          headers,
        )
      ).status,
    ).toBe(200);
  expect(await db.postback.count()).toBe(1);
  expect(
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).status,
  ).toBe("SOLD");
  expect(
    await db.enrollment.count({
      where: { subscriptionId: emailId, status: "ACTIVE" },
    }),
  ).toBe(1);
  await request(
    "/api/webhooks/roundsky",
    "POST",
    { eventId: "funded-1", applicationId, event: "FUNDED", revenue: 0 },
    false,
    headers,
  );
  await request(
    "/api/webhooks/roundsky",
    "POST",
    { eventId: "late-decline", applicationId, event: "DECLINED" },
    false,
    headers,
  );
  expect(
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).status,
  ).toBe("FUNDED");
  expect(
    await db.enrollment.count({
      where: { subscriptionId: emailId, status: "ACTIVE" },
    }),
  ).toBe(0);
  expect(
    Number(
      (await db.postback.aggregate({ _sum: { revenue: true } }))._sum.revenue,
    ),
  ).toBe(25);
});
it("a provider suppression cancels pending deliveries and blocks confirmation replay", async () => {
  const enrollment = await db.enrollment.findFirstOrThrow({
    where: { subscriptionId: emailId },
  });
  await db.delivery.create({
    data: {
      subscriptionId: emailId,
      enrollmentId: enrollment.id,
      step: 4,
      subject: "Pending",
      body: "Should be cancelled",
    },
  });
  await request(
    "/api/webhooks/brevo",
    "POST",
    { event: "unsubscribe", email: "visitor@example.com" },
    false,
    { "x-webhook-token": env.WEBHOOK_TOKEN },
  );
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: emailId } }))
      .status,
  ).toBe("UNSUBSCRIBED");
  expect(
    await db.delivery.count({
      where: { subscriptionId: emailId, status: "PENDING" },
    }),
  ).toBe(0);
  await request("/api/public/confirm", "POST", {
    token: token("confirm", emailId),
  });
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: emailId } }))
      .status,
  ).toBe("UNSUBSCRIBED");
});
it("implements MCP initialization, tool discovery and authenticated tool calls", async () => {
  const client = new Client({
    name: "sparecash-integration-test",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${env.MCP_TOKEN}` } },
  });
  await client.connect(transport);
  const tools = await client.listTools();
  expect(tools.tools.length).toBeGreaterThanOrEqual(18);
  expect(tools.tools.some((t) => t.name === "save_chain")).toBe(true);
  expect(tools.tools.some((t) => t.name === "set_lead_timezone")).toBe(true);
  expect(tools.tools.some((t) => t.name === "test_provider_connection")).toBe(
    true,
  );
  const readiness = await client.callTool({
    name: "subscription_readiness",
    arguments: {},
  });
  expect(readiness.isError).not.toBe(true);
  expect(JSON.stringify(readiness)).toContain("availableChannels");
  expect(JSON.stringify(readiness)).not.toContain(env.BREVO_API_KEY);
  const result = await client.callTool({ name: "dashboard", arguments: {} });
  const serialized = JSON.stringify(result);
  expect(serialized).toContain("funded");
  expect(serialized).not.toContain(env.MCP_TOKEN);
  expect(serialized).not.toContain(env.BREVO_API_KEY);
  const createdExperiment = await client.callTool({
    name: "save_experiment",
    arguments: {
      experiment: {
        name: "MCP quiz funnel",
        slug: "mcp-quiz-funnel",
        status: "DRAFT",
        variants: [
          {
            name: "Quiz",
            weight: 100,
            config: {
              title: "Explore your loan options",
              description: "Choose your preferences to see your next steps.",
              questions: [
                {
                  id: "amount",
                  label: "How much are you looking for?",
                  options: ["1000", "2500"],
                },
              ],
            },
          },
        ],
      },
    },
  });
  expect(createdExperiment.isError).not.toBe(true);
  expect(
    (
      await db.experiment.findUniqueOrThrow({
        where: { slug: "mcp-quiz-funnel" },
        include: { variants: true },
      })
    ).variants,
  ).toHaveLength(1);
  const createdChain = await client.callTool({
    name: "save_chain",
    arguments: {
      chain: {
        name: "MCP draft push chain",
        channel: "PUSH",
        status: "DRAFT",
        trigger: "CLICKED",
        steps: [
          {
            delayHours: 24,
            subject: "Explore your options",
            body: "Hi {{name}}, here is your next step: {{link}}",
          },
        ],
      },
    },
  });
  expect(createdChain.isError).not.toBe(true);
  const changed = await client.callTool({
    name: "set_lead_timezone",
    arguments: { id: leadId, timezone: "America/Denver" },
  });
  expect(changed.isError).not.toBe(true);
  expect(
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).timezoneSource,
  ).toBe("MANUAL");
  expect(
    await db.auditLog.count({
      where: {
        entityId: leadId,
        actor: "mcp",
        action: "lead.timezone_updated",
      },
    }),
  ).toBe(1);
  await client.close();
});

it("accepts the approved API key header used by Claude Desktop", async () => {
  const client = new Client({
    name: "sparecash-claude-desktop-test",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { "x-api-key": env.MCP_TOKEN } },
  });
  await client.connect(transport);
  const tools = await client.listTools();
  expect(tools.tools.some((tool) => tool.name === "dashboard")).toBe(true);
  await client.close();
});

it("retains the assigned variant while attributing a new paid click separately", async () => {
  const original = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  const r = await request(
    "/api/public/visit",
    "POST",
    {
      slug: "integration",
      campaignId: "123",
      zoneId: "789",
      clickId: "new-paid-click",
    },
    false,
    {
      Cookie: `sc_visit_integration=${visitToken}; sc_journey=${token("journey", original.journeyId!)}`,
    },
  );
  expect(r.status).toBe(200);
  expect(r.data.visitId).not.toBe(visitId);
  const created = await db.visit.findUniqueOrThrow({
    where: { id: r.data.visitId },
    include: { source: true },
  });
  expect(created.variantId).toBe(original.variantId);
  expect(created.source?.zoneId).toBe("789");
});
it("evaluates source evidence in bulk and records a dry-run without advertiser writes", async () => {
  const source = await db.trafficSource.create({
    data: { campaignId: "999", zoneId: "888" },
  });
  await db.visit.createMany({
    data: Array.from({ length: 200 }, (_, i) => ({
      experimentId: experiment.id,
      variantId: experiment.variants[0].id,
      sourceId: source.id,
      ipHash: `test-${i}`,
      userAgent: "test-agent",
      botScore: 100,
      evidence: ["Hidden field completed"],
      createdAt: new Date(Date.now() - 48 * 3600000),
    })),
  });
  const summary = (await sources()).find((s) => s.id === source.id)!;
  expect(summary.total).toBe(200);
  expect(summary.eligible).toBe(true);
  const before = providerCalls.length;
  expect((await blockSource(source.id, "test")).status).toBe("dry_run");
  expect(providerCalls.length).toBe(before);
  expect(
    (await db.trafficSource.findUniqueOrThrow({ where: { id: source.id } }))
      .state,
  ).toBe("RECOMMENDED");
});
it("holds uncertain provider outcomes without a blind retry", async () => {
  const lead = await db.lead.create({
    data: {
      name: "Ambiguous send",
      visitId,
      timezone: daytimeTimezone(),
      answers: {},
    },
  });
  const sub = await db.subscription.create({
    data: {
      leadId: lead.id,
      channel: "PUSH",
      address: "67c5174a-0000-4000-8000-000000000001",
      status: "ACTIVE",
      consentText: "Test push subscription",
      consentVersion: "test",
      consentIpHash: "test",
    },
  });
  const chain = await saveChain(
    {
      name: "Uncertain push test",
      channel: "PUSH",
      status: "ACTIVE",
      steps: [
        {
          delayHours: 24,
          subject: "Test push",
          body: "Test push for {{name}}: {{link}}",
        },
      ],
    },
    "test",
  );
  await db.enrollment.create({
    data: {
      chainId: chain.id,
      subscriptionId: sub.id,
      nextAt: new Date(Date.now() - 1000),
    },
  });
  await tick();
  const calls = providerCalls.filter((c) =>
    c.url.includes("api.onesignal.com/notifications"),
  ).length;
  expect(calls).toBe(1);
  expect(
    (await db.delivery.findFirstOrThrow({ where: { subscriptionId: sub.id } }))
      .status,
  ).toBe("UNCERTAIN");
  await tick();
  expect(
    providerCalls.filter((c) =>
      c.url.includes("api.onesignal.com/notifications"),
    ),
  ).toHaveLength(calls);
});
it("handles inbound SMS STOP only for incoming messages", async () => {
  const sub = await db.subscription.create({
    data: {
      leadId,
      channel: "SMS",
      address: "+13125550100",
      status: "ACTIVE",
      consentText: "Test SMS subscription",
      consentVersion: "test",
      consentIpHash: "test",
    },
  });
  const payload = {
    type: "new-message",
    data: { text: "STOP", isFromMe: true, handle: { address: "+13125550100" } },
  };
  const headers = { "x-webhook-token": env.WEBHOOK_TOKEN };
  await request("/api/webhooks/bluebubbles", "POST", payload, false, headers);
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
  ).toBe("ACTIVE");
  payload.data.isFromMe = false;
  await request("/api/webhooks/bluebubbles", "POST", payload, false, headers);
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
  ).toBe("UNSUBSCRIBED");
});

it("generates a native sale pixel only for the authenticated owner", async () => {
  expect((await request("/api/admin/integrations/roundsky/pixel")).status).toBe(
    401,
  );
  const response = await request(
    "/api/admin/integrations/roundsky/pixel",
    "GET",
    undefined,
    true,
  );
  expect(response.status).toBe(200);
  expect(response.data.origin).toBe("https://sparecash.leadtechx.com");
  expect(response.data.pixelType).toBe("Server 2 Server Requst Pixel");
  expect(response.data.pixelUrl).toContain(
    "hid=[subId3]&price=[price]&transactionId=[transactionId]",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});

async function nativeSaleFixture() {
  const config = settingsSchema.parse(
    (await db.setting.findUniqueOrThrow({ where: { key: "general" } })).value,
  );
  await db.setting.update({
    where: { key: "general" },
    data: { value: { ...config, stopOn: "SOLD" } },
  });
  const lead = await db.lead.create({
    data: {
      name: "Native sale visitor",
      visitId,
      timezone: "America/Chicago",
      answers: {},
    },
  });
  const suffix = lead.id;
  const email = await db.subscription.create({
    data: {
      leadId: lead.id,
      channel: "EMAIL",
      address: `${suffix}@example.com`,
      status: "ACTIVE",
      consentText: "A test subscription",
      consentVersion: "test",
      consentIpHash: "test",
    },
  });
  const sms = await db.subscription.create({
    data: {
      leadId: lead.id,
      channel: "SMS",
      address: suffix,
      status: "ACTIVE",
      consentText: "A test subscription",
      consentVersion: "test",
      consentIpHash: "test",
    },
  });
  const chain = await db.chain.findFirstOrThrow({
    where: { channel: "EMAIL" },
  });
  for (const sub of [email, sms]) {
    const enrollment = await db.enrollment.create({
      data: {
        chainId: chain.id,
        subscriptionId: sub.id,
        nextAt: new Date(Date.now() + 86400000),
      },
    });
    await db.delivery.create({
      data: {
        enrollmentId: enrollment.id,
        subscriptionId: sub.id,
        step: 0,
        subject: "Queued",
        body: "A queued follow-up",
      },
    });
  }
  const response = await request("/api/public/application", "POST", {
    leadToken: token("lead", lead.id),
  });
  expect(response.status).toBe(200);
  const url = new URL(response.data.url);
  expect(url.searchParams.get("subId")).toBe("123");
  expect(url.searchParams.get("subId2")).toBe("456");
  expect(url.searchParams.get("firstName")).toBe("Native sale visitor");
  expect(url.searchParams.get("email")).toBe(email.address);
  return { lead, applicationId: url.searchParams.get("subId3")! };
}

it("records the actual S2S sale once, cancels all channels, and never marks funding", async () => {
  const fixture = await nativeSaleFixture();
  const { roundSkyWebhookSecret } = await import("../server/services/roundsky");
  const query = new URLSearchParams({
    token: roundSkyWebhookSecret(),
    hid: fixture.applicationId,
    price: "5.00",
    transactionId: "8454843145",
    event: "FUNDED",
  });
  const beforeRevenue = (
    await db.postback.aggregate({ _sum: { revenue: true } })
  )._sum.revenue!;
  const results = await Promise.all([
    request(`/api/webhooks/roundsky/sold?${query}`),
    request(`/api/webhooks/roundsky/sold?${query}`),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(results.filter((r) => r.data.duplicate)).toHaveLength(1);
  const stored = await db.postback.findUniqueOrThrow({
    where: { eventId: "roundsky:sold:8454843145" },
  });
  expect(stored.applicationId).toBe(fixture.applicationId);
  expect(stored.event).toBe("SOLD");
  expect(stored.revenue.toFixed(2)).toBe("5.00");
  const afterRevenue = (
    await db.postback.aggregate({ _sum: { revenue: true } })
  )._sum.revenue!;
  expect(afterRevenue.sub(beforeRevenue).toString()).toBe("5");
  expect(
    (await db.lead.findUniqueOrThrow({ where: { id: fixture.lead.id } }))
      .status,
  ).toBe("SOLD");
  expect(
    await db.enrollment.count({
      where: { subscription: { leadId: fixture.lead.id }, status: "ACTIVE" },
    }),
  ).toBe(0);
  expect(
    await db.delivery.count({
      where: { subscription: { leadId: fixture.lead.id }, status: "CANCELLED" },
    }),
  ).toBe(2);
  expect(
    await db.leadEvent.count({
      where: { leadId: fixture.lead.id, type: "SOLD" },
    }),
  ).toBe(1);
  expect(results[0].headers.get("cache-control")).toBe("no-store");
});

it("rejects unauthenticated, malformed, and conflicting RoundSky callbacks", async () => {
  const fixture = await nativeSaleFixture();
  const { roundSkyWebhookSecret } = await import("../server/services/roundsky");
  const body = {
    hid: fixture.applicationId,
    price: "12.34",
    transactionId: "sale-conflict-test",
  };
  expect(
    (await request("/api/webhooks/roundsky/sold", "POST", body)).status,
  ).toBe(401);
  expect(
    (
      await request("/api/webhooks/roundsky/sold", "POST", body, false, {
        "x-webhook-token": env.WEBHOOK_TOKEN,
      })
    ).status,
  ).toBe(401);
  const headers = { "x-webhook-token": roundSkyWebhookSecret() };
  const count = await db.postback.count();
  expect(
    (
      await request(
        "/api/webhooks/roundsky/sold",
        "POST",
        { ...body, price: "[price]" },
        false,
        headers,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        "/api/webhooks/roundsky/sold",
        "POST",
        { ...body, hid: "00000000-0000-4000-8000-000000000001" },
        false,
        headers,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        "/api/webhooks/roundsky/sold",
        "DELETE",
        body,
        false,
        headers,
      )
    ).status,
  ).toBe(405);
  expect(await db.postback.count()).toBe(count);
  expect(
    (await request("/api/webhooks/roundsky/sold", "POST", body, false, headers))
      .status,
  ).toBe(200);
  expect(
    (
      await request(
        "/api/webhooks/roundsky/sold",
        "POST",
        { ...body, price: "99.00" },
        false,
        headers,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        "/api/webhooks/roundsky/sold",
        "POST",
        { ...body, hid: applicationId },
        false,
        headers,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await db.postback.findUniqueOrThrow({
        where: { eventId: "roundsky:sold:sale-conflict-test" },
      })
    ).revenue.toString(),
  ).toBe("12.34");
});

it("keeps skip-subscription redirects attributable without forwarding someone else's contacts", async () => {
  const response = await request("/api/public/continue", "POST", {
    visitToken,
  });
  expect(response.status).toBe(200);
  const url = new URL(response.data.url);
  expect(url.searchParams.get("subId3")).toMatch(/^[a-f0-9-]{36}$/);
  expect(url.searchParams.get("subId")).toBe("123");
  for (const key of ["firstName", "email", "homePhone"])
    expect(url.searchParams.has(key)).toBe(false);
  const app = await db.applicationClick.findUniqueOrThrow({
    where: { id: url.searchParams.get("subId3")! },
  });
  expect(app.leadId).toBeNull();
  expect(app.visitId).toBe(visitId);
});

it("attributes follow-up applications and honors the contact prefill setting", async () => {
  const fixture = await nativeSaleFixture();
  const delivery = await db.delivery.findFirstOrThrow({
    where: { subscription: { leadId: fixture.lead.id, channel: "EMAIL" } },
  });
  await db.lead.update({
    where: { id: fixture.lead.id },
    data: { answers: { rla: "2500" } },
  });
  const response = await request("/api/public/followup", "POST", {
    token: token("click", delivery.id),
  });
  expect(response.status).toBe(200);
  const url = new URL(response.data.url);
  expect(url.searchParams.get("subId3")).not.toBe(fixture.applicationId);
  expect(url.searchParams.get("subId")).toBe("123");
  expect(url.searchParams.get("subId2")).toBe("456");
  expect(url.searchParams.get("rla")).toBe("2500");
  const application = await db.applicationClick.findUniqueOrThrow({
    where: { id: url.searchParams.get("subId3")! },
  });
  expect(application.deliveryId).toBe(delivery.id);
  expect(application.visitId).toBe(visitId);
  expect(application.leadId).toBe(fixture.lead.id);
  expect(
    (await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .clickCount,
  ).toBe(1);

  const email = await db.subscription.findFirstOrThrow({
    where: { leadId: fixture.lead.id, channel: "EMAIL" },
  });
  await unsubscribe(email.id, "Test opt-out");
  const unsubscribed = await request("/api/public/application", "POST", {
    leadToken: token("lead", fixture.lead.id),
  });
  expect(new URL(unsubscribed.data.url).searchParams.has("email")).toBe(false);

  const config = settingsSchema.parse(
    (await db.setting.findUniqueOrThrow({ where: { key: "general" } })).value,
  );
  await db.setting.update({
    where: { key: "general" },
    data: { value: { ...config, roundskyPrepopulate: false } },
  });
  try {
    const disabled = await request("/api/public/followup", "POST", {
      token: token("click", delivery.id),
    });
    expect(disabled.status).toBe(200);
    const disabledUrl = new URL(disabled.data.url);
    for (const field of ["firstName", "email", "homePhone", "rla"])
      expect(disabledUrl.searchParams.has(field)).toBe(false);
    expect(disabledUrl.searchParams.get("subId3")).toBeTruthy();
  } finally {
    await db.setting.update({
      where: { key: "general" },
      data: { value: config },
    });
  }
});

it("detects lead time zones without trusting forged IP headers", async () => {
  const previous = await settings();
  const previousToken = env.CLOUDFLARE_GEO_TOKEN;
  await saveRuntimeSettings(
    {
      secrets: {
        CLOUDFLARE_GEO_TOKEN: "test-only-cloudflare-geo-secret-32-characters",
      },
    },
    "test",
  );
  await saveSettings(
    {
      ...previous,
      timezoneDetection: "IP_FIRST",
      workspaceTimezone: "America/Chicago",
    },
    "test",
  );
  try {
    for (const entry of [
      {
        browser: "America/Denver",
        trusted: false,
        ip: "Pacific/Honolulu",
        expected: "America/Denver",
        source: "BROWSER",
      },
      {
        browser: "America/Denver",
        trusted: true,
        ip: "Pacific/Honolulu",
        expected: "Pacific/Honolulu",
        source: "IP",
      },
      {
        browser: "bad/timezone",
        trusted: true,
        ip: "also/bad",
        expected: "America/Chicago",
        source: "DEFAULT",
      },
    ]) {
      const result = await request(
        "/api/public/subscribe",
        "POST",
        {
          visitToken,
          turnstileToken: "test",
          name: "Time zone capture",
          timezone: entry.browser,
          channels: ["PUSH"],
          answers: {},
          consent: true,
          adultUS: true,
        },
        false,
        {
          "cf-timezone": entry.ip,
          ...(entry.trusted
            ? { "x-sparecash-geo-token": env.CLOUDFLARE_GEO_TOKEN }
            : {}),
        },
      );
      expect(result.status).toBe(200);
      const lead = await db.lead.findUniqueOrThrow({
        where: { id: result.data.leadId },
      });
      expect(lead.timezone).toBe(entry.expected);
      expect(lead.timezoneSource).toBe(entry.source);
    }
  } finally {
    await saveRuntimeSettings(
      { secrets: { CLOUDFLARE_GEO_TOKEN: previousToken } },
      "test",
    );
    await saveSettings(previous, "test");
  }
});

it("validates owner time-zone overrides and rechecks deferred enrollments", async () => {
  const fixture = await nativeSaleFixture();
  const original = await settings();
  const due = new Date(Date.now() + 3600000);
  await db.enrollment.updateMany({
    where: { subscription: { leadId: fixture.lead.id } },
    data: { deferredUntil: due },
  });
  const route = `/api/admin/leads/${fixture.lead.id}/timezone`;
  expect(
    (await request(route, "PUT", { timezone: "America/Los_Angeles" })).status,
  ).toBe(401);
  expect(
    (await request(route, "PUT", { timezone: "Mars/Base" }, true)).status,
  ).toBe(400);
  expect(
    (await request(route, "PUT", { timezone: "America/Los_Angeles" }, true))
      .status,
  ).toBe(200);
  expect(
    await db.enrollment.count({
      where: {
        subscription: { leadId: fixture.lead.id },
        deferredUntil: { not: null },
      },
    }),
  ).toBe(0);
  const details = await request(
    `/api/admin/leads/${fixture.lead.id}`,
    "GET",
    undefined,
    true,
  );
  expect(details.data.timezoneSource).toBe("MANUAL");
  expect(details.data.timing.timezone).toBe("America/Los_Angeles");
  await db.enrollment.updateMany({
    where: { subscription: { leadId: fixture.lead.id } },
    data: { deferredUntil: due },
  });
  try {
    await saveSettings(
      {
        ...original,
        followupTimezoneMode: "WORKSPACE",
        workspaceTimezone: "America/New_York",
      },
      "test",
    );
    expect(
      await db.enrollment.count({
        where: { status: "ACTIVE", deferredUntil: { not: null } },
      }),
    ).toBe(0);
    const fixed = await request(
      `/api/admin/leads/${fixture.lead.id}`,
      "GET",
      undefined,
      true,
    );
    expect(fixed.data.timezone).toBe("America/Los_Angeles");
    expect(fixed.data.timing.timezone).toBe("America/New_York");
  } finally {
    await saveSettings(original, "test");
  }
});

it("defers quiet-hour leads so a later eligible recipient is not starved", async () => {
  const previous = await settings();
  await db.enrollment.updateMany({
    where: { status: "ACTIVE" },
    data: { status: "STOPPED" },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-08T14:00:00Z")); // 10am New York; 7am Los Angeles after DST.
  try {
    await saveSettings(
      {
        ...previous,
        followupTimezoneMode: "RECIPIENT",
        sendHourStart: 10,
        sendHourEnd: 18,
      },
      "test",
    );
    const chain = await saveChain(
      {
        name: "Time zone queue test",
        channel: "EMAIL",
        status: "ACTIVE",
        steps: [
          {
            delayHours: 24,
            subject: "Your next step",
            body: "Hello {{name}}, continue here: {{link}}",
          },
        ],
      },
      "test",
    );
    let eligibleId = "";
    for (let index = 0; index < 11; index++) {
      const lead = await db.lead.create({
        data: {
          name: "Timing test",
          visitId,
          answers: {},
          timezone: index < 10 ? "America/Los_Angeles" : "America/New_York",
          timezoneSource: "BROWSER",
        },
      });
      const sub = await db.subscription.create({
        data: {
          leadId: lead.id,
          channel: "EMAIL",
          address: `${lead.id}@example.com`,
          status: "ACTIVE",
          consentText: "Test consent",
          consentVersion: "test",
          consentIpHash: "test",
        },
      });
      const enrollment = await db.enrollment.create({
        data: {
          chainId: chain.id,
          subscriptionId: sub.id,
          nextAt: new Date(Date.now() - (11 - index) * 1000),
          startedAt: new Date(),
        },
      });
      if (index === 10) eligibleId = enrollment.id;
    }
    expect(((await tick()) as any).sent).toBe(0);
    expect(
      await db.enrollment.count({
        where: {
          chainId: chain.id,
          deferredUntil: new Date("2026-03-08T17:00:00Z"),
        },
      }),
    ).toBe(10);
    expect(((await tick()) as any).sent).toBe(1);
    expect(
      (await db.enrollment.findUniqueOrThrow({ where: { id: eligibleId } }))
        .status,
    ).toBe("COMPLETED");
    expect(
      await db.delivery.count({
        where: { enrollment: { chainId: chain.id }, status: "SENT" },
      }),
    ).toBe(1);
  } finally {
    vi.useRealTimers();
    await saveSettings(previous, "test");
  }
});

it("keeps connection credentials private and applies masked settings patches", async () => {
  expect((await request("/api/admin/configuration")).status).toBe(401);
  expect(
    (
      await request("/api/admin/configuration", "PATCH", {
        values: { LIVE_DELIVERY: "false" },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/api/admin/configuration/reveal", "POST", {
        name: "MCP_TOKEN",
      })
    ).status,
  ).toBe(401);
  const original = await readRuntimeConfiguration();
  const response = await request(
    "/api/admin/configuration",
    "GET",
    undefined,
    true,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.data.secrets.MCP_TOKEN).toBe(true);
  const serialized = JSON.stringify(response.data);
  for (const secret of [
    original.MCP_TOKEN,
    original.ROUNDSKY_WEBHOOK_TOKEN,
    original.BREVO_API_KEY,
    original.ADMIN_PASSWORD_HASH,
  ])
    expect(serialized).not.toContain(secret);
  const stored = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  expect(stored.secrets).toMatchObject({
    MCP_TOKEN: original.MCP_TOKEN,
    ROUNDSKY_WEBHOOK_TOKEN: original.ROUNDSKY_WEBHOOK_TOKEN,
    BREVO_API_KEY: original.BREVO_API_KEY,
  });
  expect(stored.encryptedSecrets).toBeNull();
  expect(JSON.stringify(stored)).not.toContain(env.OWNER_PASSWORD);
  expect(serialized).not.toContain(env.OWNER_PASSWORD);
  expect(
    (
      await request(
        "/api/admin/configuration/reveal",
        "POST",
        { name: "ADMIN_PASSWORD_HASH" },
        true,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        "/api/admin/configuration",
        "PATCH",
        { values: { LIVE_DELIVERY: "false" } },
        true,
        { Origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/admin/configuration",
        "PATCH",
        { secrets: { MCP_TOKEN: "short" } },
        true,
      )
    ).status,
  ).toBe(400);
  const changed = await request(
    "/api/admin/configuration",
    "PATCH",
    { values: { BREVO_SENDER_NAME: "New sender" } },
    true,
  );
  expect(changed.status).toBe(200);
  expect((await readRuntimeConfiguration()).MCP_TOKEN).toBe(original.MCP_TOKEN);
  expect((await readRuntimeConfiguration()).BREVO_API_KEY).toBe(
    original.BREVO_API_KEY,
  );
  await saveRuntimeSettings(
    { values: { BREVO_SENDER_NAME: original.BREVO_SENDER_NAME } },
    "test",
  );
});

it("rotates callback and MCP credentials without restart or leaking them into audits", async () => {
  const previous = await readRuntimeConfiguration();
  const newMcp = "mcp-test-rotation-32-characters-minimum-secret";
  const newRoundsky = "roundsky-test-rotation-32-characters-minimum-secret";
  try {
    const update = await request(
      "/api/admin/configuration",
      "PATCH",
      { secrets: { MCP_TOKEN: newMcp, ROUNDSKY_WEBHOOK_TOKEN: newRoundsky } },
      true,
    );
    expect(update.status).toBe(200);
    expect(JSON.stringify(update.data)).not.toContain(newMcp);
    expect(
      (
        await request("/mcp", "POST", {}, false, {
          Authorization: `Bearer ${previous.MCP_TOKEN}`,
        })
      ).status,
    ).toBe(401);
    const client = new Client({ name: "rotated-credentials", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${newMcp}` } },
      }),
    );
    const result = await client.callTool({ name: "dashboard", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toContain(newRoundsky);
    await client.close();
    const pixel = await request(
      "/api/admin/integrations/roundsky/pixel",
      "GET",
      undefined,
      true,
    );
    expect(new URL(pixel.data.pixelUrl).searchParams.get("token")).toBe(
      newRoundsky,
    );
    const body = {
      hid: "00000000-0000-4000-8000-000000000001",
      price: "1.00",
      transactionId: "rotation",
    };
    expect(
      (
        await request("/api/webhooks/roundsky/sold", "POST", body, false, {
          "x-webhook-token": previous.ROUNDSKY_WEBHOOK_TOKEN,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/api/webhooks/roundsky/sold", "POST", body, false, {
          "x-webhook-token": newRoundsky,
        })
      ).status,
    ).toBe(404);
    const audit = JSON.stringify(
      await db.auditLog.findMany({
        where: { action: "configuration.updated" },
      }),
    );
    expect(audit).not.toContain(newMcp);
    expect(audit).not.toContain(newRoundsky);
    expect(audit).toContain("ROUNDSKY_WEBHOOK_TOKEN");
  } finally {
    await saveRuntimeSettings(
      {
        secrets: {
          MCP_TOKEN: previous.MCP_TOKEN,
          ROUNDSKY_WEBHOOK_TOKEN: previous.ROUNDSKY_WEBHOOK_TOKEN,
        },
      },
      "test",
    );
  }
});

it("keeps in-flight snapshots stable while a new worker cycle reads saved settings", async () => {
  const previous = await readRuntimeConfiguration();
  await withRuntimeConfiguration(async () => {
    expect(env.LIVE_DELIVERY).toBe(previous.LIVE_DELIVERY);
    await saveRuntimeSettings({ values: { LIVE_DELIVERY: "false" } }, "test");
    expect(env.LIVE_DELIVERY).toBe(previous.LIVE_DELIVERY);
    await withRuntimeConfiguration(async () =>
      expect(env.LIVE_DELIVERY).toBe("false"),
    );
  });
  const before = providerCalls.length;
  await tick();
  expect(providerCalls.length).toBe(before);
  // Legacy environment input cannot overwrite an existing database configuration.
  await initializeRuntimeConfiguration({
    LIVE_DELIVERY: "true",
    APP_URL: "https://wrong.example",
  });
  expect((await readRuntimeConfiguration()).LIVE_DELIVERY).toBe("false");
  expect((await readRuntimeConfiguration()).APP_URL).toBe(previous.APP_URL);
  await saveRuntimeSettings(
    { values: { LIVE_DELIVERY: previous.LIVE_DELIVERY } },
    "test",
  );
});

it("rejects malformed database credentials without resetting them", async () => {
  const original = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  try {
    await db.appConfiguration.update({
      where: { id: "main" },
      data: {
        secrets: { invalid: true },
      },
    });
    await expect(readRuntimeConfiguration()).rejects.toThrow();
    await expect(initializeRuntimeConfiguration()).rejects.toThrow();
    expect(
      (await db.appConfiguration.findUniqueOrThrow({ where: { id: "main" } }))
        .secrets,
    ).toEqual({ invalid: true });
  } finally {
    await db.appConfiguration.update({
      where: { id: "main" },
      data: { secrets: original.secrets! },
    });
  }
});

it("protects connection tests and reply URLs with owner authentication and origin checks", async () => {
  const before = providerCalls.length;
  expect(
    (await request("/api/admin/integrations/onesignal/test", "POST")).status,
  ).toBe(401);
  expect(
    (await request("/api/admin/integrations/bluebubbles/webhook")).status,
  ).toBe(401);
  expect(
    (
      await request(
        "/api/admin/integrations/onesignal/test",
        "POST",
        {},
        true,
        { Origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await request("/api/admin/integrations/unknown/test", "POST", {}, true))
      .status,
  ).toBe(400);
  expect(providerCalls.length).toBe(before);
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    Response.json({ notifications: [] }),
  );
  const tested = await request(
    "/api/admin/integrations/onesignal/test",
    "POST",
    {},
    true,
  );
  expect(tested.status).toBe(200);
  expect(tested.data.status).toBe("success");
  expect(tested.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(tested.data)).not.toContain(env.ONESIGNAL_API_KEY);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: "integration.tested", entityId: "onesignal" },
    orderBy: { createdAt: "desc" },
  });
  expect(audit.details).toEqual({ status: "success" });
});

it("builds the BlueBubbles reply URL from the saved domain and current general webhook token", async () => {
  const original = await readRuntimeConfiguration();
  try {
    const newToken = "rotated-general-webhook-token-test-32-characters";
    await saveRuntimeSettings(
      {
        values: { APP_URL: "https://replies.example.test" },
        secrets: { WEBHOOK_TOKEN: newToken },
      },
      "test",
    );
    const response = await request(
      "/api/admin/integrations/bluebubbles/webhook",
      "GET",
      undefined,
      true,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const url = new URL(response.data.webhookUrl);
    expect(url.origin).toBe("https://replies.example.test");
    expect(url.pathname).toBe("/api/webhooks/bluebubbles");
    expect(url.searchParams.get("token")).toBe(newToken);
    expect(response.data.event).toBe("new-message");
  } finally {
    await saveRuntimeSettings(
      {
        values: { APP_URL: original.APP_URL },
        secrets: { WEBHOOK_TOKEN: original.WEBHOOK_TOKEN },
      },
      "test",
    );
  }
});

it("records incoming text replies once and keeps STOP cancellation working", async () => {
  const sub = await db.subscription.create({
    data: {
      leadId,
      channel: "SMS",
      address: "+12025550999",
      status: "ACTIVE",
      consentText: "Test opt-in",
      consentVersion: "test",
      consentIpHash: "test",
    },
  });
  const chain = await db.chain.create({
    data: { name: "Reply test", channel: "SMS", status: "ACTIVE" },
  });
  const enrollment = await db.enrollment.create({
    data: { subscriptionId: sub.id, chainId: chain.id },
  });
  const delivery = await db.delivery.create({
    data: {
      subscriptionId: sub.id,
      enrollmentId: enrollment.id,
      step: 0,
      subject: "",
      body: "Pending test message",
    },
  });
  const payload = {
    type: "new-message",
    data: {
      guid: "test-reply-guid",
      text: "Can I apply tomorrow?",
      isFromMe: false,
      handle: { address: "(202) 555-0999" },
    },
  };
  const headers = { "x-webhook-token": env.WEBHOOK_TOKEN };
  expect(
    (await request("/api/webhooks/bluebubbles", "POST", payload)).status,
  ).toBe(401);
  await request(
    "/api/webhooks/bluebubbles",
    "POST",
    { ...payload, data: { ...payload.data, isFromMe: true } },
    false,
    headers,
  );
  expect(
    (
      await request(
        "/api/webhooks/bluebubbles",
        "POST",
        {
          ...payload,
          data: { ...payload.data, isFromMe: true, handle: null },
        },
        false,
        headers,
      )
    ).status,
  ).toBe(200);
  await request(
    "/api/webhooks/bluebubbles",
    "POST",
    {
      ...payload,
      data: { ...payload.data, handle: { address: "+12025550888" } },
    },
    false,
    headers,
  );
  expect(
    await db.leadEvent.count({
      where: { id: `bluebubbles:${hash(payload.data.guid)}` },
    }),
  ).toBe(0);
  const responses = await Promise.all(
    Array.from({ length: 3 }, () =>
      request("/api/webhooks/bluebubbles", "POST", payload, false, headers),
    ),
  );
  expect(responses.every((r) => r.status === 200)).toBe(true);
  const events = await db.leadEvent.findMany({
    where: { id: `bluebubbles:${hash(payload.data.guid)}` },
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    leadId,
    type: "SMS_REPLY",
    detail: "Text reply: Can I apply tomorrow?",
  });
  expect(
    (await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .status,
  ).toBe("PENDING");
  const stop = {
    ...payload,
    data: { ...payload.data, guid: "test-stop-guid", text: "STOP" },
  };
  expect(
    (await request("/api/webhooks/bluebubbles", "POST", stop, false, headers))
      .status,
  ).toBe(200);
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
  ).toBe("UNSUBSCRIBED");
  expect(
    (await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .status,
  ).toBe("CANCELLED");
  expect(
    (await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } }))
      .status,
  ).toBe("STOPPED");
  await request(
    "/api/webhooks/bluebubbles",
    "POST",
    { ...payload, data: { ...payload.data, guid: "reply-after-stop" } },
    false,
    headers,
  );
  expect(
    (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
  ).toBe("UNSUBSCRIBED");
});

it("autosaves settings patches without replacing unrelated settings", async () => {
  const original = await settings();
  expect(
    (await request("/api/admin/settings", "PATCH", { businessName: "Changed" }))
      .status,
  ).toBe(401);
  const result = await request(
    "/api/admin/settings",
    "PATCH",
    { businessName: "Auto-saved business" },
    true,
  );
  expect(result.status).toBe(200);
  expect(await settings()).toEqual({
    ...original,
    businessName: "Auto-saved business",
  });
  expect(
    (await request("/api/admin/settings", "PATCH", { sendHourStart: 20 }, true))
      .status,
  ).toBe(400);
  await saveSettings(original, "test");
});
it("requires owner access for real delivery tests and deduplicates a repeated send", async () => {
  const input = {
    recipient: "owner@example.com",
    requestId: "34828a29-dc87-4a5e-8bb2-63fca1276dd5",
    emailKind: "transactional",
  };
  expect(
    (await request("/api/admin/integrations/brevo/send-test", "POST", input))
      .status,
  ).toBe(401);
  expect(
    (
      await request(
        "/api/admin/integrations/brevo/send-test",
        "POST",
        input,
        true,
        { Origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/admin/integrations/onesignal/send-test",
        "POST",
        input,
        true,
      )
    ).status,
  ).toBe(400);
  const before = providerCalls.length;
  const result = await request(
    "/api/admin/integrations/brevo/send-test",
    "POST",
    input,
    true,
  );
  expect(result.data.status).toBe("accepted");
  expect(providerCalls.length).toBe(before + 1);
  const repeated = await request(
    "/api/admin/integrations/brevo/send-test",
    "POST",
    input,
    true,
  );
  expect(repeated.data.status).toBe("unknown");
  expect(providerCalls.length).toBe(before + 1);
  const audit = await db.auditLog.findUniqueOrThrow({
    where: { id: `delivery-test:${input.requestId}` },
  });
  expect(audit.action).toBe("integration.delivery_test_accepted");
  expect(JSON.stringify(audit)).not.toContain(input.recipient);
});
it("keeps owner password management in the hosting environment", async () => {
  const response = await request(
    "/api/admin/configuration/password",
    "POST",
    {
      currentPassword: "test-owner-password",
      newPassword: "new-test-password-123",
    },
    true,
  );
  expect(response.status).toBe(409);
  expect(response.data.error).toContain("OWNER_PASSWORD");
  expect(
    (
      await request(
        "/api/admin/configuration",
        "PATCH",
        {
          secrets: { ADMIN_PASSWORD_HASH: "new-password-hash-is-not-editable" },
        },
        true,
      )
    ).status,
  ).toBe(400);
  expect(
    (await request("/api/admin/configuration", "GET", undefined, true)).status,
  ).toBe(200);
  expect(
    (
      await request("/api/auth/login", "POST", {
        password: "new-test-password-123",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/api/auth/login", "POST", {
        password: "test-owner-password",
      })
    ).status,
  ).toBe(200);
});

it("waits for OneSignal synchronization before activating push and deduplicates confirmation retries", async () => {
  const lead = await db.lead.create({
    data: { visitId, name: "Push synchronization test", answers: {} },
  });
  const subscriptionId = "f4418d3a-991d-41e7-92e8-b4d04bf185fa";
  const chain = await saveChain(
    {
      name: "Push synchronization follow-up",
      channel: "PUSH",
      status: "ACTIVE",
      steps: [
        {
          delayHours: 24,
          subject: "Follow-up",
          body: "Explore your options: {{link}}",
        },
      ],
    },
    "test",
  );
  const input = {
    leadToken: token("lead", lead.id),
    subscriptionId,
    consent: true,
  };
  const headers = { "X-Forwarded-For": "192.0.2.71" };
  const confirm = () =>
    request("/api/public/push", "POST", input, false, headers);
  const providerFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
  let response = () => Response.json({}, { status: 404 });
  vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
    if (String(url).includes("/users/by/external_id/")) {
      expect(String(url)).toBe(
        `https://api.onesignal.com/apps/test-app/users/by/external_id/${lead.id}`,
      );
      expect(init?.method).toBe("GET");
      return response();
    }
    return providerFetch(url, init);
  });
  const record = () =>
    db.subscription.findUnique({
      where: {
        channel_address: { channel: "PUSH", address: subscriptionId },
      },
    });
  try {
    // Missing alias, unlinked subscription, and incomplete opt-in are all pending.
    for (const next of [
      () => Response.json({}, { status: 404 }),
      () =>
        Response.json({
          subscriptions: [{ id: "different-id", enabled: true }],
        }),
      () =>
        Response.json({
          subscriptions: [{ id: subscriptionId, enabled: false }],
        }),
    ]) {
      response = next;
      const pending = await confirm();
      expect(pending.status).toBe(409);
      expect(pending.data).toMatchObject({
        ok: false,
        code: "PUSH_CONFIRMATION_PENDING",
      });
      expect(await record()).toBeNull();
      expect(await db.enrollment.count({ where: { chainId: chain.id } })).toBe(
        0,
      );
    }
    // Bad credentials are a real error, not an instruction to retry synchronization.
    response = () => Response.json({}, { status: 401 });
    expect((await confirm()).status).toBe(400);
    expect(await record()).toBeNull();
    response = () =>
      Response.json({ subscriptions: [{ id: subscriptionId, enabled: true }] });
    expect((await confirm()).data).toEqual({ ok: true });
    const active = await record();
    expect(active?.status).toBe("ACTIVE");
    expect(active?.confirmedAt).not.toBeNull();
    expect(active?.leadId).toBe(lead.id);
    expect((await confirm()).data).toEqual({ ok: true });
    expect(
      await db.enrollment.count({ where: { subscriptionId: active!.id } }),
    ).toBe(1);
    expect(
      await db.leadEvent.count({
        where: { leadId: lead.id, type: "SUBSCRIBED" },
      }),
    ).toBe(1);
    // A local opt-out must not produce a false confirmation on a stale retry.
    await unsubscribe(active!.id);
    expect((await confirm()).status).toBe(409);
    expect((await record())?.status).toBe("UNSUBSCRIBED");
  } finally {
    vi.mocked(globalThis.fetch).mockImplementation(providerFetch);
    await db.chain.update({
      where: { id: chain.id },
      data: { status: "PAUSED" },
    });
  }
});

it("attributes source/landing and follow-up results without multiplying sales or hiding missing costs", async () => {
  const old = new Date(Date.now() - 72 * 3600000);
  const exp = await saveExperiment(
    {
      name: "Marketing measurement",
      slug: "marketing-measurement",
      variants: [
        {
          name: "Guide",
          weight: 50,
          config: {
            title: "Explore your options",
            description: "A useful introduction to optional updates.",
            layout: "centered",
          },
        },
        {
          name: "Story",
          weight: 50,
          config: {
            title: "Your next step",
            description: "Compare options before deciding what fits.",
            layout: "editorial",
            typography: "serif",
          },
        },
      ],
    },
    "test",
  );
  const source = await db.trafficSource.create({
    data: { campaignId: "811", zoneId: "901" },
  });
  const badSource = await db.trafficSource.create({
    data: { campaignId: "811", zoneId: "902" },
  });
  const visit = (sourceId: string, variantId: string, extra: object = {}) =>
    db.visit.create({
      data: {
        experimentId: exp.id,
        variantId,
        sourceId,
        ipHash: "marketing-test",
        userAgent: "test",
        evidence: [],
        createdAt: old,
        ...extra,
      },
    });
  const first = await visit(source.id, exp.variants[0].id, {
    verified: true,
    cost: 2,
    costRecorded: true,
  });
  const second = await visit(source.id, exp.variants[0].id);
  await visit(badSource.id, exp.variants[1].id, {
    botScore: 100,
    cost: 3,
    costRecorded: true,
  });
  await visit(badSource.id, exp.variants[1].id, { createdAt: new Date() });
  const person = await db.lead.create({
    data: {
      visitId: first.id,
      name: "Measurement fixture",
      answers: { amount: "1000" },
    },
  });
  const email = await db.subscription.create({
    data: {
      leadId: person.id,
      channel: "EMAIL",
      address: "marketing-fixture@example.test",
      status: "ACTIVE",
      confirmedAt: new Date(),
      consentText: "Test subscription",
      consentVersion: "v1",
      consentIpHash: "test",
    },
  });
  await db.subscription.create({
    data: {
      leadId: person.id,
      channel: "PUSH",
      address: "335cf694-1c47-4a13-bbe6-1b8de499e210",
      status: "UNSUBSCRIBED",
      confirmedAt: new Date(),
      stoppedAt: new Date(),
      consentText: "Test subscription",
      consentVersion: "v1",
      consentIpHash: "test",
    },
  });
  const chain = await saveChain(
    {
      name: "Measurement sequence",
      channel: "EMAIL",
      steps: [
        {
          subject: "Your first step",
          body: "Explore options: {{link}}",
          delayHours: 24,
        },
        {
          subject: "Your next step",
          body: "Compare options: {{link}}",
          delayHours: 24,
        },
      ],
    },
    "test",
  );
  const enrollment = await db.enrollment.create({
    data: { subscriptionId: email.id, chainId: chain.id },
  });
  const delivery = await db.delivery.create({
    data: {
      subscriptionId: email.id,
      enrollmentId: enrollment.id,
      step: 0,
      status: "SENT",
      subject: "First",
      body: "Test message",
      createdAt: old,
      sentAt: old,
      clickedAt: old,
      clickCount: 3,
    },
  });
  await db.delivery.create({
    data: {
      subscriptionId: email.id,
      enrollmentId: enrollment.id,
      step: 1,
      status: "FAILED",
      subject: "Next",
      body: "Test message",
      createdAt: old,
    },
  });
  await db.applicationClick.create({
    data: {
      visitId: first.id,
      leadId: person.id,
      createdAt: old,
      postbacks: {
        create: { eventId: "marketing-direct", event: "SOLD", revenue: 5 },
      },
    },
  });
  await db.applicationClick.create({
    data: {
      visitId: first.id,
      leadId: person.id,
      deliveryId: delivery.id,
      createdAt: old,
      postbacks: {
        create: [
          { eventId: "marketing-followup-1", event: "SOLD", revenue: 2 },
          { eventId: "marketing-followup-2", event: "SOLD", revenue: 2 },
          { eventId: "marketing-approval", event: "APPROVED", revenue: 0 },
        ],
      },
    },
  });
  const query = { experimentId: exp.id };
  const report = await trafficReport({ ...query, groupBy: "source_landing" });
  expect(report.totalVisits).toBe(3);
  const good = report.rows.find((row) => row.sourceId === source.id)!;
  expect(good).toMatchObject({
    visits: 2,
    leads: 1,
    confirmedSubscriptions: 2,
    activeSubscriptions: 1,
    optedOutSubscriptions: 1,
    subscribedVisitors: 1,
    subscribedPeople: 1,
    subscriptionRate: 0.5,
    saleRate: 0.5,
    sold: 2,
    approved: 1,
    funded: 0,
    revenue: 7,
    directApplications: 1,
    followupApplications: 1,
    costCoverage: 0.5,
    adContribution: null,
    returnOnAdSpend: null,
  });
  expect(good.channels).toEqual({ EMAIL: 1, SMS: 0, PUSH: 1 });
  expect(
    report.rows.find((row) => row.sourceId === badSource.id),
  ).toMatchObject({
    visits: 1,
    suspectedBots: 1,
    botRate: 1,
    revenue: 0,
    adContribution: -3,
    sufficientVisitSample: false,
  });
  expect(
    (await trafficReport({ ...query, minimumAgeHours: 0 })).totalVisits,
  ).toBe(4);
  expect(
    (
      await trafficReport({
        ...query,
        zoneId: "901",
        answer: { questionId: "amount", value: "1000" },
      })
    ).totalVisits,
  ).toBe(1);
  const followup = await followupReport({ ...query, chainId: chain.id });
  expect(followup.rows.find((row) => row.step === 0)).toMatchObject({
    sent: 1,
    clickedMessages: 1,
    clickCount: 3,
    clickThroughRate: 1,
    sold: 1,
    approved: 1,
    applications: 1,
    revenue: 2,
    convertedMessages: 1,
  });
  expect(followup.rows.find((row) => row.step === 1)).toMatchObject({
    failed: 1,
    sent: 0,
    clickThroughRate: null,
    revenue: 0,
  });
  expect((await followupReport({ ...query, channel: "SMS" })).rows).toEqual([]);
  const answers = await quizAnswerReport({ ...query, questionId: "amount" });
  expect(answers.rows).toEqual([
    {
      answer: "1000",
      leads: 1,
      confirmedPeople: 1,
      activeSubscriptions: 1,
      applications: 2,
      sold: 2,
      approved: 1,
      funded: 0,
      revenue: 7,
    },
  ]);
  await recordVisitCosts(
    [{ visitId: second.id, cost: 1 }],
    "Verified advertiser test fixture",
  );
  await recordVisitCosts(
    [{ visitId: second.id, cost: 1 }],
    "Repeated import must replace, not add",
  );
  expect(
    (await trafficReport({ ...query, zoneId: "901" })).rows[0],
  ).toMatchObject({
    recordedSpend: 3,
    costCoverage: 1,
    adContribution: 4,
    returnOnAdSpend: 7 / 3,
  });
  await expect(
    recordVisitCosts(
      [
        { visitId: second.id, cost: 8 },
        { visitId: "92960b50-810b-4697-91ca-86840c7d0ce4", cost: 2 },
      ],
      "Rollback invalid visit",
    ),
  ).rejects.toThrow();
  expect(
    Number(
      (await db.visit.findUniqueOrThrow({ where: { id: second.id } })).cost,
    ),
  ).toBe(1);
  await expect(
    trafficReport({ ...query, from: "2020-01-01T00:00:00Z" }),
  ).rejects.toThrow("366 days");
  await expect(
    saveExperiment(
      {
        ...exp,
        variants: exp.variants.map((v, i) => ({
          ...v,
          config: {
            ...(v.config as object),
            ...(i === 0 ? { title: "Changed after traffic" } : {}),
          },
        })),
      },
      "test",
    ),
  ).rejects.toThrow("already has traffic");
});

it("lets an authenticated MCP marketer inspect results, author designs and safely adjust allocation and statuses", async () => {
  const client = new Client({ name: "marketing-audit", version: "1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${env.MCP_TOKEN}` } },
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  try {
    const tools = await client.listTools();
    for (const name of [
      "marketing_context",
      "traffic_report",
      "statistics_report",
      "followup_report",
      "quiz_answer_report",
      "engagement_report",
      "list_traffic_visits",
      "record_visit_costs",
      "get_experiment",
      "list_landing_images",
      "set_experiment_allocation",
      "set_chain_status",
      "subscription_readiness",
      "set_live_delivery",
      "record_marketing_review",
    ])
      expect(tools.tools.some((tool) => tool.name === name)).toBe(true);
    const context = await call("marketing_context");
    const statistics = await call("statistics_report", { groupBy: "device" });
    expect(statistics.summary.visits).toBeGreaterThan(0);
    expect(statistics.advertiser.status).toBe("unsupported");
    expect(JSON.stringify(context)).not.toContain(env.MCP_TOKEN);
    expect(context.limits.join(" ")).toContain("external AI client");
    const initialDelivery = context.liveDelivery;
    try {
      const disabled = await call("set_live_delivery", {
        enabled: false,
        reason: "Test the audited MCP delivery switch without sending messages",
      });
      expect(disabled.liveDelivery).toBe(false);
      expect(disabled.availableChannels).toEqual([]);
    } finally {
      const restored = await call("set_live_delivery", {
        enabled: initialDelivery,
        reason: "Restore the delivery mode that existed before this test",
      });
      expect(restored.liveDelivery).toBe(initialDelivery);
    }
    const images = await call("list_landing_images");
    expect(images).toHaveLength(3);
    const exp = await call("save_experiment", {
      experiment: {
        name: "MCP custom campaign",
        slug: "mcp-custom-campaign",
        variants: [
          {
            name: "Editorial qualification",
            weight: 50,
            config: {
              title: "Find your next step",
              description:
                "Explore options and choose your update preferences.",
              layout: "editorial",
              typography: "serif",
              accentColor: "#294961",
              heroImage: { src: images[0].src, alt: images[0].alt },
              offerFirst: true,
              sections: [
                {
                  heading: "Prepare before applying",
                  body: "Consider payments and read the terms.",
                },
              ],
              questions: [
                {
                  id: "timing",
                  label: "When are you looking?",
                  options: ["Now", "Later"],
                },
                {
                  id: "amount",
                  label: "How much are you considering?",
                  options: ["1000", "2500"],
                  showWhen: { questionId: "timing", equals: "Now" },
                },
              ],
            },
          },
          {
            name: "Centered control",
            weight: 50,
            config: {
              title: "Explore your options",
              description: "Choose optional updates at your own pace.",
              layout: "centered",
            },
          },
        ],
      },
    });
    const definition = await call("get_experiment", { id: exp.id });
    expect(definition.variants[0].previewUrl).toContain("/preview/");
    expect(definition.propellerUrl).toContain("click_id=${SUBID}");
    expect(definition.propellerUrl).toContain("banner_id={bannerid}");
    expect(definition.propellerUrl).toContain(
      "advertiser_user_agent={useragent}",
    );
    expect(definition.propellerUrl).not.toContain("{clickID}");
    expect(definition.variants[0].config.sections).toHaveLength(1);
    expect(definition.variants[0].config.heroImage).toEqual({
      src: images[0].src,
      alt: images[0].alt,
    });
    expect(definition.variants[0].config.offerFirst).toBe(true);
    const allocation = {
      id: exp.id,
      expectedUpdatedAt: definition.updatedAt,
      weights: [
        { variantId: definition.variants[0].id, weight: 70 },
        { variantId: definition.variants[1].id, weight: 30 },
      ],
      reason: "Test audit: adjust allocation without changing content",
    };
    await call("set_experiment_allocation", allocation);
    expect(
      (
        await client.callTool({
          name: "set_experiment_allocation",
          arguments: allocation,
        })
      ).isError,
    ).toBe(true);
    await call("set_experiment_status", {
      id: exp.id,
      status: "ACTIVE",
      reason: "Publish verified test campaign",
    });
    await call("set_experiment_status", {
      id: exp.id,
      status: "PAUSED",
      reason: "Pause the test campaign after verification",
    });
    const chain = await call("save_chain", {
      chain: {
        name: "MCP marketing chain",
        channel: "PUSH",
        steps: [
          {
            subject: "Explore options",
            body: "Your next step: {{link}}",
            delayHours: 24,
          },
        ],
      },
    });
    expect((await call("get_chain", { id: chain.id })).steps).toHaveLength(1);
    await call("set_chain_status", {
      id: chain.id,
      status: "PAUSED",
      reason: "Do not dispatch this test campaign",
    });
    for (const name of ["traffic_report", "followup_report"])
      expect((await call(name, { experimentId: exp.id })).rows).toEqual([]);
    expect(
      (
        await call("quiz_answer_report", {
          experimentId: exp.id,
          questionId: "timing",
        })
      ).rows,
    ).toEqual([]);
    await call("record_marketing_review", {
      summary:
        "Verified tool controls and created distinct draft designs; no messages were sent.",
    });
    expect(
      await db.auditLog.count({
        where: { entityId: exp.id, action: "experiment.allocation_updated" },
      }),
    ).toBe(1);
  } finally {
    await client.close();
  }
});

it("uploads and reuses original artwork through authenticated MCP, serves immutable images and protects one-use file uploads", async () => {
  const client = new Client({ name: "artwork-client", version: "1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${env.MCP_TOKEN}` } },
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  try {
    const png = await sharp(randomBytes(360 * 360 * 3), {
      raw: { width: 360, height: 360, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(png.length).toBeGreaterThan(256 * 1024);
    const args = {
      name: "Original campaign artwork",
      alt: "Colorful original campaign illustration",
      kind: "HERO",
      base64: png.toString("base64"),
    };
    const asset = await call("upload_landing_asset", args);
    expect(asset).toMatchObject({
      width: 360,
      height: 360,
      mimeType: "image/webp",
    });
    expect(asset.src).toMatch(/^\/media\/landing\/[a-z0-9]+\.webp$/);
    expect(asset.data).toBeUndefined();
    expect(asset.base64).toBeUndefined();
    expect((await call("upload_landing_asset", args)).id).toBe(asset.id);
    expect(await db.landingAsset.count({ where: { id: asset.id } })).toBe(1);
    const served = await originalFetch(base + asset.src);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/webp");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(
      (await sharp(Buffer.from(await served.arrayBuffer())).metadata()).format,
    ).toBe("webp");
    expect(
      (
        await originalFetch(base + asset.src, {
          cache: "force-cache",
          headers: { "If-None-Match": served.headers.get("etag")! },
        })
      ).status,
    ).toBe(304);
    expect(
      (
        await originalFetch(
          base + "/media/landing/cmissing00000000000000000.webp",
        )
      ).status,
    ).toBe(404);
    const library = await call("list_landing_assets", {
      q: "Original campaign",
    });
    expect(library.items.map((a: any) => a.id)).toContain(asset.id);
    expect(library.items[0].data).toBeUndefined();
    expect(library.bundled).toHaveLength(3);
    const denied = await request("/mcp", "POST", { large: args.base64 });
    expect(denied.status).toBe(401);
    expect(
      (await request("/api/admin/landing-assets", "POST", args)).status,
    ).toBe(401);
    expect(
      (
        await request("/api/admin/landing-assets", "POST", args, true, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await request("/api/admin/landing-assets", "POST", args, true)).data.id,
    ).toBe(asset.id);
    expect(
      (
        await client.callTool({
          name: "upload_landing_asset",
          arguments: {
            ...args,
            base64: Buffer.from("<svg/>").toString("base64"),
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "upload_landing_asset",
          arguments: { ...args, base64: "a===" },
        })
      ).isError,
    ).toBe(true);

    const ticket = await call("create_landing_asset_upload", {
      name: "Transparent logo",
      alt: "Custom SpareCash logo",
      kind: "LOGO",
    });
    const path = new URL(ticket.uploadUrl).pathname;
    const logo = await sharp({
      create: {
        width: 400,
        height: 100,
        channels: 4,
        background: { r: 10, g: 80, b: 70, alpha: 0.4 },
      },
    })
      .png()
      .toBuffer();
    const send = (headers: Record<string, string>) =>
      originalFetch(base + path, {
        method: "POST",
        headers,
        body: new Uint8Array(logo),
      });
    expect(
      (await send({ "Content-Type": "application/octet-stream" })).status,
    ).toBe(401);
    const uploaded = await send(ticket.headers);
    expect(uploaded.status).toBe(201);
    const logoAsset = await uploaded.json();
    const publicLogo = await originalFetch(base + logoAsset.src);
    expect(
      (await sharp(Buffer.from(await publicLogo.arrayBuffer())).metadata())
        .hasAlpha,
    ).toBe(true);
    expect((await send(ticket.headers)).status).toBe(401);
    const expired = await call("create_landing_asset_upload", {
      name: "Expired",
      alt: "Expired artwork",
      kind: "HERO",
    });
    await db.landingAssetUpload.update({
      where: { id: new URL(expired.uploadUrl).pathname.split("/").pop()! },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await originalFetch(base + new URL(expired.uploadUrl).pathname, {
          method: "POST",
          headers: expired.headers,
          body: new Uint8Array(logo),
        })
      ).status,
    ).toBe(401);
    const oversize = await call("create_landing_asset_upload", {
      name: "Too big",
      alt: "Large artwork",
    });
    expect(
      (
        await originalFetch(base + new URL(oversize.uploadUrl).pathname, {
          method: "POST",
          headers: oversize.headers,
          body: new Uint8Array(4 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);

    const definition = {
      name: "Original imagery",
      slug: "original-imagery",
      variants: [
        {
          name: "Original art",
          weight: 100,
          config: {
            title: "Your next step",
            description:
              "Explore your options with an original illustrated guide.",
            heroImage: { src: asset.src, alt: asset.alt },
            logoImage: { src: logoAsset.src, alt: logoAsset.alt },
            heroPosition: "before_title",
            sections: [
              {
                heading: "A closer look",
                body: "More details about the available options.",
                image: { src: asset.src, alt: asset.alt },
              },
            ],
          },
        },
      ],
    };
    const exp = await call("save_experiment", { experiment: definition });
    expect(exp.variants[0].config.logoImage.src).toBe(logoAsset.src);
    const preview = await request(
      `/api/admin/experiments/${exp.id}`,
      "GET",
      undefined,
      true,
    );
    expect(preview.status).toBe(200);
    expect(preview.data.variants[0].config.heroPosition).toBe("before_title");
    const broken = structuredClone(definition);
    broken.slug = "missing-imagery";
    broken.variants[0].config.heroImage.src =
      "/media/landing/cmissing00000000000000000.webp";
    expect(
      (
        await client.callTool({
          name: "save_experiment",
          arguments: { experiment: broken },
        })
      ).isError,
    ).toBe(true);
    expect(
      await db.experiment.count({ where: { slug: "missing-imagery" } }),
    ).toBe(0);
    const audit = await db.auditLog.findMany({
      where: { action: "landing_asset.uploaded" },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(args.base64);
    expect(JSON.stringify(audit)).not.toContain(ticket.headers.Authorization);
  } finally {
    await client.close();
  }
}, 20000);

it("round-trips protected canvases through MCP, previews and visit snapshots", async () => {
  const client = new Client({ name: "canvas-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${env.MCP_TOKEN}` } },
    }),
  );
  const call = async (name: string, args: any = {}) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result));
    return JSON.parse((result.content as any)[0].text);
  };
  try {
    const guide = await call("landing_design_guide");
    expect(guide.examples).toHaveLength(3);
    expect(guide.protectedElements.join(" ")).toContain("Turnstile");
    const config = landingSchema.parse({
      title: "Canvas test",
      description:
        "A completely composed page with the normal application flow.",
      design: landingDesignExamples[2].design,
      questions: [
        {
          id: "timing",
          label: "When are you looking?",
          options: ["Now", "Later"],
        },
      ],
    });
    expect(await call("validate_landing_design", { config })).toMatchObject({
      valid: true,
      mode: "canvas",
    });
    const invalid = structuredClone(config);
    invalid.design!.nodes = invalid.design!.nodes.filter(
      (n) => n.type !== "funnel",
    );
    const rejected = await call("validate_landing_design", { config: invalid });
    expect(rejected.valid).toBe(false);
    expect(
      rejected.issues.some((issue: any) => issue.message.includes("funnel")),
    ).toBe(true);
    const missing = structuredClone(config);
    const picture = missing.design!.nodes.find((n) => n.type === "image")!;
    if (picture.type === "image")
      picture.image.src = "/media/landing/cmissing00000000000000000.webp";
    expect(
      await call("validate_landing_design", { config: missing }),
    ).toMatchObject({ valid: false });
    const missingBundled = structuredClone(config);
    const bundled = missingBundled.design!.nodes.find(
      (n) => n.type === "image",
    )!;
    if (bundled.type === "image")
      bundled.image.src = "/landing-assets/not-a-real-image.jpg";
    expect(
      await call("validate_landing_design", { config: missingBundled }),
    ).toMatchObject({ valid: false });
    const brokenSave = await client.callTool({
      name: "save_experiment",
      arguments: {
        experiment: {
          name: "Missing canvas image",
          slug: "missing-canvas-image",
          variants: [{ name: "Bad image", weight: 100, config: missing }],
        },
      },
    });
    expect(brokenSave.isError).toBe(true);
    expect(
      await db.experiment.count({ where: { slug: "missing-canvas-image" } }),
    ).toBe(0);
    const exp = await call("save_experiment", {
      experiment: {
        name: "Canvas test",
        slug: "canvas-test",
        status: "ACTIVE",
        variants: [{ name: "Canvas one", weight: 100, config }],
      },
    });
    const preview = await request(
      `/api/admin/experiments/${exp.id}`,
      "GET",
      undefined,
      true,
    );
    expect(preview.data.variants[0].config.design).toEqual(config.design);
    const visit = await request("/api/public/visit", "POST", {
      slug: "canvas-test",
      campaignId: "971234",
      zoneId: "981234",
      clickId: "canvas-click",
    });
    expect(visit.status).toBe(200);
    expect(visit.data.config.design).toEqual(config.design);
    expect(visit.data.config.questions).toEqual(config.questions);
    const changed = structuredClone(config);
    changed.design!.background = "#ffffff";
    const blocked = await client.callTool({
      name: "save_experiment",
      arguments: {
        experiment: {
          id: exp.id,
          name: exp.name,
          slug: exp.slug,
          status: "ACTIVE",
          variants: [
            {
              id: exp.variants[0].id,
              name: "Canvas one",
              weight: 100,
              config: changed,
            },
          ],
        },
      },
    });
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked)).toContain("already has traffic");
    await db.visit.update({
      where: { id: visit.data.visitId },
      data: {
        verified: true,
        verificationState: "VERIFIED",
        verificationExpiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const continuation = await request("/api/public/continue", "POST", {
      visitToken: visit.data.visitToken,
      entryPoint: "optional_updates",
    });
    expect(continuation.status).toBe(200);
    const application = await db.applicationClick.findFirstOrThrow({
      where: { visit: { externalClickId: "canvas-click" } },
    });
    expect(new URL(continuation.data.url).searchParams.get("subId3")).toBe(
      application.id,
    );
    expect(
      await db.advertiserConversion.findUniqueOrThrow({
        where: {
          externalClickId_goal: {
            externalClickId: "canvas-click",
            goal: 2,
          },
        },
      }),
    ).toMatchObject({
      event: "APPLICATION",
      externalClickId: "canvas-click",
      status: "PENDING",
    });
    await recordPostback({
      eventId: `canvas-sold-${application.id}`,
      applicationId: application.id,
      event: "SOLD",
      revenue: 7.5,
    });
    expect(
      await db.advertiserConversion.findUniqueOrThrow({
        where: {
          externalClickId_goal: {
            externalClickId: "canvas-click",
            goal: 1,
          },
        },
      }),
    ).toMatchObject({
      event: "SOLD",
      externalClickId: "canvas-click",
      status: "PENDING",
    });
    expect(
      (
        await db.advertiserConversion.findUniqueOrThrow({
          where: {
            externalClickId_goal: {
              externalClickId: "canvas-click",
              goal: 1,
            },
          },
        })
      ).payout.toNumber(),
    ).toBe(7.5);
    expect(
      await db.visitEvent.count({
        where: {
          visitId: application.visitId!,
          kind: "CONTINUE_WITHOUT_UPDATES",
        },
      }),
    ).toBe(1);
    expect(
      await db.lead.count({ where: { visitId: application.visitId! } }),
    ).toBe(0);
  } finally {
    await client.close();
  }
});

it("records anonymous quiz engagement once per visit without subscribing or sending", async () => {
  const config = landingSchema.parse({
    title: "Engagement test",
    description: "A two-question anonymous visitor flow.",
    questions: [
      { id: "amount", label: "Choose an amount", options: ["Small", "Large"] },
      { id: "timing", label: "Choose a time", options: ["Now", "Later"] },
    ],
  });
  const exp = await db.experiment.create({
    data: {
      name: "Anonymous engagement",
      slug: "anonymous-engagement",
      status: "ACTIVE",
      variants: { create: { name: "Tracked", weight: 100, config } },
    },
    include: { variants: true },
  });
  const visit = await db.visit.create({
    data: {
      experimentId: exp.id,
      variantId: exp.variants[0].id,
      configSnapshot: config,
      ipHash: "engagement-test",
      userAgent: "test",
      externalClickId: "click-engagement",
    },
  });
  const signed = token("visit", visit.id, 300);
  const before = providerCalls.length;
  const send = (event: object, visitToken = signed) =>
    request("/api/public/engagement", "POST", { visitToken, event });
  const activity = (data: object, visitToken = signed) =>
    request("/api/public/pre-quiz-activity", "POST", {
      visitToken,
      activity: data,
    });
  expect(
    (
      await activity({
        activeMs: 12_000,
        clicks: 2,
        scrolls: 1,
        complete: false,
      })
    ).status,
  ).toBe(200);
  // Cumulative snapshots are idempotent and never reduce stored totals.
  await recordPreQuizActivity(visit.id, {
    activeMs: 5_000,
    clicks: 1,
    scrolls: 0,
    complete: false,
  });
  expect((await send({ kind: "UPDATES_OPENED" }, "forged")).status).toBe(400);
  expect(
    (
      await request(
        "/api/public/engagement",
        "POST",
        { visitToken: signed, event: { kind: "UPDATES_OPENED" } },
        false,
        { Origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await send({
        kind: "QUESTION_ANSWERED",
        questionId: "amount",
        answers: { amount: "Unknown" },
      })
    ).status,
  ).toBe(400);
  const first = {
    kind: "QUESTION_ANSWERED",
    questionId: "amount",
    answers: { amount: "Small" },
  };
  const concurrentAnswers = await Promise.all(
    Array.from({ length: 5 }, () => send(first)),
  );
  expect(concurrentAnswers.map((response) => response.status)).toEqual([
    200, 200, 200, 200, 200,
  ]);
  expect(await db.visitEvent.count({ where: { visitId: visit.id } })).toBe(1);
  expect(
    await recordPreQuizActivity(visit.id, {
      activeMs: 20_000,
      clicks: 3,
      scrolls: 2,
      complete: false,
    }),
  ).toBe(false);
  // The browser's final snapshot is accepted if it races behind the answer.
  expect(
    await recordPreQuizActivity(visit.id, {
      activeMs: 18_000,
      clicks: 3,
      scrolls: 2,
      complete: true,
    }),
  ).toBe(true);
  expect(
    await recordPreQuizActivity(visit.id, {
      activeMs: 80_000,
      clicks: 30,
      scrolls: 20,
      complete: true,
    }),
  ).toBe(false);
  expect(
    await db.visit.findUniqueOrThrow({
      where: { id: visit.id },
      select: {
        preQuizMeasuredAt: true,
        preQuizEndedAt: true,
        preQuizActiveMs: true,
        preQuizClicks: true,
        preQuizScrolls: true,
      },
    }),
  ).toMatchObject({
    preQuizMeasuredAt: expect.any(Date),
    preQuizEndedAt: expect.any(Date),
    preQuizActiveMs: 18_000,
    preQuizClicks: 3,
    preQuizScrolls: 2,
  });
  // Editing the live variant cannot invalidate the configuration this visitor saw.
  await db.variant.update({
    where: { id: exp.variants[0].id },
    data: { config: { ...config, questions: [] } },
  });
  expect(
    (
      await send({
        kind: "QUESTION_ANSWERED",
        questionId: "timing",
        answers: { amount: "Small", timing: "Later" },
      })
    ).status,
  ).toBe(200);
  expect((await send({ kind: "UPDATES_OPENED" })).status).toBe(200);
  expect((await send({ kind: "UPDATES_OPENED" })).status).toBe(200);
  expect(await db.visitEvent.count({ where: { visitId: visit.id } })).toBe(4);
  expect(await db.lead.count({ where: { visitId: visit.id } })).toBe(0);
  expect(
    (await db.visit.findUniqueOrThrow({ where: { id: visit.id } })).verified,
  ).toBe(false);
  expect(providerCalls.length).toBe(before);
  await expect(
    createRoundSkyApplication({
      visitId: visit.id,
      requireVerification: true,
    }),
  ).rejects.toThrow("Finish browser verification");
  await db.visit.update({
    where: { id: visit.id },
    data: {
      verified: true,
      verificationState: "VERIFIED",
      verificationExpiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const direct = await request("/api/public/continue", "POST", {
    visitToken: signed,
  });
  expect(direct.status).toBe(200);
  expect(
    await db.visitEvent.count({
      where: { visitId: visit.id, kind: "CONTINUE_WITHOUT_UPDATES" },
    }),
  ).toBe(0);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await request("/api/public/continue", "POST", {
          visitToken: signed,
          entryPoint: "optional_updates",
        })
      ).status,
    ).toBe(200);
  expect(
    await db.visitEvent.count({
      where: { visitId: visit.id, kind: "CONTINUE_WITHOUT_UPDATES" },
    }),
  ).toBe(1);
  const report = await engagementReport({
    experimentId: exp.id,
    minimumAgeHours: 0,
  });
  expect(report.rows[0]).toMatchObject({
    visits: 1,
    quizStartedVisitors: 1,
    quizCompletedVisitors: 1,
    updatesOpenedVisitors: 1,
    continuedWithoutUpdatesVisitors: 1,
    confirmedOptInVisitors: 0,
    applicationVisitors: 1,
  });
  expect(report.rows[0].questions).toEqual([
    { questionId: "amount", answeredVisitors: 1 },
    { questionId: "timing", answeredVisitors: 1 },
  ]);
  expect(
    (await request(`/api/admin/experiments/${exp.id}/engagement`)).status,
  ).toBe(401);
  expect(
    (
      await request(
        `/api/admin/experiments/${exp.id}/engagement`,
        "GET",
        undefined,
        true,
      )
    ).data.totalVisits,
  ).toBe(1);
  const summary = await request(
    `/api/admin/experiments/${exp.id}`,
    "GET",
    undefined,
    true,
  );
  expect(
    summary.data.variants[0].engagement.continuedWithoutUpdatesVisitors,
  ).toBe(1);
});

it("allows an omitted first name but still requires channel consent and adulthood", async () => {
  await saveChain(
    {
      name: "Optional name push subscription path",
      channel: "PUSH",
      status: "ACTIVE",
      trigger: "SUBSCRIBED",
      maxDays: 14,
      steps: [
        {
          delayHours: 24,
          subject: "Loan options",
          body: "Review options: {{link}}",
        },
      ],
    },
    "test",
  );
  const config = landingSchema.parse({
    title: "Optional name",
    description: "Subscribe without providing a first name.",
  });
  const exp = await db.experiment.create({
    data: {
      name: "Optional name",
      slug: "optional-name",
      status: "ACTIVE",
      variants: { create: { name: "Optional", weight: 100, config } },
    },
    include: { variants: true },
  });
  const visit = await db.visit.create({
    data: {
      experimentId: exp.id,
      variantId: exp.variants[0].id,
      configSnapshot: config,
      ipHash: "optional-name",
      userAgent: "test",
    },
  });
  const payload = {
    visitToken: token("visit", visit.id, 300),
    turnstileToken: "test",
    channels: ["PUSH"],
    answers: {},
    adultUS: true,
    consent: true,
  };
  expect(
    (
      await request("/api/public/subscribe", "POST", {
        ...payload,
        consent: false,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/api/public/subscribe", "POST", {
        ...payload,
        adultUS: false,
      })
    ).status,
  ).toBe(400);
  const result = await request("/api/public/subscribe", "POST", payload);
  expect(result.status).toBe(200);
  expect(
    (await db.lead.findUniqueOrThrow({ where: { id: result.data.leadId } }))
      .name,
  ).toBe("");
  expect(
    await db.subscription.count({ where: { leadId: result.data.leadId } }),
  ).toBe(0);
});

// Fixture pixels are never requested: server tests only reserve them and submit
// simulated browser receipts. These IDs are not production provider configuration.
const rtAudiences = [
  {
    id: "88001",
    name: "Test quiz",
    purpose: "REENGAGEMENT",
    enabled: true,
    enrollment: {
      type: "image",
      url: "https://my.rtmark.net/img.gif?f=on&lr=1&partner=88001",
    },
    removal: {
      type: "image",
      url: "https://my.rtmark.net/img.gif?f=off&lr=1&partner=88001",
    },
    qualifyingEvents: ["QUIZ_PARTICIPATED"],
    excludeOn: ["APPLICATION", "SUBSCRIBED", "PAID"],
  },
  {
    id: "88002",
    name: "Test application",
    purpose: "APPLICATION",
    enabled: true,
    enrollment: {
      type: "image",
      url: "https://my.rtmark.net/img.gif?f=on&partner=88002",
    },
    removal: {
      type: "image",
      url: "https://my.rtmark.net/img.gif?f=off&partner=88002",
    },
    qualifyingEvents: ["APPLICATION"],
    excludeOn: ["PAID"],
  },
  {
    id: "88003",
    name: "Test paid exclusion",
    purpose: "PAID_EXCLUSION",
    enabled: true,
    enrollment: {
      type: "image",
      url: "https://my.rtmark.net/img.gif?f=on&partner=88003",
    },
    qualifyingEvents: ["PAID"],
    excludeOn: [],
  },
];
async function rtSetup() {
  await saveRetargetingSettings({ enabled: false, audiences: rtAudiences });
  const now = new Date().toISOString();
  await saveRetargetingPlan({
    stages: [
      {
        name: "Quiz",
        audienceId: "88001",
        excludeAudienceIds: ["88002", "88003"],
        campaignIds: ["88101"],
      },
      {
        name: "Application",
        audienceId: "88002",
        excludeAudienceIds: ["88003"],
        campaignIds: ["88102"],
      },
    ],
    targetingChecks: [
      {
        campaignId: "88101",
        targetUrl:
          env.APP_URL +
          "/go/integration?campaign_id={campaign_id}&zone_id={zone_id}&click_id=${SUBID}",
        includedAudienceIds: ["88001"],
        excludedAudienceIds: ["88002", "88003"],
        observedAt: now,
        reference: "Simulated test fixture, not a real readback",
      },
      {
        campaignId: "88102",
        targetUrl:
          env.APP_URL +
          "/go/integration?campaign_id={campaign_id}&zone_id={zone_id}&click_id=${SUBID}",
        includedAudienceIds: ["88002"],
        excludedAudienceIds: ["88003"],
        observedAt: now,
        reference: "Simulated test fixture, not a real readback",
      },
    ],
    suppressionTest: {
      passed: true,
      testedAt: now,
      reference: "Simulated integration test fixture",
    },
  });
  await saveRetargetingSettings({ enabled: true, audiences: rtAudiences });
}
let rtCounter = 20;
async function rtVisit(group: "TREATMENT" | "CONTROL" = "TREATMENT") {
  const n = ++rtCounter;
  const config = landingSchema.parse({
    title: "Retargeting test",
    description: "Visit verification test.",
    questions: [
      { id: "amount", label: "Amount?", options: ["Small", "Large"] },
    ],
  });
  const experiment = await db.experiment.create({
    data: {
      name: `RT ${n}`,
      slug: `rt-${n}`,
      status: "ACTIVE",
      variants: { create: { name: "Original angle", weight: 100, config } },
    },
  });
  const created = await request(
    "/api/public/visit",
    "POST",
    {
      slug: experiment.slug,
      campaignId: "88100",
      zoneId: "1",
      clickId: `original-${n}`,
    },
    false,
    { "X-Forwarded-For": `203.0.113.${n}` },
  );
  expect(created.status).toBe(200);
  const headers = {
    Cookie: created.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    "X-Forwarded-For": `203.0.113.${n}`,
  };
  const visit = await db.visit.findUniqueOrThrow({
    where: { id: created.data.visitId },
  });
  // Deterministically exercise both arms; production never changes an assignment.
  await db.visitorJourney.update({
    where: { id: visit.journeyId! },
    data: { group },
  });
  const send = (
    path: string,
    body: object = {},
    extra: Record<string, string> = {},
  ) =>
    request(
      `/api/public/${path}`,
      "POST",
      { visitToken: created.data.visitToken, ...body },
      false,
      { ...headers, ...extra },
    );
  const verify = async (
    fields: object = {},
    challenge = `test-${visit.id}-${randomBytes(4).toString("hex")}`,
    extra: Record<string, string> = {},
  ) => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      Response.json({
        success: true,
        hostname: new URL(env.APP_URL).hostname,
        action: "visit",
        cdata: visit.id,
        ...fields,
      }),
    );
    return send("verify-visit", { turnstileToken: challenge }, extra);
  };
  return { visit, session: created.data, experiment, headers, send, verify };
}

it("accepts a public domain alias while binding Turnstile to that request hostname", async () => {
  await rtSetup();
  const f = await rtVisit();
  const alias = "sparecash.fit";
  const verification = await f.verify(
    { hostname: alias },
    `alias-${f.visit.id}`,
    {
      Origin: `https://${alias}`,
      "X-Forwarded-Host": alias,
      "X-Forwarded-Proto": "https",
    },
  );
  expect(verification).toMatchObject({ status: 200, data: { verified: true } });
  expect(
    (
      await f.send(
        "verify-visit",
        { turnstileToken: `wrong-host-${f.visit.id}` },
        {
          Origin: `https://${alias}`,
          "X-Forwarded-Host": "attacker.test",
        },
      )
    ).status,
  ).toBe(403);
});

it("automatically qualifies verified quiz actions without a local advertising opt-in and binds single-use proofs", async () => {
  await rtSetup();
  const f = await rtVisit();
  await f.send("engagement", {
    event: {
      kind: "QUESTION_ANSWERED",
      questionId: "amount",
      answers: { amount: "Small" },
    },
  });
  expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
  expect(f.session.advertising.privacy).toBe("UNKNOWN");
  expect((await f.verify({ cdata: "another-visit" })).data.verified).toBe(
    false,
  );
  expect((await f.verify({ hostname: "attacker.test" })).data.verified).toBe(
    false,
  );
  expect((await f.verify({ action: "subscribe" })).data.verified).toBe(false);
  expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
  const valid = `valid-${f.visit.id}`;
  expect((await f.verify({}, valid)).data.verified).toBe(true);
  // Network retry reuses the local receipt, not the single-use Cloudflare token.
  const before = vi.mocked(globalThis.fetch).mock.calls.length;
  expect(
    (await f.send("verify-visit", { turnstileToken: valid })).data.verified,
  ).toBe(true);
  expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
  const concurrent = await Promise.all([
    f.send("retargeting/qualify"),
    f.send("retargeting/qualify"),
  ]);
  const pixels = concurrent.flatMap((r) => r.data.pixels);
  expect(pixels).toHaveLength(1);
  expect(pixels[0].url).toBe(rtAudiences[0].enrollment.url);
  expect(
    await db.visitorJourney.findUniqueOrThrow({
      where: { id: f.visit.journeyId! },
    }),
  ).toMatchObject({ privacy: "UNKNOWN", privacyAt: null });
  expect(
    await db.advertisingPrivacyEvent.count({
      where: { journeyId: f.visit.journeyId! },
    }),
  ).toBe(0);
  expect(
    (await f.send("retargeting/receipt", { id: pixels[0].id, state: "LOADED" }))
      .data,
  ).toEqual({ recorded: true, confirmedAudienceMembership: false });
  expect(
    (await f.send("retargeting/receipt", { id: pixels[0].id, state: "FAILED" }))
      .data.recorded,
  ).toBe(false);
  const other = await rtVisit();
  expect(
    (await other.send("verify-visit", { turnstileToken: valid })).data.verified,
  ).toBe(false);
  expect(
    (
      await other.send("retargeting/receipt", {
        id: pixels[0].id,
        state: "FAILED",
      })
    ).data.recorded,
  ).toBe(false);
  expect(
    (await other.send("retargeting/qualify", {}, { Cookie: f.headers.Cookie }))
      .status,
  ).toBe(400);
  await db.visit.update({
    where: { id: f.visit.id },
    data: { verificationExpiresAt: new Date(Date.now() - 1) },
  });
  expect((await f.send("retargeting/qualify")).data.reason).toBe(
    "VERIFICATION_REQUIRED",
  );
  expect(
    (await db.visit.findUniqueOrThrow({ where: { id: f.visit.id } })).botScore,
  ).toBeLessThan(70);
});

it("keeps controls out of audiences, honors advertising refusal/GPC and records verification outages separately", async () => {
  const f = await rtVisit("CONTROL");
  await f.verify();
  expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
  await f.send("engagement", {
    event: {
      kind: "QUESTION_ANSWERED",
      questionId: "amount",
      answers: { amount: "Large" },
    },
  });
  const result = await f.send("retargeting/qualify");
  expect(result.data).toMatchObject({ reason: "CONTROL", pixels: [] });
  expect(
    (
      await db.visitorJourney.findUniqueOrThrow({
        where: { id: f.visit.journeyId! },
      })
    ).eligibleAt,
  ).not.toBeNull();
  const treatment = await rtVisit();
  await treatment.verify();
  await treatment.send("engagement", {
    event: {
      kind: "QUESTION_ANSWERED",
      questionId: "amount",
      answers: { amount: "Small" },
    },
  });
  await treatment.send(
    "advertising-choice",
    { choice: "GRANTED" },
    { "Sec-GPC": "1" },
  );
  expect((await treatment.send("retargeting/qualify")).data.pixels).toEqual([]);
  expect(
    (
      await db.visitorJourney.findUniqueOrThrow({
        where: { id: treatment.visit.journeyId! },
      })
    ).privacy,
  ).toBe("DENIED");
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(
    new Error("Provider timeout"),
  );
  const failed = await treatment.send("verify-visit", {
    turnstileToken: "outage-token",
  });
  expect(failed.data).toMatchObject({ verified: false, state: "ERROR" });
  expect(
    (await db.visit.findUniqueOrThrow({ where: { id: treatment.visit.id } }))
      .botScore,
  ).toBeLessThan(70);
  await expect(
    saveRetargetingSettings({
      enabled: false,
      controlPercent: 30,
      audiences: rtAudiences,
    }),
  ).rejects.toThrow("frozen");
});

it.each(["CHOICE", "GPC_HEADER", "GPC_BROWSER"] as const)(
  "honors %s on automatically tracked actions without recording a grant",
  async (source) => {
    await rtSetup();
    const f = await rtVisit();
    await f.verify();
    // A page view alone never enrolls even after browser verification.
    expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
    await f.send("engagement", {
      event: {
        kind: "QUESTION_ANSWERED",
        questionId: "amount",
        answers: { amount: "Small" },
      },
    });
    if (source !== "GPC_HEADER")
      await f.send("advertising-choice", {
        choice: "DENIED",
        gpc: source === "GPC_BROWSER",
      });
    const headers: Record<string, string> =
      source === "GPC_HEADER" ? { "Sec-GPC": "1" } : {};
    expect(
      (await f.send("retargeting/qualify", {}, headers)).data,
    ).toMatchObject({
      privacy: "DENIED",
      reason: "ADVERTISING_OPTED_OUT",
      pixels: [],
    });
    // The opt-out persists when a subsequent request omits the GPC signal.
    expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
    expect(
      await db.visitEvent.count({
        where: { visitId: f.visit.id, kind: "QUESTION_ANSWERED" },
      }),
    ).toBe(1);
    expect(
      await db.retargetingPixelAttempt.count({
        where: { journeyId: f.visit.journeyId! },
      }),
    ).toBe(0);
    expect(
      await db.advertisingPrivacyEvent.findMany({
        where: { journeyId: f.visit.journeyId! },
        select: { choice: true, source: true },
      }),
    ).toEqual([
      { choice: "DENIED", source: source === "CHOICE" ? "CHOICE" : "GPC" },
    ]);
  },
);

it("preserves every return click and original journey, progresses application audiences, and queues sale suppression without server pixels", async () => {
  const f = await rtVisit();
  await f.verify();
  await f.send("engagement", {
    event: {
      kind: "QUESTION_ANSWERED",
      questionId: "amount",
      answers: { amount: "Small" },
    },
  });
  await f.send("retargeting/qualify");
  const next = await request(
    "/api/public/visit",
    "POST",
    {
      slug: f.experiment.slug,
      campaignId: "88101",
      zoneId: "2",
      clickId: "retargeting-click-a",
    },
    false,
    f.headers,
  );
  const returned = await db.visit.findUniqueOrThrow({
    where: { id: next.data.visitId },
  });
  expect(returned).toMatchObject({
    journeyId: f.visit.journeyId,
    externalClickId: "retargeting-click-a",
    retargetingCampaignId: "88101",
    retargetingAudienceId: "88001",
  });
  expect(returned.id).not.toBe(f.visit.id);
  expect(
    (await db.visit.findUniqueOrThrow({ where: { id: f.visit.id } }))
      .externalClickId,
  ).toBe(f.visit.externalClickId);
  const send = (path: string, body: object = {}) =>
    request(
      `/api/public/${path}`,
      "POST",
      { visitToken: next.data.visitToken, ...body },
      false,
      f.headers,
    );
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    Response.json({
      success: true,
      hostname: new URL(env.APP_URL).hostname,
      action: "visit",
      cdata: returned.id,
    }),
  );
  await send("verify-visit", { turnstileToken: `return-${returned.id}` });
  const continuing = await send("continue", { entryPoint: "optional_updates" });
  expect(continuing.status).toBe(200);
  const appId = new URL(continuing.data.url).searchParams.get("subId3")!;
  expect(
    (await db.applicationClick.findUniqueOrThrow({ where: { id: appId } }))
      .visitId,
  ).toBe(returned.id);
  const progression = (await send("retargeting/qualify")).data.pixels;
  expect(
    progression
      .map((p: any) => [p.action, new URL(p.url).searchParams.get("partner")])
      .sort(),
  ).toEqual([
    ["ENROLL", "88002"],
    ["REMOVE", "88001"],
  ]);
  const calls = providerCalls.length;
  expect(
    await recordPostback({
      eventId: `retargeting-sale-${appId}`,
      applicationId: appId,
      event: "SOLD",
      revenue: "4.50",
    }),
  ).toMatchObject({ duplicate: false });
  expect(
    await recordPostback({
      eventId: `retargeting-sale-${appId}`,
      applicationId: appId,
      event: "SOLD",
      revenue: "4.50",
    }),
  ).toMatchObject({ duplicate: true });
  expect(providerCalls).toHaveLength(calls);
  expect(
    (
      await db.visitorJourney.findUniqueOrThrow({
        where: { id: f.visit.journeyId! },
      })
    ).suppressionReason,
  ).toBe("PAID_LEAD");
  expect(
    await db.retargetingPixelAttempt.count({
      where: {
        journeyId: f.visit.journeyId!,
        audienceId: "88002",
        action: "REMOVE",
      },
    }),
  ).toBe(0);
  const suppression = (await send("retargeting/qualify")).data.pixels;
  expect(
    suppression
      .map((p: any) => [p.action, new URL(p.url).searchParams.get("partner")])
      .sort(),
  ).toEqual([
    ["ENROLL", "88003"],
    ["REMOVE", "88002"],
  ]);
  expect((await send("retargeting/qualify")).data.pixels).toEqual([]);
  await recordPostback({
    eventId: `retargeting-other-sale-id-${appId}`,
    applicationId: appId,
    event: "SOLD",
    revenue: "4.50",
  });
  const today = new Date().toISOString().slice(0, 10);
  let report = await retargetingReport({
    from: today,
    through: today,
    groupBy: "campaign",
  });
  expect(report.rows.find((r) => r.key === "88101")).toMatchObject({
    paidLeads: 1,
    commission: 4.5,
    repeatedSaleEvents: 1,
    spend: null,
    paidLeadAcquisitionCost: null,
  });
  const rows = [
    {
      campaignId: "88101",
      day: today,
      amount: 2.25,
      currency: "USD",
      reference: "Isolated test daily spend",
    },
  ];
  await recordRetargetingSpend({ rows });
  await recordRetargetingSpend({ rows });
  report = await retargetingReport({ from: today, through: today });
  expect(report.rows.find((r) => r.key === "88101")).toMatchObject({
    spend: 2.25,
    paidLeadAcquisitionCost: 2.25,
  });
  expect((await retargetingStatus()).confirmedAudienceMembership).toBeNull();
});

it("allows standalone Turnstile without an edge audit while retaining verification and suppression requirements", async () => {
  await rtSetup();
  const config = await retargetingConfiguration();
  expect(config.plan.cloudflareAudit).toBeUndefined();
  expect(validateConfiguration(config).ready).toBe(true);
  config.plan.cloudflareAudit = {
    passed: false,
    testedAt: "2000-01-01T00:00:00.000Z",
    reference: "Optional historical review does not gate Turnstile",
  };
  expect(validateConfiguration(config).ready).toBe(true);
  const runtime = await readRuntimeConfiguration();
  const noSecret = runtimeContext.run(
    { ...runtime, TURNSTILE_SECRET_KEY: "" },
    () => validateConfiguration(config),
  );
  expect(noSecret.collectionReady).toBe(false);
  expect(noSecret.collectionGaps).toContain("Configure both Turnstile keys.");
  delete config.plan.suppressionTest;
  expect(validateConfiguration(config).ready).toBe(false);
});

it("exposes MCP controls, requires exact pixels for collection, and keeps launch checks separate for prelaunch testing", async () => {
  const client = new Client({ name: "retargeting-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${env.MCP_TOKEN}` } },
    }),
  );
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      "save_retargeting_settings",
      "save_retargeting_plan",
      "validate_retargeting_setup",
      "retargeting_report",
      "retargeting_status",
      "record_retargeting_spend",
    ])
      expect(names).toContain(name);
    const configured = await retargetingConfiguration();
    const badDestination = structuredClone(configured);
    badDestination.plan.targetingChecks[0].targetUrl =
      "https://example.test/missing-macros";
    const destinationCheck = await validateRetargetingSetup(badDestination);
    expect(destinationCheck.collectionReady).toBe(true);
    expect(destinationCheck.ready).toBe(false);
    expect(destinationCheck.attributionGaps).toHaveLength(2);
    const gaps = await client.callTool({
      name: "save_retargeting_plan",
      arguments: { stages: [] },
    });
    expect(gaps.isError).not.toBe(true);
    expect(validateConfiguration(await retargetingConfiguration()).ready).toBe(
      false,
    );
    expect(
      (
        await client.callTool({
          name: "save_retargeting_settings",
          arguments: { enabled: true, audiences: [] },
        })
      ).isError,
    ).toBe(true);
    const f = await rtVisit();
    await f.verify();
    await f.send("engagement", {
      event: {
        kind: "QUESTION_ANSWERED",
        questionId: "amount",
        answers: { amount: "Small" },
      },
    });
    expect((await f.send("retargeting/qualify")).data.pixels).toHaveLength(1);
    expect(validateConfiguration(await retargetingConfiguration()).ready).toBe(
      false,
    );
    expect(
      (
        await client.callTool({
          name: "retargeting_report",
          arguments: { groupBy: "group" },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: "save_retargeting_settings",
          arguments: { enabled: false, audiences: rtAudiences },
        })
      ).isError,
    ).not.toBe(true);
  } finally {
    await client.close();
  }
});

it("compares mature treatment/control journeys with equal windows, counts sales once, and retains immature journeys outside the comparison", async () => {
  const now = new Date(),
    elapsed = 86400_000;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const eligible = new Date(now.getTime() - 10 * elapsed),
    sold = new Date(eligible.getTime() + elapsed);
  for (const group of ["TREATMENT", "CONTROL"] as const) {
    const f = await rtVisit(group);
    await db.visitorJourney.update({
      where: { id: f.visit.journeyId! },
      data: {
        eligibleAt: eligible,
        createdAt: new Date(eligible.getTime() - elapsed),
      },
    });
    await db.visit.update({
      where: { id: f.visit.id },
      data: {
        createdAt: eligible,
        verifiedAt: eligible,
        verificationState: "VERIFIED",
      },
    });
    const app = await db.applicationClick.create({
      data: { visitId: f.visit.id, createdAt: eligible },
    });
    await db.postback.createMany({
      data: [
        {
          applicationId: app.id,
          eventId: `control-study-first-${app.id}`,
          event: "SOLD",
          revenue: 3,
          createdAt: sold,
        },
        {
          applicationId: app.id,
          eventId: `control-study-retry-${app.id}`,
          event: "SOLD",
          revenue: 3,
          createdAt: new Date(sold.getTime() + elapsed),
        },
      ],
    });
  }
  const report = await retargetingReport({
    from: day(eligible),
    through: day(now),
    observationDays: 7,
    groupBy: "group",
  });
  for (const arm of report.controlStudy.arms)
    expect(arm).toMatchObject({
      eligibleJourneys: 1,
      convertedJourneys: 1,
      paidLeadRate: 1,
      commission: 3,
    });
  expect(report.controlStudy.observedRateDifference).toBe(0);
  for (const row of report.rows) expect(row.spend).toBeNull();
  expect((await request("/api/admin/retargeting/status")).status).toBe(401);
  expect(
    (await request("/api/admin/retargeting/status", "GET", undefined, true))
      .status,
  ).toBe(200);
});

it("marks engagement verified only with a current proof and preserves newer verification results when responses arrive out of order", async () => {
  await rtSetup();
  const f = await rtVisit();
  await f.verify();
  await db.visit.update({
    where: { id: f.visit.id },
    data: { verificationExpiresAt: new Date(Date.now() - 1) },
  });
  await f.send("engagement", {
    event: {
      kind: "QUESTION_ANSWERED",
      questionId: "amount",
      answers: { amount: "Small" },
    },
  });
  expect(
    (
      await db.visitEvent.findFirstOrThrow({
        where: { visitId: f.visit.id, kind: "QUESTION_ANSWERED" },
      })
    ).verifiedAt,
  ).toBeNull();
  expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
  let resolveSlow!: (response: Response) => void;
  vi.mocked(globalThis.fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveSlow = resolve;
      }),
  );
  const earlier = f.send("verify-visit", {
    turnstileToken: `slow-${f.visit.id}`,
  });
  await expect
    .poll(
      async () =>
        (await db.visit.findUniqueOrThrow({ where: { id: f.visit.id } }))
          .verificationState,
    )
    .toBe("PENDING");
  expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
  expect((await f.verify()).data.verified).toBe(true);
  resolveSlow(
    Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
  );
  await earlier;
  expect(
    (await db.visit.findUniqueOrThrow({ where: { id: f.visit.id } }))
      .verificationState,
  ).toBe("VERIFIED");
  expect(
    (
      await db.visitEvent.findFirstOrThrow({
        where: { visitId: f.visit.id, kind: "QUESTION_ANSWERED" },
      })
    ).verifiedAt,
  ).not.toBeNull();
  expect((await f.send("retargeting/qualify")).data.pixels).toHaveLength(1);
  const lead = await db.lead.create({
    data: {
      visitId: f.visit.id,
      name: "Subscription suppression fixture",
      answers: {},
    },
  });
  const sub = await db.subscription.create({
    data: {
      leadId: lead.id,
      channel: "EMAIL",
      address: `suppression-${f.visit.id}@example.test`,
      consentText: "Test consent",
      consentVersion: "test",
      consentIpHash: "test",
    },
  });
  await activateSubscription(sub.id);
  expect(
    (
      await db.retargetingPixelAttempt.findFirstOrThrow({
        where: {
          journeyId: f.visit.journeyId!,
          action: "ENROLL",
          audienceId: "88001",
        },
      })
    ).suppressionReason,
  ).not.toBeNull();
  await f.send("advertising-choice", { choice: "DENIED" });
  expect((await f.send("retargeting/qualify")).data.pixels).toEqual([]);
  expect(
    await db.retargetingPixelAttempt.count({
      where: { journeyId: f.visit.journeyId!, action: "REMOVE" },
    }),
  ).toBe(0);
  expect(
    (await retargetingStatus()).recentVerificationFailures.length,
  ).toBeGreaterThan(0);
  await saveRetargetingSettings({ enabled: false, audiences: rtAudiences });
});

it("compares zones and locations with honest traffic quality, weighted CTR and deduplicated outcomes", async () => {
  const campaignId = "777811";
  const exp = await db.experiment.create({
    data: {
      name: "Statistics fixture",
      slug: "statistics-fixture",
      status: "ACTIVE",
      variants: {
        create: {
          name: "Statistics landing",
          weight: 100,
          config: landingSchema.parse({
            title: "Statistics",
            description: "Test fixture",
          }),
        },
      },
    },
    include: { variants: true },
  });
  const source = await db.trafficSource.create({
    data: { campaignId, zoneId: "111" },
  });
  const arrived = new Date(Date.now() - 2 * 86400000);
  const day = arrived.toISOString().slice(0, 10);
  const create = (data: object = {}) =>
    db.visit.create({
      data: {
        experimentId: exp.id,
        variantId: exp.variants[0].id,
        sourceId: source.id,
        ipHash: "statistics-test",
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36",
        evidence: [],
        createdAt: arrived,
        ...data,
      },
    });
  const human = await create({
    verified: true,
    verificationState: "VERIFIED",
    country: "US",
    region: "Illinois",
    city: "Springfield",
    geoSource: "TRUSTED_EDGE",
    costRecorded: true,
    cost: 0.5,
    preQuizMeasuredAt: arrived,
    preQuizActiveMs: 30_000,
    preQuizClicks: 2,
    preQuizScrolls: 1,
    adContext: {
      bannerId: "27516444",
      browser: "Chrome",
      browserVersion: "130",
      connectionType: "cellular",
      carrier: "Verizon",
      language: "en",
      os: "Windows",
      osVersion: "10",
      subzoneId: "7",
    },
  });
  await create({
    botScore: 100,
    verificationState: "FAILED",
    country: "US",
    region: "Massachusetts",
    city: "Springfield",
    preQuizMeasuredAt: arrived,
    preQuizActiveMs: 10_000,
    preQuizScrolls: 1,
  });
  await create({ verificationState: "ERROR" });
  await create();
  await db.landingHit.createMany({
    data: [
      ...Array.from({ length: 7 }, () => ({
        slug: exp.slug,
        campaignId,
        zoneId: "111",
        externalClickId: "server-hit-111",
        userAgent: "Android",
        ipHash: "server-hit-test",
        createdAt: arrived,
      })),
      ...Array.from({ length: 4 }, () => ({
        slug: exp.slug,
        campaignId,
        zoneId: "222",
        externalClickId: "server-hit-222",
        userAgent: "Android",
        ipHash: "server-hit-test",
        createdAt: arrived,
      })),
    ],
  });
  await db.landingHit.create({
    data: {
      slug: exp.slug,
      campaignId,
      zoneId: "111",
      externalClickId: "server-hit-linked",
      userAgent: "Android",
      ipHash: "server-hit-test",
      visitId: human.id,
      createdAt: arrived,
    },
  });
  await db.visitEvent.createMany({
    data: [
      {
        visitId: human.id,
        kind: "QUESTION_ANSWERED",
        questionId: "a",
        answer: "W2 employee",
      },
      {
        visitId: human.id,
        kind: "QUESTION_ANSWERED",
        questionId: "b",
        answer: "$5,000–$10,000",
      },
      { visitId: human.id, kind: "QUIZ_COMPLETED" },
    ],
  });
  const lead = await db.lead.create({
    data: { visitId: human.id, name: "Stats fixture", answers: {} },
  });
  await db.subscription.createMany({
    data: ["EMAIL", "PUSH"].map((channel) => ({
      leadId: lead.id,
      channel: channel as "EMAIL" | "PUSH",
      address: `stats-${channel}`,
      status: "ACTIVE" as const,
      consentText: "Test only",
      consentVersion: "test",
      consentIpHash: "test",
      confirmedAt: new Date(),
    })),
  });
  const application = await db.applicationClick.create({
    data: { visitId: human.id, leadId: lead.id },
  });
  await db.postback.createMany({
    data: [
      {
        eventId: "stats-sale",
        applicationId: application.id,
        event: "SOLD",
        revenue: 3,
        createdAt: new Date(Date.now() - 1000),
      },
      {
        eventId: "stats-sale-repeat",
        applicationId: application.id,
        event: "SOLD",
        revenue: 9,
      },
    ],
  });
  const saved = await readRuntimeConfiguration();
  const provider = vi.mocked(globalThis.fetch).getMockImplementation()!;
  const claritySnapshot = await db.claritySnapshot.create({
    data: {
      days: 1,
      dimensions: ["URL", "Campaign", "Device"],
      rowCount: 2,
      windowStart: new Date(Date.now() - 86400000),
      windowEnd: new Date(),
      metrics: [
        {
          metricName: "Traffic",
          information: [
            {
              URL: `${env.APP_URL}/go/statistics-fixture?campaign_id=${campaignId}&zone_id=111`,
              Campaign: campaignId,
              Device: "Desktop",
              totalSessionCount: 10,
              totalBotSessionCount: 2,
              distinctUserCount: 8,
              PagesPerSessionPercentage: 2,
            },
            {
              URL: `${env.APP_URL}/go/statistics-fixture?campaign_id=${campaignId}&zone_id=222`,
              Campaign: campaignId,
              Device: "Mobile",
              totalSessionCount: 5,
              totalBotSessionCount: 4,
              distinctUserCount: 5,
              PagesPerSessionPercentage: 1,
            },
          ],
        },
      ],
    },
  });
  try {
    await saveRuntimeSettings(
      { secrets: { PROPELLER_API_TOKEN: "stats-test-token" } },
      "test",
    );
    const providerRows = [
      {
        campaign_id: Number(campaignId),
        zone_id: 111,
        country: "United States (US)",
        date_time: day,
        impressions: 100,
        clicks: 10,
        spent: 1,
      },
      {
        campaign_id: Number(campaignId),
        zone_id: 222,
        country: "United States (US)",
        date_time: day,
        impressions: 900,
        clicks: 9,
        spent: 2,
      },
    ];
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      if (!String(url).includes("/adv/statistics")) return provider(url, init);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        group_by: ["campaign_id", "zone_id", "country_id", "date_time"],
        campaign_id: [Number(campaignId)],
        day_from: `${day} 00:00:00`,
        day_to: `${day} 23:59:59`,
      });
      return Response.json({ result: providerRows, request_id: "stats-test" });
    });
    const input = { campaignId, from: day, to: day };
    const report = await statisticsReport(input);
    expect(report.advertiser.status).toBe("ready");
    expect(report.clarity).toMatchObject({
      aligned: true,
      summary: {
        attributedSessions: 15,
        humanSessions: 9,
        botSessions: 6,
        botRate: 0.4,
        pagesPerSession: 5 / 3,
      },
    });
    expect(report.summary).toMatchObject({
      visits: 4,
      verified: 1,
      suspectedBots: 1,
      unverified: 2,
      verificationFailed: 1,
      verificationErrors: 1,
      verificationNotFinished: 1,
      serverHits: 12,
      paidClickDeliveryRate: 12 / 19,
      jsRenderRate: 1 / 3,
      verifiedPerAdClick: 1 / 19,
      engaged: 1,
      engagementRate: 0.25,
      preQuizMeasuredVisits: 2,
      preQuizActivityVisits: 2,
      preQuizActiveSeconds: 40,
      preQuizAverageSeconds: 20,
      preQuizClicks: 2,
      preQuizScrolls: 2,
      preQuizInteractions: 4,
      subscribers: 1,
      subscriptionRate: 0.25,
      emailSubscribers: 1,
      pushSubscribers: 1,
      applicationVisitors: 1,
      sold: 1,
      revenue: 3,
      adSpend: 3,
      costPerVisit: 0.75,
      costPerQuizCompletion: 3,
      costPerApplication: 3,
      recordedClickCost: 0.5,
      ctr: 0.019,
    });
    expect(report.rows).toHaveLength(2);
    expect(report.rows.find((r) => r.label === "Zone 222")).toMatchObject({
      visits: 0,
      serverHits: 4,
      paidClickDeliveryRate: 4 / 9,
      ctr: 0.01,
      subscriptionRate: null,
      claritySessions: 5,
      clarityBotRate: 0.8,
    });
    expect(report.rows.find((r) => r.label === "Zone 111")).toMatchObject({
      costPerSubscriber: 1,
      serverHits: 8,
      paidClickDeliveryRate: 0.8,
      jsRenderRate: 0.5,
      costPerVisit: 0.25,
      costPerQuizCompletion: 1,
      costPerApplication: 1,
      adContribution: 2,
      ctr: 0.1,
      claritySessions: 10,
      clarityHumanSessions: 8,
      clarityBotSessions: 2,
      clarityBotRate: 0.2,
      clarityPagesPerSession: 2,
    });
    const cities = await statisticsReport({ ...input, groupBy: "city" });
    expect(cities.rows).toHaveLength(3);
    expect(cities.rows.filter((r) => r.label === "Springfield")).toHaveLength(
      2,
    );
    expect(cities.rows.find((r) => r.label === "Unknown city")?.visits).toBe(2);
    expect(cities.advertiser.status).toBe("unsupported");
    expect(cities.clarity.aligned).toBe(false);
    expect(cities.summary.claritySessions).toBeNull();
    expect(cities.summary.adSpend).toBeNull();
    const illinois = await statisticsReport({
      ...input,
      groupBy: "zone",
      region: "Illinois",
    });
    expect(illinois.summary).toMatchObject({
      visits: 1,
      engagementRate: 1,
      subscriptionRate: 1,
      adSpend: null,
    });
    expect(
      (await statisticsReport({ ...input, groupBy: "device" })).rows[0].label,
    ).toBe("Desktop");
    expect(
      (await statisticsReport({ ...input, groupBy: "creative" })).rows.find(
        (row) => row.label === "Creative 27516444",
      )?.visits,
    ).toBe(1);
    const campaignVisits = await statisticsVisits({
      ...input,
      groupBy: "campaign",
      segmentKey: JSON.stringify([campaignId]),
      page: 1,
      pageSize: 10,
    });
    expect(campaignVisits.total).toBe(4);
    expect(campaignVisits.items).toHaveLength(4);
    expect(
      campaignVisits.items.find((visit) => visit.id === human.id),
    ).toMatchObject({
      source: { campaignId, zoneId: "111" },
      adContext: { bannerId: "27516444", carrier: "Verizon" },
      browserContext: { device: "Desktop", browser: "Chrome", os: "Windows" },
      verification: { verified: true, state: "VERIFIED", botScore: 0 },
      preQuiz: { activeSeconds: 30, clicks: 2, scrolls: 1 },
      landingHits: [
        expect.objectContaining({
          campaignId,
          zoneId: "111",
          externalClickId: "server-hit-linked",
        }),
      ],
      events: [
        { kind: "QUESTION_ANSWERED", questionId: "a", answer: "W2 employee" },
        {
          kind: "QUESTION_ANSWERED",
          questionId: "b",
          answer: "$5,000–$10,000",
        },
        { kind: "QUIZ_COMPLETED" },
      ],
      leads: [
        {
          status: "NEW",
          subscriptions: expect.arrayContaining([
            expect.objectContaining({ channel: "EMAIL", status: "ACTIVE" }),
            expect.objectContaining({ channel: "PUSH", status: "ACTIVE" }),
          ]),
        },
      ],
      applications: [
        {
          postbacks: expect.arrayContaining([
            expect.objectContaining({ event: "SOLD", revenue: 3 }),
          ]),
        },
      ],
    });
    expect(JSON.stringify(campaignVisits)).not.toContain("stats-EMAIL");
    expect(JSON.stringify(campaignVisits)).not.toContain("statistics-test");
    expect(
      (
        await statisticsVisits({
          ...input,
          groupBy: "creative",
          segmentKey: JSON.stringify(["27516444"]),
          page: 1,
          pageSize: 10,
        })
      ).total,
    ).toBe(1);
    const unauthorized = await request(
      "/api/admin/statistics/report",
      "POST",
      input,
    );
    expect(unauthorized.status).toBe(401);
    const authorized = await request(
      "/api/admin/statistics/report",
      "POST",
      input,
      true,
    );
    expect(authorized.status).toBe(200);
    expect(authorized.data.summary.visits).toBe(4);
    expect(JSON.stringify(authorized.data)).not.toContain("stats-test-token");
    const authorizedVisits = await request(
      "/api/admin/statistics/visits",
      "POST",
      {
        ...input,
        groupBy: "campaign",
        segmentKey: JSON.stringify([campaignId]),
        page: 1,
        pageSize: 10,
      },
      true,
    );
    expect(authorizedVisits.status).toBe(200);
    expect(authorizedVisits.data.total).toBe(4);
    expect(
      (
        await request("/api/admin/statistics/visits", "POST", {
          ...input,
          groupBy: "campaign",
          segmentKey: JSON.stringify([campaignId]),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/admin/statistics/report",
          "POST",
          { ...input, from: "2026-02-30" },
          true,
        )
      ).status,
    ).toBe(400);
  } finally {
    vi.mocked(globalThis.fetch).mockImplementation(provider);
    await db.claritySnapshot.delete({ where: { id: claritySnapshot.id } });
    await saveRuntimeSettings(
      { secrets: { PROPELLER_API_TOKEN: saved.PROPELLER_API_TOKEN } },
      "test",
    );
  }
});

it("captures trusted arrival geography and does not fabricate locations from browser headers", async () => {
  const saved = await readRuntimeConfiguration();
  const secret = "statistics-test-edge-secret-at-least-32-characters";
  await saveRuntimeSettings(
    { secrets: { CLOUDFLARE_GEO_TOKEN: secret } },
    "test",
  );
  try {
    for (const trusted of [false, true]) {
      const response = await request(
        "/api/public/visit",
        "POST",
        { slug: "statistics-fixture", clickId: `geo-${trusted}` },
        false,
        {
          "X-Forwarded-For": trusted ? "203.0.113.191" : "203.0.113.190",
          "cf-ipcountry": "US",
          "cf-region": "Illinois",
          "cf-ipcity": "Chicago",
          ...(trusted ? { "x-sparecash-geo-token": secret } : {}),
        },
      );
      expect(response.status).toBe(200);
      const visit = await db.visit.findUniqueOrThrow({
        where: { id: response.data.visitId },
      });
      expect(visit.country).toBe(trusted ? "US" : null);
      expect(visit.city).toBe(trusted ? "Chicago" : null);
    }
  } finally {
    await saveRuntimeSettings(
      { secrets: { CLOUDFLARE_GEO_TOKEN: saved.CLOUDFLARE_GEO_TOKEN } },
      "test",
    );
  }
});

it("summarizes Clarity exports by paid campaign and zone without exposing URLs", async () => {
  const snapshot = await db.claritySnapshot.create({
    data: {
      days: 1,
      dimensions: ["URL", "Campaign", "Device"],
      rowCount: 3,
      windowStart: new Date(Date.now() - 86400000),
      windowEnd: new Date(),
      metrics: [
        {
          metricName: "Traffic",
          information: [
            {
              URL: `${env.APP_URL}/go/test?campaign_id=701&zone_id=801&click_id=must-not-return`,
              Campaign: "ignored",
              Device: "Mobile",
              totalSessionCount: "10",
              totalBotSessionCount: "2",
              distantUserCount: "8",
              PagesPerSessionPercentage: 2,
            },
            {
              URL: `${env.APP_URL}/go/test?campaign_id=701&zone_id=801`,
              Device: "Tablet",
              totalSessionCount: "5",
              totalBotSessionCount: "1",
              distantUserCount: "4",
              PagesPerSessionPercentage: 3,
            },
            {
              URL: `${env.APP_URL}/go/direct`,
              Device: "Desktop",
              totalSessionCount: "7",
              totalBotSessionCount: "0",
              distantUserCount: "7",
              PagesPerSessionPercentage: 1,
            },
          ],
        },
      ],
    },
  });
  try {
    const report = await clarityReport({
      snapshotId: snapshot.id,
      minimumSessions: 1,
    });
    expect(report.zones).toEqual([
      expect.objectContaining({
        campaignId: "701",
        zoneId: "801",
        sessions: 15,
        botSessions: 3,
        humanSessions: 12,
        botRate: 0.2,
        distinctUsers: 12,
        pagesPerSession: 7 / 3,
        devices: ["Mobile", "Tablet"],
        urlCount: 2,
      }),
    ]);
    expect(report.unattributedSessions).toBe(7);
    expect(JSON.stringify(report)).not.toContain("must-not-return");
  } finally {
    await db.claritySnapshot.delete({ where: { id: snapshot.id } });
  }
});

it("resets marketing content and statistics while preserving configuration", async () => {
  const configuration = await readRuntimeConfiguration();
  const generalSettings = await settings();
  const retargetingAudiences = await db.retargetingAudience.findMany({
    orderBy: { id: "asc" },
  });
  expect(retargetingAudiences.length).toBeGreaterThan(0);
  await db.setting.upsert({
    where: { key: "retargeting_plan" },
    create: {
      key: "retargeting_plan",
      value: {
        stages: [
          {
            name: "Stale test mapping",
            audienceId: retargetingAudiences[0].id,
            excludeAudienceIds: [],
            campaignIds: ["123"],
          },
        ],
        targetingChecks: [],
      },
    },
    update: {
      value: {
        stages: [
          {
            name: "Stale test mapping",
            audienceId: retargetingAudiences[0].id,
            excludeAudienceIds: [],
            campaignIds: ["123"],
          },
        ],
        targetingChecks: [],
      },
    },
  });

  await expect(
    resetMarketingWorkspace("wrong confirmation", "test"),
  ).rejects.toThrow("Confirmation must exactly match");

  const result = await resetMarketingWorkspace(
    workspaceResetConfirmation,
    "test",
  );
  expect(result.ok).toBe(true);
  expect(result.deleted.experiments).toBeGreaterThan(0);
  expect(await db.experiment.count()).toBe(0);
  expect(await db.variant.count()).toBe(0);
  expect(await db.visit.count()).toBe(0);
  expect(await db.lead.count()).toBe(0);
  expect(await db.chain.count()).toBe(0);
  expect(await db.claritySnapshot.count()).toBe(0);
  expect(
    await db.retargetingAudience.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(retargetingAudiences);
  expect(
    (
      await db.setting.findUniqueOrThrow({
        where: { key: "retargeting_plan" },
      })
    ).value,
  ).toEqual({ stages: [], targetingChecks: [] });
  expect(await settings()).toEqual(generalSettings);
  expect(await readRuntimeConfiguration()).toEqual(configuration);
  expect(await db.auditLog.findMany()).toEqual([
    expect.objectContaining({
      actor: "test",
      action: "workspace.marketing_reset",
    }),
  ]);
});
