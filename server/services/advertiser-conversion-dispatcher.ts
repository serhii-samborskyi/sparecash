import { withRuntimeConfiguration } from "../runtime-config.js";
import { processAdvertiserConversions } from "./advertiser-conversions.js";

type DispatcherOptions = {
  intervalMs?: number;
  dispatch?: () => Promise<unknown>;
  onError?: (error: unknown) => void;
};

// Conversion feedback is small and time-sensitive. Keep a web-process fallback
// so a stopped general worker cannot leave PropellerAds goals queued indefinitely.
export function startAdvertiserConversionDispatcher({
  intervalMs = 30_000,
  dispatch = () =>
    withRuntimeConfiguration(() => processAdvertiserConversions()),
  onError = (error) =>
    console.error(
      error instanceof Error
        ? `Advertiser conversion dispatch failed: ${error.message}`
        : "Advertiser conversion dispatch failed",
    ),
}: DispatcherOptions = {}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    try {
      await dispatch();
    } catch (error) {
      onError(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void run(), intervalMs);
        timer.unref();
      }
    }
  };

  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
