import { describe, expect, it } from "vitest";
import { renderEmailTemplate } from "../server/services/email-templates";
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
});
