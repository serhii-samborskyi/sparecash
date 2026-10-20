import { afterEach, expect, it, vi } from "vitest";
import { startAdvertiserConversionDispatcher } from "../server/services/advertiser-conversion-dispatcher";

afterEach(() => vi.useRealTimers());

it("keeps draining conversions until stopped", async () => {
  vi.useFakeTimers();
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const stop = startAdvertiserConversionDispatcher({
    intervalMs: 1_000,
    dispatch,
  });

  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(dispatch).toHaveBeenCalledTimes(2);

  stop();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(dispatch).toHaveBeenCalledTimes(2);
});
