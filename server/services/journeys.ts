import type { Channel, LeadStatus } from "@prisma/client";
import { db } from "../db.js";
import { nextLeadStatus, shouldStop } from "../domain.js";
import { settings } from "./control.js";
export async function enroll(subscriptionId: string, trigger: string) {
  return db.$transaction(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { lead: true },
    });
    if (
      sub.status !== "ACTIVE" ||
      shouldStop(sub.lead.status, (await settings()).stopOn)
    )
      return null;
    const chain = await tx.chain.findFirst({
      where: { channel: sub.channel, trigger, status: "ACTIVE" },
      include: { steps: { orderBy: { position: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });
    if (!chain || !chain.steps.length) return null;
    const existing = await tx.enrollment.findUnique({
      where: { subscriptionId_chainId: { subscriptionId, chainId: chain.id } },
    });
    if (existing) return existing;
    await tx.enrollment.updateMany({
      where: { subscriptionId, status: "ACTIVE" },
      data: { status: "STOPPED" },
    });
    await tx.delivery.updateMany({
      where: { subscriptionId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    return tx.enrollment.create({
      data: {
        subscriptionId,
        chainId: chain.id,
        nextAt: new Date(Date.now() + chain.steps[0].delayHours * 3600000),
      },
    });
  });
}
export async function activateSubscription(id: string) {
  const sub = await db.subscription.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "ACTIVE", confirmedAt: new Date(), verificationHash: null },
  });
  if (sub.count) {
    const record = await db.subscription.findUniqueOrThrow({ where: { id } });
    await db.leadEvent.create({
      data: {
        leadId: record.leadId,
        type: "SUBSCRIBED",
        detail: `${record.channel} subscription confirmed`,
      },
    });
    await enroll(id, "SUBSCRIBED");
  }
}
export async function unsubscribe(id: string, reason = "Visitor opted out") {
  const sub = await db.subscription.findUniqueOrThrow({ where: { id } });
  await db.$transaction([
    db.subscription.update({
      where: { id },
      data: {
        status: "UNSUBSCRIBED",
        stoppedAt: new Date(),
        verificationHash: null,
      },
    }),
    db.enrollment.updateMany({
      where: { subscriptionId: id, status: "ACTIVE" },
      data: { status: "STOPPED" },
    }),
    db.delivery.updateMany({
      where: { subscriptionId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    }),
    db.leadEvent.create({
      data: { leadId: sub.leadId, type: "UNSUBSCRIBED", detail: reason },
    }),
  ]);
}
export async function transitionLead(
  leadId: string,
  event: string,
  detail: string,
) {
  const config = await settings();
  const lead = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Lead" WHERE id=${leadId} FOR UPDATE`;
    const current = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        status: nextLeadStatus(current.status, event) as LeadStatus,
        ...(event === "ENGAGED" ? { lastClickedAt: new Date() } : {}),
      },
    });
    await tx.leadEvent.create({ data: { leadId, type: event, detail } });
    if (shouldStop(updated.status, config.stopOn)) {
      await tx.enrollment.updateMany({
        where: { subscription: { leadId }, status: "ACTIVE" },
        data: { status: "STOPPED" },
      });
      await tx.delivery.updateMany({
        where: { subscription: { leadId }, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    }
    return updated;
  });
  if (
    !shouldStop(lead.status, config.stopOn) &&
    ["ENGAGED", "DECLINED"].includes(event)
  ) {
    const subs = await db.subscription.findMany({
      where: { leadId, status: "ACTIVE" },
    });
    for (const sub of subs)
      await enroll(sub.id, event === "ENGAGED" ? "CLICKED" : "DECLINED");
  }
  return lead;
}
export async function enrollExisting(channel: Channel, trigger: string) {
  const subs = await db.subscription.findMany({
    where: { channel, status: "ACTIVE" },
    take: 1000,
  });
  let count = 0;
  for (const sub of subs) if (await enroll(sub.id, trigger)) count++;
  return { count };
}
