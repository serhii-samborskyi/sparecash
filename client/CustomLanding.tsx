import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import "./custom-landing.css";

type CustomField = {
  id: string;
  valueType: "integer" | "decimal" | "text";
  required: boolean;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number;
  maxLength?: number;
};
type ContactRequirement = "hidden" | "optional" | "required";
type BoundForm = {
  fields: CustomField[];
  contacts: Record<"name" | "phone" | "email", ContactRequirement>;
  matchEstimate?: { amountFieldId: string; scoreFieldId: string };
};
type ProviderSearchView = {
  active: boolean;
  ready: boolean;
  durationMs: number;
  providerCount: number;
};
const ACTIVITY_NOTICE_MIN_DELAY_MS = 5_000;
const ACTIVITY_NOTICE_MAX_DELAY_MS = 15_000;
const ACTIVITY_NOTICE_VISIBLE_MS = 6_300;

export function activityNotificationDelay(random = Math.random()) {
  const normalized = Math.min(Math.max(random, 0), 0.999999999);
  return (
    ACTIVITY_NOTICE_MIN_DELAY_MS +
    Math.floor(
      normalized *
        (ACTIVITY_NOTICE_MAX_DELAY_MS - ACTIVITY_NOTICE_MIN_DELAY_MS + 1),
    )
  );
}

export type BoundFormSubmission = {
  answers: Record<string, string>;
  name?: string;
  phone?: string;
  email?: string;
};

function setOutput(root: HTMLElement, input: HTMLInputElement) {
  const key = input.dataset.scField;
  if (!key) return;
  root
    .querySelectorAll<HTMLOutputElement>(`[data-sc-output="${key}"]`)
    .forEach((output) => {
      const numeric = Number(input.value);
      output.value =
        output.dataset.scFormat === "currency" && Number.isFinite(numeric)
          ? new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            }).format(numeric)
          : input.value;
    });
}

function rangeRatio(input: HTMLInputElement) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function approvalMatchEstimate(amountRatio: number, scoreRatio: number) {
  const normalizedAmount = Math.min(1, Math.max(0, amountRatio));
  const normalizedScore = Math.min(1, Math.max(0, scoreRatio));
  const percent = Math.round(
    40 + normalizedScore * 45 + (1 - normalizedAmount) * 10,
  );
  const strength =
    percent < 55
      ? "Low"
      : percent < 70
        ? "Fair"
        : percent < 82
          ? "Good"
          : "Strong";
  const hue = Math.round(28 + ((percent - 40) / 55) * 117);
  return { percent, strength, color: `hsl(${hue} 55% 39%)` };
}

function updateBoundPresentation(root: HTMLElement, form: BoundForm) {
  root
    .querySelectorAll<HTMLInputElement>("[data-sc-field]")
    .forEach((input) => {
      const ratio = rangeRatio(input);
      const isAmount =
        input.dataset.scField === form.matchEstimate?.amountFieldId;
      const hue = Math.round(isAmount ? 145 - ratio * 95 : 28 + ratio * 117);
      input.style.setProperty("--sc-range-fill", `${Math.round(ratio * 100)}%`);
      input.style.setProperty("--sc-range-color", `hsl(${hue} 58% 42%)`);
    });
  if (!form.matchEstimate) return;
  const amount = root.querySelector<HTMLInputElement>(
    `[data-sc-field="${form.matchEstimate.amountFieldId}"]`,
  );
  const score = root.querySelector<HTMLInputElement>(
    `[data-sc-field="${form.matchEstimate.scoreFieldId}"]`,
  );
  if (!amount || !score) return;
  const estimate = approvalMatchEstimate(rangeRatio(amount), rangeRatio(score));
  root.style.setProperty("--sc-match-color", estimate.color);
  root.style.setProperty("--sc-match-fill", `${estimate.percent}%`);
  root
    .querySelectorAll<HTMLElement>("[data-sc-match-percent]")
    .forEach((element) => (element.textContent = `${estimate.percent}%`));
  root
    .querySelectorAll<HTMLElement>("[data-sc-match-strength]")
    .forEach((element) => (element.textContent = estimate.strength));
}

export function CustomLanding({
  source,
  funnel,
  form,
  busy = false,
  error = "",
  activity = [],
  providerSearch,
  verification,
  onBegin,
  onSubmit,
  onContinue,
}: {
  source: {
    name: string;
    htmlBefore: string;
    htmlAfter: string;
    css: string;
    version?: 1 | 2;
  };
  funnel: ReactNode;
  form?: BoundForm;
  busy?: boolean;
  error?: string;
  activity?: { location: string; amount?: string }[];
  providerSearch?: ProviderSearchView;
  verification?: ReactNode;
  onBegin?: () => void;
  onSubmit?: (submission: BoundFormSubmission) => void | Promise<void>;
  onContinue?: () => void | Promise<void>;
}) {
  const content = useRef<HTMLDivElement>(null);
  const bound = source.version === 2;
  const [activityVisible, setActivityVisible] = useState(false);
  const openFunnel = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = (event.target as Element | null)?.closest(
      '[data-sc-action="open-funnel"]',
    );
    if (!target) return;
    event.preventDefault();
    const application = document.getElementById("application");
    application?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => application?.focus({ preventScroll: true }), 250);
  }, []);

  useEffect(() => {
    if (!bound || !content.current || !form) return;
    const root = content.current;
    for (const field of form.fields) {
      const input = root.querySelector<HTMLInputElement>(
        `[data-sc-field="${field.id}"]`,
      );
      if (!input) continue;
      input.required = field.required;
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
      if (field.maxLength !== undefined) input.maxLength = field.maxLength;
      if (field.defaultValue !== undefined)
        input.value = String(field.defaultValue);
      setOutput(root, input);
    }
    for (const [name, requirement] of Object.entries(form.contacts)) {
      const input = root.querySelector<HTMLInputElement>(
        `[data-sc-contact="${name}"]`,
      );
      if (input) input.required = requirement === "required";
    }
    updateBoundPresentation(root, form);
  }, [bound, form, source.htmlBefore]);

  useEffect(() => {
    if (!bound || !content.current) return;
    const root = content.current;
    const active = providerSearch?.active ?? false;
    const ready = providerSearch?.ready ?? false;
    root
      .querySelectorAll<HTMLElement>("[data-sc-form-view]")
      .forEach((element) => (element.hidden = active));
    root
      .querySelectorAll<HTMLElement>("[data-sc-provider-search]")
      .forEach((element) => {
        element.hidden = !active;
        element.setAttribute(
          "aria-busy",
          active && !ready ? "true" : "false",
        );
      });
    if (!providerSearch) {
      root
        .querySelectorAll<HTMLButtonElement>('[data-sc-action="continue"]')
        .forEach((button) => {
          button.hidden = true;
          button.disabled = true;
        });
      return;
    }
    root
      .querySelectorAll<HTMLElement>("[data-sc-provider-count]")
      .forEach(
        (element) =>
          (element.textContent = String(providerSearch.providerCount)),
      );
    root
      .querySelectorAll<HTMLElement>("[data-sc-provider-status]")
      .forEach(
        (element) =>
          (element.textContent = ready
            ? "Your next step is ready"
            : "Checking participating providers…"),
      );
    root
      .querySelectorAll<HTMLElement>("[data-sc-provider-progress]")
      .forEach((element) => {
        element.style.setProperty(
          "--sc-search-duration",
          `${providerSearch.durationMs}ms`,
        );
        element.classList.toggle(
          "is-active",
          active && !ready,
        );
        element.classList.toggle("is-complete", ready);
      });
    root
      .querySelectorAll<HTMLButtonElement>('[data-sc-action="continue"]')
      .forEach((button) => {
        button.hidden = !ready;
        button.disabled = busy || !ready;
      });
  }, [bound, busy, providerSearch, source.htmlBefore]);

  useEffect(() => {
    if (!bound || activity.length === 0) return;
    setActivityVisible(false);
    const showDelay = activityNotificationDelay();
    const show = window.setTimeout(() => setActivityVisible(true), showDelay);
    const hide = window.setTimeout(
      () => setActivityVisible(false),
      showDelay + ACTIVITY_NOTICE_VISIBLE_MS,
    );
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [activity.length, bound]);

  useEffect(() => {
    if (!bound || !content.current) return;
    const notice =
      content.current.querySelector<HTMLElement>("[data-sc-activity]");
    if (!notice) return;
    const item = activity[0];
    notice.hidden = !item || !activityVisible;
    if (!item) return;
    notice
      .querySelectorAll<HTMLElement>('[data-sc-bind="location"]')
      .forEach((element) => (element.textContent = item.location));
    notice
      .querySelectorAll<HTMLElement>('[data-sc-bind="amount"]')
      .forEach((element) => (element.textContent = item.amount ?? ""));
  }, [activity, activityVisible, bound, source.htmlBefore]);

  useEffect(() => {
    if (!bound || !content.current) return;
    content.current
      .querySelectorAll<HTMLElement>("[data-sc-errors]")
      .forEach((element) => {
        element.textContent = error;
        element.hidden = !error;
      });
    content.current
      .querySelectorAll<HTMLButtonElement>('[data-sc-action="submit"]')
      .forEach((button) => (button.disabled = busy));
  }, [bound, busy, error]);

  const changeBoundForm = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      if (!bound || !content.current) return;
      const input = event.target as HTMLInputElement;
      if (!input.matches("[data-sc-field],[data-sc-contact]")) return;
      if (input.dataset.scField) {
        setOutput(content.current, input);
        if (form) updateBoundPresentation(content.current, form);
      }
      onBegin?.();
    },
    [bound, form, onBegin],
  );

  const clickBoundForm = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!bound || !onContinue) return;
      const target = (event.target as Element | null)?.closest(
        '[data-sc-action="continue"]',
      );
      if (!target) return;
      event.preventDefault();
      void onContinue();
    },
    [bound, onContinue],
  );

  const submitBoundForm = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      if (!bound || !form || !onSubmit) return;
      const target = event.target as HTMLFormElement;
      if (!target.matches('[data-sc-form="lead"]')) return;
      event.preventDefault();
      if (!target.reportValidity()) return;
      const answers = Object.fromEntries(
        form.fields.map((field) => [
          field.id,
          target.querySelector<HTMLInputElement>(
            `[data-sc-field="${field.id}"]`,
          )?.value ?? "",
        ]),
      );
      const contact = (name: "name" | "phone" | "email") =>
        target
          .querySelector<HTMLInputElement>(`[data-sc-contact="${name}"]`)
          ?.value.trim() || undefined;
      void onSubmit({
        answers,
        name: contact("name"),
        phone: contact("phone"),
        email: contact("email"),
      });
    },
    [bound, form, onSubmit],
  );

  if (bound)
    return (
      <main
        className="custom-landing custom-landing-bound"
        data-source-name={source.name}
      >
        {source.css ? <style>{source.css}</style> : null}
        <div
          ref={content}
          className="custom-landing-content"
          onClick={clickBoundForm}
          onInput={changeBoundForm}
          onSubmit={submitBoundForm}
          dangerouslySetInnerHTML={{ __html: source.htmlBefore }}
        />
        {verification}
      </main>
    );

  return (
    <main className="custom-landing" data-source-name={source.name}>
      {source.css ? <style>{source.css}</style> : null}
      <div
        className="custom-landing-content"
        onClick={openFunnel}
        dangerouslySetInnerHTML={{ __html: source.htmlBefore }}
      />
      <div className="custom-landing-funnel">{funnel}</div>
      <div
        className="custom-landing-content"
        onClick={openFunnel}
        dangerouslySetInnerHTML={{ __html: source.htmlAfter }}
      />
    </main>
  );
}
