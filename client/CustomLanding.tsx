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

export function CustomLanding({
  source,
  funnel,
  form,
  busy = false,
  error = "",
  activity = [],
  verification,
  onBegin,
  onSubmit,
}: {
  source: {
    name: string;
    htmlBefore: string;
    htmlAfter: string;
    css: string;
    version?: 1 | 2;
  };
  funnel: ReactNode;
  form?: {
    fields: CustomField[];
    contacts: Record<"name" | "phone" | "email", ContactRequirement>;
  };
  busy?: boolean;
  error?: string;
  activity?: { location: string; amount?: string }[];
  verification?: ReactNode;
  onBegin?: () => void;
  onSubmit?: (submission: BoundFormSubmission) => void | Promise<void>;
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
  }, [bound, form, source.htmlBefore]);

  useEffect(() => {
    if (!bound || activity.length === 0) return;
    const show = window.setTimeout(() => setActivityVisible(true), 900);
    const hide = window.setTimeout(() => setActivityVisible(false), 7200);
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
      if (input.dataset.scField) setOutput(content.current, input);
      onBegin?.();
    },
    [bound, onBegin],
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
