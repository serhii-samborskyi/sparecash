import type { Subscription, Delivery } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";
import { token } from "../security.js";
import { escapeHtml } from "../domain.js";
import { settings } from "./control.js";

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
      signal: AbortSignal.timeout(20000),
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
export async function sendText(phone: string, message: string, id: string) {
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
      chatGuid: `${env.BLUEBUBBLES_SERVICE};-;${phone}`,
      message,
      tempGuid: id,
      method: "apple-script",
    },
  );
  if (
    result.status !== 200 ||
    typeof result.data?.guid !== "string" ||
    !result.data.guid
  )
    throw new Error(
      "BlueBubbles did not confirm a message ID; check Messages on the Mac before retrying",
    );
  return result.data.guid as string;
}
export async function sendVerification(sub: Subscription, code: string) {
  if (env.LIVE_DELIVERY !== "true") return { paused: true };
  if (sub.channel === "EMAIL") {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)
      throw new Error("Brevo is not configured");
    const link = `${env.APP_URL}/confirm?token=${encodeURIComponent(token("confirm", sub.id, 86400))}`;
    await brevo("/smtp/email", {
      sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },
      to: [{ email: sub.address }],
      subject: "Confirm your SpareCash email subscription",
      htmlContent: `<p>You requested email updates from SpareCash.</p><p><a href="${escapeHtml(link)}">Confirm your subscription</a></p><p>If you did not request this, ignore this email. No marketing messages will be sent until you confirm.</p>`,
    });
  } else if (sub.channel === "SMS")
    await sendText(
      sub.address,
      `Your SpareCash confirmation code is ${code}. It expires in 10 minutes. If you did not request this, ignore this text.`,
      sub.id,
    );
  return { paused: false };
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
  if (sub.channel === "SMS")
    return sendText(
      sub.address,
      `${message.body}\n${message.body.includes(link) ? "" : link + "\n"}Reply STOP to opt out.`,
      message.id,
    );
  if (!env.BREVO_API_KEY || !env.BREVO_FOLDER_ID || !env.BREVO_SENDER_EMAIL)
    throw new Error("Brevo campaign delivery is not configured");
  const config = await settings();
  if (!config.businessAddress)
    throw new Error(
      "Set the business mailing address before sending email campaigns",
    );
  // Separate lists allow the local sequence engine to select precisely one consented recipient.
  let listId = sub.providerListId;
  if (!listId) {
    const list = await brevo("/contacts/lists", {
      name: `SpareCash ${sub.id}`,
      folderId: env.BREVO_FOLDER_ID,
    });
    listId = Number(list.id);
    if (!listId) throw new Error("Brevo returned no list ID");
    await db.subscription.update({
      where: { id: sub.id },
      data: { providerListId: listId },
    });
  }
  await brevo("/contacts", {
    email: sub.address,
    listIds: [listId],
    updateEnabled: true,
  });
  const html = `<html><body><p>${escapeHtml(message.body).replaceAll("\n", "<br>")}</p><p><a href="${escapeHtml(link)}">Explore loan options</a></p><hr><p>${escapeHtml(config.businessName)} · ${escapeHtml(config.businessAddress)}</p><p><a href="${escapeHtml(unsubscribe)}">Manage your preferences</a> · <a href="{{ unsubscribe }}">Unsubscribe</a></p></body></html>`;
  const campaign = await brevo("/emailCampaigns", {
    name: `SpareCash ${message.id}`,
    type: "classic",
    sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },
    subject: message.subject,
    htmlContent: html,
    recipients: { listIds: [listId] },
    tag: "sparecash",
  });
  await db.delivery.update({
    where: { id: message.id },
    data: { providerId: String(campaign.id) },
  });
  // Recheck local suppression immediately before the provider's send operation.
  const current = await db.subscription.findUniqueOrThrow({
    where: { id: sub.id },
  });
  if (current.status !== "ACTIVE")
    throw new Error("Recipient unsubscribed before sending");
  await brevo(`/emailCampaigns/${campaign.id}/sendNow`, {});
  return String(campaign.id);
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
  emailKind: "transactional" | "campaign",
) {
  const subject = "SpareCash delivery test";
  const body =
    "This is a test message requested by the SpareCash owner. No loan application or subscription was created.";
  if (provider === "bluebubbles") return sendText(recipient, body, requestId);
  if (provider === "onesignal") {
    if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY)
      throw new Error("OneSignal is not configured");
    const result = await one("/notifications", {
      app_id: env.ONESIGNAL_APP_ID,
      include_subscription_ids: [recipient],
      headings: { en: subject },
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
  if (emailKind === "transactional") {
    const result = await brevo("/smtp/email", {
      sender,
      to: [{ email: recipient }],
      subject,
      htmlContent: `<p>${body}</p>`,
    });
    if (typeof result.messageId !== "string" || !result.messageId)
      throw new Error(
        "Brevo did not confirm a message ID; check Brevo logs before retrying",
      );
    return result.messageId;
  }
  const config = await settings();
  if (!env.BREVO_FOLDER_ID || !config.businessAddress.trim())
    throw new Error(
      "Set your Brevo campaign folder ID and business mailing address before testing campaign email",
    );
  const campaign = await brevo("/emailCampaigns", {
    name: `SpareCash test ${requestId}`,
    type: "classic",
    sender,
    subject,
    htmlContent: `<p>${body}</p><hr><p>${escapeHtml(config.businessName)} · ${escapeHtml(config.businessAddress)}</p><p><a href="{{ unsubscribe }}">Unsubscribe</a></p>`,
    tag: "sparecash-test",
  });
  if (!Number.isSafeInteger(campaign.id) || campaign.id <= 0)
    throw new Error("Brevo did not confirm the test campaign ID");
  // Always provide one explicit address; an empty list would send to the entire test list.
  await brevo(`/emailCampaigns/${campaign.id}/sendTest`, {
    emailTo: [recipient],
  });
  return String(campaign.id);
}
