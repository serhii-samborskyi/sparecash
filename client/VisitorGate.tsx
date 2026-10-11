import { useCallback, useEffect, useRef, useState } from "react";
import { post } from "./api";
import { createPixelRunner } from "./retargeting";

let turnstileScript: Promise<void> | undefined;
function loadVerification() {
  if (window.turnstile) return Promise.resolve();
  return (turnstileScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      turnstileScript = undefined;
      script.remove();
      reject(new Error("Could not load verification. Please retry."));
    };
    document.head.append(script);
  }));
}

export function VisitorGate({
  session,
  onVerified,
  runner,
}: {
  session: any;
  onVerified: (verified: boolean) => void;
  runner: React.MutableRefObject<(() => Promise<void>) | undefined>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [privacy, setPrivacy] = useState(
    session.advertising?.privacy ?? "UNKNOWN",
  );
  const gpc =
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true;
  const permission = useRef(privacy === "GRANTED" && !gpc);
  useEffect(() => {
    if (privacy !== "GRANTED" || gpc) permission.current = false;
  }, [privacy, gpc]);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(!!session.verification?.verified);
  const [expiresAt, setExpiresAt] = useState<string | null>(
    session.verification?.expiresAt ?? null,
  );
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const updateVerified = useCallback(
    (value: boolean) => {
      setVerified(value);
      onVerified(value);
    },
    [onVerified],
  );
  useEffect(() => {
    const run = createPixelRunner(session.visitToken, () => permission.current);
    runner.current = run;
    const tick = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("sparecash-engagement", tick);
    document.addEventListener("visibilitychange", tick);
    const interval = setInterval(tick, 30_000);
    return () => {
      permission.current = false;
      clearInterval(interval);
      runner.current = undefined;
      window.removeEventListener("sparecash-engagement", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [session.visitToken, runner]);
  useEffect(() => {
    if (gpc)
      void post("/public/advertising-choice", {
        visitToken: session.visitToken,
        choice: "DENIED",
        gpc: true,
      })
        .then(() => setPrivacy("DENIED"))
        .catch(() => {});
  }, [session.visitToken, gpc]);
  useEffect(() => {
    updateVerified(verified);
    if (!verified || !expiresAt) return;
    void runner.current?.();
    const timer = setTimeout(
      () => updateVerified(false),
      Math.max(0, new Date(expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [verified, expiresAt, updateVerified, runner]);
  useEffect(() => {
    if (verified) return;
    let disposed = false,
      widget: string | undefined;
    setError("");
    if (!session.turnstileSiteKey) {
      setError("Browser verification is not available yet.");
      return;
    }
    void loadVerification()
      .then(() => {
        if (disposed || !container.current) return;
        widget = window.turnstile.render(container.current, {
          sitekey: session.turnstileSiteKey,
          action: "visit",
          cData: session.visitId,
          callback: (turnstileToken: string) => {
            void post("/public/verify-visit", {
              visitToken: session.visitToken,
              turnstileToken,
            })
              .then((result) => {
                if (disposed) return;
                setExpiresAt(result.expiresAt);
                updateVerified(result.verified);
                if (!result.verified)
                  setError("Verification did not finish. Please retry.");
              })
              .catch(() => {
                if (!disposed)
                  setError("Verification could not be checked. Please retry.");
              });
          },
          "expired-callback": () => {
            if (!disposed) updateVerified(false);
          },
          "error-callback": () => {
            if (!disposed)
              setError("Verification did not finish. Please retry.");
          },
        });
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, [
    session.visitToken,
    session.visitId,
    session.turnstileSiteKey,
    verified,
    retry,
    updateVerified,
  ]);
  async function choose(choice: "GRANTED" | "DENIED") {
    // Stop an in-flight dispatch immediately when the visitor withdraws permission.
    if (choice === "DENIED") permission.current = false;
    setSaving(true);
    setError("");
    try {
      const result = await post("/public/advertising-choice", {
        visitToken: session.visitToken,
        choice,
        gpc,
      });
      permission.current = result.privacy === "GRANTED" && !gpc;
      setPrivacy(result.privacy);
      void runner.current?.();
    } catch {
      setError("Could not save your advertising choice. Please retry.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="visitor-controls"
      aria-label="Verification and advertising choices"
    >
      {!verified && <div ref={container} className="turnstile-container" />}
      <small>
        {verified
          ? "Browser verification complete."
          : "Checking your browser. You can explore the page while this finishes."}
      </small>
      {error && (
        <p role="alert">
          {error}{" "}
          {!verified && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRetry((x) => x + 1)}
            >
              Retry verification
            </button>
          )}
        </p>
      )}
      {session.advertising?.available && (
        <details open={privacy === "UNKNOWN"}>
          <summary>
            Advertising privacy ·{" "}
            {gpc || privacy === "DENIED"
              ? "not allowed"
              : privacy === "GRANTED"
                ? "allowed"
                : "your choice"}
          </summary>
          <p>
            {session.advertising.notice}{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </p>
          {gpc ? (
            <p>Your browser’s Global Privacy Control is respected.</p>
          ) : (
            <div className="advertising-choices">
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={() => void choose("DENIED")}
              >
                Do not allow
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={() => void choose("GRANTED")}
              >
                Allow personalized ads
              </button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
