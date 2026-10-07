import { useEffect, useState } from "react";
import { Save, KeyRound, Plug, Globe, Eye, Copy } from "lucide-react";
import { api } from "../api";
import { Field, Spinner } from "./ui";
import {
  BlueBubblesReplyUrl,
  ProviderTestButton,
} from "./integration-controls";
type Configuration = {
  values: Record<string, string | number>;
  secrets: Record<string, boolean>;
};
export function ConnectionSettings({
  notify,
  onSaved,
}: {
  notify: (message: string) => void;
  onSaved: () => void;
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [repeatPassword, setRepeatPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
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
        onChange={(event) =>
          setValues((previous) => ({
            ...previous,
            [key]:
              type === "number"
                ? Number(event.target.value)
                : event.target.value,
          }))
        }
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
                ? "Will be cleared on save"
                : configuration?.secrets[key]
                  ? "•••••••• · saved"
                  : "Enter credential"
            }
            onChange={(event) => {
              const value = event.target.value;
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
              onClick={() =>
                setSecrets((previous) => ({ ...previous, [key]: "" }))
              }
            >
              Clear on save
            </button>
          )}
          {key in secrets && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setSecrets((previous) => {
                  const next = { ...previous };
                  delete next[key];
                  return next;
                })
              }
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
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await api("/admin/configuration", {
              method: "PATCH",
              body: JSON.stringify({ values, secrets }),
            });
            setConfiguration(result);
            setValues(result.values);
            setSecrets({});
            setRevealed({});
            setPixel(null);
            notify("Connection settings saved");
            onSaved();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
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
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  LIVE_DELIVERY: String(event.target.checked),
                }))
              }
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
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  LIVE_SOURCE_BLOCKING: String(event.target.checked),
                }))
              }
            />
          </label>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <Plug size={20} />
            <div>
              <h3>Provider connections</h3>
              <p>
                Credentials are encrypted in your database. Blank fields keep
                saved credentials.
              </p>
            </div>
          </div>
          <h3>RoundSky</h3>
          {secret(
            "ROUNDSKY_WEBHOOK_TOKEN",
            "RoundSky webhook secret",
            "After changing this secret, save connection settings to update the pixel URL below.",
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
                  ? "Save connection settings to generate the updated pixel URL."
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
              Save connection settings before copying the updated pixel URL.
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
          <h3>BlueBubbles</h3>
          <div className="form-grid">
            {field("BLUEBUBBLES_URL", "BlueBubbles server URL", "url")}
            {secret("BLUEBUBBLES_PASSWORD", "BlueBubbles password")}
          </div>
          {testButton("bluebubbles", "BlueBubbles", [
            "BLUEBUBBLES_URL",
            "BLUEBUBBLES_PASSWORD",
            "APP_URL",
            "WEBHOOK_TOKEN",
          ])}
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
        <div className="save-bar">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy ? <Spinner /> : <Save size={16} />}Save connection settings
          </button>
        </div>
      </form>
      <form
        className="settings-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          if (newPassword !== repeatPassword) {
            setError("The new passwords do not match.");
            return;
          }
          setChangingPassword(true);
          try {
            await api("/admin/configuration/password", {
              method: "POST",
              body: JSON.stringify({ currentPassword, newPassword }),
            });
            location.assign("/admin");
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setChangingPassword(false);
          }
        }}
      >
        <section className="panel">
          <h3>Owner password</h3>
          <p className="help">
            Changing your password signs out all owner sessions.
          </p>
          <div className="form-grid">
            <Field label="Current password">
              <input
                required
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field label="New password">
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="Repeat new password">
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
              />
            </Field>
          </div>
          <button className="button secondary" disabled={changingPassword}>
            {changingPassword && <Spinner />}Change owner password
          </button>
        </section>
      </form>
    </>
  );
}
