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
  experimentSchema,
  validateCustomFormAnswers,
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
describe("custom landing form contracts", () => {
  const form = landingSchema.parse({
    title: "Fast loan request",
    description: "Choose an amount and term, then enter a mobile number.",
    customLanding: { sourceId: "cmabcdefghijklmnopqrstuv" },
    customForm: {
      fields: [
        {
          id: "amount",
          valueType: "integer",
          min: 500,
          max: 50000,
          step: 500,
          defaultValue: 10000,
        },
      ],
      contacts: { name: "optional", phone: "required", email: "optional" },
    },
  }).customForm!;

  it("keeps field validation independent from presentation", () => {
    expect(validateCustomFormAnswers(form, { amount: "50000" })).toEqual({
      amount: "50000",
    });
    expect(() =>
      validateCustomFormAnswers(form, { amount: "50500" }),
    ).toThrow();
    expect(() =>
      validateCustomFormAnswers(form, { amount: "10000", extra: "x" }),
    ).toThrow();
  });

  it("validates match estimates and bounded provider-search presentation", () => {
    const parsed = landingSchema.parse({
      title: "Fast loan request",
      description: "Choose an amount and score, then enter an email address.",
      customLanding: { sourceId: "cmabcdefghijklmnopqrstuv" },
      customForm: {
        fields: [
          {
            id: "amount",
            valueType: "integer",
            min: 500,
            max: 50000,
          },
          {
            id: "credit_score",
            valueType: "integer",
            min: 300,
            max: 850,
          },
        ],
        contacts: { email: "required" },
        matchEstimate: {
          amountFieldId: "amount",
          scoreFieldId: "credit_score",
        },
        providerSearch: {
          minDurationMs: 5000,
          maxDurationMs: 10000,
          minProviderCount: 104,
          maxProviderCount: 135,
        },
      },
    });
    expect(parsed.customForm?.providerSearch).toEqual({
      minDurationMs: 5000,
      maxDurationMs: 10000,
      minProviderCount: 104,
      maxProviderCount: 135,
    });
    expect(
      landingSchema.safeParse({
        ...parsed,
        customForm: {
          ...parsed.customForm,
          providerSearch: {
            minDurationMs: 10000,
            maxDurationMs: 5000,
            minProviderCount: 135,
            maxProviderCount: 104,
          },
        },
      }).success,
    ).toBe(false);
  });
});
describe("phone marketing consent defaults", () => {
  it("uses the reusable calls and messaging disclosure", () => {
    const config = landingSchema.parse({
      title: "Phone consent",
      description: "Request updates about personal-loan options by phone.",
    });
    expect(config.phoneConsentVersion).toBe("v3-phone-marketing-2026-10-20");
    expect(config.phoneConsent).toContain("SMS, iMessage and RCS");
    expect(config.phoneConsent).toContain("AI-generated voices");
    expect(config.phoneConsent).toContain("Reply STOP");
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
      funnelMode: "guided",
    });
    expect(
      landingSchema.safeParse({
        ...old,
        accentColor: "url(javascript:alert(1))",
      }).success,
    ).toBe(false);
  });
  it("supports a compact request card and recorded activity notice", () => {
    const parsed = landingSchema.parse({
      title: "W-2 personal loan finder",
      description: "Choose two details and check your next step.",
      funnelMode: "instant",
      activityNotice: { enabled: true },
    });
    expect(parsed.funnelMode).toBe("instant");
    expect(parsed.activityNotice).toEqual({ enabled: true });
  });
  it("accepts a bounded post-quiz preparation stage", () => {
    const base = {
      title: "Explore options",
      description: "Find your next step with optional updates.",
    };
    expect(
      landingSchema.parse({
        ...base,
        searchTransition: {
          durationMs: 7000,
          steps: ["Reviewing your answers", "Your next step is ready"],
        },
      }).searchTransition,
    ).toEqual({
      durationMs: 7000,
      steps: ["Reviewing your answers", "Your next step is ready"],
    });
    expect(
      landingSchema.safeParse({
        ...base,
        searchTransition: {
          durationMs: 3000,
          steps: ["Reviewing your answers", "Your next step is ready"],
        },
      }).success,
    ).toBe(false);
  });
  it("accepts a plain-text city fallback and rejects markup", () => {
    const base = {
      title: "Explore options in {{city}}",
      description: "Find your next step with optional updates.",
    };
    expect(
      landingSchema.parse({ ...base, cityFallback: "St. Louis" }).cityFallback,
    ).toBe("St. Louis");
    expect(
      landingSchema.safeParse({
        ...base,
        cityFallback: "<strong>Houston</strong>",
      }).success,
    ).toBe(false);
  });
  it("accepts a plain-text region fallback and rejects markup", () => {
    const base = {
      title: "Explore options in {{region}}",
      description: "Find your next step with optional updates.",
    };
    expect(
      landingSchema.parse({ ...base, regionFallback: "Texas" }).regionFallback,
    ).toBe("Texas");
    expect(
      landingSchema.safeParse({
        ...base,
        regionFallback: "<strong>Texas</strong>",
      }).success,
    ).toBe(false);
  });
});
describe("experiment variant preservation", () => {
  it("only permits preserving stored content for an existing variant", () => {
    const experiment = {
      name: "Existing experiment",
      slug: "existing-experiment",
      variants: [
        {
          id: "variant-a",
          name: "A",
          weight: 100,
          preserveConfig: true,
          config: {
            title: "Existing landing",
            description: "This complete config is ignored when preserving.",
          },
        },
      ],
    };
    expect(experimentSchema.parse(experiment).variants[0].preserveConfig).toBe(
      true,
    );
    expect(
      experimentSchema.safeParse({
        ...experiment,
        variants: [{ ...experiment.variants[0], id: undefined }],
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
