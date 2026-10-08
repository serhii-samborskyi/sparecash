import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  waitForPushSubscription,
  confirmPushSubscription,
  PushConfirmationPending,
  type PushSubscription,
} from "../client/push-subscription";

const subscriptionId = "db5d8d82-08c8-4f7d-b165-30cbd5b62812";
function subscription() {
  const listeners = new Set<(event: { current: PushSubscription }) => void>();
  const state: PushSubscription = {
    id: subscriptionId,
    token: null,
    optedIn: false,
    addEventListener: vi.fn((_event, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_event, listener) =>
      listeners.delete(listener),
    ),
  };
  return {
    state,
    listeners,
    change: () => {
      for (const listener of listeners) listener({ current: state });
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("waits beyond the old three-second window for a token and opt-in, even with an ID", async () => {
  const sub = subscription();
  let complete = false;
  const ready = waitForPushSubscription(
    sub.state,
    new AbortController().signal,
  );
  void ready.then(() => {
    complete = true;
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(complete).toBe(false);
  sub.state.token = "browser-push-token";
  sub.change();
  await Promise.resolve();
  expect(complete).toBe(false);
  sub.state.optedIn = true;
  sub.change();
  expect(await ready).toBe(subscriptionId);
  expect(sub.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it("recognizes a browser that is already subscribed without requiring a new event", async () => {
  const sub = subscription();
  Object.assign(sub.state, { token: "existing-token", optedIn: true });
  expect(
    await waitForPushSubscription(sub.state, new AbortController().signal),
  ).toBe(subscriptionId);
  expect(sub.listeners.size).toBe(0);
});
it("leaves delayed browser registration pending and removes listeners on timeout", async () => {
  const sub = subscription();
  const result = expect(
    waitForPushSubscription(sub.state, new AbortController().signal),
  ).rejects.toBeInstanceOf(PushConfirmationPending);
  await vi.advanceTimersByTimeAsync(20000);
  await result;
  expect(sub.listeners.size).toBe(0);
});
it("cancels browser listeners when leaving the page", async () => {
  const sub = subscription();
  const controller = new AbortController();
  const result = expect(
    waitForPushSubscription(sub.state, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await result;
  expect(sub.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it("retries pending CRM verification without reporting success or duplicating permission requests", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { ok: false, code: "PUSH_CONFIRMATION_PENDING" },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        { ok: false, code: "PUSH_CONFIRMATION_PENDING" },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  let confirmed = false;
  const result = confirmPushSubscription(
    "lead-token",
    subscriptionId,
    new AbortController().signal,
  ).then(() => {
    confirmed = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(confirmed).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(confirmed).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const [url, options] of fetchMock.mock.calls) {
    expect(url).toBe("/api/public/push");
    expect(JSON.parse(options.body)).toEqual({
      leadToken: "lead-token",
      subscriptionId,
      consent: true,
    });
  }
  expect(vi.getTimerCount()).toBe(0);
});
it("stops after a bounded number of pending checks and lets the visitor retry", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json(
      { ok: false, code: "PUSH_CONFIRMATION_PENDING" },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = expect(
    confirmPushSubscription(
      "lead-token",
      subscriptionId,
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(PushConfirmationPending);
  await vi.advanceTimersByTimeAsync(21000);
  await result;
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not retry an ownership conflict or show it as subscribed", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json(
      { error: "Subscription belongs to another lead" },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    confirmPushSubscription(
      "lead-token",
      subscriptionId,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("stops pending server retries when leaving the page", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json(
      { ok: false, code: "PUSH_CONFIRMATION_PENDING" },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  const result = expect(
    confirmPushSubscription("lead-token", subscriptionId, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await result;
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
