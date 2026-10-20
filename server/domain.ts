import { z } from "zod";
import { ROUND_SKY_OFFER_URL } from "./roundsky-contract.js";
import { timezoneSchema } from "./timezones.js";
import { landingImageSchema } from "./landing-image-schema.js";
import { landingDesignSchema } from "./landing-design.js";
import { customLandingReferenceSchema } from "./custom-landing-schema.js";
export { landingImageSchema } from "./landing-image-schema.js";
export { withinSendingHours } from "./timezones.js";
export const channelSchema = z.enum(["EMAIL", "SMS", "PUSH"]);
export const objectiveSchema = z.enum([
  "SUBSCRIPTIONS",
  "SOLD",
  "APPROVED",
  "FUNDED",
  "REVENUE",
]);
export const questionSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(40),
  label: z.string().min(3).max(160),
  options: z.array(z.string().min(1).max(100)).min(2).max(8),
  showWhen: z.object({ questionId: z.string(), equals: z.string() }).optional(),
});

const customFormFieldSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(40),
    valueType: z.enum(["integer", "decimal", "text"]),
    required: z.boolean().default(true),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
    defaultValue: z
      .union([z.string().max(200), z.number().finite()])
      .optional(),
    maxLength: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.valueType === "text") {
      if (
        field.min !== undefined ||
        field.max !== undefined ||
        field.step !== undefined
      )
        context.addIssue({
          code: "custom",
          message: "Text fields cannot define numeric bounds",
        });
      return;
    }
    if (field.min === undefined || field.max === undefined)
      context.addIssue({
        code: "custom",
        message: "Numeric fields require min and max",
      });
    else if (field.max <= field.min)
      context.addIssue({
        code: "custom",
        message: "Field max must be greater than min",
      });
    if (field.defaultValue !== undefined) {
      const value = Number(field.defaultValue);
      if (
        !Number.isFinite(value) ||
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      )
        context.addIssue({
          code: "custom",
          path: ["defaultValue"],
          message: "Default value must be inside the configured range",
        });
    }
  });

const contactRequirementSchema = z.enum(["hidden", "optional", "required"]);
const matchEstimateSchema = z
  .object({
    amountFieldId: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(40),
    scoreFieldId: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(40),
  })
  .strict();
const providerSearchSchema = z
  .object({
    minDurationMs: z.number().int().min(4000).max(10000),
    maxDurationMs: z.number().int().min(4000).max(10000),
    minProviderCount: z.number().int().min(1).max(500),
    maxProviderCount: z.number().int().min(1).max(500),
  })
  .strict();
export const customFormSchema = z
  .object({
    fields: z.array(customFormFieldSchema).max(12).default([]),
    contacts: z
      .object({
        name: contactRequirementSchema.default("hidden"),
        phone: contactRequirementSchema.default("hidden"),
        email: contactRequirementSchema.default("hidden"),
      })
      .strict()
      .default({}),
    continueToApplication: z.boolean().default(true),
    matchEstimate: matchEstimateSchema.optional(),
    providerSearch: providerSearchSchema.optional(),
  })
  .strict()
  .superRefine((form, context) => {
    const ids = new Set<string>();
    for (const [index, field] of form.fields.entries()) {
      if (ids.has(field.id))
        context.addIssue({
          code: "custom",
          path: ["fields", index, "id"],
          message: "Custom form field IDs must be unique",
        });
      ids.add(field.id);
    }
    if (form.matchEstimate) {
      const numericIds = new Set(
        form.fields
          .filter((field) => field.valueType !== "text")
          .map((field) => field.id),
      );
      if (!numericIds.has(form.matchEstimate.amountFieldId))
        context.addIssue({
          code: "custom",
          path: ["matchEstimate", "amountFieldId"],
          message: "The amount estimate binding must reference a numeric field",
        });
      if (!numericIds.has(form.matchEstimate.scoreFieldId))
        context.addIssue({
          code: "custom",
          path: ["matchEstimate", "scoreFieldId"],
          message: "The score estimate binding must reference a numeric field",
        });
    }
    if (form.providerSearch) {
      if (form.providerSearch.maxDurationMs < form.providerSearch.minDurationMs)
        context.addIssue({
          code: "custom",
          path: ["providerSearch", "maxDurationMs"],
          message: "Maximum search duration must be at least the minimum",
        });
      if (
        form.providerSearch.maxProviderCount <
        form.providerSearch.minProviderCount
      )
        context.addIssue({
          code: "custom",
          path: ["providerSearch", "maxProviderCount"],
          message: "Maximum provider count must be at least the minimum",
        });
      if (!form.continueToApplication)
        context.addIssue({
          code: "custom",
          path: ["providerSearch"],
          message: "Provider search requires application continuation",
        });
    }
    if (Object.values(form.contacts).every((value) => value === "hidden"))
      context.addIssue({
        code: "custom",
        path: ["contacts"],
        message: "A custom lead form must collect at least one contact method",
      });
  });

export function validateCustomFormAnswers(
  form: z.infer<typeof customFormSchema>,
  answers: Record<string, string>,
) {
  const result: Record<string, string> = {};
  const expected = new Set(form.fields.map((field) => field.id));
  if (Object.keys(answers).some((id) => !expected.has(id)))
    throw new Error("The submitted form contains an unknown field.");
  for (const field of form.fields) {
    const raw = answers[field.id]?.trim() ?? "";
    if (!raw) {
      if (field.required) throw new Error(`Complete the ${field.id} field.`);
      continue;
    }
    if (field.valueType === "text") {
      if (raw.length > (field.maxLength ?? 200))
        throw new Error(`The ${field.id} field is too long.`);
      result[field.id] = raw;
      continue;
    }
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (field.valueType === "integer" && !Number.isInteger(value)) ||
      value < field.min! ||
      value > field.max!
    )
      throw new Error(`Choose a valid ${field.id} value.`);
    if (field.step) {
      const steps = (value - field.min!) / field.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-7)
        throw new Error(`Choose a valid ${field.id} increment.`);
    }
    result[field.id] = String(value);
  }
  return result;
}
export const landingSchema = z
  .object({
    eyebrow: z.string().max(80).default("A little breathing room"),
    title: z.string().min(3).max(120),
    description: z.string().min(10).max(400),
    cityFallback: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[\p{L}\p{M} .'-]+$/u)
      .optional()
      .describe(
        "Optional city used in {{city}} landing copy when trusted edge geolocation is unavailable, such as a city-targeted campaign preview.",
      ),
    regionFallback: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[\p{L}\p{M} .'-]+$/u)
      .optional()
      .describe(
        "Optional state, province or administrative region used when trusted edge or advertiser region data is unavailable. Use {{region_phrase}} to append ' in Region' only when a region exists.",
      ),
    button: z.string().min(2).max(50).default("Explore my options"),
    theme: z.enum(["forest", "blue", "plum"]).default("forest"),
    layout: z.enum(["split", "centered", "editorial"]).default("split"),
    typography: z.enum(["sans", "serif"]).default("sans"),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    showIllustration: z.boolean().default(true),
    heroImage: landingImageSchema.optional(),
    logoImage: landingImageSchema.optional(),
    heroPosition: z.enum(["before_title", "after_copy"]).default("after_copy"),
    design: landingDesignSchema
      .optional()
      .describe(
        "Optional composable canvas. Replaces the legacy story/layout. Keep quiz, consent, form and image/logo settings at config level. Read landing_design_guide first.",
      ),
    customLanding: customLandingReferenceSchema
      .optional()
      .describe(
        "Optional immutable custom HTML/CSS source. Mutually exclusive with design and the classic template story. The app still owns the quiz, opt-in and application funnel.",
      ),
    customForm: customFormSchema
      .optional()
      .describe(
        "Data and validation contract for a bound custom HTML form. The landing source controls the complete form markup and CSS through data-sc bindings.",
      ),
    offerFirst: z.boolean().default(false),
    funnelMode: z
      .enum(["guided", "instant"])
      .default("guided")
      .describe(
        "Guided shows one quiz question at a time. Instant keeps the short quiz and optional update form together in one compact request card.",
      ),
    activityNotice: z
      .object({ enabled: z.boolean().default(false) })
      .strict()
      .optional()
      .describe(
        "Shows anonymized recent application activity recorded by SpareCash. Live pages never invent names, locations or loan outcomes.",
      ),
    benefits: z
      .array(z.string().min(1).max(160))
      .max(5)
      .default([
        "Choose how you hear from us",
        "Explore at your own pace",
        "Unsubscribe whenever you like",
      ]),
    sections: z
      .array(
        z.object({
          heading: z.string().min(1).max(100),
          body: z.string().min(1).max(800),
          image: landingImageSchema.optional(),
        }),
      )
      .max(5)
      .default([]),
    formTitle: z
      .string()
      .min(3)
      .max(120)
      .default("Want daily updates about loan options?"),
    formDescription: z
      .string()
      .max(400)
      .default(
        "Choose one or more channels for daily updates about loan options.",
      ),
    questions: z.array(questionSchema).max(8).default([]),
    searchTransition: z
      .object({
        durationMs: z.number().int().min(4000).max(10000).default(7000),
        steps: z
          .array(z.string().min(3).max(100))
          .min(2)
          .max(4)
          .default([
            "Reviewing your answers",
            "Preparing your lender-network request",
            "Your next step is ready",
          ]),
      })
      .strict()
      .optional()
      .describe(
        "Optional honest preparation stage shown after the quiz and before channel choice. It must not claim approval, matching or lender results.",
      ),
    consentVersion: z.string().min(1).max(40).default("v1"),
    emailConsent: z
      .string()
      .min(20)
      .max(1000)
      .default(
        "I agree to receive recurring marketing emails about personal-loan options from SpareCash at the email address I provide. Frequency may vary, and messages may continue until I unsubscribe. Consent is not a condition of using the service. I can unsubscribe at any time.",
      ),
    smsConsent: z
      .string()
      .min(20)
      .max(1000)
      .default(
        "I agree to receive recurring automated marketing texts about loan options from SpareCash at the number I provide, up to one per day. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.",
      ),
    phoneConsentVersion: z
      .string()
      .min(1)
      .max(40)
      .default("v3-phone-marketing-2026-10-20"),
    phoneConsent: z
      .string()
      .min(20)
      .max(1000)
      .default(
        "By switching this on and submitting, I provide my electronic signature and agree that SpareCash may contact me at the number I provided with recurring marketing calls and messages about personal-loan options, including by SMS, iMessage and RCS, using automated dialing technology and artificial, prerecorded or AI-generated voices. Message frequency varies, and messages may continue until I unsubscribe. Message and data rates may apply. Consent is not a condition of using the service. Reply STOP to messages or contact SpareCash to revoke consent at any time.",
      ),
    pushConsent: z
      .string()
      .min(20)
      .max(1000)
      .default(
        "I agree to receive daily browser notifications about loan options from SpareCash. I can turn them off at any time.",
      ),
  })
  .superRefine((config, context) => {
    if (config.design && config.customLanding)
      context.addIssue({
        code: "custom",
        path: ["customLanding"],
        message: "Choose either a composable canvas or a custom HTML source",
      });
    if (config.customForm && !config.customLanding)
      context.addIssue({
        code: "custom",
        path: ["customForm"],
        message: "A bound custom form requires a custom landing source",
      });
    if (config.customForm && config.questions.length)
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message:
          "A bound custom form owns its fields and cannot also use the fixed quiz",
      });
    const prior = new Map<string, z.infer<typeof questionSchema>>();
    for (const [index, question] of config.questions.entries()) {
      if (prior.has(question.id))
        context.addIssue({
          code: "custom",
          path: ["questions", index, "id"],
          message: "Question IDs must be unique",
        });
      if (question.showWhen) {
        const parent = prior.get(question.showWhen.questionId);
        if (!parent?.options.includes(question.showWhen.equals))
          context.addIssue({
            code: "custom",
            path: ["questions", index, "showWhen"],
            message:
              "Conditions must refer to an earlier question and one of its options",
          });
      }
      prior.set(question.id, question);
    }
  });
export function visibleQuestions(
  questions: z.infer<typeof questionSchema>[],
  answers: Record<string, string>,
) {
  const visible = new Set<string>();
  return questions.filter((question) => {
    const rule = question.showWhen;
    const show =
      !rule ||
      (visible.has(rule.questionId) &&
        answers[rule.questionId] === rule.equals);
    if (show) visible.add(question.id);
    return show;
  });
}
const attributionText = (maximum = 200) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !/[\x00-\x1f\x7f]/.test(value),
      "Invalid attribution value",
    );
export const propellerAdContextSchema = z
  .object({
    bannerId: attributionText(),
    browser: attributionText(),
    browserVersion: attributionText(),
    carrier: attributionText(),
    propellerClickId: attributionText(),
    connectionType: attributionText(),
    declaredCost: attributionText(50),
    country: attributionText(),
    city: attributionText(100),
    device: attributionText(),
    language: attributionText(),
    os: attributionText(),
    osVersion: attributionText(),
    region: attributionText(),
    subzoneId: attributionText(),
    userAgent: attributionText(1000),
    utmSource: attributionText(),
    utmMedium: attributionText(),
    utmCampaign: attributionText(),
    utmContent: attributionText(),
  })
  .partial()
  .strict();
export const experimentSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(3).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(70),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).default("DRAFT"),
    objective: objectiveSchema.default("SUBSCRIPTIONS"),
    variants: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().min(1).max(80),
          weight: z.number().int().min(0).max(100),
          config: landingSchema,
          preserveConfig: z
            .boolean()
            .default(false)
            .describe(
              "For an existing variant with traffic, keep its stored config while changing allocation or adding another variant.",
            ),
        }),
      )
      .min(1)
      .max(8),
  })
  .refine(
    (v) => v.variants.some((x) => x.weight > 0),
    "At least one variant must receive traffic",
  )
  .refine(
    (v) => v.variants.every((x) => !x.preserveConfig || Boolean(x.id)),
    "Only an existing variant can preserve its stored config",
  );
export const chainSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3).max(100),
  channel: channelSchema,
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).default("DRAFT"),
  trigger: z
    .enum(["SUBSCRIBED", "CLICKED", "DECLINED", "NO_CONVERSION"])
    .default("SUBSCRIBED"),
  maxDays: z.number().int().min(1).max(365).default(30),
  steps: z
    .array(
      z.object({
        delayHours: z.number().int().min(24).max(2160),
        subject: z.string().min(2).max(140),
        body: z.string().min(10).max(4000),
      }),
    )
    .min(1)
    .max(60),
});
export const settingsSchema = z
  .object({
    sourceAutomation: z.boolean().default(false),
    minimumVisits: z.number().int().min(50).max(100000).default(100),
    minimumAgeHours: z.number().min(1).max(720).default(24),
    botRateThreshold: z.number().min(0.5).max(1).default(0.8),
    maxBlocksPerRun: z.number().int().min(1).max(20).default(3),
    lookbackDays: z.number().int().min(1).max(30).default(7),
    maxDaysWithoutConversion: z.number().int().min(1).max(365).default(14),
    sendHourStart: z.number().int().min(9).max(18).default(10),
    sendHourEnd: z.number().int().min(11).max(20).default(18),
    workspaceTimezone: timezoneSchema.default("America/Chicago"),
    followupTimezoneMode: z
      .enum(["RECIPIENT", "WORKSPACE"])
      .default("RECIPIENT"),
    timezoneDetection: z
      .enum(["BROWSER_FIRST", "IP_FIRST"])
      .default("BROWSER_FIRST"),
    stopOn: z.enum(["SOLD", "APPROVED", "FUNDED"]).default("SOLD"),
    roundskyUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .url()
          .refine((v) => new URL(v).protocol === "https:", "Use HTTPS"),
      ])
      .default(ROUND_SKY_OFFER_URL),
    roundskySubIdParameter: z.literal("subId3").default("subId3"),
    roundskyPrepopulate: z.boolean().default(true),
    businessName: z.string().max(120).default("SpareCash"),
    businessAddress: z.string().max(300).default(""),
    contactEmail: z.union([z.literal(""), z.string().email()]).default(""),
    privacyText: z.string().max(20000).default(""),
    termsText: z.string().max(20000).default(""),
  })
  .refine(
    (v) => v.sendHourEnd > v.sendHourStart,
    "Sending window must end after it starts",
  );
export type Settings = z.infer<typeof settingsSchema>;
export function chooseVariant<T extends { id: string; weight: number }>(
  variants: T[],
  value: number,
): T {
  const active = variants.filter((v) => v.weight > 0);
  const total = active.reduce((s, v) => s + v.weight, 0);
  if (!total) throw new Error("No weighted variants");
  let point = Math.max(0, Math.min(0.999999, value)) * total;
  return (
    active.find((v) => (point -= v.weight) < 0) ?? active[active.length - 1]
  );
}
export function sourceDecision(
  input: { total: number; bad: number; oldest: Date },
  config: Settings,
  now = new Date(),
) {
  const rate = input.total ? input.bad / input.total : 0;
  // Wilson lower bound prevents small, noisy samples from triggering paid-source changes.
  const n = input.total,
    z = 1.96;
  const lower = n
    ? (rate +
        (z * z) / (2 * n) -
        z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * n)) / n)) /
      (1 + (z * z) / n)
    : 0;
  const mature =
    now.getTime() - input.oldest.getTime() >= config.minimumAgeHours * 3600000;
  return {
    eligible:
      n >= config.minimumVisits && mature && lower >= config.botRateThreshold,
    rate,
    lower,
    total: n,
    bad: input.bad,
  };
}
const rank: Record<string, number> = {
  NEW: 0,
  ENGAGED: 1,
  DECLINED: 2,
  SOLD: 3,
  APPROVED: 4,
  FUNDED: 5,
};
export function nextLeadStatus(current: string, event: string) {
  return (rank[event] ?? 0) > (rank[current] ?? 0) ? event : current;
}
export function shouldStop(status: string, stopOn: string) {
  return (
    ["SOLD", "APPROVED", "FUNDED"].includes(status) &&
    (rank[status] ?? 0) >= (rank[stopOn] ?? 5)
  );
}
export function canSend(lastSentAt: Date | null, now = new Date()) {
  return !lastSentAt || now.getTime() - lastSentAt.getTime() >= 24 * 3600000;
}
export function renderMessage(template: string, name: string, link: string) {
  return template
    .replaceAll("{{name}}", name.trim() || "there")
    .replaceAll("{{link}}", link);
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^1\d{10}$/.test(digits)
    ? `+${digits}`
    : /^\d{10}$/.test(digits)
      ? `+1${digits}`
      : null;
}
