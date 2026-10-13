type ClarityCommand = (...args: unknown[]) => void;

declare global {
  interface Window {
    clarity?: ClarityCommand & { q?: unknown[][] };
  }
}

let activeProject = "";

function command(...args: unknown[]) {
  if (typeof window === "undefined") return;
  window.clarity?.(...args);
}

function cleanLandingUrl() {
  const url = new URL(location.href);
  const keep = new Set([
    "campaign_id",
    "zone_id",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
  ]);
  for (const key of [...url.searchParams.keys()])
    if (!keep.has(key)) url.searchParams.delete(key);
  history.replaceState(history.state, "", url);
}

export function initializeClarity(input: {
  projectId?: string;
  tags?: Record<string, string | undefined>;
}) {
  if (!input.projectId || activeProject === input.projectId) return;
  activeProject = input.projectId;
  cleanLandingUrl();
  window.clarity =
    window.clarity ??
    Object.assign(
      (...args: unknown[]) => {
        (window.clarity!.q ??= []).push(args);
      },
      { q: [] as unknown[][] },
    );
  for (const [key, value] of Object.entries(input.tags ?? {}))
    if (value) command("set", key, value.slice(0, 255));
  command("event", "landing_view");
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(input.projectId)}`;
  script.dataset.sparecashClarity = input.projectId;
  document.head.append(script);
}

export function clarityEvent(name: string) {
  command("event", name);
}

export function clarityTag(key: string, value: string | string[]) {
  command("set", key, value);
}
