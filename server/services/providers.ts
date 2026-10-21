import type { Subscription, Delivery } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";
import { token } from "../security.js";
import { escapeHtml } from "../domain.js";
import { settings } from "./control.js";
import { renderEmailTemplate } from "./email-templates.js";

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
  ) {
    super(`${provider} request failed (HTTP ${status}); check provider logs`);
  }
}
async function request(
  provider: string,
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
  timeoutMs = 20000,
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error(
      `${provider} did not confirm the request; delivery outcome is unknown`,
    );
  }
  if (!response.ok) throw new ProviderError(provider, response.status);
  const content = await response.text();
  return content ? JSON.parse(content) : {};
}
async function requestMultipart(
  provider: string,
  url: string,
  body: FormData,
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(120000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      `${provider} did not confirm the attachment; delivery outcome is unknown`,
    );
  }
  if (!response.ok) throw new ProviderError(provider, response.status);
  const content = await response.text();
  return content ? JSON.parse(content) : {};
}
const brevo = (path: string, body: unknown, method = "POST") =>
  request(
    "Brevo",
    `https://api.brevo.com/v3${path}`,
    method,
    { "api-key": env.BREVO_API_KEY },
    body,
  );
const one = (path: string, body?: unknown, method = "POST") =>
  request(
    "OneSignal",
    `https://api.onesignal.com${path}`,
    method,
    { Authorization: `Key ${env.ONESIGNAL_API_KEY}` },
    body,
  );
export type BlueBubblesService = "SMS" | "iMessage";

export function selectBlueBubblesService(
  preferred: BlueBubblesService,
  visit?: { adContext: unknown; userAgent: string } | null,
): BlueBubblesService {
  if (preferred === "SMS") return "SMS";
  const context =
    visit?.adContext && typeof visit.adContext === "object"
      ? (visit.adContext as Record<string, unknown>)
      : {};
  const os = typeof context.os === "string" ? context.os : "";
  const device = typeof context.device === "string" ? context.device : "";
  const fingerprint = `${os} ${device} ${visit?.userAgent ?? ""}`.toLowerCase();
  return /(?:iphone|ipad|ipod|\bios\b|macintosh|\bmac ?os\b)/.test(fingerprint)
    ? "iMessage"
    : "SMS";
}

async function serviceForSubscription(
  sub: Subscription,
): Promise<BlueBubblesService> {
  const lead = await db.lead.findUnique({
    where: { id: sub.leadId },
    select: {
      visit: { select: { adContext: true, userAgent: true } },
    },
  });
  return selectBlueBubblesService(env.BLUEBUBBLES_SERVICE, lead?.visit);
}

export async function sendText(
  phone: string,
  message: string,
  id: string,
  service: BlueBubblesService = env.BLUEBUBBLES_SERVICE,
) {
  if (!env.BLUEBUBBLES_URL || !env.BLUEBUBBLES_PASSWORD)
    throw new Error("BlueBubbles is not configured");
  const url = new URL("/api/v1/message/text", env.BLUEBUBBLES_URL);
  url.searchParams.set("password", env.BLUEBUBBLES_PASSWORD);
  const result = await request(
    "BlueBubbles",
    url.toString(),
    "POST",
    {},
    {
      chatGuid: `${service};-;${phone}`,
      message,
      tempGuid: id,
      method: "apple-script",
    },
    60000,
  );
  const guid = result.data?.guid ?? result.data?.messageGuid;
  if (result.status !== 200 || typeof guid !== "string" || !guid)
    throw new Error(
      "BlueBubbles did not confirm a message ID; check Messages on the Mac before retrying",
    );
  return guid as string;
}
export async function sendAttachment(
  phone: string,
  asset: { data: Uint8Array; mimeType: string; fileName: string },
  service: BlueBubblesService = env.BLUEBUBBLES_SERVICE,
) {
  if (!env.BLUEBUBBLES_URL || !env.BLUEBUBBLES_PASSWORD)
    throw new Error("BlueBubbles is not configured");
  const chatGuid = `${service};-;${phone}`;
  const url = new URL("/api/v1/message/attachment", env.BLUEBUBBLES_URL);
  url.searchParams.set("password", env.BLUEBUBBLES_PASSWORD);
  // Keep the GUID in the query because some BlueBubbles multipart parsers
  // truncate semicolon-delimited chat GUIDs in form fields.
  url.searchParams.set("chatGuid", chatGuid);
  url.searchParams.set("method", "apple-script");
  const form = new FormData();
  form.append(
    "attachment",
    new Blob([Buffer.from(asset.data)], { type: asset.mimeType }),
    asset.fileName,
  );
  const result = await requestMultipart("BlueBubbles", url.toString(), form);
  const guid = result.data?.guid ?? result.data?.messageGuid;
  if (result.status !== 200 || typeof guid !== "string" || !guid)
    throw new Error(
      "BlueBubbles did not confirm an attachment message ID; check the Mac before retrying",
    );
  return guid as string;
}
export async function sendVerification(sub: Subscription, code: string) {
  if (env.LIVE_DELIVERY !== "true") return { paused: true };
  let providerId: string | undefined;
  if (sub.channel === "EMAIL") {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)
      throw new Error("Brevo is not configured");
    const link = `${env.APP_URL}/confirm?token=${encodeURIComponent(token("confirm", sub.id, 86400))}`;
    const result = await brevo("/smtp/email", {
      sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },
      to: [{ email: sub.address }],
      subject: "Confirm your SpareCash email subscription",
      htmlContent: `<p>You requested email updates from SpareCash.</p><p>Your updates are active. You can optionally <a href="${escapeHtml(link)}">verify your email address</a>.</p><p>If you did not request this, use the preference link in any update to unsubscribe.</p>`,
    });
    if (typeof result.messageId !== "string" || !result.messageId)
      throw new Error(
        "Brevo did not confirm a message ID; check Brevo logs before retrying",
      );
    providerId = result.messageId;
  } else if (sub.channel === "SMS") {
    const service = await serviceForSubscription(sub);
    providerId = await sendText(
      sub.address,
      `Your SpareCash optional verification code is ${code}. It expires in 10 minutes. Updates are already active. Reply STOP to opt out.`,
      sub.id,
      service,
    );
  }
  return { paused: false, providerId };
}
export async function verifyPush(subscriptionId: string, externalId: string) {
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY)
    throw new Error("OneSignal is not configured");
  let result;
  try {
    result = await one(
      `/apps/${env.ONESIGNAL_APP_ID}/users/by/external_id/${encodeURIComponent(externalId)}`,
      undefined,
      "GET",
    );
  } catch (error) {
    // The SDK may still be syncing login() and the new subscription.
    if (error instanceof ProviderError && error.status === 404) return false;
    throw error;
  }
  return (
    Array.isArray(result.subscriptions) &&
    result.subscriptions.some(
      (s: any) => s.id === subscriptionId && s.enabled === true,
    )
  );
}
export async function deliver(
  sub: Subscription,
  message: Delivery,
  link: string,
) {
  const unsubscribe = `${env.APP_URL}/preferences?token=${encodeURIComponent(token("preferences", sub.id, 86400 * 365))}`;
  if (sub.channel === "PUSH") {
    if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY)
      throw new Error("OneSignal is not configured");
    const r = await one("/notifications", {
      app_id: env.ONESIGNAL_APP_ID,
      include_subscription_ids: [sub.address],
      headings: { en: message.subject },
      contents: { en: message.body },
      url: link,
      idempotency_key: message.id,
    });
    if (!r.id) throw new Error("OneSignal returned no message ID");
    return String(r.id);
  }
  if (sub.channel === "SMS") {
    const service = await serviceForSubscription(sub);
    if (message.mediaAssetId) {
      const asset = await db.messageAsset.findUniqueOrThrow({
        where: { id: message.mediaAssetId },
      });
      await sendAttachment(sub.address, asset, service);
    }
    return sendText(
      sub.address,
      `${message.body}\n${message.body.includes(link) ? "" : link + "\n"}Reply STOP to opt out.`,
      message.id,
      service,
    );
  }
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)
    throw new Error("Brevo email delivery is not configured");
  const config = await settings();
  if (!config.businessAddress)
    throw new Error(
      "Set the business mailing address before sending follow-up emails",
    );
  const [template, subscription] = await Promise.all([
    message.emailTemplateId
      ? db.emailTemplate.findUnique({ where: { id: message.emailTemplateId } })
      : null,
    db.subscription.findUniqueOrThrow({
      where: { id: sub.id },
      include: { lead: true },
    }),
  ]);
  const rendered = template
    ? renderEmailTemplate({
        template,
        name: subscription.lead.name,
        link,
        unsubscribe,
        businessName: config.businessName,
        businessAddress: config.businessAddress,
      })
    : {
        subject: message.subject,
        body: message.body,
        html: `<html><body><p>${escapeHtml(message.body).replaceAll("\n", "<br>")}</p><p><a href="${escapeHtml(link)}">Explore loan options</a></p><hr><p>${escapeHtml(config.businessName)} · ${escapeHtml(config.businessAddress)}</p><p><a href="${escapeHtml(unsubscribe)}">Manage your preferences</a></p></body></html>`,
      };
  await db.delivery.update({
    where: { id: message.id },
    data: {
      subject: rendered.subject,
      body: rendered.body,
      htmlBody: rendered.html,
    },
  });
  const result = await brevo("/smtp/email", {
    sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },
    to: [{ email: sub.address }],
    subject: rendered.subject,
    htmlContent: rendered.html,
    textContent: `${rendered.body}\n\n${link}\n\nManage preferences: ${unsubscribe}`,
    tags: ["sparecash-followup"],
    headers: { "X-Mailin-custom": `delivery:${message.id}` },
  });
  if (typeof result.messageId !== "string" || !result.messageId)
    throw new Error("Brevo returned no message ID");
  return result.messageId;
}
export async function excludeZone(campaignId: string, zoneId: string) {
  if (!/^\d+$/.test(campaignId) || !/^\d+$/.test(zoneId))
    throw new Error("PropellerAds campaign and zone IDs must be numeric");
  if (!env.PROPELLER_API_TOKEN)
    throw new Error("PropellerAds is not configured");
  return request(
    "PropellerAds",
    `${env.PROPELLER_API_URL}/adv/campaigns/${campaignId}/targeting/exclude/zone`,
    "PATCH",
    { Authorization: `Bearer ${env.PROPELLER_API_TOKEN}` },
    { zone: [zoneId] },
  );
}

// These owner-initiated tests deliberately work while automated delivery is paused.
export async function sendDeliveryTest(
  provider: "onesignal" | "brevo" | "bluebubbles",
  recipient: string,
  requestId: string,
  emailKind: "confirmation" | "followup",
) {
  const body =
    "This is a test message requested by the SpareCash owner. No loan application or subscription was created.";
  if (provider === "bluebubbles") return sendText(recipient, body, requestId);
  if (provider === "onesignal") {
    if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY)
      throw new Error("OneSignal is not configured");
    const result = await one("/notifications", {
      app_id: env.ONESIGNAL_APP_ID,
      include_subscription_ids: [recipient],
      headings: { en: "SpareCash delivery test" },
      contents: { en: body },
      url: env.APP_URL,
      idempotency_key: requestId,
    });
    if (typeof result.id !== "string" || !result.id)
      throw new Error(
        "OneSignal did not accept a notification. Check that the subscription is active and belongs to this app.",
      );
    return result.id;
  }
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)
    throw new Error("Brevo is not configured");
  const sender = { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL };
  const config = emailKind === "followup" ? await settings() : null;
  if (config && !config.businessAddress.trim())
    throw new Error(
      "Set your business mailing address before testing follow-up email",
    );
  const subject =
    emailKind === "followup"
      ? "SpareCash follow-up delivery test"
      : "SpareCash confirmation delivery test";
  const htmlContent = config
    ? `<!doctype html><html><body style="margin:0;background:#f2f5ef;font-family:Arial,sans-serif;color:#203d34"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5ef;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dce5d9;border-radius:24px"><tr><td style="height:10px;background:#245f52"></td></tr><tr><td style="padding:38px"><div style="font-size:12px;letter-spacing:2px;font-weight:700;color:#245f52;margin-bottom:14px">FOLLOW-UP TEST</div><h1 style="font-size:32px;line-height:1.1;margin:0 0 18px;color:#173b31">Your email design is ready</h1><p style="font-size:17px;line-height:1.6;color:#486158">${escapeHtml(body)}</p><p style="margin:28px 0"><a href="${escapeHtml(env.APP_URL)}" style="display:inline-block;background:#245f52;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">Open SpareCash</a></p><p style="font-size:12px;line-height:1.5;color:#74847d">${escapeHtml(config.businessName)} · ${escapeHtml(config.businessAddress)}</p></td></tr></table></td></tr></table></body></html>`
    : `<p>${escapeHtml(body)}</p>`;
  const result = await brevo("/smtp/email", {
    sender,
    to: [{ email: recipient }],
    subject,
    htmlContent,
    textContent: body,
    tags: [
      emailKind === "followup"
        ? "sparecash-followup-test"
        : "sparecash-confirmation-test",
    ],
    headers: { "X-Mailin-custom": `test:${requestId}` },
  });
  if (typeof result.messageId !== "string" || !result.messageId)
    throw new Error(
      "Brevo did not confirm a message ID; check Brevo logs before retrying",
    );
  return result.messageId;
}
