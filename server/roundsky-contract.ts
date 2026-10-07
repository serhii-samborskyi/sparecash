import { z } from "zod";

export const SPARECASH_PRODUCTION_ORIGIN = "https://sparecash.leadtechx.com";
export const ROUND_SKY_OFFER_URL =
  "https://www.rnd3.com/ai/iframeRedirect.php?id=uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.";

export type RoundSkyPrepopulation = {
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  zip?: string;
  homePhone?: string;
  rla?: string;
};

const managedParameters = new Set([
  "subid",
  "subid2",
  "subid3",
  "firstname",
  "lastname",
  "email",
  "address",
  "zip",
  "homephone",
  "homephone1",
  "homephone2",
  "homephone3",
  "rla",
]);

export function buildRoundSkyUrl(input: {
  baseUrl: string;
  applicationId: string;
  campaign: string;
  source: string;
  prepopulate?: RoundSkyPrepopulation;
}) {
  const url = new URL(input.baseUrl);
  if (url.protocol !== "https:")
    throw new Error("RoundSky offers must use HTTPS");
  z.string().uuid().parse(input.applicationId);
  // Remove old aliases, copied template placeholders, and stale personal data.
  for (const key of [...url.searchParams.keys()]) {
    if (managedParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.set("subId", input.campaign);
  url.searchParams.set("subId2", input.source);
  url.searchParams.set("subId3", input.applicationId);

  const fields = input.prepopulate;
  if (!fields) return url.toString();
  for (const [key, limit] of [
    ["firstName", 30],
    ["lastName", 30],
    ["address", 150],
  ] as const) {
    const value = fields[key]?.trim();
    if (value)
      url.searchParams.set(key, Array.from(value).slice(0, limit).join(""));
  }
  // An email cannot be truncated without changing the recipient.
  if (
    fields.email &&
    z.string().email().max(100).safeParse(fields.email).success
  ) {
    url.searchParams.set("email", fields.email);
  }
  if (fields.zip && /^\d{5}$/.test(fields.zip))
    url.searchParams.set("zip", fields.zip);
  const digits = fields.homePhone?.replace(/\D/g, "") ?? "";
  const phone = /^1\d{10}$/.test(digits) ? digits.slice(1) : digits;
  if (/^\d{10}$/.test(phone)) url.searchParams.set("homePhone", phone);
  // A quiz range such as "$1,000–$2,500" is not an exact requested amount.
  if (fields.rla && /^\d+$/.test(fields.rla))
    url.searchParams.set("rla", fields.rla);
  return url.toString();
}

export const roundSkySaleSchema = z.object({
  hid: z.string().uuid(),
  price: z
    .string()
    .regex(/^\d{1,6}(?:\.\d{1,4})?$/, "Expected a dollar amount such as 5.00")
    .refine(
      (value) => Number(value) <= 100000,
      "Lead price exceeds supported limit",
    ),
  transactionId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
});

export function normalizeRoundSkySale(input: unknown) {
  const sale = roundSkySaleSchema.parse(input);
  return {
    eventId: `roundsky:sold:${sale.transactionId}`,
    applicationId: sale.hid,
    event: "SOLD" as const,
    revenue: sale.price,
  };
}

export function buildRoundSkyPixelUrl(origin: string, secret: string) {
  const base = new URL(origin);
  if (base.protocol !== "https:")
    throw new Error("RoundSky requires an HTTPS pixel URL");
  // Keep the bracketed macros literal so RoundSky can substitute them.
  return `${base.origin}/api/webhooks/roundsky/sold?token=${encodeURIComponent(secret)}&hid=[subId3]&price=[price]&transactionId=[transactionId]`;
}
