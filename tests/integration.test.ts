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
import { env } from "../server/config";
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
} from "../server/services/marketing";
import { sources, blockSource } from "../server/services/traffic";
import { tick } from "../server/services/engine";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
let server: Server,
  base: string,
  cookie: string,
  experiment: any,
  visitToken: string,
  visitId: string,
  leadId: string,
  applicationId: string,
  emailId: string;
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
  });
  expect(a.status).toBe(200);
  visitToken = a.data.visitToken;
  visitId = a.data.visitId;
  const b = await request(
    "/api/public/visit",
    "POST",
    { slug: "integration" },
    false,
    { Cookie: a.headers.get("set-cookie")!.split(";")[0] },
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
it("records the rendered consent snapshot and waits for email confirmation", async () => {
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
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
  const chain = await saveChain(
    {
      name: "Integration chain",
      channel: "EMAIL",
      status: "ACTIVE",
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
  await db.enrollment.create({
    data: {
      chainId: chain.id,
      subscriptionId: emailId,
      nextAt: new Date(Date.now() - 1000),
    },
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
    { Cookie: `sc_visit_integration=${visitToken}` },
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
    revenue: 9,
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
    revenue: 4,
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
      revenue: 9,
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
    adContribution: 6,
    returnOnAdSpend: 3,
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
      "followup_report",
      "quiz_answer_report",
      "list_traffic_visits",
      "record_visit_costs",
      "get_experiment",
      "list_landing_images",
      "set_experiment_allocation",
      "set_chain_status",
      "record_marketing_review",
    ])
      expect(tools.tools.some((tool) => tool.name === name)).toBe(true);
    const context = await call("marketing_context");
    expect(JSON.stringify(context)).not.toContain(env.MCP_TOKEN);
    expect(context.limits.join(" ")).toContain("external AI client");
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
