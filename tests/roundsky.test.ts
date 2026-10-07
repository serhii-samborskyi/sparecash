import { describe, expect, it } from "vitest";
import {
  ROUND_SKY_OFFER_URL,
  SPARECASH_PRODUCTION_ORIGIN,
  buildRoundSkyUrl,
  buildRoundSkyPixelUrl,
  normalizeRoundSkySale,
} from "../server/roundsky-contract";
import { settingsSchema } from "../server/domain";
const applicationId = "6148cb1d-37ad-458f-8bb4-96db422a98fa";
const base = {
  baseUrl: ROUND_SKY_OFFER_URL,
  applicationId,
  campaign: "123",
  source: "456",
};

describe("RoundSky account contract", () => {
  it("preserves the affiliate ID and puts the HID exclusively in subId3", () => {
    const url = new URL(buildRoundSkyUrl(base));
    expect(url.origin + url.pathname).toBe(
      "https://www.rnd3.com/ai/iframeRedirect.php",
    );
    expect(url.searchParams.get("id")).toBe(
      "uNpHH775b5c1ktyvjMVrDnuzC0JzlijEhOZZAtcoWN0.",
    );
    expect(url.searchParams.get("subId")).toBe("123");
    expect(url.searchParams.get("subId2")).toBe("456");
    expect(url.searchParams.get("subId3")).toBe(applicationId);
    expect(
      [...url.searchParams.values()].filter((v) => v === applicationId),
    ).toHaveLength(1);
  });
  it("replaces copied placeholders and case aliases without forwarding stale personal data", () => {
    const url = new URL(
      buildRoundSkyUrl({
        ...base,
        baseUrl: `${ROUND_SKY_OFFER_URL}&subID=old&subId2=[SUB_ID2_VALUE]&subid3=old-hid&subId3=[clickId]&firstName=[firstName]&email=old@example.com&rla=2500`,
      }),
    );
    expect(
      [...url.searchParams.keys()].filter((k) => k.toLowerCase() === "subid3"),
    ).toEqual(["subId3"]);
    expect(url.searchParams.has("email")).toBe(false);
    expect(url.searchParams.has("firstName")).toBe(false);
    expect(url.searchParams.has("rla")).toBe(false);
    expect(decodeURIComponent(url.toString())).not.toContain("[");
  });
  it("encodes supplied prefill values and respects RoundSky field limits", () => {
    const url = new URL(
      buildRoundSkyUrl({
        ...base,
        prepopulate: {
          firstName: "  " + "A".repeat(35),
          lastName: "O'Neil & Sons",
          email: "person+loans@example.com",
          address: "123 " + "B".repeat(180),
          zip: "01234",
          homePhone: "+1 (312) 555-0100",
          rla: "2500",
        },
      }),
    );
    expect(url.searchParams.get("firstName")).toHaveLength(30);
    expect(url.searchParams.get("lastName")).toBe("O'Neil & Sons");
    expect(url.searchParams.get("email")).toBe("person+loans@example.com");
    expect(url.searchParams.get("address")).toHaveLength(150);
    expect(url.searchParams.get("homePhone")).toBe("3125550100");
    expect(url.searchParams.get("zip")).toBe("01234");
    expect(url.searchParams.get("rla")).toBe("2500");
    expect(url.toString()).toContain("person%2Bloans%40example.com");
  });
  it("omits invalid prefill values instead of inventing a loan amount or truncating an email", () => {
    const url = new URL(
      buildRoundSkyUrl({
        ...base,
        prepopulate: {
          email: `${"a".repeat(64)}@${"b".repeat(40)}.com`,
          homePhone: "+44 20 1234 5678",
          zip: "123456",
          rla: "$1,000–$2,500",
        },
      }),
    );
    for (const key of ["email", "homePhone", "zip", "rla"])
      expect(url.searchParams.has(key)).toBe(false);
  });
  it("generates an HTTPS S2S template with unescaped provider macros", () => {
    const value = buildRoundSkyPixelUrl(
      SPARECASH_PRODUCTION_ORIGIN,
      "test-only-secret",
    );
    expect(value).toBe(
      "https://sparecash.leadtechx.com/api/webhooks/roundsky/sold?token=test-only-secret&hid=[subId3]&price=[price]&transactionId=[transactionId]",
    );
    expect(() => buildRoundSkyPixelUrl("http://example.com", "secret")).toThrow(
      "HTTPS",
    );
  });
  it("maps a sold-lead pixel to sale revenue and a stable transaction key", () => {
    expect(
      normalizeRoundSkySale({
        hid: applicationId,
        price: "5.0000",
        transactionId: "8454843145",
        event: "FUNDED",
      }),
    ).toEqual({
      eventId: "roundsky:sold:8454843145",
      applicationId,
      event: "SOLD",
      revenue: "5.0000",
    });
  });
  it.each([
    "",
    "-1.00",
    "NaN",
    "Infinity",
    "1e3",
    "5.00001",
    "100001",
    "[price]",
  ])("rejects an invalid price: %s", (price) => {
    expect(() =>
      normalizeRoundSkySale({
        hid: applicationId,
        price,
        transactionId: "123",
      }),
    ).toThrow();
  });
  it("rejects unresolved HID and transaction macros", () => {
    expect(() =>
      normalizeRoundSkySale({
        hid: "[subId3]",
        price: "5.00",
        transactionId: "123",
      }),
    ).toThrow();
    expect(() =>
      normalizeRoundSkySale({
        hid: applicationId,
        price: "5.00",
        transactionId: "[transactionId]",
      }),
    ).toThrow();
    expect(() =>
      normalizeRoundSkySale({
        hid: applicationId,
        price: "5.00",
        transactionId: "",
      }),
    ).toThrow();
  });
  it("defaults to the configured offer, required HID field, and sold-lead stop event", () => {
    const config = settingsSchema.parse({});
    expect(config.roundskyUrl).toBe(ROUND_SKY_OFFER_URL);
    expect(config.roundskySubIdParameter).toBe("subId3");
    expect(config.stopOn).toBe("SOLD");
    expect(
      settingsSchema.safeParse({ roundskySubIdParameter: "subId" }).success,
    ).toBe(false);
  });
});
