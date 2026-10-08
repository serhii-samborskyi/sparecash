import { useEffect, useRef, useState } from "react";
import {
  AutosaveQueue,
  registerAutosave,
  type SavePatch,
  type SaveState,
} from "../autosave";
export function useAutosave(send: (patch: SavePatch) => Promise<void>) {
  const sender = useRef(send);
  sender.current = send;
  const [state, setState] = useState<SaveState>({
    status: "idle",
    pending: false,
    error: "",
  });
  const [queue] = useState(
    () => new AutosaveQueue((patch) => sender.current(patch), setState),
  );
  useEffect(() => registerAutosave(queue), [queue]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.state.pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [queue]);
  return { queue, state };
}
