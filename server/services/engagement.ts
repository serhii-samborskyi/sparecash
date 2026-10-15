import { z } from "zod";
import { db } from "../db.js";
import { landingSchema, visibleQuestions } from "../domain.js";
import { hasVisitorProof } from "./visitor-verification.js";
import { queueAdvertiserConversion } from "./advertiser-conversion-events.js";

export const engagementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UPDATES_OPENED") }).strict(),
  z.object({ kind: z.literal("SEARCH_STARTED") }).strict(),
  z.object({ kind: z.literal("SEARCH_COMPLETED") }).strict(),
  z
    .object({
      kind: z.literal("CHANNEL_SELECTED"),
      channel: z.enum(["PUSH", "SMS", "EMAIL"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("QUESTION_ANSWERED"),
      questionId: z.string().min(1).max(40),
      answers: z
        .record(z.string().max(40), z.string().max(100))
        .refine((value) => Object.keys(value).length <= 8, "Too many answers"),
    })
    .strict(),
]);

export const preQuizActivitySchema = z
  .object({
    activeMs: z.number().int().min(0).max(86_400_000),
    clicks: z.number().int().min(0).max(10_000),
    scrolls: z.number().int().min(0).max(10_000),
    complete: z.boolean().default(false),
  })
  .strict();

type Event = { kind: string; questionId: string; answer?: string };

// Accept only the visible, answered prefix of the visit's immutable quiz.
// No arbitrary event properties, contact details, or free-text answers.
export function engagementEvents(
  configInput: unknown,
  input: unknown,
): Event[] {
  const event = engagementSchema.parse(input);
  if (
    event.kind === "UPDATES_OPENED" ||
    event.kind === "SEARCH_STARTED" ||
    event.kind === "SEARCH_COMPLETED"
  )
    return [{ kind: event.kind, questionId: "" }];
  if (event.kind === "CHANNEL_SELECTED")
    return [
      {
        kind: event.kind,
        questionId: "",
        answer: event.channel,
      },
    ];
  const config = landingSchema.parse(configInput);
  const questions = visibleQuestions(config.questions, event.answers);
  const index = questions.findIndex((q) => q.id === event.questionId);
  const prefix = questions.slice(0, index + 1);
  if (
    index < 0 ||
    Object.keys(event.answers).length !== prefix.length ||
    prefix.some((q) => !q.options.includes(event.answers[q.id]))
  ) {
    throw new Error(
      "Answer the visible questions in order using their listed options.",
    );
  }
  const events: Event[] = prefix.map((q) => ({
    kind: "QUESTION_ANSWERED",
    questionId: q.id,
    answer: event.answers[q.id],
  }));
  if (index === questions.length - 1)
    events.push({ kind: "QUIZ_COMPLETED", questionId: "" });
  return events;
}

export async function recordEngagement(visitId: string, input: unknown) {
  const visit = await db.visit.findUniqueOrThrow({
    where: { id: visitId },
    include: { variant: true },
  });
  const config = Object.keys(visit.configSnapshot as object).length
    ? visit.configSnapshot
    : visit.variant.config;
  const events = engagementEvents(config, input);
  // Keep the first recorded event, even if clicks arrive out of order.
  // These records measure engagement, not the final submitted quiz response.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id=${visitId} FOR UPDATE`;
    const latest = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
    const verifiedAt = hasVisitorProof(latest) ? new Date() : null;
    await tx.visitEvent.createMany({
      data: events.map((event) => ({ visitId, ...event, verifiedAt })),
      skipDuplicates: true,
    });
    if (verifiedAt)
      await tx.visitEvent.updateMany({
        where: {
          visitId,
          verifiedAt: null,
          OR: events.map((e) => ({ kind: e.kind, questionId: e.questionId })),
        },
        data: { verifiedAt },
      });
    if (verifiedAt && events.some((event) => event.kind === "QUIZ_COMPLETED"))
      await queueAdvertiserConversion(tx, {
        visit: latest,
        event: "QUIZ_COMPLETED",
        goal: 3,
      });
  });
}

// The browser sends cumulative counters so retries and out-of-order requests are
// idempotent. A final snapshot may arrive just after the first quiz answer; the
// row lock lets that one snapshot complete the pre-quiz measurement without
// accepting later inflation.
export async function recordPreQuizActivity(visitId: string, input: unknown) {
  const activity = preQuizActivitySchema.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id=${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
    if (visit.preQuizEndedAt) return false;
    const quizStarted = await tx.visitEvent.findFirst({
      where: { visitId, kind: "QUESTION_ANSWERED" },
      select: { id: true },
    });
    if (quizStarted && !activity.complete) return false;
    await tx.visit.update({
      where: { id: visitId },
      data: {
        preQuizMeasuredAt: visit.preQuizMeasuredAt ?? new Date(),
        preQuizEndedAt: activity.complete ? new Date() : null,
        preQuizActiveMs: Math.max(visit.preQuizActiveMs, activity.activeMs),
        preQuizClicks: Math.max(visit.preQuizClicks, activity.clicks),
        preQuizScrolls: Math.max(visit.preQuizScrolls, activity.scrolls),
      },
    });
    return true;
  });
}

export async function recordContinueWithoutUpdates(visitId: string) {
  await db.visitEvent.createMany({
    data: [{ visitId, kind: "CONTINUE_WITHOUT_UPDATES" }],
    skipDuplicates: true,
  });
}

export function engagementCounts(
  visits: { engagementEvents: { kind: string }[] }[],
) {
  const has = (kind: string) =>
    visits.filter((v) => v.engagementEvents.some((e) => e.kind === kind))
      .length;
  return {
    engagedVisitors: visits.filter((v) => v.engagementEvents.length > 0).length,
    quizStartedVisitors: has("QUESTION_ANSWERED"),
    quizCompletedVisitors: has("QUIZ_COMPLETED"),
    searchStartedVisitors: has("SEARCH_STARTED"),
    searchCompletedVisitors: has("SEARCH_COMPLETED"),
    channelSelectedVisitors: has("CHANNEL_SELECTED"),
    updatesOpenedVisitors: has("UPDATES_OPENED"),
    continuedWithoutUpdatesVisitors: has("CONTINUE_WITHOUT_UPDATES"),
  };
}
