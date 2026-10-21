import { assertLandingImages } from "./landing-designs.js";
import {
  assertCustomLandingSources,
  hydrateCustomLandingConfig,
} from "./custom-landings.js";
import { deduplicateSales } from "./retargeting-report.js";
import { engagementCounts } from "./engagement.js";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import {
  experimentSchema,
  chainSchema,
  settingsSchema,
  landingSchema,
} from "../domain.js";
import { env } from "../config.js";
import { isDeepStrictEqual } from "node:util";
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
    await assertLandingImages(
      data.variants.map(({ config }) => config),
      tx,
    );
    await assertCustomLandingSources(
      data.variants.map(({ config }) => config),
      tx,
    );
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
        offerId: data.offerId ?? null,
      },
      update: {
        name: data.name,
        slug: data.slug,
        status: data.status,
        objective: data.objective,
        offerId: data.offerId ?? null,
      },
    });
    for (const variant of data.variants) {
      if (variant.id && !existing?.variants.some((v) => v.id === variant.id))
        throw new Error("Variant does not belong to this experiment");
      const previous = existing?.variants.find((v) => v.id === variant.id);
      if (
        previous &&
        !variant.preserveConfig &&
        !isDeepStrictEqual(
          landingSchema.parse(previous.config),
          variant.config,
        ) &&
        (await tx.visit.count({ where: { variantId: previous.id } }))
      )
        throw new Error(
          "This variant already has traffic. Create a new variant for design, copy or quiz changes to keep results comparable.",
        );
      await tx.variant.upsert({
        where: { id: variant.id ?? "new" },
        create: {
          experimentId: experiment.id,
          name: variant.name,
          weight: variant.weight,
          offerId: variant.offerId ?? null,
          config: variant.config,
        },
        update: {
          name: variant.name,
          weight: variant.weight,
          offerId: variant.offerId ?? null,
          archivedAt: null,
          config: variant.preserveConfig
            ? (previous!.config as Prisma.InputJsonValue)
            : variant.config,
        },
      });
    }
    // Preserve historical attribution while removing the landing from the
    // editable experiment and future traffic allocation.
    for (const old of existing?.variants ?? [])
      if (!data.variants.some((v) => v.id === old.id))
        await tx.variant.update({
          where: { id: old.id },
          data: { weight: 0, archivedAt: new Date() },
        });
    return tx.experiment.findUniqueOrThrow({
      where: { id: experiment.id },
      include: { variants: { where: { archivedAt: null } } },
    });
  });
  await audit(actor, "experiment.saved", result.id);
  return result;
}

function copiedExperimentSlug(slug: string, attempt: number) {
  const suffix = attempt === 1 ? "-copy" : `-copy-${attempt}`;
  const root = slug.slice(0, 70 - suffix.length).replace(/-+$/, "");
  return `${root || "experiment"}${suffix}`;
}

export async function duplicateExperiment(id: string, actor: string) {
  const result = await db.$transaction(async (tx) => {
    const source = await tx.experiment.findUniqueOrThrow({
      where: { id },
      include: { variants: { where: { archivedAt: null } } },
    });
    let attempt = 1;
    let slug = copiedExperimentSlug(source.slug, attempt);
    while (await tx.experiment.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = copiedExperimentSlug(source.slug, attempt);
    }
    return tx.experiment.create({
      data: {
        name: `${source.name} copy`.slice(0, 100),
        slug,
        status: "DRAFT",
        objective: source.objective,
        offerId: source.offerId,
        variants: {
          create: source.variants.map((variant) => ({
            name: variant.name,
            weight: variant.weight,
            offerId: variant.offerId,
            config: variant.config as Prisma.InputJsonValue,
          })),
        },
      },
      include: { variants: true, _count: { select: { visits: true } } },
    });
  });
  await audit(actor, "experiment.duplicated", result.id, { sourceId: id });
  return result;
}

function landingSourceId(config: Prisma.JsonValue) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const customLanding = config.customLanding;
  if (
    !customLanding ||
    typeof customLanding !== "object" ||
    Array.isArray(customLanding)
  )
    return null;
  return typeof customLanding.sourceId === "string"
    ? customLanding.sourceId
    : null;
}

export async function deleteExperiment(id: string, actor: string) {
  const result = await db.$transaction(async (tx) => {
    const experiment = await tx.experiment.findUniqueOrThrow({
      where: { id },
      include: { variants: true, _count: { select: { visits: true } } },
    });
    const sourceIds = [
      ...new Set(
        experiment.variants
          .map((variant) => landingSourceId(variant.config))
          .filter((sourceId): sourceId is string => Boolean(sourceId)),
      ),
    ];
    const visitIds = (
      await tx.visit.findMany({
        where: { experimentId: id },
        select: { id: true },
      })
    ).map(({ id: visitId }) => visitId);
    const leadRelation = { visit: { experimentId: id } };
    const subscriptionRelation = { lead: leadRelation };

    const deliveries = await tx.delivery.deleteMany({
      where: { subscription: subscriptionRelation },
    });
    const enrollments = await tx.enrollment.deleteMany({
      where: { subscription: subscriptionRelation },
    });
    const subscriptions = await tx.subscription.deleteMany({
      where: subscriptionRelation,
    });
    const postbacks = await tx.postback.deleteMany({
      where: { application: { visit: { experimentId: id } } },
    });
    const advertiserConversions = await tx.advertiserConversion.deleteMany({
      where: { visit: { experimentId: id } },
    });
    const applications = await tx.applicationClick.deleteMany({
      where: { visit: { experimentId: id } },
    });
    const leadEvents = await tx.leadEvent.deleteMany({
      where: { lead: leadRelation },
    });
    const leads = await tx.lead.deleteMany({ where: leadRelation });
    const retargetingPixels = visitIds.length
      ? await tx.retargetingPixelAttempt.deleteMany({
          where: { visitId: { in: visitIds } },
        })
      : { count: 0 };
    const landingHits = await tx.landingHit.deleteMany({
      where: {
        OR: [{ visit: { experimentId: id } }, { slug: experiment.slug }],
      },
    });
    const visitorVerifications = await tx.visitorVerification.deleteMany({
      where: { visit: { experimentId: id } },
    });
    const visitEvents = await tx.visitEvent.deleteMany({
      where: { visit: { experimentId: id } },
    });
    const visits = await tx.visit.deleteMany({ where: { experimentId: id } });
    const variants = await tx.variant.deleteMany({
      where: { experimentId: id },
    });
    await tx.experiment.delete({ where: { id } });

    let landingSources = 0;
    if (sourceIds.length) {
      const remaining = await tx.variant.findMany({ select: { config: true } });
      const referenced = new Set(
        remaining
          .map(({ config }) => landingSourceId(config))
          .filter((sourceId): sourceId is string => Boolean(sourceId)),
      );
      const removable = sourceIds.filter(
        (sourceId) => !referenced.has(sourceId),
      );
      if (removable.length)
        landingSources = (
          await tx.landingSource.deleteMany({
            where: { id: { in: removable } },
          })
        ).count;
    }

    return {
      id: experiment.id,
      name: experiment.name,
      slug: experiment.slug,
      deleted: {
        variants: variants.count,
        landingSources,
        visits: visits.count,
        landingHits: landingHits.count,
        visitEvents: visitEvents.count,
        visitorVerifications: visitorVerifications.count,
        retargetingPixels: retargetingPixels.count,
        leads: leads.count,
        leadEvents: leadEvents.count,
        subscriptions: subscriptions.count,
        enrollments: enrollments.count,
        deliveries: deliveries.count,
        applications: applications.count,
        postbacks: postbacks.count,
        advertiserConversions: advertiserConversions.count,
      },
    };
  });
  await audit(actor, "experiment.deleted", id, result.deleted);
  return { ok: true, ...result };
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
            ).map(
              ({
                delayHours,
                subject,
                body,
                offerId,
                emailTemplateId,
                mediaAssetId,
              }) => ({
                delayHours,
                subject,
                body,
                offerId,
                emailTemplateId,
                mediaAssetId,
              }),
            ),
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
      id: "clarity",
      name: "Microsoft Clarity",
      purpose: "Behavior analytics & aggregate bot evidence",
      connected: !!env.CLARITY_PROJECT_ID,
      dataExport: !!env.CLARITY_EXPORT_TOKEN,
    },
    {
      id: "turnstile",
      name: "Cloudflare Turnstile",
      purpose: "Verify visitors",
      connected: !!env.TURNSTILE_SECRET_KEY && !!env.TURNSTILE_SITE_KEY,
    },
    {
      id: "propeller",
      name: "PropellerAds",
      purpose: "Statistics, source exclusions & conversion feedback",
      connected: !!env.PROPELLER_API_TOKEN,
      conversionFeedback: !!env.PROPELLER_POSTBACK_URL,
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
      purpose: "Transactional confirmation & follow-up email",
      connected: !!env.BREVO_API_KEY && !!env.BREVO_SENDER_EMAIL,
    },
    {
      id: "myemailverifier",
      name: "MyEmailVerifier",
      purpose: "Validate submitted email addresses",
      connected: !!env.MYEMAILVERIFIER_API_KEY,
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
    pendingSubscriptions,
    leads,
    postbacks,
    deliveries,
    sources,
    experiments,
    chains,
    events,
    offers,
    integrations,
    config,
    spend,
  ] = await Promise.all([
    db.visit.count(),
    db.visit.count({ where: { verified: true } }),
    db.subscription.count({ where: { status: "ACTIVE" } }),
    db.subscription.count({ where: { status: "PENDING" } }),
    db.lead.count(),
    db.postback.findMany({
      select: {
        id: true,
        createdAt: true,
        event: true,
        revenue: true,
        applicationId: true,
      },
    }),
    db.delivery.groupBy({ by: ["status"], _count: true }),
    db.trafficSource.count({ where: { state: "BLOCKED" } }),
    db.experiment.findMany({
      where: { status: { not: "PAUSED" } },
      include: {
        variants: {
          where: { archivedAt: null },
          include: { _count: { select: { visits: true } } },
        },
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
    db.offer.findMany({
      where: { status: { not: "PAUSED" } },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    }),
    integrationStatus(),
    settings(),
    db.visit.aggregate({ _sum: { cost: true } }),
  ]);
  return {
    stats: {
      visits,
      verified,
      subscriptions,
      pendingSubscriptions,
      optIns: subscriptions + pendingSubscriptions,
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
      revenue: deduplicateSales(postbacks).commission,
      spend: Number(spend._sum.cost ?? 0),
      blocked: sources,
      deliveries,
    },
    experiments,
    chains,
    events,
    offers,
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
    include: { variants: { where: { archivedAt: null } } },
  });
  const variants = await Promise.all(
    experiment.variants.map(async (v) => {
      const [visits, subscriptionRows, postbacks] = await Promise.all([
        db.visit.findMany({
          where: { variantId: v.id },
          select: {
            id: true,
            verified: true,
            cost: true,
            engagementEvents: { select: { kind: true } },
          },
        }),
        db.subscription.findMany({
          where: {
            status: { in: ["PENDING", "ACTIVE"] },
            lead: { visit: { variantId: v.id } },
          },
          select: { status: true },
        }),
        db.postback.findMany({
          where: { application: { visit: { variantId: v.id } } },
        }),
      ]);
      const converted = (type: string) =>
        new Set(
          postbacks.filter((p) => p.event === type).map((p) => p.applicationId),
        ).size;
      const revenue = deduplicateSales(postbacks).commission,
        spend = visits.reduce((s, v) => s + Number(v.cost), 0),
        subscriptions = subscriptionRows.filter(
          (subscription) => subscription.status === "ACTIVE",
        ).length,
        pendingOptIns = subscriptionRows.filter(
          (subscription) => subscription.status === "PENDING",
        ).length;
      const value =
        experiment.objective === "SUBSCRIPTIONS"
          ? subscriptions
          : experiment.objective === "REVENUE"
            ? revenue
            : converted(experiment.objective);
      return {
        ...v,
        config: await hydrateCustomLandingConfig(landingSchema.parse(v.config)),
        visits: visits.length,
        verified: visits.filter((v) => v.verified).length,
        subscriptions,
        pendingOptIns,
        optIns: subscriptions + pendingOptIns,
        engagement: engagementCounts(visits),
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
