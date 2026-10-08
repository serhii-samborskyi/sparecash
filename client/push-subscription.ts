import { api } from "./api";

type PushState = {
  id?: string | null;
  token?: string | null;
  optedIn?: boolean;
};
type PushChangeListener = (event: { current: PushState }) => void;
export type PushSubscription = PushState & {
  addEventListener(event: "change", listener: PushChangeListener): void;
  removeEventListener(event: "change", listener: PushChangeListener): void;
};

export class PushConfirmationPending extends Error {
  constructor() {
    super(
      "Notifications are allowed. We still need to finish confirming your subscription.",
    );
  }
}

// Permission and a subscription ID can arrive before the push token/opt-in.
// Listen for the completed subscription instead of treating an ID as readiness.
export function waitForPushSubscription(
  subscription: PushSubscription,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      subscription.removeEventListener("change", change);
      signal.removeEventListener("abort", abort);
    };
    const check = (state: PushState) => {
      if (state.id && state.token && state.optedIn === true) {
        cleanup();
        resolve(state.id);
      }
    };
    const change: PushChangeListener = (event) => check(event.current);
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new PushConfirmationPending());
    }, 20000);
    subscription.addEventListener("change", change);
    signal.addEventListener("abort", abort, { once: true });
    check(subscription);
  });
}

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function confirmPushSubscription(
  leadToken: string,
  subscriptionId: string,
  signal: AbortSignal,
) {
  // OneSignal's REST user record can lag behind its browser subscription.
  // Retry only explicit pending responses; errors and ownership conflicts stop.
  for (const pause of [0, 1000, 2000, 4000, 6000, 8000]) {
    if (pause) await delay(pause, signal);
    signal.throwIfAborted();
    // Use a controller instead of AbortSignal.any(), absent on older iOS versions.
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    const timeout = setTimeout(() => request.abort(), 12000);
    signal.addEventListener("abort", abort, { once: true });
    let result: { ok: boolean; status?: string };
    try {
      result = await api("/public/push", {
        method: "POST",
        body: JSON.stringify({ leadToken, subscriptionId, consent: true }),
        signal: request.signal,
      });
    } catch (error) {
      const failure = error as { status?: number; code?: string };
      if (
        failure.status !== 409 ||
        failure.code !== "PUSH_CONFIRMATION_PENDING"
      )
        throw error;
      result = { ok: false, status: "pending" };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    if (result.ok === true) return;
    if (result.status !== "pending")
      throw new Error("Could not confirm notifications. Please retry.");
  }
  throw new PushConfirmationPending();
}
