import { Prisma } from "@prisma/client";
import { db } from "../db.js";

export async function recordMessageEvent(input: {
  deliveryId: string;
  type: string;
  providerEventId: string;
  occurredAt?: Date;
  url?: string;
  detail?: Record<string, unknown>;
}) {
  const occurredAt = input.occurredAt ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const event = await tx.messageEvent.create({
        data: {
          deliveryId: input.deliveryId,
          type: input.type,
          providerEventId: input.providerEventId,
          occurredAt,
          url: input.url,
          detail: (input.detail ?? {}) as Prisma.InputJsonValue,
        },
      });
      const data: Prisma.DeliveryUpdateInput = {};
      if (input.type === "DELIVERED") data.deliveredAt = occurredAt;
      if (["OPENED", "PROXY_OPENED"].includes(input.type)) {
        data.openedAt = occurredAt;
        data.openCount = { increment: 1 };
      }
      if (input.type === "PROVIDER_CLICKED")
        data.providerClickCount = { increment: 1 };
      if (input.type === "READ") data.readAt = occurredAt;
      if (input.type === "REPLIED") data.repliedAt = occurredAt;
      if (Object.keys(data).length)
        await tx.delivery.update({ where: { id: input.deliveryId }, data });
      return event;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return null;
    throw error;
  }
}
