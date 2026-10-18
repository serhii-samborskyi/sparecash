import type { NextFunction, Request, Response } from "express";
import { env } from "../config.js";
import { ipHash, token, verifyToken } from "../security.js";
import { db } from "../db.js";
import { propellerVisitAttribution } from "../../shared/propeller-attribution.js";
import {
  lookupIpLocation,
  requestIpAddress,
  trustedVisitLocation,
} from "./visit-context.js";

const HIT_COOKIE = "sc_landing_hit";
const digits = (value?: string) =>
  value && /^\d{1,30}$/.test(value) ? value : null;
const bounded = (value?: string, max = 200) =>
  value ? value.slice(0, max) : null;

export async function recordLandingHit(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const slug = String(req.params.slug ?? "").slice(0, 70);
  const query = req.originalUrl.includes("?")
    ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
    : "";
  const attribution = propellerVisitAttribution(query);
  const ipAddress = requestIpAddress(req);
  const location = trustedVisitLocation(req);
  const hit = await db.landingHit.create({
    data: {
      slug,
      campaignId: digits(attribution.campaignId),
      zoneId: digits(attribution.zoneId),
      externalClickId: bounded(attribution.clickId),
      userAgent: bounded(req.headers["user-agent"], 500) ?? "",
      ipAddress,
      ipHash: ipHash(ipAddress || "unknown"),
      ...location,
    },
  });
  res.cookie(HIT_COOKIE, token("landing-hit", hit.id, 600), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600_000,
    path: "/",
  });
  next();
  if (!location.country)
    void lookupIpLocation(ipAddress)
      .then(async (resolved) => {
        if (!resolved) return;
        const updated = await db.landingHit.update({
          where: { id: hit.id },
          data: resolved,
          select: { visitId: true },
        });
        if (updated.visitId)
          await db.visit.updateMany({
            where: { id: updated.visitId, country: null },
            data: resolved,
          });
      })
      .catch(() => undefined);
}

export async function attachLandingHit(
  req: Request,
  res: Response,
  input: {
    slug: string;
    campaignId?: string;
    zoneId?: string;
    clickId?: string;
  },
  visitId: string,
) {
  const id = verifyToken(String(req.cookies[HIT_COOKIE] ?? ""), "landing-hit");
  if (!id) return;
  const hit = await db.landingHit.findUnique({ where: { id } });
  if (
    hit &&
    !hit.visitId &&
    hit.slug === input.slug &&
    hit.campaignId === digits(input.campaignId) &&
    hit.zoneId === digits(input.zoneId) &&
    hit.externalClickId === bounded(input.clickId)
  ) {
    await db.landingHit.update({
      where: { id },
      data: { visitId },
    });
    if (hit.country)
      await db.visit.updateMany({
        where: { id: visitId, country: null },
        data: {
          country: hit.country,
          region: hit.region,
          city: hit.city,
          geoSource: hit.geoSource,
        },
      });
  }
  res.clearCookie(HIT_COOKIE, { path: "/" });
}
