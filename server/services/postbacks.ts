import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { nextLeadStatus, shouldStop } from "../domain.js";
import { settings } from "./control.js";
import { transitionLead } from "./journeys.js";

export class PostbackConflictError extends Error {}

export async function recordPostback(input: {
  eventId: string;
  applicationId: string;
  event: "SOLD" | "APPROVED" | "FUNDED" | "DECLINED";
  revenue: string | number;
}) {
  const revenue = new Prisma.Decimal(input.revenue);
  const config = await settings();
  try {
    const application = await db.$transaction(async (tx) => {
      const app = await tx.applicationClick.findUniqueOrThrow({
        where: { id: input.applicationId },
      });
      await tx.postback.create({ data: { ...input, revenue } });
      if (app.leadId) {
        await tx.$queryRaw`SELECT id FROM "Lead" WHERE id=${app.leadId} FOR UPDATE`;
        const lead = await tx.lead.findUniqueOrThrow({
          where: { id: app.leadId },
        });
        const status = nextLeadStatus(
          lead.status,
          input.event,
        ) as typeof lead.status;
        await tx.lead.update({ where: { id: lead.id }, data: { status } });
        await tx.leadEvent.create({
          data: {
            leadId: lead.id,
            type: input.event,
            detail: `RoundSky ${input.event.toLowerCase()} event received`,
          },
        });
        if (shouldStop(status, config.stopOn)) {
          await tx.enrollment.updateMany({
            where: { subscription: { leadId: lead.id }, status: "ACTIVE" },
            data: { status: "STOPPED" },
          });
          await tx.delivery.updateMany({
            where: { subscription: { leadId: lead.id }, status: "PENDING" },
            data: { status: "CANCELLED" },
          });
        }
      }
      return app;
    });
    if (application.leadId && input.event === "DECLINED") {
      await transitionLead(
        application.leadId,
        "DECLINED",
        "RoundSky reported a decline",
      );
    }
    return { ok: true, duplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.postback.findUnique({
        where: { eventId: input.eventId },
      });
      if (
        existing &&
        existing.applicationId === input.applicationId &&
        existing.event === input.event &&
        existing.revenue.equals(revenue)
      ) {
        return { ok: true, duplicate: true };
      }
      throw new PostbackConflictError(
        "This transaction was already recorded with a different application or price",
      );
    }
    throw error;
  }
}
