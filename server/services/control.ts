import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { experimentSchema, chainSchema, settingsSchema } from "../domain.js";
import { env } from "../config.js";
export const audit = (
  actor: string,
  action: string,
  entityId?: string,
  details?: object,
) =>
  db.auditLog.create({
    data: {
      actor,
      action,
      entityId,
      details: details as Prisma.InputJsonValue | undefined,
    },
  });
export async function settings() {
  return settingsSchema.parse(
    (await db.setting.findUnique({ where: { key: "general" } }))?.value ?? {},
  );
}
export async function saveSettings(
  input: unknown,
  actor: string,
  partial = false,
) {
  const patch = partial
    ? settingsSchema.innerType().partial().strict().parse(input)
    : settingsSchema.parse(input);
  const value = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1629071202)`;
    const previous = settingsSchema.parse(
      (await tx.setting.findUnique({ where: { key: "general" } }))?.value ?? {},
    );
    const value = settingsSchema.parse(
      partial ? { ...previous, ...patch } : patch,
    );
    await tx.setting.upsert({
      where: { key: "general" },
      create: { key: "general", value },
      update: { value },
    });
    if (
      previous.workspaceTimezone !== value.workspaceTimezone ||
      previous.followupTimezoneMode !== value.followupTimezoneMode ||
      previous.sendHourStart !== value.sendHourStart ||
      previous.sendHourEnd !== value.sendHourEnd
    ) {
      await tx.enrollment.updateMany({
        where: { status: "ACTIVE" },
        data: { deferredUntil: null },
      });
    }
    return value;
  });
  await audit(actor, "settings.updated");
  return value;
}
export async function saveExperiment(input: unknown, actor: string) {
  const data = experimentSchema.parse(input);
  const result = await db.$transaction(async (tx) => {
    const existing = data.id
      ? await tx.experiment.findUniqueOrThrow({
          where: { id: data.id },
          include: { variants: true },
        })
      : null;
    const experiment = await tx.experiment.upsert({
      where: { id: data.id ?? "new" },
      create: {
        name: data.name,
        slug: data.slug,
        status: data.status,
        objective: data.objective,
      },
      update: {
        name: data.name,
        slug: data.slug,
        status: data.status,
        objective: data.objective,
      },
    });
    for (const variant of data.variants) {
      if (variant.id && !existing?.variants.some((v) => v.id === variant.id))
        throw new Error("Variant does not belong to this experiment");
      await tx.variant.upsert({
        where: { id: variant.id ?? "new" },
        create: {
          experimentId: experiment.id,
          name: variant.name,
          weight: variant.weight,
          config: variant.config,
        },
        update: {
          name: variant.name,
          weight: variant.weight,
          config: variant.config,
        },
      });
    }
    // Preserve historical attribution when a variant is removed from traffic.
    for (const old of existing?.variants ?? [])
      if (!data.variants.some((v) => v.id === old.id))
        await tx.variant.update({ where: { id: old.id }, data: { weight: 0 } });
    return tx.experiment.findUniqueOrThrow({
      where: { id: experiment.id },
      include: { variants: true },
    });
  });
  await audit(actor, "experiment.saved", result.id);
  return result;
}
export async function saveChain(input: unknown, actor: string) {
  const data = chainSchema.parse(input);
  const { steps, id, ...fields } = data;
  const result = await db.$transaction(async (tx) => {
    if (id) {
      const old = await tx.chain.findUniqueOrThrow({ where: { id } });
      const count = await tx.enrollment.count({ where: { chainId: id } });
      if (
        count &&
        (old.channel !== data.channel ||
          JSON.stringify(
            (
              await tx.chainStep.findMany({
                where: { chainId: id },
                orderBy: { position: "asc" },
              })
            ).map(({ delayHours, subject, body }) => ({
              delayHours,
              subject,
              body,
            })),
          ) !== JSON.stringify(steps))
      )
        throw new Error(
          "This chain has enrolled subscribers. Duplicate it to change its channel or messages.",
        );
    }
    if (data.status === "ACTIVE")
      await tx.chain.updateMany({
        where: {
          channel: data.channel,
          trigger: data.trigger,
          status: "ACTIVE",
          ...(id ? { id: { not: id } } : {}),
        },
        data: { status: "PAUSED" },
      });
    const chain = await tx.chain.upsert({
      where: { id: id ?? "new" },
      create: fields,
      update: fields,
    });
    await tx.chainStep.deleteMany({ where: { chainId: chain.id } });
    await tx.chainStep.createMany({
      data: steps.map((s, position) => ({ ...s, position, chainId: chain.id })),
    });
    return tx.chain.findUniqueOrThrow({
      where: { id: chain.id },
      include: { steps: { orderBy: { position: "asc" } } },
    });
  });
  await audit(actor, "chain.saved", result.id);
  return result;
}
export async function integrationStatus() {
  return [
    {
      id: "turnstile",
      name: "Cloudflare Turnstile",
      purpose: "Verify visitors",
      connected: !!env.TURNSTILE_SECRET_KEY && !!env.TURNSTILE_SITE_KEY,
    },
    {
      id: "propeller",
      name: "PropellerAds",
      purpose: "Source exclusions",
      connected: !!env.PROPELLER_API_TOKEN,
    },
    {
      id: "roundsky",
      name: "RoundSky",
      purpose: "Offers & postbacks",
      connected: !!(await settings()).roundskyUrl,
    },
    {
      id: "onesignal",
      name: "OneSignal",
      purpose: "Browser push",
      connected: !!env.ONESIGNAL_APP_ID && !!env.ONESIGNAL_API_KEY,
    },
    {
      id: "brevo",
      name: "Brevo",
      purpose: "Email campaigns",
      connected:
        !!env.BREVO_API_KEY &&
        !!env.BREVO_SENDER_EMAIL &&
        !!env.BREVO_FOLDER_ID,
    },
    {
      id: "bluebubbles",
      name: "BlueBubbles",
      purpose: "Text messages",
      connected: !!env.BLUEBUBBLES_URL && !!env.BLUEBUBBLES_PASSWORD,
    },
  ];
}
export async function dashboard() {
  const [
    visits,
    verified,
    subscriptions,
    leads,
    postbacks,
    deliveries,
    sources,
    experiments,
    chains,
    events,
    integrations,
    config,
    spend,
  ] = await Promise.all([
    db.visit.count(),
    db.visit.count({ where: { verified: true } }),
    db.subscription.count({ where: { status: "ACTIVE" } }),
    db.lead.count(),
    db.postback.findMany({
      select: { event: true, revenue: true, applicationId: true },
    }),
    db.delivery.groupBy({ by: ["status"], _count: true }),
    db.trafficSource.count({ where: { state: "BLOCKED" } }),
    db.experiment.findMany({
      include: {
        variants: { include: { _count: { select: { visits: true } } } },
        _count: { select: { visits: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.chain.findMany({
      include: {
        steps: { orderBy: { position: "asc" } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.auditLog.findMany({ take: 8, orderBy: { createdAt: "desc" } }),
    integrationStatus(),
    settings(),
    db.visit.aggregate({ _sum: { cost: true } }),
  ]);
  return {
    stats: {
      visits,
      verified,
      subscriptions,
      leads,
      sold: new Set(
        postbacks.filter((p) => p.event === "SOLD").map((p) => p.applicationId),
      ).size,
      approved: new Set(
        postbacks
          .filter((p) => p.event === "APPROVED")
          .map((p) => p.applicationId),
      ).size,
      funded: new Set(
        postbacks
          .filter((p) => p.event === "FUNDED")
          .map((p) => p.applicationId),
      ).size,
      revenue: postbacks.reduce((s, p) => s + Number(p.revenue), 0),
      spend: Number(spend._sum.cost ?? 0),
      blocked: sources,
      deliveries,
    },
    experiments,
    chains,
    events,
    integrations,
    settings: config,
    liveDelivery: env.LIVE_DELIVERY === "true",
    liveSourceBlocking: env.LIVE_SOURCE_BLOCKING === "true",
    appUrl: env.APP_URL,
    ipTimezoneConfigured: Boolean(env.CLOUDFLARE_GEO_TOKEN),
  };
}
export async function experimentResults(id: string) {
  const experiment = await db.experiment.findUniqueOrThrow({
    where: { id },
    include: { variants: true },
  });
  const variants = await Promise.all(
    experiment.variants.map(async (v) => {
      const [visits, subs, postbacks] = await Promise.all([
        db.visit.findMany({
          where: { variantId: v.id },
          select: { id: true, verified: true, cost: true },
        }),
        db.subscription.count({
          where: { status: "ACTIVE", lead: { visit: { variantId: v.id } } },
        }),
        db.postback.findMany({
          where: { application: { visit: { variantId: v.id } } },
        }),
      ]);
      const converted = (type: string) =>
        new Set(
          postbacks.filter((p) => p.event === type).map((p) => p.applicationId),
        ).size;
      const revenue = postbacks.reduce((s, p) => s + Number(p.revenue), 0),
        spend = visits.reduce((s, v) => s + Number(v.cost), 0);
      const value =
        experiment.objective === "SUBSCRIPTIONS"
          ? subs
          : experiment.objective === "REVENUE"
            ? revenue
            : converted(experiment.objective);
      return {
        ...v,
        visits: visits.length,
        verified: visits.filter((v) => v.verified).length,
        subscriptions: subs,
        sold: converted("SOLD"),
        approved: converted("APPROVED"),
        funded: converted("FUNDED"),
        revenue,
        spend,
        score: visits.length ? value / visits.length : 0,
      };
    }),
  );
  return { ...experiment, variants };
}
