import { describe, it, expect } from "vitest";
import { landingSchema } from "../server/domain";
import { landingImages } from "../server/landing-images";

const base = {
  title: "Explore loan options",
  description: "A clear starting point for exploring personal loan options.",
};
describe("landing images and application-first pages", () => {
  it("preserves existing pages unless the new behavior is selected", () => {
    const config = landingSchema.parse(base);
    expect(config.heroImage).toBeUndefined();
    expect(config.offerFirst).toBe(false);
    expect(config.showIllustration).toBe(true);
  });
  it("accepts every bundled image with accessible text", () => {
    for (const image of landingImages) {
      const config = landingSchema.parse({
        ...base,
        heroImage: image,
        offerFirst: true,
      });
      expect(config.heroImage).toEqual({ src: image.src, alt: image.alt });
      expect(config.offerFirst).toBe(true);
    }
  });
  it("rejects external sources, executable URLs, traversal and missing descriptions", () => {
    for (const src of [
      "https://example.com/image.jpg",
      "//example.com/image.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,abc",
      "/landing-assets/../private.jpg",
      "/landing-assets/%2e%2e/private.jpg",
      "/landing-assets/test.svg",
      "/landing-assets/test.jpg?redirect=1",
    ]) {
      expect(
        landingSchema.safeParse({
          ...base,
          heroImage: { src, alt: "A picture" },
        }).success,
      ).toBe(false);
    }
    expect(
      landingSchema.safeParse({
        ...base,
        heroImage: { src: landingImages[0].src, alt: " " },
      }).success,
    ).toBe(false);
  });
});
