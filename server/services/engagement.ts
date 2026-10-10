import { z } from "zod";
import { db } from "../db.js";
import { landingSchema, visibleQuestions } from "../domain.js";

export const engagementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UPDATES_OPENED") }).strict(),
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

type Event = { kind: string; questionId: string; answer?: string };

// Accept only the visible, answered prefix of the visit's immutable quiz.
// No arbitrary event properties, contact details, or free-text answers.
export function engagementEvents(
  configInput: unknown,
  input: unknown,
): Event[] {
  const event = engagementSchema.parse(input);
  if (event.kind === "UPDATES_OPENED")
    return [{ kind: event.kind, questionId: "" }];
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
  await db.visitEvent.createMany({
    data: events.map((event) => ({ visitId, ...event })),
    skipDuplicates: true,
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
    updatesOpenedVisitors: has("UPDATES_OPENED"),
    continuedWithoutUpdatesVisitors: has("CONTINUE_WITHOUT_UPDATES"),
  };
}
