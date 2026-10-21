import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { runtimeContext } from "../server/config";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "../server/runtime-schema";
import { sendDeliveryTest } from "../server/services/providers";
vi.mock("../server/services/control", () => ({
  settings: async () => ({
    businessName: "SpareCash",
    businessAddress: "Test address",
  }),
}));
let config: RuntimeConfiguration;
let fetchMock: ReturnType<typeof vi.fn>;
const requestId = "0d690bd0-2745-43d8-b07c-40cd937cb801";
const subscription = "1a690bd0-2745-43d8-b07c-40cd937cb802";
const run = (
  provider: "onesignal" | "brevo" | "bluebubbles",
  recipient: string,
  kind: "confirmation" | "followup" = "followup",
) =>
  runtimeContext.run(config, () =>
    sendDeliveryTest(provider, recipient, requestId, kind),
  );
beforeEach(() => {
  config = {
    ...defaultRuntimeValues,
    ADMIN_PASSWORD_HASH: "unused-test-password-hash",
    TOKEN_SECRET: "test-token",
    MCP_TOKEN: "test-mcp",
    WEBHOOK_TOKEN: "test-webhook",
    ROUNDSKY_WEBHOOK_TOKEN: "test-roundsky",
    CLOUDFLARE_GEO_TOKEN: "",
    TURNSTILE_SECRET_KEY: "",
    CLARITY_EXPORT_TOKEN: "",
    ONESIGNAL_APP_ID: "test-app",
    ONESIGNAL_API_KEY: "test-key",
    BREVO_API_KEY: "test-brevo",
    MYEMAILVERIFIER_API_KEY: "",
    BREVO_SENDER_EMAIL: "sender@example.com",
    BREVO_FOLDER_ID: 1,
    BLUEBUBBLES_URL: "https://bluebubbles.example.test",
    BLUEBUBBLES_PASSWORD: "test-password",
    PROPELLER_API_TOKEN: "",
    PROPELLER_POSTBACK_URL: "",
  };
  fetchMock = vi.fn(() => Promise.reject(new Error("Unexpected request")));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it.each(["SMS", "iMessage"] as const)(
  "uses the selected %s transport for a single BlueBubbles test",
  async (service) => {
    config.BLUEBUBBLES_SERVICE = service;
    fetchMock.mockResolvedValue(
      Response.json({ status: 200, data: { guid: "provider-message-id" } }),
    );
    expect(await run("bluebubbles", "+13125550123")).toBe(
      "provider-message-id",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      chatGuid: `${service};-;+13125550123`,
      message: expect.stringContaining("test message"),
      tempGuid: requestId,
      method: "apple-script",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);
it("does not invent BlueBubbles acceptance when there is no message ID", async () => {
  fetchMock.mockResolvedValue(Response.json({ status: 200, data: {} }));
  await expect(run("bluebubbles", "+13125550123")).rejects.toThrow(
    "did not confirm",
  );
});
it("targets exactly one push subscription with an idempotency key while live follow-ups are off", async () => {
  expect(config.LIVE_DELIVERY).toBe("false");
  fetchMock.mockResolvedValue(Response.json({ id: "push-message-id" }));
  expect(await run("onesignal", subscription)).toBe("push-message-id");
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.include_subscription_ids).toEqual([subscription]);
  expect(body.idempotency_key).toBe(requestId);
  expect(body.included_segments).toBeUndefined();
});
it("reports a push with no accepted audience as a failure", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ id: "", errors: ["not subscribed"] }),
  );
  await expect(run("onesignal", subscription)).rejects.toThrow(
    "did not accept",
  );
});
it("sends a confirmation test only to the entered email address", async () => {
  fetchMock.mockResolvedValue(Response.json({ messageId: "email-test-id" }));
  expect(await run("brevo", "owner@example.com", "confirmation")).toBe(
    "email-test-id",
  );
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://api.brevo.com/v3/smtp/email",
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual([
    { email: "owner@example.com" },
  ]);
});
it("sends a branded follow-up test through the same transactional endpoint", async () => {
  fetchMock.mockResolvedValue(Response.json({ messageId: "followup-test-id" }));
  expect(await run("brevo", "owner@example.com")).toBe("followup-test-id");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://api.brevo.com/v3/smtp/email",
  );
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.to).toEqual([{ email: "owner@example.com" }]);
  expect(body.tags).toEqual(["sparecash-followup-test"]);
  expect(body.headers["X-Mailin-custom"]).toBe(`test:${requestId}`);
  expect(body.htmlContent).toContain("FOLLOW-UP TEST");
  expect(body.htmlContent).toContain("Test address");
});
it("keeps provider response secrets out of send errors", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ error: "provider-secret-do-not-return" }, { status: 403 }),
  );
  await expect(run("onesignal", subscription)).rejects.toThrow("HTTP 403");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
