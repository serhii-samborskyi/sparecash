import { beforeEach, expect, it, vi } from "vitest";
import { subscriptionAvailability } from "../server/services/subscription-availability";

const { config, findMany } = vi.hoisted(() => ({
  config: {} as Record<string, string | number>,
  findMany: vi.fn(),
}));
vi.mock("../server/config", () => ({ env: config }));
vi.mock("../server/db", () => ({ db: { chain: { findMany } } }));
beforeEach(() => {
  Object.assign(config, {
    LIVE_DELIVERY: "true",
    ONESIGNAL_APP_ID: "test-app",
    ONESIGNAL_API_KEY: "test-key",
    BREVO_API_KEY: "test-key",
    BREVO_SENDER_EMAIL: "test@example.com",
    BREVO_FOLDER_ID: 1,
    BLUEBUBBLES_URL: "https://sms.example.test",
    BLUEBUBBLES_PASSWORD: "test-password",
  });
  findMany.mockResolvedValue(
    ["PUSH", "EMAIL", "SMS"].map((channel) => ({ channel })),
  );
});
it("hides every channel while delivery is paused even with configured providers", async () => {
  config.LIVE_DELIVERY = "false";
  expect((await subscriptionAvailability()).availableChannels).toEqual([]);
});
it("does not offer email with an incomplete sending configuration", async () => {
  config.BREVO_FOLDER_ID = 0;
  expect((await subscriptionAvailability()).availableChannels).toEqual([
    "PUSH",
    "SMS",
  ]);
  config.BREVO_FOLDER_ID = 1;
  config.BREVO_API_KEY = "";
  expect((await subscriptionAvailability()).availableChannels).not.toContain(
    "EMAIL",
  );
});
it("offers only approved subscriber channels, leaving a held SMS chain unavailable", async () => {
  findMany.mockResolvedValue([{ channel: "PUSH" }]);
  const result = await subscriptionAvailability();
  expect(result.availableChannels).toEqual(["PUSH"]);
  expect(findMany).toHaveBeenCalledWith({
    where: { status: "ACTIVE", trigger: "SUBSCRIBED" },
    select: { channel: true },
  });
  expect(JSON.stringify(result)).not.toContain("test-key");
  expect(JSON.stringify(result)).not.toContain("test-password");
});
it("requires both push credentials and an active subscriber chain", async () => {
  config.ONESIGNAL_API_KEY = "";
  expect((await subscriptionAvailability()).availableChannels).not.toContain(
    "PUSH",
  );
  findMany.mockResolvedValue([]);
  expect((await subscriptionAvailability()).availableChannels).toEqual([]);
});
