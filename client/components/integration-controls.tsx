import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Copy, Plug } from "lucide-react";
import { api } from "../api";
import { Field, Spinner } from "./ui";

type TestResult = {
  status: "success" | "warning" | "error";
  checks: { label: string; ok: boolean; message: string }[];
};
export function ProviderTestButton({
  provider,
  name,
  saved,
  needsSave,
  disabled,
}: {
  provider: string;
  name: string;
  saved: object;
  needsSave: boolean;
  disabled: boolean;
}) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null);
    setError("");
    setTesting(false);
    return () => request.current?.abort();
  }, [saved, needsSave]);
  return (
    <div className="provider-test">
      <button
        type="button"
        className="button secondary"
        disabled={testing || disabled || needsSave}
        aria-label={`Test ${name} connection`}
        onClick={async () => {
          const controller = new AbortController();
          request.current = controller;
          setTesting(true);
          setResult(null);
          setError("");
          try {
            const data = await api<TestResult>(
              `/admin/integrations/${provider}/test`,
              {
                method: "POST",
                signal: controller.signal,
              },
            );
            if (!controller.signal.aborted) setResult(data);
          } catch (error) {
            if (!controller.signal.aborted) setError((error as Error).message);
          } finally {
            if (!controller.signal.aborted) setTesting(false);
          }
        }}
      >
        {testing ? <Spinner /> : <Plug size={16} />}
        {testing ? "Testing…" : "Test connection"}
      </button>
      <p className="help">
        {needsSave
          ? "Save connection settings before testing these changes."
          : "Checks saved settings without sending messages or changing campaigns."}
      </p>
      <div aria-live="polite" aria-atomic="true">
        {!needsSave && result && (
          <div className={`connection-result ${result.status}`}>
            <strong>
              {result.status === "success"
                ? "Connection verified"
                : result.status === "warning"
                  ? "Connected — setup needs attention"
                  : "Connection not verified"}
            </strong>
            <ul>
              {result.checks.map((check) => (
                <li key={check.label}>
                  {check.ok ? (
                    <CheckCircle2 size={16} aria-label="Passed" />
                  ) : (
                    <CircleAlert size={16} aria-label="Needs attention" />
                  )}
                  <span>
                    <b>{check.label}:</b> {check.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!needsSave && error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

export function BlueBubblesReplyUrl({
  saved,
  needsSave,
  disabled,
  notify,
}: {
  saved: object;
  needsSave: boolean;
  disabled: boolean;
  notify: (message: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setUrl("");
    setError("");
    if (!needsSave)
      api("/admin/integrations/bluebubbles/webhook", {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setUrl(data.webhookUrl);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        });
    return () => controller.abort();
  }, [saved, needsSave]);
  return (
    <>
      <Field
        label="BlueBubbles reply webhook URL"
        hint="Paste this complete URL into BlueBubbles → API & Webhooks and enable new-message. Replies from known contacts appear in their CRM timeline; STOP replies unsubscribe them."
      >
        <textarea
          readOnly
          rows={3}
          spellCheck={false}
          value={needsSave ? "" : url}
          placeholder={
            needsSave
              ? "Save connection settings to update the reply URL."
              : error
                ? "Unable to load the reply URL. Reload Settings to try again."
                : "Loading reply URL…"
          }
          onFocus={(event) => event.currentTarget.select()}
        />
      </Field>
      <div className="row-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!url || needsSave || disabled}
          onClick={async () => {
            setError("");
            try {
              await navigator.clipboard.writeText(url);
              notify("BlueBubbles reply URL copied");
            } catch {
              setError("Select the reply URL above and copy it manually.");
            }
          }}
        >
          <Copy size={16} />
          Copy reply URL
        </button>
      </div>
      {needsSave && (
        <p className="help" role="status">
          Save the Application URL or general webhook token changes before
          copying.
        </p>
      )}
      {!needsSave && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
