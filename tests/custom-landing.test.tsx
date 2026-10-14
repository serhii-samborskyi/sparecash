import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomLanding } from "../client/CustomLanding";
import { landingSchema } from "../server/domain";
import { prepareCustomLandingSource } from "../server/services/custom-landings";

const source = (overrides: Record<string, unknown> = {}) => ({
  name: "Editorial guide",
  html: `<main class="guide"><h1>Compare the total cost.</h1><p>Review the details before deciding.</p><button data-sc-action="open-funnel">Start</button></main>
<sparecash-funnel></sparecash-funnel>
<section class="notes"><h2>What to compare</h2><img src="/landing-assets/loan-checklist-v2.jpg" alt="A loan checklist"></section>`,
  css: `.guide,.notes{max-width:70rem;margin:0 auto;padding:2rem}.guide h1{font-size:4rem}@media(max-width:700px){.guide h1{font-size:2.5rem}}`,
  ...overrides,
});

describe("custom landing sources", () => {
  it("sanitizes, scopes and renders authored sections around the protected funnel", async () => {
    const prepared = await prepareCustomLandingSource(source());
    expect(prepared.css).toContain(".custom-landing-content .guide");
    expect(prepared.htmlBefore).toContain("<h1>Compare the total cost.</h1>");
    expect(prepared.htmlAfter).toContain(
      "/landing-assets/loan-checklist-v2.jpg",
    );
    const html = renderToStaticMarkup(
      <CustomLanding
        source={{ ...prepared, name: "Editorial guide" }}
        funnel={<section id="application">Protected quiz and consent</section>}
      />,
    );
    expect(html.match(/id="application"/g)).toHaveLength(1);
    expect(html).toContain("Protected quiz and consent");
    expect(html).toContain("custom-landing-content");
  });

  it("requires one primary heading and one top-level funnel slot", async () => {
    await expect(
      prepareCustomLandingSource(
        source({
          html: "<h1>One</h1><div><sparecash-funnel></sparecash-funnel></div>",
        }),
      ),
    ).rejects.toThrow("top-level");
    await expect(
      prepareCustomLandingSource(
        source({
          html: "<h2>No primary heading</h2><sparecash-funnel></sparecash-funnel>",
        }),
      ),
    ).rejects.toThrow("exactly one h1");
  });

  it("rejects executable markup, replacement forms and protected identifiers", async () => {
    for (const html of [
      "<h1>Unsafe</h1><script>alert(1)</script><sparecash-funnel></sparecash-funnel>",
      "<h1>Unsafe</h1><form><input></form><sparecash-funnel></sparecash-funnel>",
      '<h1 onclick="alert(1)">Unsafe</h1><sparecash-funnel></sparecash-funnel>',
      '<h1 id="application">Unsafe</h1><sparecash-funnel></sparecash-funnel>',
      "<h1 id=application>Unsafe</h1><sparecash-funnel></sparecash-funnel>",
    ])
      await expect(
        prepareCustomLandingSource(source({ html })),
      ).rejects.toThrow();
  });

  it("isolates CSS and rejects overlays, network loads and protected selectors", async () => {
    for (const css of [
      "@import url(https://example.com/a.css);",
      ".hero{background:url(https://example.com/pixel)}",
      ".hero{position:fixed;inset:0}",
      ".hero{margin-top:-1000px}",
      ".hero{transform:translateY(-1000px)}",
      "sparecash-funnel{display:none}",
      "body{color:red}",
    ])
      await expect(
        prepareCustomLandingSource(source({ css })),
      ).rejects.toThrow();
  });

  it("allows only privacy-enhanced video players and hardens the iframe", async () => {
    const prepared = await prepareCustomLandingSource(
      source({
        html: `<main><h1>Watch the guide</h1><iframe src="https://www.youtube-nocookie.com/embed/abc123" title="Personal loan guide"></iframe><iframe src="https://example.com/embed/tracker" title="Blocked"></iframe></main><sparecash-funnel></sparecash-funnel>`,
      }),
    );
    expect(prepared.htmlBefore).toContain(
      "www.youtube-nocookie.com/embed/abc123",
    );
    expect(prepared.htmlBefore).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation"',
    );
    expect(prepared.htmlBefore).not.toContain("example.com");
  });

  it("keeps presentation modes mutually exclusive", () => {
    const parsed = landingSchema.safeParse({
      title: "Compare personal loan options",
      description: "Review the terms and decide which next step works for you.",
      customLanding: { sourceId: "cmabcdefghijklmnopqrstuv" },
      design: {
        version: 1,
        root: "page",
        nodes: [
          { id: "page", type: "container", children: ["title", "form"] },
          { id: "title", type: "heading", level: 1, text: "Compare options" },
          { id: "form", type: "funnel" },
        ],
      },
    });
    expect(parsed.success).toBe(false);
  });
});
