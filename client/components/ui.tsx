import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X, ArrowUpRight, Inbox, LoaderCircle } from "lucide-react";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span />
      {children}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={23} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const d = dialog.current;
    const handler = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener("cancel", handler);
    return () => {
      d?.removeEventListener("cancel", handler);
      d?.close();
    };
  }, [onClose]);
  return (
    <dialog className={wide ? "modal wide" : "modal"} ref={dialog}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={18} />;
}
export function External({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="button secondary"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
