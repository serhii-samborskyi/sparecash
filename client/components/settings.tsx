import { useState } from "react";
import { Save, ShieldCheck, Clock, Link2, FileText } from "lucide-react";
import { Field, Spinner } from "./ui";
import { api } from "../api";
import { TimezoneSelect } from "./timezone-select";
export function SettingsView({
  value,
  onSaved,
  notify,
  ipTimezoneConfigured,
}: {
  value: any;
  onSaved: () => void;
  notify: (s: string) => void;
  ipTimezoneConfigured: boolean;
}) {
  const [form, setForm] = useState({ ...value }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key: string, value: any) => setForm({ ...form, [key]: value });
  const num = (key: string, label: string, min: number, max: number) => (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={key === "botRateThreshold" ? 0.01 : 1}
        value={form[key]}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </Field>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      notify("Settings saved");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="settings-form" onSubmit={save}>
      <section className="panel">
        <div className="panel-heading">
          <ShieldCheck size={20} />
          <div>
            <h3>Traffic protection</h3>
            <p>Control when a source qualifies for exclusion.</p>
          </div>
        </div>
        <label className="switch-row">
          <span>
            <b>Evaluate sources automatically</b>
            <small>
              Uses Turnstile and abuse evidence, with a statistical confidence
              threshold.
            </small>
          </span>
          <input
            type="checkbox"
            checked={form.sourceAutomation}
            onChange={(e) => set("sourceAutomation", e.target.checked)}
          />
        </label>
        <div className="form-grid three">
          {num("minimumVisits", "Minimum visits per source", 50, 100000)}
          {num("minimumAgeHours", "Minimum observation period (hours)", 1, 720)}
          {num("botRateThreshold", "Bot-rate lower-bound threshold", 0.5, 1)}
          {num("maxBlocksPerRun", "Maximum exclusions per run", 1, 20)}
          {num("lookbackDays", "Evidence window (days)", 1, 30)}
        </div>
        <p className="help">
          Enable Live source exclusions in Application & delivery to apply
          exclusions. Failed challenges caused by expiry or connectivity do not
          count as confirmed bot evidence.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <Clock size={20} />
          <div>
            <h3>Follow-up rules</h3>
            <p>Every channel has its own journey and daily limit.</p>
          </div>
        </div>
        <div className="form-grid three">
          <Field label="Schedule follow-ups using">
            <select
              value={form.followupTimezoneMode}
              onChange={(e) => set("followupTimezoneMode", e.target.value)}
            >
              <option value="RECIPIENT">Each lead’s time zone</option>
              <option value="WORKSPACE">
                Workspace time zone for everyone
              </option>
            </select>
          </Field>
          <Field
            label="Workspace / fallback time zone"
            hint="Used when detection is unavailable, or for everyone in workspace mode."
          >
            <TimezoneSelect
              value={form.workspaceTimezone}
              onChange={(zone) => set("workspaceTimezone", zone)}
            />
          </Field>
          <Field label="Detect new leads’ time zones">
            <select
              value={form.timezoneDetection}
              onChange={(e) => set("timezoneDetection", e.target.value)}
            >
              <option value="BROWSER_FIRST">Browser first, then IP</option>
              <option value="IP_FIRST">IP first, then browser</option>
            </select>
          </Field>
        </div>
        <p className="help">
          Time zones adjust for daylight saving. You can override a lead’s time
          zone in Audience.{" "}
          {ipTimezoneConfigured
            ? "Cloudflare IP detection credentials are configured; location headers must also be enabled on the domain."
            : "IP detection needs Cloudflare setup. Browser detection and the fallback work now."}
        </p>
        <div className="form-grid three">
          {num("sendHourStart", "Start hour (selected time zone)", 9, 18)}
          {num("sendHourEnd", "End hour (selected time zone)", 11, 20)}
          {num(
            "maxDaysWithoutConversion",
            "No-conversion branch after (days)",
            1,
            365,
          )}
          <Field label="Stop all journeys after">
            <select
              value={form.stopOn}
              onChange={(e) => set("stopOn", e.target.value)}
            >
              <option value="SOLD">Purchased lead</option>
              <option value="APPROVED">Approved loan</option>
              <option value="FUNDED">Funded loan</option>
            </select>
          </Field>
        </div>
        <p className="help">
          The current RoundSky pixel reports purchased leads. Approval and
          funding require separate events; use Purchased lead to stop on this
          pixel.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <Link2 size={20} />
          <div>
            <h3>RoundSky connection</h3>
            <p>LeadTechX self-optimizing offer and sold-lead callback.</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Hosted affiliate URL">
            <input
              type="url"
              placeholder="https://www.rnd3.com/ai/iframeRedirect.php?id=..."
              value={form.roundskyUrl}
              onChange={(e) => set("roundskyUrl", e.target.value)}
            />
          </Field>
          <Field
            label="Application tracking parameter"
            hint="Required by RoundSky for a unique HID."
          >
            <input value={form.roundskySubIdParameter} readOnly />
          </Field>
        </div>
        <p className="help">
          subId identifies the campaign, subId2 identifies the source zone, and
          subId3 contains the unique application ID returned by RoundSky. Direct
          visits use “direct” for the campaign and source.
        </p>
        <label className="switch-row">
          <span>
            <b>Prefill the partner application</b>
            <small>
              Pass the visitor’s submitted first name and available email or
              phone. An exact requested amount is passed only when one was
              collected.
            </small>
          </span>
          <input
            type="checkbox"
            checked={form.roundskyPrepopulate}
            onChange={(e) => set("roundskyPrepopulate", e.target.checked)}
          />
        </label>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <FileText size={20} />
          <div>
            <h3>Business details & disclosures</h3>
            <p>Shown to visitors and included in email campaigns.</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Business name">
            <input
              value={form.businessName}
              onChange={(e) => set("businessName", e.target.value)}
            />
          </Field>
          <Field label="Contact email">
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Business mailing address">
          <input
            value={form.businessAddress}
            onChange={(e) => set("businessAddress", e.target.value)}
          />
        </Field>
        <Field label="Privacy policy">
          <textarea
            rows={7}
            value={form.privacyText}
            onChange={(e) => set("privacyText", e.target.value)}
            placeholder="Add your business’s privacy policy before publishing."
          />
        </Field>
        <Field label="Terms & offer disclosures">
          <textarea
            rows={7}
            value={form.termsText}
            onChange={(e) => set("termsText", e.target.value)}
            placeholder="Add the applicable terms and lender disclosures before publishing."
          />
        </Field>
      </section>
      <div className="save-bar">
        {error && <p className="error">{error}</p>}
        <button className="button" disabled={busy}>
          {busy ? <Spinner /> : <Save size={16} />}Save settings
        </button>
      </div>
    </form>
  );
}
