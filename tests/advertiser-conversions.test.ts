import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeContext } from "../server/config";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "../server/runtime-schema";
import {
  processAdvertiserConversions,
  requeueAdvertiserConversions,
} from "../server/services/advertiser-conversions";

const conversions = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
}));
const attempts = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));
const auditLogs = vi.hoisted(() => ({ create: vi.fn() }));
const transaction = vi.hoisted(() => vi.fn());
vi.mock("../server/db", () => ({
  db: {
    advertiserConversion: conversions,
    advertiserConversionAttempt: attempts,
    auditLog: auditLogs,
    $transaction: transaction,
  },
}));

let config: RuntimeConfiguration;
let fetchMock: ReturnType<typeof vi.fn>;
const conversion = {
  id: "conversion-1",
  applicationId: "application-1",
  event: "APPLICATION",
  goal: 1,
  externalClickId: "propeller-click-123",
  payout: { toString: () => "0" },
  status: "PENDING",
  attempts: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  config = {
    ...defaultRuntimeValues,
    PROPELLER_POSTBACK_URL:
      "https://ad.propellerads.com/conversion.php?aid=account-test&tid=tracker-test&visitor_id=%24%7BSUBID%7D",
  } as RuntimeConfiguration;
  conversions.updateMany.mockResolvedValue({ count: 1 });
  conversions.findMany.mockResolvedValue([conversion]);
  conversions.update.mockResolvedValue({});
  conversions.count.mockResolvedValue(0);
  attempts.create.mockResolvedValue({ id: "attempt-1" });
  attempts.update.mockResolvedValue({});
  auditLogs.create.mockResolvedValue({});
  transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it("sends the click ID as the primary PropellerAds conversion exactly once", async () => {
  const result = await runtimeContext.run(config, () =>
    processAdvertiserConversions(),
  );
  expect(result).toEqual({
    advertiserConversionsSent: 1,
    advertiserConversionsPending: 0,
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  const url = new URL(fetchMock.mock.calls[0][0]);
  expect(url.origin + url.pathname).toBe(
    "https://ad.propellerads.com/conversion.php",
  );
  expect(url.searchParams.get("visitor_id")).toBe("propeller-click-123");
  expect(url.searchParams.has("goal")).toBe(false);
  expect(url.searchParams.get("payout")).toBe("0");
  expect(conversions.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: "SENT" }),
    }),
  );
  expect(attempts.update).toHaveBeenCalledWith({
    where: { id: "attempt-1" },
    data: expect.objectContaining({
      outcome: "SENT",
      httpStatus: 200,
      completedAt: expect.any(Date),
    }),
  });
});

it("holds an ambiguous network outcome instead of retrying it", async () => {
  fetchMock.mockRejectedValue(new Error("timeout"));
  await runtimeContext.run(config, () => processAdvertiserConversions());
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(conversions.update).toHaveBeenLastCalledWith({
    where: { id: "conversion-1" },
    data: {
      status: "UNCERTAIN",
      error:
        "Postback outcome is uncertain; check PropellerAds before retrying",
    },
  });
  expect(attempts.update).toHaveBeenCalledWith({
    where: { id: "attempt-1" },
    data: expect.objectContaining({
      outcome: "UNCERTAIN",
      completedAt: expect.any(Date),
    }),
  });
});

it("leaves conversions queued until the account postback URL is configured", async () => {
  config.PROPELLER_POSTBACK_URL = "";
  const result = await runtimeContext.run(config, () =>
    processAdvertiserConversions(),
  );
  expect(result).toEqual({
    advertiserConversionsSent: 0,
    advertiserConversionsPending: 0,
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(conversions.findMany).not.toHaveBeenCalled();
});

it("requeues only exact advertiser click IDs for an authorized replay", async () => {
  conversions.findMany.mockResolvedValue([
    {
      id: "conversion-1",
      externalClickId: "propeller-click-123",
      status: "SENT",
      attempts: 1,
    },
  ]);
  const result = await requeueAdvertiserConversions({
    goal: 3,
    externalClickIds: ["propeller-click-123", "missing-click-456"],
    actor: "mcp",
    reason: "Owner requested replay after the advertiser report stayed empty",
  });
  expect(result).toEqual({
    requested: 2,
    requeued: 1,
    missing: ["missing-click-456"],
  });
  expect(conversions.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["conversion-1"] } },
    data: {
      status: "PENDING",
      attemptedAt: null,
      sentAt: null,
      error:
        "Manual replay requested: Owner requested replay after the advertiser report stayed empty",
    },
  });
});
