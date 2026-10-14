import { useCallback } from "react";
import type { ReactNode, MouseEvent } from "react";
import "./custom-landing.css";

export function CustomLanding({
  source,
  funnel,
}: {
  source: {
    name: string;
    htmlBefore: string;
    htmlAfter: string;
    css: string;
  };
  funnel: ReactNode;
}) {
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
