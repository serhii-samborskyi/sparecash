import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  normalizeLandingAsset,
  MAX_ASSET_BYTES,
} from "../server/services/landing-assets";
import { landingSchema } from "../server/domain";

describe("uploaded artwork", () => {
  it("normalizes real images, strips metadata, resizes and preserves logo transparency", async () => {
    const png = await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 4,
        background: { r: 30, g: 80, b: 60, alpha: 0.4 },
      },
    })
      .png()
      .withMetadata()
      .toBuffer();
    const result = await normalizeLandingAsset(png, "LOGO");
    expect(result.width).toBe(2048);
    expect(result.height).toBe(1024);
    const metadata = await sharp(result.data).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.exif).toBeUndefined();
    const jpg = await sharp(png).jpeg().toBuffer();
    expect((await normalizeLandingAsset(jpg, "HERO")).width).toBe(2048);
  });
  it("rejects executable files, malformed images and size/pixel bombs", async () => {
    for (const bytes of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from("<html>"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(MAX_ASSET_BYTES + 1),
    ]) {
      await expect(normalizeLandingAsset(bytes, "HERO")).rejects.toThrow();
    }
    const huge = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(normalizeLandingAsset(huge, "HERO")).rejects.toThrow();
  });
  it("accepts library images in each slot and rejects untrusted URLs in all slots", () => {
    const image = {
      src: "/media/landing/c1234567890123456789012345.webp",
      alt: "Custom artwork",
    };
    const config = {
      title: "Custom landing",
      description: "A landing with custom artwork and branding.",
      heroImage: image,
      logoImage: image,
      heroPosition: "before_title",
      sections: [
        { heading: "Our approach", body: "Illustrated section", image },
      ],
    };
    expect(landingSchema.parse(config).logoImage).toEqual(image);
    for (const src of [
      "https://evil.example/a.png",
      "/media/landing/../../private.webp",
      "/media/landing/c1234567890123456789012345.svg",
      "data:image/png;base64,abc",
    ])
      for (const candidate of [
        { ...config, heroImage: { ...image, src } },
        { ...config, logoImage: { ...image, src } },
        {
          ...config,
          sections: [{ ...config.sections[0], image: { ...image, src } }],
        },
      ])
        expect(landingSchema.safeParse(candidate).success).toBe(false);
  });
});
