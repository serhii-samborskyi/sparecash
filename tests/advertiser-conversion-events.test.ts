import { expect, it, vi } from "vitest";
import {
  queueAdvertiserConversion,
  validAdvertiserClickId,
} from "../server/services/advertiser-conversion-events";

it("accepts provider click IDs but rejects unresolved macros", () => {
  expect(validAdvertiserClickId("1134450222450876491")).toBe(true);
  expect(validAdvertiserClickId("click_test-123:abc")).toBe(true);
  expect(validAdvertiserClickId("${SUBID}")).toBe(false);
  expect(validAdvertiserClickId("{clickId}")).toBe(false);
  expect(validAdvertiserClickId("bad click")).toBe(false);
});

it("deduplicates advertiser goals by click ID and refuses unattributed visits", async () => {
  const upsert = vi.fn().mockResolvedValue({});
  const tx = { advertiserConversion: { upsert } } as any;
  expect(
    await queueAdvertiserConversion(tx, {
      visit: {
        id: "visit-1",
        sourceId: "source-1",
        externalClickId: "click-123456",
      },
      event: "OPT_IN",
      goal: 3,
    }),
  ).toBe(true);
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        externalClickId_goal: {
          externalClickId: "click-123456",
          goal: 3,
        },
      },
      create: expect.objectContaining({
        visitId: "visit-1",
        event: "OPT_IN",
        goal: 3,
      }),
      update: {},
    }),
  );
  expect(
    await queueAdvertiserConversion(tx, {
      visit: {
        id: "visit-2",
        sourceId: null,
        externalClickId: "click-654321",
      },
      event: "APPLICATION",
      goal: 2,
    }),
  ).toBe(false);
  expect(upsert).toHaveBeenCalledTimes(1);
});
