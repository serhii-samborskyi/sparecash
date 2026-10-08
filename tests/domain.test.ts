import { describe, it, expect } from "vitest";
import {
  sourceDecision,
  settingsSchema,
  chooseVariant,
  nextLeadStatus,
  canSend,
  withinSendingHours,
  shouldStop,
  normalizePhone,
  landingSchema,
  visibleQuestions,
} from "../server/domain";
describe("traffic decisions", () => {
  const rules = settingsSchema.parse({});
  const old = new Date(Date.now() - 48 * 3600000);
  it("requires a mature sample even when all requests appear suspicious", () => {
    expect(
      sourceDecision({ total: 10, bad: 10, oldest: old }, rules).eligible,
    ).toBe(false);
    expect(
      sourceDecision({ total: 200, bad: 200, oldest: new Date() }, rules)
        .eligible,
    ).toBe(false);
  });
  it("uses the lower confidence bound instead of the observed bot rate", () => {
    expect(
      sourceDecision({ total: 100, bad: 85, oldest: old }, rules).eligible,
    ).toBe(false);
    expect(
      sourceDecision({ total: 200, bad: 195, oldest: old }, rules).eligible,
    ).toBe(true);
  });
  it("does not exclude sources merely for zero conversions", () => {
    expect(
      sourceDecision({ total: 10000, bad: 0, oldest: old }, rules).eligible,
    ).toBe(false);
  });
  it("respects weighted allocation and excludes zero-weight variants", () => {
    const variants = [
      { id: "off", weight: 0 },
      { id: "a", weight: 25 },
      { id: "b", weight: 75 },
    ];
    expect(chooseVariant(variants, 0).id).toBe("a");
    expect(chooseVariant(variants, 0.249).id).toBe("a");
    expect(chooseVariant(variants, 0.25).id).toBe("b");
  });
});
describe("conditional landing quizzes", () => {
  const questions = [
    { id: "timing", label: "When are you looking?", options: ["Now", "Later"] },
    {
      id: "amount",
      label: "How much are you considering?",
      options: ["1000", "2500"],
      showWhen: { questionId: "timing", equals: "Now" },
    },
    {
      id: "budget",
      label: "Have you reviewed your budget?",
      options: ["Yes", "No"],
      showWhen: { questionId: "amount", equals: "2500" },
    },
  ];
  it("only shows questions on the current path, including when stale hidden answers exist", () => {
    expect(
      visibleQuestions(questions, { timing: "Later", amount: "2500" }).map(
        (q) => q.id,
      ),
    ).toEqual(["timing"]);
    expect(
      visibleQuestions(questions, { timing: "Now", amount: "2500" }).map(
        (q) => q.id,
      ),
    ).toEqual(["timing", "amount", "budget"]);
  });
  it("rejects forward references, duplicate IDs and invalid condition answers", () => {
    const parse = (q: unknown[]) =>
      landingSchema.safeParse({
        title: "Explore options",
        description: "Find your next step with optional updates.",
        questions: q,
      });
    expect(parse(questions).success).toBe(true);
    expect(parse([questions[1], questions[0]]).success).toBe(false);
    expect(parse([questions[0], questions[0]]).success).toBe(false);
    expect(
      parse([
        questions[0],
        {
          ...questions[1],
          showWhen: { questionId: "timing", equals: "Unknown" },
        },
      ]).success,
    ).toBe(false);
  });
  it("keeps old landing configurations usable and validates customization", () => {
    const old = {
      title: "Explore options",
      description: "Find your next step with optional updates.",
    };
    expect(landingSchema.parse(old)).toMatchObject({
      layout: "split",
      typography: "sans",
      sections: [],
      showIllustration: true,
    });
    expect(
      landingSchema.safeParse({
        ...old,
        accentColor: "url(javascript:alert(1))",
      }).success,
    ).toBe(false);
  });
});
describe("journey rules", () => {
  it("never downgrades funded or approved outcomes with late postbacks", () => {
    expect(nextLeadStatus("FUNDED", "DECLINED")).toBe("FUNDED");
    expect(nextLeadStatus("APPROVED", "SOLD")).toBe("APPROVED");
    expect(nextLeadStatus("DECLINED", "FUNDED")).toBe("FUNDED");
  });
  it("distinguishes a lead sale from funded money", () => {
    expect(shouldStop("SOLD", "FUNDED")).toBe(false);
    expect(shouldStop("FUNDED", "FUNDED")).toBe(true);
    expect(shouldStop("APPROVED", "SOLD")).toBe(true);
  });
  it("enforces a rolling daily cap", () => {
    const now = new Date("2026-10-07T16:00:00Z");
    expect(canSend(new Date("2026-10-06T17:00:00Z"), now)).toBe(false);
    expect(canSend(new Date("2026-10-06T16:00:00Z"), now)).toBe(true);
  });
  it("uses recipient timezone for the sending window", () => {
    const now = new Date("2026-10-07T16:00:00Z");
    expect(withinSendingHours("America/Chicago", 10, 18, now)).toBe(true);
    expect(withinSendingHours("America/Los_Angeles", 10, 18, now)).toBe(false);
  });
  it("normalizes only US-format telephone numbers", () => {
    expect(normalizePhone("(312) 555-0100")).toBe("+13125550100");
    expect(normalizePhone("+1 312 555 0100")).toBe("+13125550100");
    expect(normalizePhone("+44 20 1234 1234")).toBe(null);
  });
});
