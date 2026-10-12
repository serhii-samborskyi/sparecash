import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeContext } from "../server/config";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "../server/runtime-schema";
import { processAdvertiserConversions } from "../server/services/advertiser-conversions";

const conversions = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
}));
vi.mock("../server/db", () => ({
  db: { advertiserConversion: conversions },
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
