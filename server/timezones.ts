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

const dateParts = (value: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
};

export function dateInTimezone(value: Date, timezone: string) {
  const { year, month, day } = dateParts(value, timezone);
  return `${year}-${month}-${day}`;
}

export function statisticsTimezone(
  workspaceTimezone: string,
  requestedThrough: string | undefined,
  now = new Date(),
) {
  const workspaceToday = dateInTimezone(now, workspaceTimezone);
  const utcToday = dateInTimezone(now, "UTC");
  // An admin tab opened before the timezone rollout can still submit its UTC
  // "Today" until it reloads. Keep that tab usable without weakening normal
  // future-date validation for the current client.
  return requestedThrough === utcToday && utcToday > workspaceToday
    ? "UTC"
    : workspaceTimezone;
}

export function addCalendarDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount))
    .toISOString()
    .slice(0, 10);
}

function offsetMinutesAt(value: Date, timezone: string) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!name || name === "GMT") return 0;
  const match = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Unable to read the offset for ${timezone}`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

export function startOfDayInTimezone(value: string, timezone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const localMidnight = Date.UTC(year, month - 1, day);
  let instant = localMidnight;
  // Re-read the offset at the resulting instant so DST boundary days resolve
  // against the offset in force at local midnight.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next =
      localMidnight - offsetMinutesAt(new Date(instant), timezone) * 60_000;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function timezoneOffsetForDay(value: string, timezone: string) {
  const start = startOfDayInTimezone(value, timezone);
  const end = startOfDayInTimezone(addCalendarDays(value, 1), timezone);
  const middle = new Date((start.getTime() + end.getTime()) / 2);
  const minutes = offsetMinutesAt(middle, timezone);
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`;
}
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
