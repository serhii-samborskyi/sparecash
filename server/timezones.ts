import { z } from "zod";

export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  // Require a named zone, not a fixed offset or a locale-dependent abbreviation.
  if (value !== "UTC" && !value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export const timezoneSchema = z
  .string()
  .max(80)
  .refine(validTimezone, "Choose a valid IANA time zone");
export type TimingSettings = {
  workspaceTimezone: string;
  followupTimezoneMode: "RECIPIENT" | "WORKSPACE";
  timezoneDetection: "BROWSER_FIRST" | "IP_FIRST";
};
export function detectTimezone(
  browser: unknown,
  ip: unknown,
  config: TimingSettings,
) {
  const candidates =
    config.timezoneDetection === "IP_FIRST"
      ? ([
          [ip, "IP"],
          [browser, "BROWSER"],
        ] as const)
      : ([
          [browser, "BROWSER"],
          [ip, "IP"],
        ] as const);
  for (const [timezone, timezoneSource] of candidates)
    if (validTimezone(timezone)) return { timezone, timezoneSource };
  return {
    timezone: config.workspaceTimezone,
    timezoneSource: "DEFAULT" as const,
  };
}
export function sendingTimezone(
  lead: { timezone: string; timezoneSource?: string },
  config: TimingSettings,
) {
  if (
    config.followupTimezoneMode === "WORKSPACE" ||
    lead.timezoneSource === "DEFAULT" ||
    !validTimezone(lead.timezone)
  )
    return config.workspaceTimezone;
  return lead.timezone;
}
export function withinSendingHours(
  timezone: string,
  start: number,
  end: number,
  now = new Date(),
) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= start && hour < end;
}
export function nextSendingTime(
  timezone: string,
  start: number,
  end: number,
  earliest: Date,
) {
  if (withinSendingHours(timezone, start, end, earliest)) return earliest;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  });
  // Search real UTC instants so DST gaps, repeated hours and fractional offsets work.
  const firstMinute = Math.ceil(earliest.getTime() / 60000) * 60000;
  for (let minute = 0; minute <= 48 * 60; minute++) {
    const candidate = new Date(firstMinute + minute * 60000);
    const hour = Number(formatter.format(candidate));
    if (hour >= start && hour < end) return candidate;
  }
  throw new Error("Unable to find the next sending window");
}
