export type SavePatch = Record<string, unknown>;
export type SaveState = {
  status: "idle" | "editing" | "saving" | "saved" | "error";
  pending: boolean;
  error: string;
};
type Entry = { value: unknown; version: number; ready: boolean };

// Serialize writes; an older response must never discard a newer edit.
export class AutosaveQueue {
  private edits = new Map<string, Entry>();
  private version = 0;
  private active: Promise<void> | null = null;
  private error = "";
  private saved = false;
  constructor(
    private send: (patch: SavePatch) => Promise<void>,
    private changed: (state: SaveState) => void,
  ) {}
  get state(): SaveState {
    return {
      status: this.active
        ? "saving"
        : this.error
          ? "error"
          : this.edits.size
            ? "editing"
            : this.saved
              ? "saved"
              : "idle",
      pending: Boolean(this.active || this.edits.size),
      error: this.error,
    };
  }
  edit(key: string, value: unknown) {
    this.edits.set(key, { value, version: ++this.version, ready: false });
    this.changed(this.state);
  }
  cancel(key: string) {
    this.edits.delete(key);
    this.error = "";
    this.changed(this.state);
  }
  matches(key: string, value: unknown) {
    return this.edits.get(key)?.value === value;
  }
  commit(key?: string) {
    for (const [name, entry] of this.edits)
      if (!key || key === name) entry.ready = true;
    return this.drain();
  }
  private async drain(): Promise<void> {
    if (this.active) {
      await this.active;
      return;
    }
    const entries = [...this.edits].filter(([, entry]) => entry.ready);
    if (!entries.length) return;
    const patch = Object.fromEntries(
      entries.map(([key, entry]) => [key, entry.value]),
    );
    this.error = "";
    this.active = Promise.resolve()
      .then(() => this.send(patch))
      .then(() => {
        this.saved = true;
        for (const [key, entry] of entries)
          if (this.edits.get(key)?.version === entry.version)
            this.edits.delete(key);
      })
      .catch((error) => {
        this.error =
          error instanceof Error ? error.message : "Could not save changes";
        for (const [key, entry] of entries)
          if (this.edits.get(key)?.version === entry.version)
            entry.ready = false;
      });
    this.changed(this.state);
    await this.active;
    this.active = null;
    this.changed(this.state);
    if ([...this.edits.values()].some((entry) => entry.ready))
      await this.drain();
  }
  async flush() {
    await this.commit();
    while (this.active) await this.active;
    return !this.state.pending;
  }
}

const queues = new Set<AutosaveQueue>();
export function registerAutosave(queue: AutosaveQueue) {
  queues.add(queue);
  return () => {
    queues.delete(queue);
  };
}
export async function flushSettings() {
  return (await Promise.all([...queues].map((queue) => queue.flush()))).every(
    Boolean,
  );
}
