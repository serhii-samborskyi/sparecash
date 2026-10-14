type ActivityTotals = {
  activeMs: number;
  clicks: number;
  scrolls: number;
  complete?: boolean;
};

const MAX_ACTIVE_MS = 86_400_000;
const MAX_ACTIONS = 10_000;

export function startPreQuizActivityTracking({
  visitToken,
  initial,
}: {
  visitToken: string;
  initial?: ActivityTotals;
}) {
  if (initial?.complete) return () => {};
  let activeMs = initial?.activeMs ?? 0;
  let clicks = initial?.clicks ?? 0;
  let scrolls = initial?.scrolls ?? 0;
  let visibleStarted =
    document.visibilityState === "visible" ? performance.now() : null;
  let stopped = false;
  let lastSent = "";
  let lastScrollEvent = -Infinity;
  let scrollAnchor = window.scrollY;
  let scrollSequenceCounted = false;

  const freezeVisibleTime = () => {
    if (visibleStarted === null) return;
    activeMs = Math.min(
      MAX_ACTIVE_MS,
      activeMs + Math.max(0, performance.now() - visibleStarted),
    );
    visibleStarted = null;
  };
  const snapshot = (complete: boolean) => ({
    activeMs: Math.min(
      MAX_ACTIVE_MS,
      Math.round(
        activeMs +
          (visibleStarted === null
            ? 0
            : Math.max(0, performance.now() - visibleStarted)),
      ),
    ),
    clicks: Math.min(MAX_ACTIONS, clicks),
    scrolls: Math.min(MAX_ACTIONS, scrolls),
    complete,
  });
  const send = (complete = false) => {
    const activity = snapshot(complete);
    const serialized = JSON.stringify(activity);
    if (serialized === lastSent) return;
    lastSent = serialized;
    void fetch("/api/public/pre-quiz-activity", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitToken, activity }),
    }).catch(() => {});
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      if (visibleStarted === null) visibleStarted = performance.now();
    } else {
      freezeVisibleTime();
      send();
    }
  };
  const onClick = (event: MouseEvent) => {
    if (stopped || event.button !== 0 || !(event.target instanceof Element))
      return;
    const control = event.target.closest(
      "a,button,input,select,textarea,label,[role='button']",
    );
    if (!control || control.closest(".quiz-options")) return;
    clicks = Math.min(MAX_ACTIONS, clicks + 1);
  };
  const onScroll = () => {
    if (stopped) return;
    const now = performance.now();
    if (now - lastScrollEvent > 800) {
      scrollAnchor = window.scrollY;
      scrollSequenceCounted = false;
    }
    if (
      !scrollSequenceCounted &&
      Math.abs(window.scrollY - scrollAnchor) >= 24
    ) {
      scrolls = Math.min(MAX_ACTIONS, scrolls + 1);
      scrollSequenceCounted = true;
    }
    lastScrollEvent = now;
  };
  const onPageHide = () => {
    freezeVisibleTime();
    send();
  };
  const detach = () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("sparecash-quiz-started", stop);
  };
  const stop = () => {
    if (stopped) return;
    freezeVisibleTime();
    stopped = true;
    send(true);
    detach();
  };
  const interval = window.setInterval(() => send(), 10_000);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("sparecash-quiz-started", stop);
  // Marks this visit as measured even if it bounces before the first interval.
  send();

  return () => {
    if (stopped) return;
    freezeVisibleTime();
    send();
    detach();
  };
}
