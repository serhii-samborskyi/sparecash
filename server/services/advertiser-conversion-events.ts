import type { Prisma } from "@prisma/client";

type Transaction = Prisma.TransactionClient;

export function validAdvertiserClickId(value: string | null | undefined) {
  if (!value || value.length < 6 || value.length > 200) return false;
  if (/[{}$\s]/.test(value)) return false;
  return /^[A-Za-z0-9._:-]+$/.test(value);
}

export async function queueAdvertiserConversion(
  tx: Transaction,
  input: {
    visit: {
      id: string;
      sourceId: string | null;
      externalClickId: string | null;
    };
    event: "SOLD" | "APPLICATION" | "QUIZ_COMPLETED";
    goal: 1 | 2 | 3;
    applicationId?: string;
    payout?: Prisma.Decimal;
  },
) {
  const clickId = input.visit.externalClickId;
  if (!input.visit.sourceId || !validAdvertiserClickId(clickId)) return false;
  await tx.advertiserConversion.upsert({
    where: {
      externalClickId_goal: {
        externalClickId: clickId!,
        goal: input.goal,
      },
    },
    create: {
      visitId: input.visit.id,
      applicationId: input.applicationId,
      event: input.event,
      goal: input.goal,
      externalClickId: clickId!,
      payout: input.payout,
    },
    update: {},
  });
  return true;
}
