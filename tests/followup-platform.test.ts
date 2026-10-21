import { describe, expect, it } from "vitest";
import { chainSchema } from "../server/domain";
import {
  normalizeEmailHtmlSource,
  renderEmailTemplate,
} from "../server/services/email-templates";
import { buildOfferDestination } from "../server/services/offers";

describe("follow-up platform", () => {
  it("builds an offer URL with durable application attribution", () => {
    const result = new URL(
      buildOfferDestination({
        offer: {
          provider: "CUSTOM",
          destinationUrl: "https://partner.example/apply?fixed=1",
          trackingParameter: "subId3",
        },
        applicationId: "application-id",
        campaign: "campaign-42",
        source: "zone-9",
        prepopulate: {
          firstName: " Alex ",
          email: "alex@example.com",
          homePhone: "+1 (312) 555-0100",
          rla: "15000",
        },
      }),
    );

    expect(Object.fromEntries(result.searchParams)).toMatchObject({
      fixed: "1",
      subId3: "application-id",
      subId: "campaign-42",
      subId2: "zone-9",
      firstName: "Alex",
      email: "alex@example.com",
      homePhone: "3125550100",
      rla: "15000",
    });
  });

  it("renders a styled email with escaped contact data and local opt-out links", () => {
    const rendered = renderEmailTemplate({
      template: {
        id: "template",
        name: "Template",
        status: "ACTIVE",
        subject: "Options for {{name}}",
        preheader: "Ready for {{name}}",
        eyebrow: "YOUR OPTIONS",
        headline: "A clear next step",
        body: "Hi {{name}}, your options are ready.",
        ctaLabel: "Review options",
        accentColor: "#1f5b4d",
        htmlSource: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      name: "<Alex>",
      link: "https://sparecash.fit/followup/token",
      unsubscribe: "https://sparecash.fit/preferences?token=private",
      businessName: "SpareCash",
      businessAddress: "Chicago, IL",
    });

    expect(rendered.subject).toBe("Options for <Alex>");
    expect(rendered.html).toContain("&lt;Alex&gt;");
    expect(rendered.html).toContain("Review options");
    expect(rendered.html).toContain("Manage preferences or unsubscribe");
    expect(rendered.html).not.toContain("{{");
  });

  it("allows only the first follow-up to send immediately", () => {
    const base = {
      name: "Immediate welcome",
      channel: "EMAIL" as const,
      steps: [
        {
          delayHours: 0,
          subject: "Your options",
          body: "Hi {{name}}, review your options here: {{link}}",
        },
      ],
    };
    expect(chainSchema.parse(base).steps[0].delayHours).toBe(0);
    expect(() =>
      chainSchema.parse({
        ...base,
        steps: [
          base.steps[0],
          { ...base.steps[0], delayHours: 0, subject: "Reminder" },
        ],
      }),
    ).toThrow("Later follow-ups must be at least 24 hours apart");
  });

  it("renders sanitized custom HTML with hosted artwork and tracked links", () => {
    const htmlSource = `<table role="presentation" width="100%"><tr><td><img src="https://sparecash.leadtechx.com/media/landing/email-hero.webp" alt="Calendar and cash"><h1>Hello {{name}}</h1><a href="{{link}}">See options</a></td></tr></table>`;
    const rendered = renderEmailTemplate({
      template: {
        id: "custom-template",
        name: "Custom",
        status: "ACTIVE",
        subject: "Options for {{name}}",
        preheader: "Your options are ready.",
        eyebrow: "OPTIONS",
        headline: "Options",
        body: "Hi {{name}}, review your options at {{link}}",
        ctaLabel: "See options",
        accentColor: "#1f5b4d",
        htmlSource,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      name: "Alex",
      link: "https://sparecash.fit/followup/tracked-token",
      unsubscribe: "https://sparecash.fit/preferences?token=private",
      businessName: "SpareCash",
      businessAddress: "Chicago, IL",
    });
    expect(rendered.html).toContain("Calendar and cash");
    expect(rendered.html).toContain("Hello Alex");
    expect(rendered.html).toContain(
      "https://sparecash.fit/followup/tracked-token",
    );
    expect(rendered.html).not.toContain("{{");
  });

  it("rejects custom email artwork from outside hosts", () => {
    expect(() =>
      normalizeEmailHtmlSource(
        '<img src="https://tracker.example/pixel.gif" alt="pixel"><a href="{{link}}">Continue</a>',
      ),
    ).toThrow("absolute URL returned by list_landing_assets");
  });
});
