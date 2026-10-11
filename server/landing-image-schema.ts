import { z } from "zod";

export const landingImageSchema = z.object({
  src: z
    .string()
    .regex(
      /^(?:\/landing-assets\/[a-z0-9][a-z0-9-]*\.(?:jpg|jpeg|png|webp)|\/media\/landing\/[a-z0-9]{20,40}\.webp)$/,
      "Choose a bundled image or upload an image to the media library",
    ),
  alt: z.string().trim().min(3).max(240),
});
