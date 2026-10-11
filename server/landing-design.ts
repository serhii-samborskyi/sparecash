import { z } from "zod";
import { landingImageSchema } from "./landing-image-schema.js";

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const designFontSchema = z.enum([
  "modern",
  "humanist",
  "editorial",
  "classic",
  "mono",
]);
// A finite CSS vocabulary keeps authored content from hiding or covering the
// protected form. No arbitrary selectors, HTML, event handlers or network URLs.
export const designStyleSchema = z
  .object({
    background: color.optional(),
    color: color.optional(),
    borderColor: color.optional(),
    borderWidth: z.number().int().min(0).max(6).optional(),
    radius: z.number().int().min(0).max(64).optional(),
    padding: z.number().int().min(0).max(96).optional(),
    gap: z.number().int().min(0).max(96).optional(),
    maxWidth: z.number().int().min(320).max(1600).optional(),
    columns: z.number().int().min(1).max(4).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    font: designFontSchema.optional(),
    fontSize: z.number().int().min(14).max(112).optional(),
    fontWeight: z.enum(["400", "500", "600", "700", "800"]).optional(),
    lineHeight: z.number().min(1).max(2).optional(),
    letterSpacing: z.number().min(-3).max(6).optional(),
    shadow: z.enum(["none", "soft", "bold"]).optional(),
  })
  .strict();
const styled = {
  id,
  style: designStyleSchema.optional(),
  mobile: designStyleSchema
    .optional()
    .describe("Overrides at 760px and below; grids stack by default"),
};
export const designNodeSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...styled,
      type: z.literal("container"),
      children: z.array(id).min(1).max(30),
    })
    .strict(),
  z
    .object({
      ...styled,
      type: z.literal("heading"),
      level: z.number().int().min(1).max(3),
      text: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      ...styled,
      type: z.literal("text"),
      text: z.string().trim().min(1).max(2400),
    })
    .strict(),
  z
    .object({
      ...styled,
      type: z.literal("image"),
      image: landingImageSchema,
      aspect: z
        .enum(["auto", "square", "landscape", "wide", "portrait"])
        .default("landscape"),
      fit: z.enum(["cover", "contain"]).default("cover"),
    })
    .strict(),
  z
    .object({
      ...styled,
      type: z.literal("list"),
      items: z.array(z.string().trim().min(1).max(400)).min(1).max(12),
      ordered: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...styled,
      type: z.literal("action"),
      text: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      ...styled,
      type: z.literal("faq"),
      question: z.string().trim().min(1).max(200),
      answer: z.string().trim().min(1).max(1600),
    })
    .strict(),
  z.object({ ...styled, type: z.literal("divider") }).strict(),
  z
    .object({ id, type: z.literal("funnel") })
    .strict()
    .describe(
      "Exactly one protected quiz/subscription/application slot. Cannot be styled, hidden or replaced.",
    ),
]);

export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const landingDesignSchema = z
  .object({
    version: z.literal(1),
    background: color.default("#f7f7f2"),
    color: color.default("#172b24"),
    font: designFontSchema.default("modern"),
    headingFont: designFontSchema.default("modern"),
    root: id,
    nodes: z.array(designNodeSchema).min(3).max(80),
  })
  .strict()
  .superRefine((design, ctx) => {
    const fail = (message: string, path: (string | number)[] = ["nodes"]) =>
      ctx.addIssue({ code: "custom", path, message });
    const nodes = new Map(design.nodes.map((n) => [n.id, n]));
    if (nodes.size !== design.nodes.length) fail("Node IDs must be unique");
    if (nodes.get(design.root)?.type !== "container")
      fail("Root must name a container", ["root"]);
    if (design.nodes.filter((n) => n.type === "funnel").length !== 1)
      fail("Include exactly one protected funnel node");
    if (
      design.nodes.filter((n) => n.type === "heading" && n.level === 1)
        .length !== 1
    )
      fail("Include exactly one level-1 heading");
    // Validate the graph before rendering so cycles, orphans and reused slots
    // cannot duplicate forms or recurse indefinitely in a visitor's browser.
    const visited = new Set<string>();
    const walk = (key: string, depth: number, ancestors: Set<string>) => {
      if (depth > 8) {
        fail("Design nesting is limited to 8 levels");
        return;
      }
      if (ancestors.has(key)) {
        fail(`Cycle at ${key}`);
        return;
      }
      if (visited.has(key)) {
        fail(`Node ${key} is used more than once`);
        return;
      }
      const node = nodes.get(key);
      if (!node) {
        fail(`Missing node ${key}`);
        return;
      }
      visited.add(key);
      if (node.type === "container") {
        const next = new Set(ancestors).add(key);
        for (const child of node.children) walk(child, depth + 1, next);
      }
    };
    walk(design.root, 1, new Set());
    if (visited.size !== nodes.size)
      fail("Every node must be reachable from root");
    // Validate inherited foreground/background pairs at both breakpoints.
    // The funnel uses its own palette and does not inherit authored styles.
    if (visited.size === nodes.size && design.nodes.length === nodes.size) {
      for (const mobile of [false, true]) {
        const checked = new Set<string>();
        const inspect = (
          key: string,
          background: string,
          foreground: string,
          depth: number,
        ) => {
          if (checked.has(key) || depth > 8) return;
          checked.add(key);
          const node = nodes.get(key);
          if (!node || node.type === "funnel") return;
          const style = { ...node.style, ...(mobile ? node.mobile : {}) };
          background = style.background ?? background;
          foreground = style.color ?? foreground;
          if (
            !["image", "divider", "container"].includes(node.type) &&
            contrastRatio(background, foreground) < 4.5
          )
            fail(
              `Node ${key} needs text contrast of at least 4.5:1 on ${mobile ? "mobile" : "desktop"}`,
            );
          if (node.type === "container")
            for (const child of node.children)
              inspect(child, background, foreground, depth + 1);
        };
        inspect(design.root, design.background, design.color, 1);
      }
    }
  });

export type LandingDesign = z.infer<typeof landingDesignSchema>;
export type DesignNode = z.infer<typeof designNodeSchema>;
export type DesignStyle = z.infer<typeof designStyleSchema>;
