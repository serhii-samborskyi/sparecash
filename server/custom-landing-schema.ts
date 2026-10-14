import { z } from "zod";

export const customLandingReferenceSchema = z.object({
  sourceId: z
    .string()
    .min(20)
    .max(40)
    .describe(
      "Immutable source id returned by create_custom_landing_source. The source supplies all authored HTML and CSS around the protected funnel.",
    ),
});

export const customLandingSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  html: z.string().min(20).max(200_000),
  css: z.string().max(100_000).default(""),
});

export const listLandingSourcesSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  q: z.string().trim().max(120).default(""),
});
