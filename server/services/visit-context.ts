import type { Request } from "express";
import { env } from "../config.js";
import { equal } from "../security.js";

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
