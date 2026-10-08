import { useEffect, useState } from "react";
import { KeyRound, Plug, Globe, Eye, Copy } from "lucide-react";
import { api } from "../api";
import { useAutosave } from "../hooks/use-autosave";
import { AutosaveStatus } from "./autosave-status";
import { Field, Spinner } from "./ui";
import {
  BlueBubblesReplyUrl,
  ProviderTestButton,
  ProviderDeliveryTest,
} from "./integration-controls";
type Configuration = {
  values: Record<string, string | number>;
  secrets: Record<string, boolean>;
  credentialsNeedReview: boolean;
};
export function ConnectionSettings({
  notify,
  onSaved,
}: {
  notify: (message: string) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [pixel, setPixel] = useState<{ pixelUrl: string } | null>(null);
  const [pixelError, setPixelError] = useState("");
  const pixelNeedsSave =
    values.APP_URL !== configuration?.values.APP_URL ||
    "ROUNDSKY_WEBHOOK_TOKEN" in secrets;
  const [error, setError] = useState("");
  const [credentialsReviewed, setCredentialsReviewed] = useState(false);
  const { queue, state } = useAutosave(async (patch) => {
    const payload: {
      values: Record<string, unknown>;
      secrets: Record<string, unknown>;
      credentialsReviewed?: true;
    } = { values: {}, secrets: {} };
    for (const [key, value] of Object.entries(patch)) {
      const [kind, field] = key.split(".");
      if (kind === "values" || kind === "secrets") payload[kind][field] = value;
      else if (key === "credentialsReviewed")
        payload.credentialsReviewed = true;
    }
    const result = await api("/admin/configuration", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setConfiguration(result);
    const acceptedSecrets = Object.entries(payload.secrets).filter(
      ([key, value]) => queue.matches(`secrets.${key}`, value),
    );
    setSecrets((current) => {
      const next = { ...current };
      for (const [key, value] of acceptedSecrets)
        if (next[key] === value) delete next[key];
      return next;
    });
    setValues((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(payload.values))
        if (next[key] === value) next[key] = result.values[key];
      return next;
    });
    setRevealed({});
    if (payload.credentialsReviewed) setCredentialsReviewed(false);
    await onSaved();
  });
  const busy = state.status === "saving";
  useEffect(() => {
    let active = true;
    api("/admin/configuration")
      .then((data) => {
        if (active) {
          setConfiguration(data);
          setValues(data.values);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setPixel(null);
    setPixelError("");
    if (!configuration || pixelNeedsSave) return;
    api("/admin/integrations/roundsky/pixel")
      .then((data) => {
        if (active) setPixel(data);
      })
      .catch((error) => {
        if (active) setPixelError(error.message);
      });
    return () => {
      active = false;
    };
  }, [configuration, pixelNeedsSave]);
  const changed = (...keys: string[]) =>
    keys.some(
      (key) =>
        key in secrets ||
        (key in values && values[key] !== configuration?.values[key]),
    );
  const testButton = (provider: string, name: string, keys: string[]) => (
    <ProviderTestButton
      provider={provider}
      name={name}
      saved={configuration!}
      needsSave={changed(...keys)}
      disabled={busy}
    />
  );
  const field = (key: string, label: string, type = "text", hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        type={type}
        value={values[key] ?? ""}
        min={type === "number" ? 0 : undefined}
        onBlur={() => {
          void queue.commit(`values.${key}`);
        }}
        onChange={(event) => {
          const value =
            type === "number" ? Number(event.target.value) : event.target.value;
          setValues((previous) => ({ ...previous, [key]: value }));
          queue.edit(`values.${key}`, value);
        }}
      />
    </Field>
  );
  function secret(key: string, label: string, hint?: string) {
    const required = [
      "TOKEN_SECRET",
      "MCP_TOKEN",
      "WEBHOOK_TOKEN",
      "ROUNDSKY_WEBHOOK_TOKEN",
    ].includes(key);
    return (
      <div key={key}>
        <Field
          label={label}
          hint={
            hint ??
            (configuration?.secrets[key]
              ? "Saved. Leave blank to keep the current value."
              : "Not configured yet.")
          }
        >
          <input
            type={key in revealed ? "text" : "password"}
            autoComplete="new-password"
            value={secrets[key] ?? revealed[key] ?? ""}
            placeholder={
              secrets[key] === ""
                ? "Clearing…"
                : configuration?.secrets[key]
                  ? "•••••••• · saved"
                  : "Enter credential"
            }
            onBlur={() => {
              void queue.commit(`secrets.${key}`);
            }}
            onChange={(event) => {
              const value = event.target.value;
              if (value) queue.edit(`secrets.${key}`, value);
              else queue.cancel(`secrets.${key}`);
              setSecrets((previous) => {
                const next = { ...previous };
                if (value) next[key] = value;
                else delete next[key];
                return next;
              });
              setRevealed((previous) => {
                const next = { ...previous };
                delete next[key];
                return next;
              });
            }}
          />
        </Field>
        <div className="row-actions">
          {configuration?.secrets[key] && (
            <button
              type="button"
              className="text-button"
              aria-label={`${key in revealed ? "Hide" : "Reveal"} ${label}`}
              onClick={async () => {
                if (key in revealed) {
                  setRevealed((previous) => {
                    const next = { ...previous };
                    delete next[key];
                    return next;
                  });
                  return;
                }
                try {
                  const result = await api("/admin/configuration/reveal", {
                    method: "POST",
                    body: JSON.stringify({ name: key }),
                  });
                  setRevealed((previous) => ({
                    ...previous,
                    [key]: result.value,
                  }));
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <Eye size={14} />
              {key in revealed ? "Hide saved value" : "Reveal saved value"}
            </button>
          )}
          {!required && configuration?.secrets[key] && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setSecrets((previous) => ({ ...previous, [key]: "" }));
                queue.edit(`secrets.${key}`, "");
                void queue.commit(`secrets.${key}`);
              }}
            >
              Clear saved value
            </button>
          )}
          {key in secrets && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                queue.cancel(`secrets.${key}`);
                setSecrets((previous) => {
                  const next = { ...previous };
                  delete next[key];
                  return next;
                });
              }}
            >
              Undo change
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!configuration)
    return (
      <section className="panel">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <Spinner />
        )}
      </section>
    );
  return (
    <>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void queue.commit();
        }}
      >
        <AutosaveStatus
          state={state}
          retry={() => {
            void queue.commit();
          }}
        />
        {configuration.credentialsNeedReview && (
          <section className="panel" role="status">
            <h3>Reconnect your providers</h3>
            <p>
              The previous credentials could not be recovered. Your CRM data and
              campaigns are saved. Live sending and source exclusions were
              switched off.
            </p>
            <p>
              Re-enter provider keys, copy the updated RoundSky and BlueBubbles
              webhook URLs, and update your MCP token. Previous confirmation,
              preference, and tracking links will need to be replaced. Enable
              live delivery when setup is complete.
            </p>
            <label className="switch-row">
              <span>I have reviewed and reconnected my integrations</span>
              <input
                type="checkbox"
                checked={credentialsReviewed}
                onChange={(event) => {
                  setCredentialsReviewed(event.target.checked);
                  if (event.target.checked) {
                    queue.edit("credentialsReviewed", true);
                    void queue.commit("credentialsReviewed");
                  }
                }}
              />
            </label>
            <p className="help">
              Checking this box saves your review automatically.
            </p>
          </section>
        )}
        <section className="panel">
          <div className="panel-heading">
            <Globe size={20} />
            <div>
              <h3>Application & delivery</h3>
              <p>Changes apply to new requests and worker cycles.</p>
            </div>
          </div>
          {field(
            "APP_URL",
            "Application URL",
            "url",
            "Used for application links, callbacks, and your remote MCP endpoint.",
          )}
          <label className="switch-row">
            <span>
              <b>Live message delivery</b>
              <small>
                Allow confirmation messages and scheduled email, text, and push
                messages.
              </small>
            </span>
            <input
              type="checkbox"
              checked={values.LIVE_DELIVERY === "true"}
              onChange={(event) => {
                const value = String(event.target.checked);
                setValues((previous) => ({
                  ...previous,
                  LIVE_DELIVERY: value,
                }));
                queue.edit("values.LIVE_DELIVERY", value);
                void queue.commit("values.LIVE_DELIVERY");
              }}
            />
          </label>
          <label className="switch-row">
            <span>
              <b>Live source exclusions</b>
              <small>
                Allow sources that meet your traffic-protection rules to be
                excluded in PropellerAds.
              </small>
            </span>
            <input
              type="checkbox"
              checked={values.LIVE_SOURCE_BLOCKING === "true"}
              onChange={(event) => {
                const value = String(event.target.checked);
                setValues((previous) => ({
                  ...previous,
                  LIVE_SOURCE_BLOCKING: value,
                }));
                queue.edit("values.LIVE_SOURCE_BLOCKING", value);
                void queue.commit("values.LIVE_SOURCE_BLOCKING");
              }}
            />
          </label>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <Plug size={20} />
            <div>
              <h3>Provider connections</h3>
              <p>
                Credentials are stored in your database. Blank fields keep saved
                credentials.
              </p>
            </div>
          </div>
          <h3>RoundSky</h3>
          {secret(
            "ROUNDSKY_WEBHOOK_TOKEN",
            "RoundSky webhook secret",
            "Leave this field to save automatically and update the pixel URL below.",
          )}
          <Field
            label="RoundSky pixel URL"
            hint="In RoundSky, select seller LeadTechX and pixel type “Server 2 Server Requst Pixel”. Paste this complete URL with the bracketed variables unchanged."
          >
            <textarea
              readOnly
              rows={4}
              spellCheck={false}
              value={pixelNeedsSave ? "" : (pixel?.pixelUrl ?? "")}
              placeholder={
                pixelNeedsSave
                  ? "Leave the field and wait for changes to save."
                  : pixelError
                    ? "Unable to load the pixel URL. Reload Settings to try again."
                    : "Loading pixel URL…"
              }
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
          <div className="row-actions">
            <button
              type="button"
              className="button secondary"
              disabled={!pixel || pixelNeedsSave || busy}
              onClick={async () => {
                if (!pixel || pixelNeedsSave) return;
                setPixelError("");
                try {
                  await navigator.clipboard.writeText(pixel.pixelUrl);
                  notify("RoundSky pixel URL copied");
                } catch {
                  setPixelError(
                    "Select the pixel URL above and copy it manually.",
                  );
                }
              }}
            >
              <Copy size={16} />
              Copy pixel URL
            </button>
          </div>
          {pixelNeedsSave && (
            <p className="help" role="status">
              Waiting for changes to save before updating the pixel URL.
            </p>
          )}
          {pixelError && (
            <p className="error" role="alert">
              {pixelError}
            </p>
          )}
          <h3>Cloudflare</h3>
          <div className="form-grid">
            {field("TURNSTILE_SITE_KEY", "Turnstile site key")}
            {secret("TURNSTILE_SECRET_KEY", "Turnstile secret key")}
            {secret(
              "CLOUDFLARE_GEO_TOKEN",
              "IP detection secret",
              "Match the x-sparecash-geo-token header in your Cloudflare rule.",
            )}
          </div>
          <h3>OneSignal</h3>
          <div className="form-grid">
            {field("ONESIGNAL_APP_ID", "OneSignal app ID")}
            {secret("ONESIGNAL_API_KEY", "OneSignal API key")}
          </div>
          {testButton("onesignal", "OneSignal", [
            "ONESIGNAL_APP_ID",
            "ONESIGNAL_API_KEY",
          ])}
          <ProviderDeliveryTest
            provider="onesignal"
            saved={configuration}
            needsSave={changed("ONESIGNAL_APP_ID", "ONESIGNAL_API_KEY")}
            disabled={busy}
          />
          <h3>Brevo</h3>
          <div className="form-grid">
            {secret("BREVO_API_KEY", "Brevo API key")}
            {field("BREVO_SENDER_EMAIL", "Sender email", "email")}
            {field("BREVO_SENDER_NAME", "Sender name")}
            {field("BREVO_FOLDER_ID", "Campaign folder ID", "number")}
          </div>
          {testButton("brevo", "Brevo", [
            "BREVO_API_KEY",
            "BREVO_SENDER_EMAIL",
            "BREVO_SENDER_NAME",
            "BREVO_FOLDER_ID",
          ])}
          <ProviderDeliveryTest
            provider="brevo"
            saved={configuration}
            needsSave={changed(
              "BREVO_API_KEY",
              "BREVO_SENDER_EMAIL",
              "BREVO_SENDER_NAME",
              "BREVO_FOLDER_ID",
            )}
            disabled={busy}
          />
          <h3>BlueBubbles</h3>
          <div className="form-grid">
            {field("BLUEBUBBLES_URL", "BlueBubbles server URL", "url")}
            {secret("BLUEBUBBLES_PASSWORD", "BlueBubbles password")}
            <Field
              label="Text delivery service"
              hint="Used for phone confirmations, follow-ups, and test messages. Keep SMS for Android recipients."
            >
              <select
                value={values.BLUEBUBBLES_SERVICE ?? "SMS"}
                onChange={(event) => {
                  const value = event.target.value;
                  setValues((previous) => ({
                    ...previous,
                    BLUEBUBBLES_SERVICE: value,
                  }));
                  queue.edit("values.BLUEBUBBLES_SERVICE", value);
                  void queue.commit("values.BLUEBUBBLES_SERVICE");
                }}
              >
                <option value="SMS">SMS</option>
                <option value="iMessage">iMessage</option>
              </select>
            </Field>
          </div>
          {testButton("bluebubbles", "BlueBubbles", [
            "BLUEBUBBLES_URL",
            "BLUEBUBBLES_PASSWORD",
            "APP_URL",
            "WEBHOOK_TOKEN",
          ])}
          <ProviderDeliveryTest
            provider="bluebubbles"
            service={String(values.BLUEBUBBLES_SERVICE ?? "SMS")}
            saved={configuration}
            needsSave={changed(
              "BLUEBUBBLES_URL",
              "BLUEBUBBLES_PASSWORD",
              "BLUEBUBBLES_SERVICE",
            )}
            disabled={busy}
          />
          <BlueBubblesReplyUrl
            saved={configuration}
            needsSave={changed("APP_URL", "WEBHOOK_TOKEN")}
            disabled={busy}
            notify={notify}
          />
          <h3>PropellerAds</h3>
          <div className="form-grid">
            {secret("PROPELLER_API_TOKEN", "PropellerAds API token")}
            {field("PROPELLER_API_URL", "PropellerAds API URL", "url")}
          </div>
          {testButton("propellerads", "PropellerAds", [
            "PROPELLER_API_TOKEN",
            "PROPELLER_API_URL",
          ])}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <KeyRound size={20} />
            <div>
              <h3>Access & tracking tokens</h3>
              <p>
                Generated automatically. Reveal a token when connecting a
                service.
              </p>
            </div>
          </div>
          <div className="form-grid">
            {secret("MCP_TOKEN", "MCP bearer token")}
            {secret("WEBHOOK_TOKEN", "General webhook token")}
            {secret(
              "TOKEN_SECRET",
              "Link signing key",
              "Changing this invalidates existing preference, confirmation, and tracked links.",
            )}
          </div>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <section className="panel">
        <h3>Owner password</h3>
        <p className="help">
          Set <code>OWNER_PASSWORD</code> in Coolify → Environment Variables.
          Save and redeploy to change your login password. This signs out
          existing owner sessions. Use the same value for the web app and
          worker.
        </p>
      </section>
    </>
  );
}
