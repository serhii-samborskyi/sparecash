import { z } from "zod";
import { env } from "../config.js";
import { settings } from "./control.js";

export const testProviderSchema = z.enum([
  "onesignal",
  "brevo",
  "bluebubbles",
  "propellerads",
]);
type Provider = z.infer<typeof testProviderSchema>;
type Check = { label: string; ok: boolean; message: string };
class CheckError extends Error {}

// Only our own error messages leave this module. Provider bodies can contain secrets.
async function getJson<T>(
  url: string | URL,
  headers: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new CheckError(
      "Could not reach the provider. Check its URL, availability, and network access, then retry.",
    );
  }
  if (!response.ok) {
    const message =
      response.status === 401 || response.status === 403
        ? "Access was rejected. Check the saved credential, permissions, and provider IP restrictions."
        : response.status === 404
          ? "Not found. Check the saved app ID, folder ID, or server URL."
          : response.status === 429
            ? "The provider rate limit was reached. Wait before testing again."
            : "The provider could not complete this check. Retry or check its service status.";
    throw new CheckError(`${message} (HTTP ${response.status})`);
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new CheckError(
      "The provider returned an unexpected response. Check the server URL and API compatibility.",
    );
  }
}

export function blueBubblesReplySetup() {
  const url = new URL("/api/webhooks/bluebubbles", env.APP_URL);
  url.searchParams.set("token", env.WEBHOOK_TOKEN);
  return { webhookUrl: url.toString(), event: "new-message" };
}

export async function testProviderConnection(provider: Provider) {
  const checks: Check[] = [];
  async function check(label: string, run: () => Promise<string>) {
    try {
      checks.push({ label, ok: true, message: await run() });
      return true;
    } catch (error) {
      checks.push({
        label,
        ok: false,
        message:
          error instanceof CheckError
            ? error.message
            : "This check could not be completed. Retry or check the saved settings.",
      });
      return false;
    }
  }
  function requireValue(value: unknown, message: string) {
    if (!value) throw new CheckError(message);
  }
  if (provider === "onesignal") {
    await check("App access", async () => {
      requireValue(
        env.ONESIGNAL_APP_ID && env.ONESIGNAL_API_KEY,
        "Save your OneSignal app ID and app API key first.",
      );
      const url = new URL("https://api.onesignal.com/notifications");
      url.searchParams.set("app_id", env.ONESIGNAL_APP_ID);
      url.searchParams.set("limit", "1");
      // App API keys can read messages. The app-management endpoint needs an organization key.
      await getJson(
        url,
        { Authorization: `Key ${env.ONESIGNAL_API_KEY}` },
        z.object({ notifications: z.array(z.unknown()) }),
      );
      return "App ID and API key accepted. No push notification was sent.";
    });
  } else if (provider === "brevo") {
    const headers = { "api-key": env.BREVO_API_KEY };
    const connected = await check("Account access", async () => {
      requireValue(env.BREVO_API_KEY, "Save your Brevo API key first.");
      await getJson(
        "https://api.brevo.com/v3/account",
        headers,
        z.object({ email: z.string() }),
      );
      return "Brevo API key accepted. No email was sent.";
    });
    if (connected) {
      await check("Sender", async () => {
        requireValue(env.BREVO_SENDER_EMAIL, "Save a sender email first.");
        const data = await getJson(
          "https://api.brevo.com/v3/senders",
          headers,
          z.object({
            senders: z.array(
              z.object({ email: z.string(), active: z.boolean() }),
            ),
          }),
        );
        const sender = data.senders.find(
          (item) =>
            item.email.toLowerCase() === env.BREVO_SENDER_EMAIL.toLowerCase(),
        );
        requireValue(
          sender,
          "Add the saved sender email to your Brevo account.",
        );
        requireValue(
          sender?.active,
          "Verify and activate this sender in Brevo.",
        );
        return "The saved sender is active in Brevo.";
      });
      await check("Contact-list folder", async () => {
        requireValue(
          env.BREVO_FOLDER_ID > 0,
          "Create a contact-list folder in Brevo and save its numeric ID in Campaign folder ID. Zero is not configured.",
        );
        const folder = await getJson(
          `https://api.brevo.com/v3/contacts/folders/${env.BREVO_FOLDER_ID}`,
          headers,
          z.object({ id: z.number() }),
        );
        requireValue(
          folder.id === env.BREVO_FOLDER_ID,
          "The saved folder ID did not match Brevo's response.",
        );
        return "The saved contact-list folder exists.";
      });
      await check("Business address", async () => {
        requireValue(
          (await settings()).businessAddress.trim(),
          "Add your business mailing address in Settings before sending email campaigns.",
        );
        return "A business mailing address is configured.";
      });
    }
  } else if (provider === "bluebubbles") {
    function url(path: string) {
      const value = new URL(path, env.BLUEBUBBLES_URL);
      value.searchParams.set("password", env.BLUEBUBBLES_PASSWORD);
      return value;
    }
    const connected = await check("Server access", async () => {
      requireValue(
        env.BLUEBUBBLES_URL && env.BLUEBUBBLES_PASSWORD,
        "Save your BlueBubbles server URL and password first.",
      );
      await getJson(
        url("/api/v1/server/info"),
        {},
        z.object({
          status: z.literal(200),
          data: z.object({ server_version: z.string() }),
        }),
      );
      return "Server reached and password accepted. No text message was sent.";
    });
    if (connected)
      await check("Reply webhook", async () => {
        const webhooks = await getJson(
          url("/api/v1/webhook"),
          {},
          z.object({
            status: z.literal(200),
            data: z.array(
              z.object({ url: z.string(), events: z.array(z.string()) }),
            ),
          }),
        );
        const expected = new URL(blueBubblesReplySetup().webhookUrl);
        const registered = webhooks.data.some((webhook) => {
          try {
            const actual = new URL(webhook.url);
            return (
              actual.origin === expected.origin &&
              actual.pathname === expected.pathname &&
              actual.searchParams.get("token") ===
                expected.searchParams.get("token") &&
              webhook.events.includes("new-message")
            );
          } catch {
            return false;
          }
        });
        requireValue(
          registered,
          "Add the reply URL below to BlueBubbles and enable the new-message event.",
        );
        return "The reply URL is registered for new-message. Send a real reply to verify incoming delivery.";
      });
  } else {
    await check("Account access", async () => {
      requireValue(
        env.PROPELLER_API_TOKEN,
        "Save your PropellerAds API token first.",
      );
      await getJson(
        `${env.PROPELLER_API_URL.replace(/\/$/, "")}/adv/balance`,
        { Authorization: `Bearer ${env.PROPELLER_API_TOKEN}` },
        z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number().finite()]),
      );
      return "Advertiser API access confirmed. No campaigns or source exclusions were changed.";
    });
  }
  const status = !checks[0]?.ok
    ? "error"
    : checks.some((item) => !item.ok)
      ? "warning"
      : "success";
  return { provider, status, checks, checkedAt: new Date().toISOString() };
}
