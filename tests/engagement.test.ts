import { describe, it, expect, vi, afterEach } from "vitest";
import {
  engagementEvents,
  engagementCounts,
} from "../server/services/engagement";
import { createEngagementTracker } from "../client/engagement";
import { landingSchema, renderMessage } from "../server/domain";

const config = landingSchema.parse({
  title: "A test quiz",
  description: "A conditional quiz for engagement tests.",
  questions: [
    {
      id: "purpose",
      label: "What brings you here?",
      options: ["Repair", "Other"],
    },
    {
      id: "repair",
      label: "Which repair?",
      options: ["Car", "Home"],
      showWhen: { questionId: "purpose", equals: "Repair" },
    },
  ],
});
afterEach(() => vi.unstubAllGlobals());

describe("anonymous engagement", () => {
  it("counts only a complete visible quiz path as completed", () => {
    expect(
      engagementEvents(config, {
        kind: "QUESTION_ANSWERED",
        questionId: "purpose",
        answers: { purpose: "Repair" },
      }).map((e) => e.kind),
    ).toEqual(["QUESTION_ANSWERED"]);
    expect(
      engagementEvents(config, {
        kind: "QUESTION_ANSWERED",
        questionId: "purpose",
        answers: { purpose: "Other" },
      }).map((e) => e.kind),
    ).toEqual(["QUESTION_ANSWERED", "QUIZ_COMPLETED"]);
  });
  it("rejects hidden questions, missing predecessors, arbitrary answers and extra data", () => {
    for (const event of [
      {
        kind: "QUESTION_ANSWERED",
        questionId: "repair",
        answers: { purpose: "Other", repair: "Car" },
      },
      {
        kind: "QUESTION_ANSWERED",
        questionId: "repair",
        answers: { repair: "Car" },
      },
      {
        kind: "QUESTION_ANSWERED",
        questionId: "purpose",
        answers: { purpose: "private free text" },
      },
      {
        kind: "QUESTION_ANSWERED",
        questionId: "purpose",
        answers: { purpose: "Other" },
        email: "private@example.test",
      },
      { kind: "SOLD" },
    ])
      expect(() => engagementEvents(config, event)).toThrow();
  });
  it("counts visitor sessions rather than clicks or answers", () => {
    const summary = engagementCounts([
      {
        engagementEvents: [
          { kind: "QUESTION_ANSWERED" },
          { kind: "QUESTION_ANSWERED" },
          { kind: "QUIZ_COMPLETED" },
        ],
      },
      { engagementEvents: [{ kind: "CONTINUE_WITHOUT_UPDATES" }] },
      { engagementEvents: [] },
    ]);
    expect(summary).toMatchObject({
      engagedVisitors: 2,
      quizStartedVisitors: 1,
      quizCompletedVisitors: 1,
      continuedWithoutUpdatesVisitors: 1,
    });
  });
  it("does not send preview or unauthenticated events", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const track = createEngagementTracker();
    track("preview-token", true, { kind: "UPDATES_OPENED" });
    track(undefined, false, { kind: "UPDATES_OPENED" });
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("dispatches every event immediately even when an earlier request stalls", async () => {
    let fail!: (reason: Error) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetch);
    const track = createEngagementTracker();
    track("visit", false, {
      kind: "QUESTION_ANSWERED",
      questionId: "purpose",
      answers: { purpose: "Repair" },
    });
    track("visit", false, {
      kind: "QUESTION_ANSWERED",
      questionId: "purpose",
      answers: { purpose: "Other" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    fail(new Error("Network unavailable"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body).event.answers.purpose).toBe(
      "Other",
    );
    expect(fetch.mock.calls[1][1].keepalive).toBe(true);
  });
  it("uses a natural greeting when the optional name is empty", () => {
    expect(
      renderMessage("Hi {{name}}, {{link}}", "", "https://example.test"),
    ).toBe("Hi there, https://example.test");
  });
});
