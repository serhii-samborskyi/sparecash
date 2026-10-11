import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { landingDesignSchema } from "../server/landing-design";
import { landingDesignExamples } from "../server/landing-design-guide";
import { landingSchema } from "../server/domain";
import { LandingCanvas } from "../client/LandingCanvas";

const minimal = () => ({
  version: 1,
  root: "page",
  nodes: [
    { id: "page", type: "container", children: ["title", "form"] },
    { id: "title", type: "heading", level: 1, text: "A new starting point" },
    { id: "form", type: "funnel" },
  ],
});
describe("composable landing boundaries", () => {
  it("accepts distinct compositions and keeps the legacy default unchanged", () => {
    for (const example of landingDesignExamples)
      expect(landingDesignSchema.safeParse(example.design).success).toBe(true);
    const config = {
      title: "Explore options",
      description: "Choose your next step at your own pace.",
    };
    expect(landingSchema.parse(config).design).toBeUndefined();
    expect(
      landingSchema.parse({ ...config, design: minimal() }).design?.nodes,
    ).toHaveLength(3);
  });
  it("requires exactly one reachable funnel and primary heading", () => {
    const missing = minimal();
    missing.nodes.pop();
    expect(landingDesignSchema.safeParse(missing).success).toBe(false);
    const duplicate = minimal();
    duplicate.nodes.push({ id: "extra", type: "funnel" });
    duplicate.nodes[0].children!.push("extra");
    expect(landingDesignSchema.safeParse(duplicate).success).toBe(false);
    const heading = minimal();
    heading.nodes[1].level = 2;
    expect(landingDesignSchema.safeParse(heading).success).toBe(false);
  });
  it("rejects cycles, disconnected nodes, duplicate IDs and repeated slots", () => {
    const cycle = minimal();
    cycle.nodes[0].children!.push("page");
    const orphan = minimal();
    orphan.nodes.push({
      id: "other",
      type: "heading",
      level: 2,
      text: "Orphan",
    });
    const duplicate = minimal();
    duplicate.nodes.push(duplicate.nodes[1]);
    const reused = minimal();
    reused.nodes[0].children!.push("form");
    const missing = minimal();
    missing.nodes[0].children!.push("missing");
    for (const input of [cycle, orphan, duplicate, reused, missing])
      expect(landingDesignSchema.safeParse(input).success).toBe(false);
  });
  it("rejects attempts to replace or conceal protected controls", () => {
    for (const bad of [
      { type: "funnel", style: { display: "none" } },
      { type: "funnel", mobile: { padding: 40 } },
      {
        type: "container",
        children: ["title"],
        style: { position: "fixed", zIndex: 9999 },
      },
      { type: "text", text: "Text", style: { opacity: 0 } },
      { type: "action", text: "Continue", href: "https://example.com" },
      { type: "text", text: "Text", html: "<form></form>" },
    ]) {
      const design = minimal();
      (design.nodes as unknown[])[2] = { id: "form", ...bad };
      expect(landingDesignSchema.safeParse(design).success).toBe(false);
    }
  });
  it("checks inherited foreground and background on both breakpoints", () => {
    const design: any = minimal();
    design.nodes[0].style = { background: "#101010", color: "#ffffff" };
    expect(landingDesignSchema.safeParse(design).success).toBe(true);
    design.nodes[0].mobile = { color: "#111111" };
    const mobile = landingDesignSchema.safeParse(design);
    expect(mobile.success).toBe(false);
    if (!mobile.success)
      expect(mobile.error.issues[0].message).toContain("mobile");
    delete design.nodes[0].mobile;
    design.nodes[1].style = { color: "#111111" };
    expect(landingDesignSchema.safeParse(design).success).toBe(false);
  });
  it("caps depth and node count, rejecting executable sources and style values", () => {
    const deep: any = minimal();
    for (let i = 0; i < 9; i++)
      deep.nodes.push({
        id: `nest${i}`,
        type: "container",
        children: [i === 8 ? "form" : `nest${i + 1}`],
      });
    deep.nodes[0].children = ["title", "nest0"];
    expect(landingDesignSchema.safeParse(deep).success).toBe(false);
    const many: any = minimal();
    for (let i = 0; i < 81; i++)
      many.nodes.push({ id: `text${i}`, type: "text", text: "Too many" });
    expect(landingDesignSchema.safeParse(many).success).toBe(false);
    for (const field of [
      { color: "url(https://example.com/pixel)" },
      { fontSize: 0 },
      { padding: -30 },
    ]) {
      const design = {
        ...minimal(),
        nodes: minimal().nodes.map((n) =>
          n.type === "heading" ? { ...n, style: field } : n,
        ),
      };
      expect(landingDesignSchema.safeParse(design).success).toBe(false);
    }
  });
  it("renders supplied text as text and routes actions to the protected form", () => {
    const design = landingDesignSchema.parse({
      ...minimal(),
      nodes: [
        { id: "page", type: "container", children: ["title", "jump", "form"] },
        {
          id: "title",
          type: "heading",
          level: 1,
          text: '<script src="https://example.com/track"></script>',
        },
        { id: "jump", type: "action", text: "Explore options" },
        { id: "form", type: "funnel" },
      ],
    });
    const html = renderToStaticMarkup(
      <LandingCanvas
        design={design}
        funnel={<section id="application">Required consent</section>}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script");
    expect(html).toContain('href="#application"');
    expect(html.match(/id="application"/g)).toHaveLength(1);
    expect(html).toContain("Required consent");
  });
});
