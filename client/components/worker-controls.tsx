import { useCallback, useEffect, useState } from "react";
import { Activity, Play, RefreshCw, Square } from "lucide-react";
import { api } from "../api";
import { Badge, Spinner } from "./ui";

const tone = (state: string) =>
  state === "RUNNING"
    ? "green"
    : state === "STARTING"
      ? "amber"
      : state === "ERROR" || state === "STALE"
        ? "red"
        : "neutral";

const label = (state: string) =>
  ({
    RUNNING: "Running",
    STARTING: "Starting",
    STOPPED: "Stopped",
    STALE: "Needs attention",
    ERROR: "Error",
  })[state] ?? state;

function queueSummary(worker: any) {
  if (worker.id === "automation")
    return `${worker.queue.active ?? 0} active · ${worker.queue.due ?? 0} due · ${worker.queue.held ?? 0} held`;
  return `${worker.queue.pending ?? 0} pending · ${worker.queue.failed ?? 0} failed · ${worker.queue.uncertain ?? 0} uncertain`;
}

export function WorkerControls({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<any>();
  const [busy, setBusy] = useState<string>();
  const load = useCallback(async () => {
    try {
      setData(await api("/admin/workers"));
    } catch (error) {
      notify((error as Error).message);
    }
  }, [notify]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const act = async (id: string, action: string) => {
    setBusy(`${id}:${action}`);
    try {
      setData(
        await api(`/admin/workers/${id}/${action}`, {
          method: "POST",
          body: "{}",
        }),
      );
      notify(
        action === "stop"
          ? "Worker stopped"
          : action === "start"
            ? "Worker started"
            : "Fresh worker cycle requested",
      );
      window.setTimeout(() => void load(), 1_000);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section
      className="panel worker-controls settings-anchor"
      id="settings-workers"
    >
      <div className="panel-heading">
        <Activity size={20} />
        <div>
          <h3>Background workers</h3>
          <p>Monitor queues and control each worker independently.</p>
        </div>
        <button
          type="button"
          className="icon-button worker-refresh"
          aria-label="Refresh worker statuses"
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <div className="worker-grid">
          {data.workers.map((worker: any) => (
            <article className="worker-card" key={worker.id}>
              <div className="worker-card-heading">
                <div>
                  <h4>{worker.name}</h4>
                  <p>{worker.description}</p>
                </div>
                <Badge tone={tone(worker.state)}>{label(worker.state)}</Badge>
              </div>
              <div className="worker-facts">
                <span>
                  <b>Queue</b>
                  {queueSummary(worker)}
                </span>
                <span>
                  <b>Last cycle</b>
                  {worker.lastRunAt
                    ? new Date(worker.lastRunAt).toLocaleString()
                    : "Not recorded yet"}
                </span>
              </div>
              {worker.lastError && (
                <p className="worker-error">{worker.lastError}</p>
              )}
              <div className="row-actions">
                <button
                  type="button"
                  className="button secondary compact"
                  disabled={worker.enabled || Boolean(busy)}
                  onClick={() => void act(worker.id, "start")}
                >
                  <Play size={14} /> Start
                </button>
                <button
                  type="button"
                  className="button secondary compact"
                  disabled={!worker.enabled || Boolean(busy)}
                  onClick={() => void act(worker.id, "stop")}
                >
                  <Square size={13} /> Stop
                </button>
                <button
                  type="button"
                  className="button secondary compact"
                  disabled={Boolean(busy)}
                  onClick={() => void act(worker.id, "restart")}
                >
                  {busy === `${worker.id}:restart` ? (
                    <Spinner />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Restart
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="help">
        Stop prevents new cycles; an in-progress provider request is allowed to
        finish safely. Restart requests a fresh cycle immediately.
      </p>
    </section>
  );
}
