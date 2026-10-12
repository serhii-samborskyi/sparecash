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
  const privacy = session.advertising?.privacy ?? "UNKNOWN";
  const gpc =
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true;
  const permission = useRef(privacy !== "DENIED" && !gpc);
  useEffect(() => {
    permission.current = privacy !== "DENIED" && !gpc;
  }, [session.visitToken, privacy, gpc]);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(!!session.verification?.verified);
  const [expiresAt, setExpiresAt] = useState<string | null>(
    session.verification?.expiresAt ?? null,
  );
  const [retry, setRetry] = useState(0);
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
      }).catch(() => {});
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
          appearance: "interaction-only",
          callback: (turnstileToken: string) => {
            void post("/public/verify-visit", {
              visitToken: session.visitToken,
              turnstileToken,
            })
              .then((result) => {
                if (disposed) return;
                setError("");
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
  if (verified) return null;
  return (
    <section
      className="visitor-controls"
      aria-label="Browser verification"
      aria-live="polite"
    >
      <div ref={container} className="turnstile-container" />
      <small>Secure browser check runs before you continue.</small>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((x) => x + 1)}
          >
            Retry verification
          </button>
        </p>
      )}
    </section>
  );
}
