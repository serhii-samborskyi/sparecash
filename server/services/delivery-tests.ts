import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";
import { hash } from "../security.js";
import { ProviderError, sendDeliveryTest } from "./providers.js";

const schema = z
  .object({
    provider: z.enum(["onesignal", "brevo", "bluebubbles"]),
    recipient: z.string().trim().min(1).max(254),
    requestId: z.string().uuid(),
    emailKind: z.enum(["transactional", "campaign"]).default("campaign"),
  })
  .strict()
  .superRefine((input, context) => {
    const email = z.string().email().safeParse(input.recipient).success;
    const valid =
      input.provider === "onesignal"
        ? z.string().uuid().safeParse(input.recipient).success
        : input.provider === "brevo"
          ? email
          : /^\+[1-9]\d{7,14}$/.test(input.recipient) ||
            (env.BLUEBUBBLES_SERVICE === "iMessage" && email);
    if (!valid)
      context.addIssue({
        code: "custom",
        path: ["recipient"],
        message:
          input.provider === "onesignal"
            ? "Enter your device's OneSignal subscription ID"
            : input.provider === "brevo"
              ? "Enter one valid test email address"
              : "Enter a phone number with country code (or an Apple ID email in iMessage mode)",
      });
  });
export async function testDelivery(input: unknown) {
  const data = schema.parse(input);
  const id = `delivery-test:${data.requestId}`;
  try {
    await db.auditLog.create({
      data: {
        id,
        actor: "owner",
        action: "integration.delivery_test_started",
        details: {
          provider: data.provider,
          recipientHash: hash(data.recipient),
          emailKind: data.emailKind,
        },
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return {
        status: "unknown",
        message:
          "This test was already attempted. Check your device and provider logs before starting a new test.",
      };
    throw error;
  }
  let status: "accepted" | "error" | "unknown" = "unknown";
  let message =
    "Delivery could not be confirmed. Check provider logs and your device before trying again.";
  let providerId: string | undefined;
  try {
    providerId = await sendDeliveryTest(
      data.provider,
      data.recipient,
      data.requestId,
      data.emailKind,
    );
    status = "accepted";
    message =
      "Provider accepted the test. Check your device or inbox (including spam) to confirm receipt.";
  } catch (error) {
    // Provider bodies and URLs may contain credentials; only known messages are returned.
    if (error instanceof ProviderError) {
      status = error.status < 500 ? "error" : "unknown";
      message = `${error.message}. Check your device before starting another test.`;
    } else if (
      error instanceof Error &&
      [
        "OneSignal is not configured",
        "BlueBubbles is not configured",
        "Brevo is not configured",
        "Set your Brevo campaign folder ID and business mailing address before testing campaign email",
        "OneSignal did not accept a notification. Check that the subscription is active and belongs to this app.",
      ].includes(error.message)
    ) {
      status = "error";
      message = error.message;
    }
  }
  await db.auditLog.update({
    where: { id },
    data: { action: `integration.delivery_test_${status}` },
  });
  return { status, message, ...(providerId ? { providerId } : {}) };
}
