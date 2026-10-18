import type { Request } from "express";
import { isIP } from "node:net";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../config.js";
import { equal, ipHash } from "../security.js";

type VisitLocation = {
  country: string;
  region: string | null;
  city: string | null;
  geoSource: string;
};

const lookupResponse = z
  .object({
    error: z.boolean().optional(),
    city: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    country_code: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  })
  .passthrough();
const inFlight = new Map<string, Promise<VisitLocation | null>>();
const clean = (value: string | null | undefined, max = 100) => {
  const text = value?.trim();
  return text && text.length <= max && !/[\x00-\x1f\x7f]/.test(text)
    ? text
    : null;
};

export function requestIpAddress(req: Pick<Request, "ip">) {
  const supplied = String(req.ip ?? "").trim();
  const mapped = supplied.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const address = mapped ?? supplied;
  return isIP(address) ? address : "";
}

function publicIp(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return !(
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("2001:db8:")
    );
  }
  return false;
}

function cachedLocation(value: {
  country: string | null;
  region: string | null;
  city: string | null;
  source: string;
}): VisitLocation | null {
  return value.country
    ? {
        country: value.country,
        region: value.region,
        city: value.city,
        geoSource: value.source,
      }
    : null;
}

export async function lookupIpLocation(
  ipAddress: string,
): Promise<VisitLocation | null> {
  if (!publicIp(ipAddress)) return null;
  const key = ipHash(ipAddress);
  const cached = await db.ipLocationCache.findUnique({
    where: { ipHash: key },
  });
  if (cached && cached.expiresAt > new Date()) return cachedLocation(cached);
  const running = inFlight.get(key);
  if (running) return running;
  const lookup = (async () => {
    let location: VisitLocation | null = null;
    let timezone: string | null = null;
    try {
      const response = await fetch(
        `https://ipapi.co/${encodeURIComponent(ipAddress)}/json/`,
        {
          headers: { "User-Agent": "SpareCash/1.0" },
          signal: AbortSignal.timeout(2500),
        },
      );
      if (response.ok) {
        const data = lookupResponse.parse(await response.json());
        const country = clean(data.country_code ?? data.country)?.toUpperCase();
        if (!data.error && country && /^[A-Z]{2}$/.test(country)) {
          location = {
            country,
            region: clean(data.region),
            city: clean(data.city),
            geoSource: "IPAPI",
          };
          timezone = clean(data.timezone);
        }
      }
    } catch {
      // The landing remains usable when the optional location provider fails.
    }
    await db.ipLocationCache.upsert({
      where: { ipHash: key },
      create: {
        ipHash: key,
        country: location?.country,
        region: location?.region,
        city: location?.city,
        timezone,
        source: location?.geoSource ?? "IPAPI_UNAVAILABLE",
        expiresAt: new Date(
          Date.now() + (location ? 30 * 86400000 : 60 * 60000),
        ),
      },
      update: {
        country: location?.country,
        region: location?.region,
        city: location?.city,
        timezone,
        source: location?.geoSource ?? "IPAPI_UNAVAILABLE",
        expiresAt: new Date(
          Date.now() + (location ? 30 * 86400000 : 60 * 60000),
        ),
      },
    });
    return location;
  })();
  inFlight.set(key, lookup);
  try {
    return await lookup;
  } finally {
    inFlight.delete(key);
  }
}

export function trustedVisitLocation(req: Pick<Request, "headers">) {
  const supplied = req.headers["x-sparecash-geo-token"];
  if (
    !env.CLOUDFLARE_GEO_TOKEN ||
    typeof supplied !== "string" ||
    !equal(supplied, env.CLOUDFLARE_GEO_TOKEN)
  )
    return {};
  const text = (name: string) => {
    const value = req.headers[name];
    if (typeof value !== "string") return null;
    const clean = value.trim();
    return clean && clean.length <= 100 && !/[\x00-\x1f\x7f]/.test(clean)
      ? clean
      : null;
  };
  const code = text("cf-ipcountry")?.toUpperCase();
  const country =
    code && /^[A-Z]{2}$/.test(code) && !["XX", "T1"].includes(code)
      ? code
      : null;
  if (!country) return {};
  return {
    country,
    region: text("cf-region"),
    city: text("cf-ipcity"),
    geoSource: "TRUSTED_EDGE",
  };
}

// Coarse reporting categories from the UA already stored with each visit.
// These are client claims, never identity or bot-verification evidence.
export function browserContext(ua: string) {
  const os = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /macintosh|mac os x/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "Unknown";
  const browser = /edg(?:e|a|ios)?\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /samsungbrowser/i.test(ua)
        ? "Samsung Internet"
        : /firefox\/|fxios\//i.test(ua)
          ? "Firefox"
          : /chrome\/|crios\//i.test(ua)
            ? "Chrome"
            : /safari\//i.test(ua)
              ? "Safari"
              : "Unknown";
  const device = /ipad|tablet|android(?!.*mobile)/i.test(ua)
    ? "Tablet"
    : /mobile|iphone|ipod/i.test(ua)
      ? "Mobile"
      : browser !== "Unknown"
        ? "Desktop"
        : "Unknown";
  return { device, browser, os };
}
