import { z } from "zod";
import { SPARECASH_PRODUCTION_ORIGIN } from "./roundsky-contract.js";
const optionalUrl = z.union([z.literal(""), z.string().url()]);
export const publicRuntimeSchema = z
  .object({
    APP_URL: z
      .string()
      .url()
      .transform((value) => new URL(value).origin),
    LIVE_DELIVERY: z.enum(["true", "false"]).default("false"),
    LIVE_SOURCE_BLOCKING: z.enum(["true", "false"]).default("false"),
    TURNSTILE_SITE_KEY: z.string().max(500).default(""),
    ONESIGNAL_APP_ID: z.string().max(200).default(""),
    BREVO_SENDER_EMAIL: z
      .union([z.literal(""), z.string().email()])
      .default(""),
    BREVO_SENDER_NAME: z.string().max(120).default("SpareCash"),
    BREVO_FOLDER_ID: z.coerce.number().int().min(0).default(0),
    BLUEBUBBLES_URL: optionalUrl.default(""),
    PROPELLER_API_URL: z
      .string()
      .url()
      .default("https://ssp-api.propellerads.com/v5"),
  })
  .strict();
const optionalSecret = z.string().max(4000).default("");
export const secretRuntimeSchema = z
  .object({
    ADMIN_PASSWORD_HASH: z.string().min(20).max(100),
    TOKEN_SECRET: z.string().min(32).max(500),
    MCP_TOKEN: z.string().min(32).max(500),
    WEBHOOK_TOKEN: z.string().min(32).max(500),
    ROUNDSKY_WEBHOOK_TOKEN: z.string().min(32).max(500),
    CLOUDFLARE_GEO_TOKEN: z
      .union([z.literal(""), z.string().min(32).max(500)])
      .default(""),
    TURNSTILE_SECRET_KEY: optionalSecret,
    ONESIGNAL_API_KEY: optionalSecret,
    BREVO_API_KEY: optionalSecret,
    BLUEBUBBLES_PASSWORD: optionalSecret,
    PROPELLER_API_TOKEN: optionalSecret,
  })
  .strict();
export const editableSecretsSchema = secretRuntimeSchema
  .omit({ ADMIN_PASSWORD_HASH: true })
  .partial()
  .strict();
export const runtimePatchSchema = z
  .object({
    values: publicRuntimeSchema.partial().default({}),
    secrets: editableSecretsSchema.default({}),
  })
  .strict();
export type RuntimeValues = z.infer<typeof publicRuntimeSchema>;
export type RuntimeSecrets = z.infer<typeof secretRuntimeSchema>;
export type RuntimeConfiguration = RuntimeValues & RuntimeSecrets;
export const defaultRuntimeValues = publicRuntimeSchema.parse({
  APP_URL: SPARECASH_PRODUCTION_ORIGIN,
});
