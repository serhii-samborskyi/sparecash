import { db } from "../db.js";

export async function deleteLead(id: string, actor: string) {
  return db.$transaction(async (tx) => {
    await tx.lead.findUniqueOrThrow({ where: { id }, select: { id: true } });

    const deliveries = await tx.delivery.deleteMany({
      where: { subscription: { leadId: id } },
    });
    const enrollments = await tx.enrollment.deleteMany({
      where: { subscription: { leadId: id } },
    });
    const subscriptions = await tx.subscription.deleteMany({
      where: { leadId: id },
    });
    const events = await tx.leadEvent.deleteMany({ where: { leadId: id } });

    // Keep anonymous application, conversion and visit measurement intact.
    // Removing a contact should erase its CRM data without rewriting paid
    // traffic history or allowing an advertiser conversion to be sent twice.
    const applicationsDetached = await tx.applicationClick.updateMany({
      where: { leadId: id },
      data: { leadId: null },
    });
    await tx.lead.delete({ where: { id } });

    const deleted = {
      subscriptions: subscriptions.count,
      enrollments: enrollments.count,
      deliveries: deliveries.count,
      events: events.count,
      applicationsDetached: applicationsDetached.count,
    };
    await tx.auditLog.create({
      data: {
        actor,
        action: "lead.deleted",
        entityId: id,
        details: deleted,
      },
    });

    return { ok: true, deleted };
  });
}
