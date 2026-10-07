import { z } from "zod";
import { ROUND_SKY_OFFER_URL } from "./roundsky-contract.js";
import { timezoneSchema } from "./timezones.js";
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
});
export const landingSchema = z.object({
  eyebrow: z.string().max(80).default("A little breathing room"),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(400),
  button: z.string().min(2).max(50).default("Explore my options"),
  theme: z.enum(["forest", "blue", "plum"]).default("forest"),
  questions: z.array(questionSchema).max(8).default([]),
  consentVersion: z.string().min(1).max(40).default("v1"),
  emailConsent: z
    .string()
    .min(20)
    .max(1000)
    .default(
      "I agree to receive daily marketing emails about loan options from SpareCash. I can unsubscribe at any time.",
    ),
  smsConsent: z
    .string()
    .min(20)
    .max(1000)
    .default(
      "I agree to receive recurring automated marketing texts about loan options from SpareCash at the number I provide, up to one per day. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.",
    ),
  pushConsent: z
    .string()
    .min(20)
    .max(1000)
    .default(
      "I agree to receive daily browser notifications about loan options from SpareCash. I can turn them off at any time.",
    ),
});
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
        }),
      )
      .min(1)
      .max(8),
  })
  .refine(
    (v) => v.variants.some((x) => x.weight > 0),
    "At least one variant must receive traffic",
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
  return template.replaceAll("{{name}}", name).replaceAll("{{link}}", link);
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
