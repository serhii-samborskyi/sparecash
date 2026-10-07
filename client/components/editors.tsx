import { useState } from "react";
import { Plus, Trash2, Copy, ArrowDown } from "lucide-react";
import { Field, Spinner } from "./ui";
import { post } from "../api";
import { landingSchema } from "../../server/domain";
export const defaultLanding = () =>
  landingSchema.parse({
    title: "A little more room for what matters.",
    description:
      "Explore loan options, on your terms. Tell us what you’re looking for and choose how you’d like to hear from us.",
  });
export function ExperimentEditor({
  initial,
  onSaved,
  notify,
}: {
  initial: any;
  onSaved: () => void;
  notify: (s: string) => void;
}) {
  const [form, setForm] = useState<any>(
    initial ?? {
      name: "New experiment",
      slug: `experiment-${Date.now().toString().slice(-6)}`,
      status: "DRAFT",
      objective: "SUBSCRIPTIONS",
      variants: [
        { name: "Direct introduction", weight: 50, config: defaultLanding() },
        {
          name: "Short quiz",
          weight: 50,
          config: {
            ...defaultLanding(),
            title: "Let’s find your next step.",
            questions: [
              {
                id: "amount",
                label: "How much are you looking for?",
                options: [
                  "Under $1,000",
                  "$1,000–$2,500",
                  "$2,500–$5,000",
                  "Over $5,000",
                ],
              },
            ],
          },
        },
      ],
    },
  );
  const [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const v = form.variants[selected];
  const set = (key: string, value: any) => setForm({ ...form, [key]: value });
  const variant = (key: string, value: any) =>
    set(
      "variants",
      form.variants.map((x: any, i: number) =>
        i === selected ? { ...x, [key]: value } : x,
      ),
    );
  const config = (key: string, value: any) =>
    variant("config", { ...v.config, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/admin/experiments", form);
      notify("Experiment saved");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Experiment name">
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field
            label="Page address"
            hint="Visitors open /go/your-page-address"
          >
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
            />
          </Field>
          <Field label="Optimization goal">
            <select
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
            >
              {["SUBSCRIPTIONS", "SOLD", "APPROVED", "FUNDED", "REVENUE"].map(
                (x) => (
                  <option key={x} value={x}>
                    {
                      (
                        {
                          SUBSCRIPTIONS: "Confirmed subscriptions",
                          SOLD: "Purchased leads",
                          APPROVED: "Loan approvals",
                          FUNDED: "Funded loans",
                          REVENUE: "Revenue per visitor",
                        } as any
                      )[x]
                    }
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option>DRAFT</option>
              <option>ACTIVE</option>
              <option>PAUSED</option>
            </select>
          </Field>
        </div>
        <div className="editor-divider">
          <h3>Landing variants</h3>
          <button
            type="button"
            className="text-button"
            disabled={form.variants.length >= 8}
            onClick={() => {
              set("variants", [
                ...form.variants,
                {
                  name: `Variant ${form.variants.length + 1}`,
                  weight: 25,
                  config: defaultLanding(),
                },
              ]);
              setSelected(form.variants.length);
            }}
          >
            <Plus size={15} />
            Add variant
          </button>
        </div>
        <div className="tabs">
          {form.variants.map((x: any, i: number) => (
            <button
              type="button"
              key={i}
              className={selected === i ? "active" : ""}
              onClick={() => setSelected(i)}
            >
              {String.fromCharCode(65 + i)} · {x.name}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Variant name">
            <input
              value={v.name}
              onChange={(e) => variant("name", e.target.value)}
            />
          </Field>
          <Field
            label="Traffic weight"
            hint="Traffic is split in proportion to the weights. Zero pauses a variant."
          >
            <input
              type="number"
              min="0"
              max="100"
              value={v.weight}
              onChange={(e) => variant("weight", Number(e.target.value))}
            />
          </Field>
          <Field label="Headline">
            <input
              value={v.config.title}
              onChange={(e) => config("title", e.target.value)}
            />
          </Field>
          <Field label="Intro label">
            <input
              value={v.config.eyebrow}
              onChange={(e) => config("eyebrow", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            rows={3}
            value={v.config.description}
            onChange={(e) => config("description", e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Button label">
            <input
              value={v.config.button}
              onChange={(e) => config("button", e.target.value)}
            />
          </Field>
          <Field label="Color palette">
            <select
              value={v.config.theme}
              onChange={(e) => config("theme", e.target.value)}
            >
              <option value="forest">Forest & mint</option>
              <option value="blue">Navy & sky</option>
              <option value="plum">Plum & lilac</option>
            </select>
          </Field>
        </div>
        <div className="editor-divider">
          <h3>
            Quiz questions <span className="muted">· optional</span>
          </h3>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              config("questions", [
                ...v.config.questions,
                {
                  id: `question_${v.config.questions.length + 1}`,
                  label: "What matters most to you?",
                  options: ["Lower payments", "A quick decision"],
                },
              ])
            }
          >
            <Plus size={15} />
            Add question
          </button>
        </div>
        {v.config.questions.map((q: any, i: number) => (
          <div className="question-editor" key={i}>
            <div className="form-grid">
              <Field label="Question">
                <input
                  value={q.label}
                  onChange={(e) =>
                    config(
                      "questions",
                      v.config.questions.map((x: any, j: number) =>
                        i === j ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Answer options (one per line)">
                <textarea
                  rows={3}
                  value={q.options.join("\n")}
                  onChange={(e) =>
                    config(
                      "questions",
                      v.config.questions.map((x: any, j: number) =>
                        i === j
                          ? { ...x, options: e.target.value.split("\n") }
                          : x,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <button
              type="button"
              className="text-button danger"
              onClick={() =>
                config(
                  "questions",
                  v.config.questions.filter((_: any, j: number) => j !== i),
                )
              }
            >
              <Trash2 size={14} />
              Remove question
            </button>
          </div>
        ))}
        <details>
          <summary>Consent wording & version</summary>
          <p className="help">
            Consent text is recorded with each contact. Update the version
            whenever this wording changes.
          </p>
          <Field label="Consent version">
            <input
              value={v.config.consentVersion}
              onChange={(e) => config("consentVersion", e.target.value)}
            />
          </Field>
          {["emailConsent", "smsConsent", "pushConsent"].map((key) => (
            <Field key={key} label={key.replace("Consent", " consent")}>
              <textarea
                rows={3}
                value={v.config[key]}
                onChange={(e) => config(key, e.target.value)}
              />
            </Field>
          ))}
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <p>Changes are saved to this experiment.</p>
        <button className="button" disabled={busy}>
          {busy ? <Spinner /> : null}Save experiment
        </button>
      </div>
    </form>
  );
}
export function ChainEditor({
  initial,
  onSaved,
  notify,
}: {
  initial: any;
  onSaved: () => void;
  notify: (s: string) => void;
}) {
  const [form, setForm] = useState<any>(
    initial ?? {
      name: "New follow-up chain",
      channel: "EMAIL",
      trigger: "SUBSCRIBED",
      status: "DRAFT",
      maxDays: 30,
      steps: [
        {
          delayHours: 24,
          subject: "Your next step, {{name}}",
          body: "Hi {{name}}, explore the loan options available to you. Review the terms carefully before deciding. {{link}}",
        },
      ],
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key: string, value: any) => setForm({ ...form, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/admin/chains", form);
      notify("Follow-up chain saved");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="modal-body">
        <div className="form-grid">
          <Field label="Chain name">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Channel">
            <select
              value={form.channel}
              onChange={(e) => set("channel", e.target.value)}
            >
              <option value="EMAIL">Email · Brevo</option>
              <option value="SMS">Text · BlueBubbles</option>
              <option value="PUSH">Browser push · OneSignal</option>
            </select>
          </Field>
          <Field label="Entry condition">
            <select
              value={form.trigger}
              onChange={(e) => set("trigger", e.target.value)}
            >
              <option value="SUBSCRIBED">Confirmed subscription</option>
              <option value="CLICKED">Clicked through a follow-up</option>
              <option value="DECLINED">Explicitly declined</option>
              <option value="NO_CONVERSION">
                No conversion after waiting period
              </option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option>DRAFT</option>
              <option>ACTIVE</option>
              <option>PAUSED</option>
            </select>
          </Field>
          <Field label="Maximum journey length (days)">
            <input
              type="number"
              min="1"
              max="365"
              value={form.maxDays}
              onChange={(e) => set("maxDays", Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="notice subtle">
          One active sequence per person, per channel. Messages are spaced at
          least 24 hours apart and respect the recipient’s local sending window.
        </div>
        {form.steps.map((step: any, i: number) => (
          <div key={i} className="step-editor">
            <div className="step-top">
              <span className="step-number">{i + 1}</span>
              <h3>{i === 0 ? "First follow-up" : "Next follow-up"}</h3>
              {form.steps.length > 1 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove step"
                  onClick={() =>
                    set(
                      "steps",
                      form.steps.filter((_: any, j: number) => j !== i),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <div className="form-grid">
              <Field label="Wait before sending (hours)">
                <input
                  type="number"
                  min="24"
                  value={step.delayHours}
                  onChange={(e) =>
                    set(
                      "steps",
                      form.steps.map((s: any, j: number) =>
                        j === i
                          ? { ...s, delayHours: Number(e.target.value) }
                          : s,
                      ),
                    )
                  }
                />
              </Field>
              <Field
                label={
                  form.channel === "EMAIL"
                    ? "Email subject"
                    : "Notification title"
                }
              >
                <input
                  value={step.subject}
                  onChange={(e) =>
                    set(
                      "steps",
                      form.steps.map((s: any, j: number) =>
                        j === i ? { ...s, subject: e.target.value } : s,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <Field
              label="Message"
              hint="Use {{name}} for the first name and {{link}} for the tracked loan-options link."
            >
              <textarea
                rows={4}
                value={step.body}
                onChange={(e) =>
                  set(
                    "steps",
                    form.steps.map((s: any, j: number) =>
                      j === i ? { ...s, body: e.target.value } : s,
                    ),
                  )
                }
              />
            </Field>
          </div>
        ))}
        <button
          type="button"
          className="button secondary full"
          onClick={() =>
            set("steps", [
              ...form.steps,
              {
                delayHours: 24,
                subject: "Explore your options",
                body: "Hi {{name}}, here is a reminder to explore your options when the time is right. {{link}}",
              },
            ])
          }
        >
          <Plus size={16} />
          Add follow-up
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <p>Pause or duplicate enrolled chains to preserve history.</p>
        <button className="button" disabled={busy}>
          {busy && <Spinner />}Save chain
        </button>
      </div>
    </form>
  );
}
