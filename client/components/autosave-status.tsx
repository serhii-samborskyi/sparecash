import { Check, Cloud, CircleAlert } from "lucide-react";
import type { SaveState } from "../autosave";
import { Spinner } from "./ui";
export function AutosaveStatus({
  state,
  retry,
}: {
  state: SaveState;
  retry: () => void;
}) {
  return (
    <div
      className={`autosave-status ${state.status}`}
      role="status"
      aria-live="polite"
    >
      {state.status === "saving" ? (
        <Spinner />
      ) : state.status === "error" ? (
        <CircleAlert size={16} />
      ) : state.status === "saved" ? (
        <Check size={16} />
      ) : (
        <Cloud size={16} />
      )}
      <span>
        {state.status === "saving"
          ? "Saving…"
          : state.status === "error"
            ? `Not saved: ${state.error}`
            : state.status === "editing"
              ? "Unsaved changes · leave the field to save"
              : state.status === "saved"
                ? "All changes saved"
                : "Auto-save on · fields save when you leave them"}
      </span>
      {state.status === "error" && (
        <button type="button" className="text-button" onClick={retry}>
          Retry save
        </button>
      )}
    </div>
  );
}
