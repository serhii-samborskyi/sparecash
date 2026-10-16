import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  audienceSchema,
  pixelSchema,
  planSchema,
} from "../server/services/retargeting-config";
import {
  audienceEligible,
  type JourneyFacts,
} from "../server/services/retargeting";
import { deduplicateSales } from "../server/services/retargeting-report";

const audience = audienceSchema.parse({
  id: "11",
  name: "Quiz visitors",
  purpose: "REENGAGEMENT",
  enabled: true,
  enrollment: {
    type: "image",
    url: "https://my.rtmark.net/img.gif?f=on&lr=1&partner=123",
  },
  removal: {
    type: "image",
    url: "https://my.rtmark.net/img.gif?f=off&lr=1&partner=123",
  },
  qualifyingEvents: ["QUIZ_PARTICIPATED"],
  excludeOn: ["APPLICATION", "SUBSCRIBED", "PAID"],
});
const none: JourneyFacts = {
  quiz: false,
  completed: false,
  application: false,
  subscribed: false,
  paid: false,
  verifiedApplication: false,
  verifiedSubscription: false,
};
describe("retargeting contracts", () => {
  it("preserves modern sync image pixels and matching browser-removal tokens", () => {
    const partner = "6b081349".repeat(8);
    const url = `https://my.rtmark.net/img.gif?f=sync&lr=1&partner=${partner}`;
    const modern = audienceSchema.parse({
      ...audience,
      enrollment: { type: "image", url },
      removal: { type: "image", url: url.replace("f=sync", "f=off") },
    });
    expect(modern.enrollment.url).toBe(url);
    expect(modern.removal?.url).toBe(url.replace("f=sync", "f=off"));
    expect(
      audienceSchema.safeParse({ ...modern, enrollment: modern.removal })
        .success,
    ).toBe(false);
    expect(
      audienceSchema.safeParse({ ...modern, removal: modern.enrollment })
        .success,
    ).toBe(false);
    expect(
      audienceSchema.safeParse({
        ...modern,
        removal: {
          type: "image",
          url: `https://my.rtmark.net/img.gif?f=off&partner=${"ab".repeat(32)}`,
        },
      }).success,
    ).toBe(false);
    for (const invalid of [
      "a".repeat(63),
      "a".repeat(65),
      "g".repeat(64),
      "-123",
      "abc/def",
    ]) {
      expect(
        pixelSchema.safeParse({
          type: "image",
          url: `https://my.rtmark.net/img.gif?f=sync&partner=${invalid}`,
        }).success,
      ).toBe(false);
    }
    for (const invalid of [
      url.replace("f=sync", "f=unknown"),
      `${url}&email=test`,
      `${url}&partner=456`,
      url.replace("img.gif", "p.js"),
    ]) {
      expect(
        pixelSchema.safeParse({ type: "image", url: invalid }).success,
      ).toBe(false);
    }
  });
  it("distinguishes quiz participation, applications, confirmations and paid leads", () => {
    expect(audienceEligible(audience, none)).toBe(false);
    expect(audienceEligible(audience, { ...none, quiz: true })).toBe(true);
    for (const status of ["application", "subscribed", "paid"])
      expect(
        audienceEligible(audience, { ...none, quiz: true, [status]: true }),
      ).toBe(false);
    const applications = audienceSchema.parse({
      ...audience,
      qualifyingEvents: ["APPLICATION"],
      excludeOn: ["PAID"],
    });
    expect(audienceEligible(applications, { ...none, application: true })).toBe(
      false,
    );
    expect(
      audienceEligible(applications, {
        ...none,
        application: true,
        verifiedApplication: true,
      }),
    ).toBe(true);
    expect(
      audienceEligible(applications, {
        ...none,
        application: true,
        verifiedApplication: true,
        paid: true,
      }),
    ).toBe(false);
  });
  it("accepts exact image URLs and rejects scripts, arbitrary hosts and mismatched removal codes", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://evil.test/img.gif?f=on&partner=123",
      "https://my.rtmark.net/p.js?f=on&partner=123",
      "https://my.rtmark.net/img.gif?f=on&partner=123&email=test",
      "https://my.rtmark.net/img.gif?f=on&partner=123&partner=456",
      "http://my.rtmark.net/img.gif?f=on&partner=123",
    ])
      expect(pixelSchema.safeParse({ type: "image", url }).success).toBe(false);
    expect(
      audienceSchema.safeParse({
        ...audience,
        removal: {
          type: "image",
          url: "https://my.rtmark.net/img.gif?f=off&partner=456",
        },
      }).success,
    ).toBe(false);
    expect(
      audienceSchema.safeParse({ ...audience, qualifyingEvents: ["PAID"] })
        .success,
    ).toBe(false);
    expect(
      audienceSchema.parse({
        ...audience,
        sourceCampaignIds: ["12010687"],
      }).sourceCampaignIds,
    ).toEqual(["12010687"]);
    expect(
      audienceSchema.safeParse({
        ...audience,
        sourceCampaignIds: ["not-a-campaign"],
      }).success,
    ).toBe(false);
    expect(
      planSchema.safeParse({
        stages: [{ name: "Day three", audienceId: "11", delayDays: 3 }],
      }).success,
    ).toBe(false);
  });
  it("counts the earliest SOLD once per application, with decimal-safe commission", () => {
    const p = (
      id: string,
      applicationId: string,
      event: string,
      revenue: string,
      time: number,
    ) => ({
      id,
      applicationId,
      event,
      revenue: new Prisma.Decimal(revenue),
      createdAt: new Date(time),
    });
    expect(
      deduplicateSales([
        p("retry", "a", "SOLD", "9", 3),
        p("first", "a", "SOLD", "0.1", 1),
        p("funded", "a", "FUNDED", "10", 4),
        p("b", "b", "SOLD", "0.2", 2),
      ]),
    ).toEqual({ paidLeads: 2, commission: 0.3, repeatedSaleEvents: 1 });
  });
});
