import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  activityNotificationDelay,
  CustomLanding,
} from "../client/CustomLanding";
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
  it("delays activity notifications by a random 5 to 15 seconds", () => {
    expect(activityNotificationDelay(0)).toBe(5_000);
    expect(activityNotificationDelay(0.5)).toBe(10_000);
    expect(activityNotificationDelay(0.999999999)).toBe(15_000);
  });

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

  it("accepts a fully authored bound form and renders it without the legacy funnel", async () => {
    const prepared = await prepareCustomLandingSource({
      name: "Slider request",
      html: `<main><h1>Request funds</h1><form data-sc-form="lead"><label for="amount">Amount</label><output data-sc-output="amount" data-sc-format="currency"></output><input id="amount" type="range" data-sc-field="amount"><input type="text" data-sc-contact="name"><input type="tel" data-sc-contact="phone"><input type="email" data-sc-contact="email"><div data-sc-consent>Consent text and <a href="/terms">terms</a>.</div><p data-sc-errors role="alert"></p><button data-sc-action="submit">Check options</button></form></main>`,
      css: `main{min-height:100vh;padding:2rem}[data-sc-activity]{position:fixed;top:1rem;left:1rem;z-index:4}`,
    });
    expect(prepared.version).toBe(2);
    expect(prepared.htmlAfter).toBe("");
    expect(prepared.htmlBefore).toContain('type="range"');
    expect(prepared.htmlBefore).toContain('type="submit"');
    const html = renderToStaticMarkup(
      <CustomLanding
        source={{ ...prepared, name: "Slider request" }}
        form={{
          fields: [
            {
              id: "amount",
              valueType: "integer",
              required: true,
              min: 500,
              max: 50000,
              step: 500,
              defaultValue: 10000,
            },
          ],
          contacts: {
            name: "optional",
            phone: "required",
            email: "optional",
          },
        }}
        funnel={<section id="legacy-funnel">Legacy</section>}
      />,
    );
    expect(html).toContain('data-sc-form="lead"');
    expect(html).not.toContain("legacy-funnel");
  });

  it("keeps bound estimate and provider-search controls", async () => {
    const prepared = await prepareCustomLandingSource({
      name: "Animated request",
      html: `<main><div data-sc-form-view><h1>Request funds</h1><form data-sc-form="lead"><input type="range" data-sc-field="amount"><input type="range" data-sc-field="credit_score"><output data-sc-match-percent></output><span data-sc-match-strength></span><input type="email" data-sc-contact="email"><div data-sc-consent>Consent and terms apply.</div><p data-sc-errors></p><button data-sc-action="submit">Check options</button></form></div><section data-sc-provider-search hidden><strong data-sc-provider-count></strong><span data-sc-provider-status></span><span data-sc-provider-progress></span><button data-sc-action="continue">See my loan options</button></section></main>`,
    });
    expect(prepared.htmlBefore).toContain("data-sc-match-percent");
    expect(prepared.htmlBefore).toContain("data-sc-provider-search");
    expect(prepared.htmlBefore).toContain('data-sc-action="continue"');
  });
});
