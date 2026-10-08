import { expect, it, vi } from "vitest";
import { AutosaveQueue } from "../client/autosave";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("waits for a field to be committed and sends only edited keys", async () => {
  const send = vi.fn(async () => {});
  const queue = new AutosaveQueue(send, () => {});
  queue.edit("name", "New name");
  expect(send).not.toHaveBeenCalled();
  expect(queue.state.status).toBe("editing");
  await queue.commit("name");
  expect(send).toHaveBeenCalledExactlyOnceWith({ name: "New name" });
  expect(queue.state.status).toBe("saved");
});
it("serializes writes and retains edits made while a previous save is in flight", async () => {
  const first = deferred();
  const send = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(undefined);
  const queue = new AutosaveQueue(send, () => {});
  queue.edit("sender", "First");
  const saving = queue.commit("sender");
  await Promise.resolve();
  queue.edit("sender", "Second");
  void queue.commit("sender");
  queue.edit("secret", "still typing");
  expect(send).toHaveBeenCalledTimes(1);
  first.resolve();
  await saving;
  expect(send.mock.calls).toEqual([
    [{ sender: "First" }],
    [{ sender: "Second" }],
  ]);
  expect(queue.state.pending).toBe(true);
  await queue.commit("secret");
  expect(send).toHaveBeenLastCalledWith({ secret: "still typing" });
  expect(queue.state.pending).toBe(false);
});
it("keeps a failed save pending, without automatically retrying", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined);
  const queue = new AutosaveQueue(send, () => {});
  queue.edit("timezone", "America/Chicago");
  await queue.commit("timezone");
  expect(queue.state).toEqual({
    status: "error",
    error: "Offline",
    pending: true,
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(await queue.flush()).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
});
it("flushes the latest draft before leaving settings and waits for queued writes", async () => {
  const first = deferred();
  const second = deferred();
  const send = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const queue = new AutosaveQueue(send, () => {});
  queue.edit("key", "first");
  void queue.commit();
  await Promise.resolve();
  queue.edit("key", "latest");
  let done = false;
  const leaving = queue.flush().then((ok) => {
    done = ok;
  });
  first.resolve();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
  expect(done).toBe(false);
  second.resolve();
  await leaving;
  expect(done).toBe(true);
});
it("does not allow navigation to discard a failed field", async () => {
  const queue = new AutosaveQueue(
    async () => {
      throw new Error("Invalid URL");
    },
    () => {},
  );
  queue.edit("url", "unfinished");
  expect(await queue.flush()).toBe(false);
  expect(queue.state.error).toBe("Invalid URL");
});
