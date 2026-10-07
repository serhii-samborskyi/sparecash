import { describe, expect, it } from "vitest";
import { settingsSchema } from "../server/domain";
import {
  detectTimezone,
  sendingTimezone,
  nextSendingTime,
  withinSendingHours,
  validTimezone,
} from "../server/timezones";

describe("time zone selection and sending windows", () => {
  const settings = settingsSchema.parse({});
  it("prefers browser detection by default and supports IP priority", () => {
    expect(
      detectTimezone("America/Phoenix", "America/New_York", settings),
    ).toEqual({ timezone: "America/Phoenix", timezoneSource: "BROWSER" });
    expect(
      detectTimezone("America/Phoenix", "America/New_York", {
        ...settings,
        timezoneDetection: "IP_FIRST",
      }),
    ).toEqual({ timezone: "America/New_York", timezoneSource: "IP" });
  });
  it("falls back when detection is missing or invalid", () => {
    expect(
      detectTimezone("Mars/Crater", "America/Chicago", settings).timezoneSource,
    ).toBe("IP");
    expect(detectTimezone(undefined, "invalid", settings)).toEqual({
      timezone: "America/Chicago",
      timezoneSource: "DEFAULT",
    });
    expect(
      detectTimezone("America/Denver", undefined, {
        ...settings,
        timezoneDetection: "IP_FIRST",
      }).timezoneSource,
    ).toBe("BROWSER");
  });
  it("uses overrides in recipient mode and the chosen zone in workspace mode", () => {
    const lead = { timezone: "Pacific/Honolulu", timezoneSource: "MANUAL" };
    expect(sendingTimezone(lead, settings)).toBe("Pacific/Honolulu");
    expect(
      sendingTimezone(lead, { ...settings, followupTimezoneMode: "WORKSPACE" }),
    ).toBe("America/Chicago");
    expect(
      sendingTimezone({ timezone: "UTC", timezoneSource: "DEFAULT" }, settings),
    ).toBe("America/Chicago");
    expect(sendingTimezone({ timezone: "bad" }, settings)).toBe(
      "America/Chicago",
    );
  });
  it("rejects invalid owner settings and ambiguous offsets", () => {
    expect(validTimezone("-06:00")).toBe(false);
    expect(validTimezone("CST")).toBe(false);
    expect(validTimezone("America/New_York")).toBe(true);
    expect(
      settingsSchema.safeParse({ workspaceTimezone: "Mars/Base" }).success,
    ).toBe(false);
  });
  it("keeps 10am local through spring daylight saving", () => {
    expect(
      nextSendingTime(
        "America/New_York",
        10,
        18,
        new Date("2026-03-07T23:00:00Z"),
      ).toISOString(),
    ).toBe("2026-03-08T14:00:00.000Z");
    expect(
      withinSendingHours(
        "America/New_York",
        10,
        18,
        new Date("2026-03-08T13:59:59Z"),
      ),
    ).toBe(false);
  });
  it("keeps 10am local through fall daylight saving", () => {
    expect(
      nextSendingTime(
        "America/New_York",
        10,
        18,
        new Date("2026-10-31T23:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-01T15:00:00.000Z");
  });
  it("handles non-DST zones and fractional offsets", () => {
    expect(
      nextSendingTime(
        "America/Phoenix",
        10,
        18,
        new Date("2026-03-08T12:00:00Z"),
      ).toISOString(),
    ).toBe("2026-03-08T17:00:00.000Z");
    expect(
      nextSendingTime(
        "Asia/Kathmandu",
        10,
        18,
        new Date("2026-10-07T01:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-07T04:15:00.000Z");
  });
  it("preserves the 24-hour cap when a DST day is only 23 hours", () => {
    const previous = new Date("2026-03-07T15:00:00Z");
    const earliest = new Date(previous.getTime() + 86400000);
    expect(
      nextSendingTime("America/New_York", 10, 18, earliest).toISOString(),
    ).toBe("2026-03-08T15:00:00.000Z");
  });
  it("treats the window end as exclusive", () => {
    const end = new Date("2026-10-07T23:00:00Z");
    expect(withinSendingHours("America/Chicago", 10, 18, end)).toBe(false);
    expect(nextSendingTime("America/Chicago", 10, 18, end).toISOString()).toBe(
      "2026-10-08T15:00:00.000Z",
    );
  });
});
