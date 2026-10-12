import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeContext } from "../server/config";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "../server/runtime-schema";
import { advertiserStatistics } from "../server/services/advertiser-statistics";
import {
  trustedVisitLocation,
  browserContext,
} from "../server/services/visit-context";

const database = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("../server/db", () => ({ db: { adStatisticsSnapshot: database } }));
let config: RuntimeConfiguration;
let fetchMock: ReturnType<typeof vi.fn>;
const query = { from: "2026-10-01", to: "2026-10-02", campaignIds: ["123"] };
const row = {
  campaign_id: 123,
  zone_id: 456,
  country: "United States (US)",
  date_time: "2026-10-01",
  impressions: 100,
  clicks: 3,
  spent: "0.09",
};
const run = (refresh = false) =>
  runtimeContext.run(config, () => advertiserStatistics(query, refresh));
beforeEach(() => {
  vi.clearAllMocks();
  database.findUnique.mockResolvedValue(null);
  database.upsert.mockResolvedValue({});
  config = {
    ...defaultRuntimeValues,
    TOKEN_SECRET: "test-secret",
    PROPELLER_API_TOKEN: "test-api-key",
    CLOUDFLARE_GEO_TOKEN: "test-edge-secret",
  } as RuntimeConfiguration;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("fetches a complete advertiser report with POST and stores its scoped snapshot", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      result: [row, { ...row, zone_id: 789 }],
      request_id: "test-request",
    }),
  );
  const result = await run();
  expect(result.status).toBe("ready");
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({
    country: "US",
    spend: 0.09,
    clicks: 3,
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://ssp-api.propellerads.com/v5/adv/statistics",
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    tz: "+0000",
    campaign_id: [123],
    group_by: ["campaign_id", "zone_id", "country_id", "date_time"],
  });
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: "Bearer test-api-key",
      "Content-Type": "application/json",
    },
  });
  expect(database.upsert).toHaveBeenCalledOnce();
  expect(JSON.stringify(database.upsert.mock.calls)).not.toContain(
    "test-api-key",
  );
});

it("uses cached reports and retains the last complete snapshot on a failed refresh", async () => {
  const cached = {
    fetchedAt: new Date(),
    rows: [
      {
        campaignId: "123",
        zoneId: "456",
        country: "US",
        day: "2026-10-01",
        impressions: 100,
        clicks: 3,
        spend: 0.09,
      },
    ],
  };
  database.findUnique.mockResolvedValue(cached);
  expect((await run()).status).toBe("ready");
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(
    new Response("secret provider body", { status: 401 }),
  );
  const stale = await run(true);
  expect(stale.status).toBe("stale");
  expect(stale.rows).toEqual(cached.rows);
  expect(stale.message).toContain("HTTP 401");
  expect(stale.message).not.toContain("secret");
  expect(database.upsert).not.toHaveBeenCalled();
});

it.each([
  { items: [row] },
  { result: [{ ...row, campaign_id: 999 }] },
  { result: [{ ...row, spent: undefined }] },
  { result: [{ ...row, country: "Unknown" }] },
])(
  "rejects differently scoped and malformed advertiser responses",
  async (data) => {
    fetchMock.mockResolvedValue(Response.json(data));
    const result = await run();
    expect(result.status).toBe("unavailable");
    expect(result.rows).toEqual([]);
    expect(database.upsert).not.toHaveBeenCalled();
  },
);

it("does not turn missing credentials into zero advertiser spend", async () => {
  config.PROPELLER_API_TOKEN = "";
  const result = await run();
  expect(result.status).toBe("unavailable");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("requires a trusted edge secret and a valid country before storing geography", () => {
  const headers = {
    "cf-ipcountry": "US",
    "cf-region": "Illinois",
    "cf-ipcity": "Chicago",
  };
  const location = (extra = {}) =>
    runtimeContext.run(config, () =>
      trustedVisitLocation({ headers: { ...headers, ...extra } }),
    );
  expect(location()).toEqual({});
  expect(location({ "x-sparecash-geo-token": "wrong" })).toEqual({});
  expect(
    location({ "x-sparecash-geo-token": config.CLOUDFLARE_GEO_TOKEN }),
  ).toEqual({
    country: "US",
    region: "Illinois",
    city: "Chicago",
    geoSource: "TRUSTED_EDGE",
  });
  expect(
    location({
      "x-sparecash-geo-token": config.CLOUDFLARE_GEO_TOKEN,
      "cf-ipcountry": "XX",
    }),
  ).toEqual({});
});

it("groups browser families without treating their claims as verification", () => {
  expect(
    browserContext(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    ),
  ).toEqual({ device: "Mobile", browser: "Safari", os: "iOS" });
  expect(
    browserContext(
      "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130",
    ),
  ).toEqual({ device: "Desktop", browser: "Edge", os: "Windows" });
  expect(browserContext("curl/8")).toEqual({
    device: "Unknown",
    browser: "Unknown",
    os: "Unknown",
  });
});
