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
          ? "Waiting for these changes to save. Leave the field to finish saving."
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
              ? "Leave the field and wait for changes to save."
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
          Waiting for the Application URL or webhook token to finish saving.
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

export function ProviderDeliveryTest({
  provider,
  saved,
  needsSave,
  disabled,
  service = "SMS",
}: {
  provider: "onesignal" | "brevo" | "bluebubbles";
  saved: object;
  needsSave: boolean;
  disabled: boolean;
  service?: string;
}) {
  const [recipient, setRecipient] = useState("");
  const [emailKind, setEmailKind] = useState("campaign");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [result, setResult] = useState<{
    status: string;
    message: string;
    providerId?: string;
  } | null>(null);
  const name =
    provider === "onesignal"
      ? "push"
      : provider === "brevo"
        ? "email"
        : service;
  useEffect(() => {
    if (!inFlight.current) setResult(null);
  }, [saved, needsSave]);
  return (
    <div className="delivery-test">
      <h4>Send a test {name}</h4>
      <p className="help">
        Sends one real message to the recipient below, even while live
        follow-ups are paused. Use your own device or inbox.
      </p>
      {provider === "brevo" && (
        <Field label="Email test type">
          <select
            value={emailKind}
            disabled={sending}
            onChange={(event) => {
              setEmailKind(event.target.value);
              setResult(null);
            }}
          >
            <option value="campaign">Follow-up campaign email</option>
            <option value="transactional">
              Confirmation / transactional email
            </option>
          </select>
        </Field>
      )}
      <Field
        label={
          provider === "onesignal"
            ? "Test push subscription ID"
            : provider === "brevo"
              ? "Test email address"
              : "Test phone number or iMessage address"
        }
        hint={
          provider === "onesignal"
            ? "Subscribe on your phone using a published landing page, then copy that device's Subscription ID from OneSignal → Audience → Subscriptions. This is different from the app ID."
            : provider === "brevo"
              ? "Check both email types to verify confirmations and marketing delivery."
              : "Use a country code, for example +13125550123. iMessage requires an iMessage-capable recipient; SMS requires Text Message Forwarding on your iPhone and Mac."
        }
      >
        <input
          type={provider === "brevo" ? "email" : "text"}
          value={recipient}
          disabled={sending}
          autoComplete="off"
          placeholder={
            provider === "onesignal"
              ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              : provider === "brevo"
                ? "you@example.com"
                : "+13125550123"
          }
          onChange={(event) => {
            setRecipient(event.target.value);
            setResult(null);
          }}
        />
      </Field>
      <button
        type="button"
        className="button secondary"
        disabled={sending || disabled || needsSave || !recipient.trim()}
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          setSending(true);
          setResult(null);
          try {
            setResult(
              await api(`/admin/integrations/${provider}/send-test`, {
                method: "POST",
                body: JSON.stringify({
                  recipient: recipient.trim(),
                  emailKind,
                  requestId: crypto.randomUUID(),
                }),
              }),
            );
          } catch (error) {
            const status = (error as Error & { status?: number }).status;
            const rejected =
              status !== undefined && status >= 400 && status < 500;
            setResult({
              status: rejected ? "error" : "unknown",
              message: rejected
                ? (error as Error).message
                : "The test could not be confirmed. Check your device and provider logs before trying again.",
            });
          } finally {
            inFlight.current = false;
            setSending(false);
          }
        }}
      >
        {sending && <Spinner />}
        {sending ? "Sending test…" : `Send test ${name}`}
      </button>
      {needsSave && (
        <p className="help">
          Leave the settings field and wait for changes to save before sending a
          test.
        </p>
      )}
      {result && (
        <div
          className={`connection-result ${result.status === "accepted" ? "success" : result.status === "error" ? "error" : "warning"}`}
          role="status"
        >
          <strong>
            {result.status === "accepted"
              ? "Accepted by provider"
              : result.status === "error"
                ? "Test needs attention"
                : "Check before retrying"}
          </strong>
          <p>{result.message}</p>
          {result.providerId && <p>Provider reference: {result.providerId}</p>}
        </div>
      )}
    </div>
  );
}
