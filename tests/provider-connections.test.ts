import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeContext } from "../server/config";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "../server/runtime-schema";
import {
  blueBubblesReplySetup,
  testProviderConnection,
} from "../server/services/integration-tests";

vi.mock("../server/services/control", () => ({
  settings: async () => ({ businessAddress: "Test business address" }),
}));
let config: RuntimeConfiguration;
let fetchMock: ReturnType<typeof vi.fn>;
const run = (provider: Parameters<typeof testProviderConnection>[0]) =>
  runtimeContext.run(config, () => testProviderConnection(provider));
beforeEach(() => {
  config = {
    ...defaultRuntimeValues,
    ADMIN_PASSWORD_HASH: "test-only-unused-hash",
    TOKEN_SECRET: "test-only-link-secret",
    MCP_TOKEN: "test-only-mcp-secret",
    WEBHOOK_TOKEN: "test-only-general-webhook-secret-with-&?=",
    ROUNDSKY_WEBHOOK_TOKEN: "test-only-roundsky-secret",
    CLOUDFLARE_GEO_TOKEN: "",
    TURNSTILE_SECRET_KEY: "",
    ONESIGNAL_APP_ID: "test-app-id",
    ONESIGNAL_API_KEY: "test-only-onesignal-key",
    BREVO_API_KEY: "test-only-brevo-key",
    BREVO_SENDER_EMAIL: "sender@example.com",
    BREVO_FOLDER_ID: 12,
    BLUEBUBBLES_URL: "https://bluebubbles.example.test",
    BLUEBUBBLES_PASSWORD: "test-only-password-&?=",
    PROPELLER_API_TOKEN: "test-only-propeller-token",
  };
  fetchMock = vi.fn(() =>
    Promise.reject(new Error("Unexpected external request")),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("checks OneSignal with an app key through the read-only messages endpoint", async () => {
  fetchMock.mockResolvedValue(Response.json({ notifications: [] }));
  expect((await run("onesignal")).status).toBe("success");
  const [url, options] = fetchMock.mock.calls[0];
  expect(new URL(url).pathname).toBe("/notifications");
  expect(new URL(url).searchParams.get("app_id")).toBe(config.ONESIGNAL_APP_ID);
  expect(new URL(url).searchParams.get("limit")).toBe("1");
  expect(options).toMatchObject({
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Key ${config.ONESIGNAL_API_KEY}` },
  });
  expect(options.body).toBeUndefined();
});

it.each(["onesignal", "brevo", "bluebubbles", "propellerads"] as const)(
  "reports missing %s credentials without an external request",
  async (provider) => {
    config.ONESIGNAL_API_KEY =
      config.BREVO_API_KEY =
      config.BLUEBUBBLES_PASSWORD =
      config.PROPELLER_API_TOKEN =
        "";
    expect((await run(provider)).status).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("warns about Brevo folder zero even with a valid API key and active sender", async () => {
  config.BREVO_FOLDER_ID = 0;
  fetchMock
    .mockResolvedValueOnce(Response.json({ email: "account@example.com" }))
    .mockResolvedValueOnce(
      Response.json({
        senders: [{ email: "SENDER@example.com", active: true }],
      }),
    );
  const result = await run("brevo");
  expect(result.status).toBe("warning");
  expect(
    result.checks.find((c) => c.label === "Contact-list folder"),
  ).toMatchObject({ ok: false });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("verifies Brevo sender, folder and business address using only reads", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ email: "account@example.com" }))
    .mockResolvedValueOnce(
      Response.json({
        senders: [{ email: config.BREVO_SENDER_EMAIL, active: true }],
      }),
    )
    .mockResolvedValueOnce(Response.json({ id: 12 }));
  const result = await run("brevo");
  expect(result.status).toBe("success");
  expect(result.checks).toHaveLength(4);
  expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
    "GET",
    "GET",
    "GET",
  ]);
  expect(fetchMock.mock.calls[2][0]).toBe(
    "https://api.brevo.com/v3/contacts/folders/12",
  );
});

it("reports an inactive Brevo sender and inaccessible folder as setup failures", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ email: "account@example.com" }))
    .mockResolvedValueOnce(
      Response.json({
        senders: [{ email: config.BREVO_SENDER_EMAIL, active: false }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ message: config.BREVO_API_KEY }, { status: 404 }),
    );
  const result = await run("brevo");
  expect(result.status).toBe("warning");
  expect(result.checks.filter((c) => !c.ok)).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain(config.BREVO_API_KEY);
});

it("warns when BlueBubbles is reachable but its reply webhook is not registered", async () => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ status: 200, data: { server_version: "1.9.9" } }),
    )
    .mockResolvedValueOnce(Response.json({ status: 200, data: [] }));
  const result = await run("bluebubbles");
  expect(result.status).toBe("warning");
  expect(result.checks[0].ok).toBe(true);
  expect(result.checks[1].ok).toBe(false);
});

it("verifies the exact BlueBubbles reply URL, encoded token and new-message event", async () => {
  const setup = runtimeContext.run(config, blueBubblesReplySetup);
  expect(new URL(setup.webhookUrl).searchParams.get("token")).toBe(
    config.WEBHOOK_TOKEN,
  );
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ status: 200, data: { server_version: "1.9.9" } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: 200,
        data: [{ url: setup.webhookUrl, events: ["new-message"] }],
      }),
    );
  const result = await run("bluebubbles");
  expect(result.status).toBe("success");
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("password")).toBe(
    config.BLUEBUBBLES_PASSWORD,
  );
  expect(JSON.stringify(result)).not.toContain(config.BLUEBUBBLES_PASSWORD);
  expect(JSON.stringify(result)).not.toContain(config.WEBHOOK_TOKEN);
});

it("does not accept a stale BlueBubbles callback token", async () => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ status: 200, data: { server_version: "1.9.9" } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: 200,
        data: [
          {
            url: `${config.APP_URL}/api/webhooks/bluebubbles?token=old`,
            events: ["new-message"],
          },
        ],
      }),
    );
  expect((await run("bluebubbles")).status).toBe("warning");
});

it("uses PropellerAds' read-only balance endpoint without returning financial data", async () => {
  fetchMock.mockResolvedValue(Response.json("123.45"));
  const result = await run("propellerads");
  expect(result.status).toBe("success");
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://ssp-api.propellerads.com/v5/adv/balance",
  );
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  expect(JSON.stringify(result)).not.toContain("123.45");
});

it.each([401, 403, 429, 503])(
  "reports HTTP %s without exposing the response body",
  async (status) => {
    fetchMock.mockResolvedValue(
      Response.json({ error: config.ONESIGNAL_API_KEY }, { status }),
    );
    const result = await run("onesignal");
    expect(result.status).toBe("error");
    expect(result.checks[0].message).toContain(`HTTP ${status}`);
    expect(JSON.stringify(result)).not.toContain(config.ONESIGNAL_API_KEY);
  },
);

it("does not claim success for an HTTP 200 login page or provider error envelope", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("<html>Sign in</html>"))
    .mockResolvedValueOnce(Response.json({ errors: ["invalid key"] }));
  expect((await run("onesignal")).status).toBe("error");
  expect((await run("onesignal")).status).toBe("error");
});

it("sanitizes network failures that contain a password-bearing URL", async () => {
  fetchMock.mockRejectedValue(
    new Error(
      `https://bluebubbles.example.test/?password=${config.BLUEBUBBLES_PASSWORD}`,
    ),
  );
  const result = await run("bluebubbles");
  expect(result.status).toBe("error");
  expect(result.checks[0].message).toContain("Could not reach");
  expect(JSON.stringify(result)).not.toContain(config.BLUEBUBBLES_PASSWORD);
});
