import { clarityEvent, clarityTag } from "./clarity";

type EngagementEvent =
  | { kind: "UPDATES_OPENED" }
  | { kind: "SEARCH_STARTED" }
  | { kind: "SEARCH_COMPLETED" }
  | {
      kind: "CHANNEL_SELECTED";
      channel: "PUSH" | "SMS" | "EMAIL";
    }
  | {
      kind: "QUESTION_ANSWERED";
      questionId: string;
      answers: Record<string, string>;
    };

// Dispatch immediately so a slow earlier request cannot hold the final quiz event
// until after navigation. The server deduplicates events; failures never block UI.
export function createEngagementTracker() {
  return (
    visitToken: string | undefined,
    preview: boolean,
    event: EngagementEvent,
  ) => {
    if (preview || !visitToken) return;
    clarityEvent(event.kind.toLowerCase());
    if (event.kind === "CHANNEL_SELECTED")
      clarityTag("selected_channel", event.channel.toLowerCase());
    void fetch("/api/public/engagement", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitToken, event }),
    })
      .then((response) => {
        if (response?.ok && typeof window !== "undefined")
          window.dispatchEvent(new Event("sparecash-engagement"));
      })
      .catch(() => {});
  };
}
