type EngagementEvent =
  | { kind: "UPDATES_OPENED" }
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
    void fetch("/api/public/engagement", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitToken, event }),
    }).catch(() => {});
  };
}
