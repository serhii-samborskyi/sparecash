import type { Request } from "express";
import { db } from "../db.js";
import { env } from "../config.js";
import { equal } from "../security.js";
import {
  timezoneSchema,
  validTimezone,
  sendingTimezone,
} from "../timezones.js";
import { settings } from "./control.js";

export function trustedIpTimezone(req: Pick<Request, "headers">) {
  const supplied = req.headers["x-sparecash-geo-token"];
  if (
    !env.CLOUDFLARE_GEO_TOKEN ||
    typeof supplied !== "string" ||
    !equal(supplied, env.CLOUDFLARE_GEO_TOKEN)
  )
    return undefined;
  const zone = req.headers["cf-timezone"];
  return validTimezone(zone) ? zone : undefined;
}

export async function updateLeadTimezone(
  id: string,
  value: unknown,
  actor: string,
) {
  const timezone = timezoneSchema.parse(value);
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id },
      data: { timezone, timezoneSource: "MANUAL" },
    });
    await tx.enrollment.updateMany({
      where: { status: "ACTIVE", subscription: { leadId: id } },
      data: { deferredUntil: null },
    });
    await tx.leadEvent.create({
      data: {
        leadId: id,
        type: "TIMEZONE",
        detail: `Time zone set to ${timezone} by ${actor}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actor,
        action: "lead.timezone_updated",
        entityId: id,
        details: { timezone },
      },
    });
    return lead;
  });
}

export async function leadTiming(lead: {
  timezone: string;
  timezoneSource: string;
}) {
  const config = await settings();
  return {
    timezone: sendingTimezone(lead, config),
    mode: config.followupTimezoneMode,
    startHour: config.sendHourStart,
    endHour: config.sendHourEnd,
  };
}
