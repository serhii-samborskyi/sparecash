import { db } from "../db.js";

export const workspaceResetConfirmation =
  "DELETE ALL SPARECASH MARKETING DATA" as const;

export async function resetMarketingWorkspace(
  confirmation: string,
  actor: string,
) {
  if (confirmation !== workspaceResetConfirmation)
    throw new Error(
      `Confirmation must exactly match: ${workspaceResetConfirmation}`,
    );

  const deleted = await db.$transaction(async (tx) => {
    // Delete dependent measurement and delivery records before their parents.
    const deliveries = await tx.delivery.deleteMany();
    const enrollments = await tx.enrollment.deleteMany();
    const chainSteps = await tx.chainStep.deleteMany();
    const chains = await tx.chain.deleteMany();
    const subscriptions = await tx.subscription.deleteMany();
    const advertiserConversions = await tx.advertiserConversion.deleteMany();
    const postbacks = await tx.postback.deleteMany();
    const applications = await tx.applicationClick.deleteMany();
    const leadEvents = await tx.leadEvent.deleteMany();
    const leads = await tx.lead.deleteMany();
    const visitorVerifications = await tx.visitorVerification.deleteMany();
    const visitEvents = await tx.visitEvent.deleteMany();
    const retargetingPixelAttempts =
      await tx.retargetingPixelAttempt.deleteMany();
    const advertisingPrivacyEvents =
      await tx.advertisingPrivacyEvent.deleteMany();
    const landingHits = await tx.landingHit.deleteMany();
    const visits = await tx.visit.deleteMany();
    const visitorJourneys = await tx.visitorJourney.deleteMany();
    const sourceActions = await tx.sourceAction.deleteMany();
    const trafficSources = await tx.trafficSource.deleteMany();
    const retargetingSpend = await tx.retargetingSpend.deleteMany();
    // Audience IDs and exact provider pixels are account infrastructure, not
    // campaign statistics. Keep them across a marketing reset so a later
    // landing cannot silently stop collection. The campaign plan is cleared
    // below because its landing and targeting evidence become stale.
    const retargetingAudiences = await tx.retargetingAudience.count();
    await tx.setting.upsert({
      where: { key: "retargeting_plan" },
      create: {
        key: "retargeting_plan",
        value: { stages: [], targetingChecks: [] },
      },
      update: { value: { stages: [], targetingChecks: [] } },
    });
    const adStatisticsSnapshots = await tx.adStatisticsSnapshot.deleteMany();
    const claritySnapshots = await tx.claritySnapshot.deleteMany();
    const variants = await tx.variant.deleteMany();
    const experiments = await tx.experiment.deleteMany();
    const landingAssetUploads = await tx.landingAssetUpload.deleteMany();
    const landingSources = await tx.landingSource.deleteMany();
    const landingAssets = await tx.landingAsset.deleteMany();
    await tx.auditLog.deleteMany();

    return {
      experiments: experiments.count,
      variants: variants.count,
      visits: visits.count,
      landingHits: landingHits.count,
      visitEvents: visitEvents.count,
      visitorVerifications: visitorVerifications.count,
      visitorJourneys: visitorJourneys.count,
      advertisingPrivacyEvents: advertisingPrivacyEvents.count,
      leads: leads.count,
      leadEvents: leadEvents.count,
      subscriptions: subscriptions.count,
      applications: applications.count,
      postbacks: postbacks.count,
      advertiserConversions: advertiserConversions.count,
      chains: chains.count,
      chainSteps: chainSteps.count,
      enrollments: enrollments.count,
      deliveries: deliveries.count,
      trafficSources: trafficSources.count,
      sourceActions: sourceActions.count,
      preservedRetargetingAudiences: retargetingAudiences,
      retargetingPixelAttempts: retargetingPixelAttempts.count,
      retargetingSpend: retargetingSpend.count,
      adStatisticsSnapshots: adStatisticsSnapshots.count,
      claritySnapshots: claritySnapshots.count,
      landingAssets: landingAssets.count,
      landingAssetUploads: landingAssetUploads.count,
      landingSources: landingSources.count,
    };
  });

  await db.auditLog.create({
    data: {
      actor,
      action: "workspace.marketing_reset",
      details: deleted,
    },
  });

  return {
    ok: true,
    deleted,
    preserved: [
      "settings",
      "integration credentials",
      "owner sessions",
      "retargeting audience pixel configuration",
    ],
  };
}
