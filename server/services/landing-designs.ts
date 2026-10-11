import { z } from "zod";
import { db } from "../db.js";
import { landingSchema } from "../domain.js";
import { landingImages } from "../landing-images.js";

export async function assertLandingImages(
  configs: z.infer<typeof landingSchema>[],
  client: Pick<typeof db, "landingAsset"> = db,
) {
  const sources = [
    ...new Set(
      configs.flatMap((config) =>
        [
          config.heroImage,
          config.logoImage,
          ...config.sections.map((s) => s.image),
          ...(config.design?.nodes.flatMap((n) =>
            n.type === "image" ? [n.image] : [],
          ) ?? []),
        ].flatMap((image) => (image ? [image.src] : [])),
      ),
    ),
  ];
  const uploaded = sources
    .filter((src) => src.startsWith("/media/landing/"))
    .map((src) =>
      src
        .split("/")
        .pop()!
        .replace(/\.webp$/, ""),
    );
  if (
    sources.some(
      (src) =>
        src.startsWith("/landing-assets/") &&
        !landingImages.some((image) => image.src === src),
    ) ||
    (uploaded.length &&
      (await client.landingAsset.count({ where: { id: { in: uploaded } } })) !==
        uploaded.length)
  ) {
    throw new Error(
      "An image is missing from the media library. Upload it before saving the landing.",
    );
  }
}

export async function validateLandingDesign(config: unknown) {
  const result = landingSchema.safeParse(config);
  if (!result.success)
    return {
      valid: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  try {
    await assertLandingImages([result.data]);
  } catch (error) {
    return {
      valid: false,
      issues: [{ path: "images", message: (error as Error).message }],
    };
  }
  return {
    valid: true,
    mode: result.data.design ? "canvas" : "template",
    nodes: result.data.design?.nodes.length ?? 0,
    issues: [],
    next: "Save a DRAFT and inspect get_experiment preview URLs on desktop and mobile. Validation does not test provider delivery, marketing claims or every accessibility requirement.",
  };
}
