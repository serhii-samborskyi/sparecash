import { z } from "zod";
import { db } from "../db.js";
import { env } from "../config.js";
import { hash } from "../security.js";
import { settingsSchema } from "../domain.js";

const id = z.string().regex(/^\d+$/).max(30);
export const ADVERTISING_NOTICE =
  "SpareCash shares qualifying activity with PropellerAds for personalized advertising. Saved advertising opt-outs and Global Privacy Control are respected. This is separate from email, text and push subscriptions and does not affect access to loan options.";

// V1 deliberately accepts the provider's image adapter, not executable HTML.
// Keep the supplied URL byte-for-byte; do not infer partner from audience ID.
export const pixelSchema = z
  .object({
    type: z.literal("image"),
    url: z
      .string()
      .max(2000)
      .superRefine((value, ctx) => {
        try {
          const u = new URL(value);
          if (
            u.origin !== "https://my.rtmark.net" ||
            u.pathname !== "/img.gif" ||
            u.username ||
            u.password ||
            u.hash ||
            !/^(?:[1-9]\d*|[a-fA-F0-9]{64})$/.test(
              u.searchParams.get("partner") ?? "",
            ) ||
            !["on", "sync", "off"].includes(u.searchParams.get("f") ?? "") ||
            [...u.searchParams.keys()].some(
              (k) => !["partner", "f", "lr"].includes(k),
            ) ||
            new Set(u.searchParams.keys()).size !==
              [...u.searchParams.keys()].length ||
            (u.searchParams.has("lr") && u.searchParams.get("lr") !== "1")
          )
            throw new Error();
        } catch {
          ctx.addIssue({
            code: "custom",
            message:
              "Supply the exact HTTPS PropellerAds /img.gif URL with a numeric or 64-character hexadecimal partner, f=on/sync/off and optional lr=1. Scripts and arbitrary pixels are unsupported.",
          });
        }
      }),
    sourceCode: z.string().max(8000).optional(),
  })
  .strict();
const event = z.enum([
  "QUIZ_PARTICIPATED",
  "QUIZ_COMPLETED",
  "APPLICATION",
  "SUBSCRIBED",
  "PAID",
]);
export const audienceSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    purpose: z.enum([
      "REENGAGEMENT",
      "APPLICATION",
      "SUBSCRIPTION",
      "PAID_EXCLUSION",
    ]),
    enabled: z.boolean(),
    enrollment: pixelSchema,
    removal: pixelSchema.optional(),
    qualifyingEvents: z.array(event).min(1).max(5),
    applicationStatus: z.enum(["ANY", "NONE", "STARTED"]).default("ANY"),
    subscriptionStatus: z.enum(["ANY", "NONE", "CONFIRMED"]).default("ANY"),
    excludeOn: z
      .array(z.enum(["APPLICATION", "SUBSCRIBED", "PAID"]))
      .max(3)
      .default(["PAID"]),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      !["on", "sync"].includes(
        new URL(a.enrollment.url).searchParams.get("f") ?? "",
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Enrollment must use f=on or f=sync",
      });
    if (
      a.removal &&
      (new URL(a.removal.url).searchParams.get("f") !== "off" ||
        new URL(a.removal.url).searchParams.get("partner") !==
          new URL(a.enrollment.url).searchParams.get("partner"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Removal must use f=off with the enrollment pixel's partner",
      });
    if (
      (a.purpose === "PAID_EXCLUSION") !==
      (a.qualifyingEvents.length === 1 && a.qualifyingEvents[0] === "PAID")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Only PAID_EXCLUSION audiences can qualify on PAID, and must qualify only on PAID",
      });
    if (a.purpose !== "PAID_EXCLUSION" && a.qualifyingEvents.includes("PAID"))
      ctx.addIssue({
        code: "custom",
        message: "PAID is reserved for exclusion audiences",
      });
  });
export type Audience = z.infer<typeof audienceSchema>;

export const retargetingSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    controlPercent: z.number().int().min(1).max(99).default(20),
    audiences: z.array(audienceSchema).max(15).default([]),
  })
  .strict();
export const planSchema = z
  .object({
    stages: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            audienceId: id,
            excludeAudienceIds: z.array(id).max(15).default([]),
            campaignIds: z.array(id).max(100).default([]),
          })
          .strict(),
      )
      .max(15)
      .default([]),
    targetingChecks: z
      .array(
        z
          .object({
            campaignId: id,
            targetUrl: z.string().url().max(4000),
            includedAudienceIds: z.array(id).max(15),
            excludedAudienceIds: z.array(id).max(15),
            observedAt: z.string().datetime(),
            reference: z.string().min(5).max(1000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    suppressionTest: z
      .object({
        passed: z.boolean(),
        testedAt: z.string().datetime(),
        reference: z.string().min(5).max(1000),
      })
      .strict()
      .optional(),
    cloudflareAudit: z
      .object({
        passed: z.boolean(),
        testedAt: z.string().datetime(),
        reference: z.string().min(5).max(1000),
      })
      .strict()
      .optional()
      .describe(
        "Optional historical edge-security review. Cloudflare DNS/CDN/WAF and this audit are not required for Turnstile or retargeting readiness.",
      ),
  })
  .strict();
export type RetargetingPlan = z.infer<typeof planSchema>;

export async function retargetingConfiguration(
  client: Pick<typeof db, "setting" | "retargetingAudience"> = db,
) {
  const [setting, audiences, plan] = await Promise.all([
    client.setting.findUnique({ where: { key: "retargeting" } }),
    client.retargetingAudience.findMany({ orderBy: { id: "asc" } }),
    client.setting.findUnique({ where: { key: "retargeting_plan" } }),
  ]);
  return {
    ...retargetingSettingsSchema
      .omit({ audiences: true })
      .parse(setting?.value ?? {}),
    audiences: audiences.map((a) => audienceSchema.parse(a.config)),
    plan: planSchema.parse(plan?.value ?? {}),
    advertisingNotice: ADVERTISING_NOTICE,
  };
}
export async function validateRetargetingSetup(
  input?: Awaited<ReturnType<typeof retargetingConfiguration>>,
) {
  const config = input ?? (await retargetingConfiguration());
  const result = validateConfiguration(config);
  const general = settingsSchema.parse(
    (await db.setting.findUnique({ where: { key: "general" } }))?.value ?? {},
  );
  const attributionGaps: string[] = [];
  if (!env.ROUNDSKY_WEBHOOK_TOKEN || !general.roundskyUrl)
    attributionGaps.push(
      "Configure RoundSky's destination and authenticated sale callback.",
    );
  if (
    env.NODE_ENV === "production" &&
    new URL(env.APP_URL).protocol !== "https:"
  )
    attributionGaps.push(
      "Production APP_URL must use HTTPS for cookies, verification and callbacks.",
    );
  for (const stage of config.plan.stages)
    for (const campaignId of stage.campaignIds) {
      const check = config.plan.targetingChecks.find(
        (c) => c.campaignId === campaignId,
      );
      if (!check) continue;
      const url = new URL(check.targetUrl);
      const slug = url.pathname.startsWith("/go/") ? url.pathname.slice(4) : "";
      const landing = slug
        ? await db.experiment.findUnique({
            where: { slug },
            select: { status: true },
          })
        : null;
      if (
        url.origin !== new URL(env.APP_URL).origin ||
        landing?.status !== "ACTIVE"
      )
        attributionGaps.push(
          `Campaign ${campaignId}: target a published SpareCash /go/ landing on APP_URL.`,
        );
      if (
        !["{campaign_id}", campaignId].includes(
          url.searchParams.get("campaign_id") ?? "",
        ) ||
        url.searchParams.get("zone_id") !== "{zone_id}" ||
        url.searchParams.get("click_id") !== "${SUBID}"
      )
        attributionGaps.push(
          `Campaign ${campaignId}: preserve campaign_id={campaign_id}, zone_id={zone_id} and click_id=\u0024{SUBID} in the actual destination readback.`,
        );
    }
  return {
    ...result,
    ready: result.ready && !attributionGaps.length,
    attributionGaps,
    gaps: [...result.gaps, ...attributionGaps],
    attribution: {
      roundSkyConfigured: !!env.ROUNDSKY_WEBHOOK_TOKEN && !!general.roundskyUrl,
      callbackSemantics:
        "SOLD is a paid lead, not funded. Complete a real callback test before launch.",
      destinationChecks: config.plan.targetingChecks.length,
    },
  };
}

export function validateConfiguration(
  config: Awaited<ReturnType<typeof retargetingConfiguration>>,
) {
  const collectionGaps: string[] = [];
  const gaps = collectionGaps;
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY)
    gaps.push("Configure both Turnstile keys.");
  if (
    env.NODE_ENV === "production" &&
    /^(1x|2x|3x)000/.test(env.TURNSTILE_SITE_KEY)
  )
    gaps.push("Replace the Turnstile test key before launch.");
  const enabled = config.audiences.filter((a) => a.enabled);
  if (!enabled.some((a) => a.purpose !== "PAID_EXCLUSION"))
    gaps.push(
      "Provide an enabled marketing audience and its exact enrollment pixel.",
    );
  for (const a of enabled.filter((a) => a.purpose !== "PAID_EXCLUSION"))
    if (!a.removal)
      gaps.push(`Audience ${a.id}: provide the exact removal pixel.`);
  const launchGaps: string[] = [];
  for (const a of enabled.filter((a) => a.purpose !== "PAID_EXCLUSION")) {
    const stages = config.plan.stages.filter((s) => s.audienceId === a.id);
    if (!stages.length || stages.some((s) => !s.campaignIds.length))
      launchGaps.push(
        `Audience ${a.id}: link draft PropellerAds campaigns to an event stage.`,
      );
    for (const stage of stages) {
      if (
        !stage.excludeAudienceIds.some((id) =>
          enabled.some((x) => x.id === id && x.purpose === "PAID_EXCLUSION"),
        )
      )
        launchGaps.push(
          `Stage ${stage.name}: map an enabled paid-lead exclusion audience.`,
        );
      for (const campaignId of stage.campaignIds) {
        const check = config.plan.targetingChecks.find(
          (c) => c.campaignId === campaignId,
        );
        if (
          !check ||
          !freshEvidence(check.observedAt) ||
          check.includedAudienceIds.length !== 1 ||
          check.includedAudienceIds[0] !== a.id ||
          stage.excludeAudienceIds.some(
            (id) => !check.excludedAudienceIds.includes(id),
          )
        )
          launchGaps.push(
            `Campaign ${campaignId}: supply a recent targeting readback showing only audience ${a.id} included and all stage exclusions applied.`,
          );
      }
    }
  }
  if (
    !config.plan.suppressionTest?.passed ||
    !freshEvidence(config.plan.suppressionTest.testedAt)
  )
    launchGaps.push(
      "Record a recent end-to-end suppression test; a server-side sale cannot run browser removal pixels.",
    );
  return {
    ready: collectionGaps.length + launchGaps.length === 0,
    collectionReady: collectionGaps.length === 0,
    collectionGaps,
    launchGaps,
    enabled: config.enabled,
    gaps: [...collectionGaps, ...launchGaps],
    checks: {
      serverVerification: true,
      visitBinding: true,
      advertisingChoiceRequired: true,
      persistentHoldout: true,
      timedStagesSupported: false,
    },
    evidence:
      "Targeting and suppression evidence is supplied by the operator/PropellerAds MCP; SpareCash cannot independently inspect that account.",
    limits: [
      "Pixel load is not confirmed audience membership.",
      "Suppression after a sale waits for a verified browser return without an advertising opt-out; advertiser exclusions must be tested separately.",
      "Browser identifiers do not link cleared cookies or different devices.",
      "Turnstile works independently of Cloudflare DNS/CDN/WAF; an edge-security audit is optional and does not gate readiness.",
    ],
  };
}
function freshEvidence(value: string) {
  const age = Date.now() - new Date(value).getTime();
  return age >= -60_000 && age < 7 * 86400_000;
}
async function configurationLock(
  tx: import("@prisma/client").Prisma.TransactionClient,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(83923771)`;
}
export async function saveRetargetingSettings(raw: unknown) {
  const input = retargetingSettingsSchema.parse(raw);
  if (new Set(input.audiences.map((a) => a.id)).size !== input.audiences.length)
    throw new Error("Audience IDs must be unique");
  await db.$transaction(async (tx) => {
    await configurationLock(tx);
    const current = await retargetingConfiguration(tx);
    if (input.enabled) {
      const check = validateConfiguration({ ...current, ...input });
      if (!check.collectionReady)
        throw new Error(check.collectionGaps.join("\n"));
    }
    if (
      await tx.visitorJourney.count({
        where: { controlPercent: { not: input.controlPercent } },
      })
    )
      throw new Error(
        "The control split is frozen after the first journey; changing it requires a new study.",
      );
    for (const audience of input.audiences) {
      const old = await tx.retargetingAudience.findUnique({
        where: { id: audience.id },
      });
      if (
        old &&
        (old.config as any).enrollment.url !== audience.enrollment.url &&
        (await tx.retargetingPixelAttempt.count({
          where: { audienceId: audience.id },
        }))
      )
        throw new Error(
          "An audience pixel cannot change after dispatch. Create a new audience ID.",
        );
      await tx.retargetingAudience.upsert({
        where: { id: audience.id },
        create: {
          id: audience.id,
          config: audience,
          revision: hash(JSON.stringify(audience)),
        },
        update: { config: audience, revision: hash(JSON.stringify(audience)) },
      });
    }
    // Omitted audiences are disabled, never deleted along with their tracking history.
    const omitted = await tx.retargetingAudience.findMany({
      where: { id: { notIn: input.audiences.map((a) => a.id) } },
    });
    for (const row of omitted)
      await tx.retargetingAudience.update({
        where: { id: row.id },
        data: {
          config: { ...audienceSchema.parse(row.config), enabled: false },
        },
      });
    const value = {
      enabled: input.enabled,
      controlPercent: input.controlPercent,
    };
    await tx.setting.upsert({
      where: { key: "retargeting" },
      create: { key: "retargeting", value },
      update: { value },
    });
    await tx.auditLog.create({
      data: { actor: "mcp", action: "retargeting.settings", details: input },
    });
  });
  return retargetingConfiguration();
}
export async function saveRetargetingPlan(raw: unknown) {
  const input = planSchema.parse(raw),
    config = await retargetingConfiguration();
  const campaigns = input.stages.flatMap((s) => s.campaignIds);
  if (new Set(campaigns).size !== campaigns.length)
    throw new Error(
      "Map each campaign to exactly one stage for unambiguous reporting",
    );
  if (
    new Set(input.targetingChecks.map((c) => c.campaignId)).size !==
    input.targetingChecks.length
  )
    throw new Error("Supply one targeting readback per campaign");
  for (const stage of input.stages) {
    if (stage.excludeAudienceIds.includes(stage.audienceId))
      throw new Error("An audience cannot be both included and excluded");
    for (const id of [stage.audienceId, ...stage.excludeAudienceIds])
      if (!config.audiences.some((a) => a.id === id))
        throw new Error(`Unknown audience ${id}`);
    if (
      config.audiences.find((a) => a.id === stage.audienceId)?.purpose ===
      "PAID_EXCLUSION"
    )
      throw new Error("Paid audiences are exclusions, not campaign targets");
  }
  await db.$transaction(async (tx) => {
    await configurationLock(tx);
    await tx.setting.upsert({
      where: { key: "retargeting_plan" },
      create: { key: "retargeting_plan", value: input },
      update: { value: input },
    });
    await tx.auditLog.create({
      data: { actor: "mcp", action: "retargeting.plan", details: input },
    });
  });
  return {
    plan: input,
    validation: await validateRetargetingSetup({ ...config, plan: input }),
  };
}
