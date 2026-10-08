import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Bell,
  Mail,
  MessageSquare,
  ShieldCheck,
  LockKeyhole,
  ChevronRight,
  Wallet,
  Leaf,
} from "lucide-react";
import { api, post } from "./api";
import { Field, Spinner } from "./components/ui";
import {
  waitForPushSubscription,
  confirmPushSubscription,
  PushConfirmationPending,
} from "./push-subscription";
declare global {
  interface Window {
    turnstile: any;
    OneSignalDeferred: any[];
  }
}
const scripts = new Map<string, Promise<void>>();
function loadScript(url: string) {
  if (!scripts.has(url))
    scripts.set(
      url,
      new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(
            new Error("Could not load browser verification. Please reload."),
          );
        document.head.append(script);
      }),
    );
  return scripts.get(url)!;
}
function Turnstile({
  siteKey,
  visitId,
  onToken,
}: {
  siteKey: string;
  visitId: string;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | undefined,
      disposed = false;
    if (!siteKey) return;
    void loadScript(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    ).then(() => {
      if (!disposed && container.current)
        widget = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action: "subscribe",
          cData: visitId,
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
    });
    return () => {
      disposed = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, visitId, onToken]);
  return <div className="turnstile-container" ref={container} />;
}
export function Public() {
  const preview = location.pathname.startsWith("/preview/"),
    utility = [
      "/confirm",
      "/preferences",
      "/follow-up",
      "/privacy",
      "/terms",
    ].includes(location.pathname);
  if (utility) return <Utility />;
  return <Landing preview={preview} />;
}
function Landing({ preview }: { preview: boolean }) {
  const [session, setSession] = useState<any>(null),
    [error, setError] = useState(""),
    [step, setStep] = useState(0),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [channels, setChannels] = useState<string[]>([]),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [consent, setConsent] = useState(false),
    [adult, setAdult] = useState(false),
    [company, setCompany] = useState(""),
    [turnstileToken, setToken] = useState(""),
    [captchaKey, setCaptchaKey] = useState(0),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [code, setCode] = useState(""),
    [smsConfirmed, setSmsConfirmed] = useState(false),
    [pushStatus, setPushStatus] = useState("");
  const pushAttempt = useRef<AbortController | null>(null);
  useEffect(() => () => pushAttempt.current?.abort(), []);
  useEffect(() => {
    let current = true;
    async function init() {
      try {
        if (preview) {
          const exp = await api(
            `/admin/experiments/${location.pathname.split("/")[2]}`,
          );
          const v =
            exp.variants.find(
              (x: any) =>
                x.id === new URLSearchParams(location.search).get("variant"),
            ) ?? exp.variants[0];
          if (current) setSession({ config: v.config, preview: true });
        } else {
          const q = new URLSearchParams(location.search);
          const data = await post("/public/visit", {
            slug: location.pathname.split("/")[2] || "us-loans",
            campaignId: q.get("campaign_id") ?? undefined,
            zoneId: q.get("zone_id") ?? undefined,
            clickId: q.get("click_id") ?? undefined,
          });
          if (current) setSession(data);
        }
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    }
    void init();
    return () => {
      current = false;
    };
  }, [preview]);
  const toggle = (channel: string) => {
    setChannels(
      channels.includes(channel)
        ? channels.filter((x) => x !== channel)
        : [...channels, channel],
    );
    setConsent(false);
  };
  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return;
    setBusy(true);
    setError("");
    try {
      const r = await post("/public/subscribe", {
        visitToken: session.visitToken,
        turnstileToken,
        name,
        timezone: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch {
            return undefined;
          }
        })(),
        answers,
        channels,
        email: channels.includes("EMAIL") ? email : undefined,
        phone: channels.includes("SMS") ? phone : undefined,
        consent,
        adultUS: adult,
        company,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
      setToken("");
      setCaptchaKey((x) => x + 1);
    } finally {
      setBusy(false);
    }
  }
  async function push() {
    if (pushAttempt.current) return;
    const attempt = new AbortController();
    pushAttempt.current = attempt;
    setBusy(true);
    setError("");
    setPushStatus("starting");
    try {
      if (!session.oneSignalAppId)
        throw new Error(
          "Browser notifications are not available yet. Please choose email or text.",
        );
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      const one = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error("Notifications took too long to load. Please retry."),
            ),
          15000,
        );
        window.OneSignalDeferred.push((sdk: any) => {
          clearTimeout(timer);
          resolve(sdk);
        });
        void loadScript(
          "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js",
        ).catch(reject);
      });
      if (!(window as any).__scOneSignalReady) {
        await one.init({
          appId: session.oneSignalAppId,
          allowLocalhostAsSecureOrigin: true,
          notifyButton: { enable: false },
        });
        (window as any).__scOneSignalReady = true;
      }
      await one.login(result.leadId);
      attempt.signal.throwIfAborted();
      if (!one.Notifications.permission)
        await one.Notifications.requestPermission();
      if (!one.Notifications.permission)
        throw new Error(
          "Notifications were not enabled. You can change this in your browser settings.",
        );
      attempt.signal.throwIfAborted();
      setPushStatus("confirming");
      if (!one.User.PushSubscription.optedIn)
        await one.User.PushSubscription.optIn();
      const id = await waitForPushSubscription(
        one.User.PushSubscription,
        attempt.signal,
      );
      await confirmPushSubscription(result.leadToken, id, attempt.signal);
      setPushStatus("confirmed");
    } catch (e) {
      if (!attempt.signal.aborted) {
        setPushStatus(e instanceof PushConfirmationPending ? "pending" : "");
        if (!(e instanceof PushConfirmationPending))
          setError((e as Error).message);
      }
    } finally {
      pushAttempt.current = null;
      if (!attempt.signal.aborted) setBusy(false);
    }
  }
  async function continueOffer() {
    setBusy(true);
    try {
      const r = result
        ? await post("/public/application", { leadToken: result.leadToken })
        : await post("/public/continue", { visitToken: session.visitToken });
      location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (!session)
    return (
      <div className="public-page">
        <PublicHeader />
        {error ? (
          <div className="public-unavailable">
            <ShieldCheck size={30} />
            <h1>We’re getting things ready.</h1>
            <p>{error}</p>
            <a href="/admin" className="text-button">
              Owner sign in
              <ArrowRight size={16} />
            </a>
          </div>
        ) : (
          <div className="startup">
            <Spinner />
          </div>
        )}
      </div>
    );
  const config = session.config,
    questions = config.questions ?? [],
    question = questions[step];
  return (
    <div className={`public-page theme-${config.theme}`}>
      {preview && (
        <div className="preview-banner">
          Preview · Try the quiz and channel choices. Submissions are disabled.
        </div>
      )}
      <PublicHeader />
      <main className="landing-layout">
        <div className="landing-story">
          <div className="landing-eyebrow">
            <span />
            {config.eyebrow}
          </div>
          <h1>{config.title}</h1>
          <p className="landing-description">{config.description}</p>
          <div className="promise-list">
            <div>
              <Check size={16} />
              <span>Choose how you hear from us</span>
            </div>
            <div>
              <Check size={16} />
              <span>Explore at your own pace</span>
            </div>
            <div>
              <Check size={16} />
              <span>Unsubscribe whenever you like</span>
            </div>
          </div>
          <div className="landing-illustration" aria-hidden="true">
            <div className="illustration-orbit" />
            <div className="float-card back">
              <span className="circle-icon">
                <Wallet size={22} />
              </span>
              <div>
                <span className="art-line long" />
                <span className="art-line" />
              </div>
            </div>
            <div className="float-card front">
              <span className="circle-icon mint">
                <Leaf size={21} />
              </span>
              <b>A little breathing room.</b>
              <span className="art-check">
                <Check size={14} />
              </span>
            </div>
            <span className="art-spark">✦</span>
          </div>
          <p className="lender-note">
            SpareCash connects you with third-party loan options. We are not a
            lender. Approval, amounts, rates, and timing depend on the lender
            and your application.
          </p>
        </div>
        <section className="application-card">
          {result ? (
            <>
              <span className="success-mark">
                <Check size={25} />
              </span>
              <h2>Your preferences are saved.</h2>
              <p>
                {pushStatus === "confirmed" && result.results.length === 0
                  ? "You’re subscribed to browser notifications."
                  : "Finish confirming your channels to receive updates."}
              </p>
              {result.results.map((r: any) => (
                <div className="confirmation-channel" key={r.channel}>
                  <b>
                    {r.channel === "EMAIL" ? "Email updates" : "Text updates"}
                  </b>
                  <p>
                    {r.state === "PENDING"
                      ? r.channel === "EMAIL"
                        ? "Check your inbox and confirm your email address."
                        : smsConfirmed
                          ? "Your phone number is confirmed."
                          : "Enter the six-digit confirmation code sent to your phone."
                      : r.state === "PAUSED"
                        ? "Updates are not active yet. Your preference has been recorded."
                        : r.message}
                  </p>
                  {r.channel === "SMS" &&
                    r.state === "PENDING" &&
                    !smsConfirmed && (
                      <form
                        className="code-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setBusy(true);
                          try {
                            await post("/public/verify-phone", {
                              token: r.subscriptionToken,
                              code,
                            });
                            setSmsConfirmed(true);
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <input
                          aria-label="Six-digit confirmation code"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                        <button className="button secondary" disabled={busy}>
                          Confirm
                        </button>
                      </form>
                    )}
                </div>
              ))}
              {result.pushRequested && (
                <div className="confirmation-channel">
                  <b>Browser notifications</b>
                  {pushStatus === "confirmed" ? (
                    <p>Notifications are enabled.</p>
                  ) : (
                    <>
                      <p role="status">
                        {pushStatus === "confirming"
                          ? "Notifications are allowed. We’re confirming your subscription…"
                          : pushStatus === "pending"
                            ? "Notifications are allowed. Tap Finish subscribing to complete confirmation."
                            : "Allow notifications in your browser to finish subscribing."}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => void push()}
                        disabled={busy}
                      >
                        {pushStatus === "starting" ||
                        pushStatus === "confirming" ? (
                          <Spinner />
                        ) : (
                          <Bell size={16} />
                        )}
                        {pushStatus === "confirming"
                          ? "Confirming subscription…"
                          : pushStatus === "starting"
                            ? "Enabling notifications…"
                            : pushStatus === "pending"
                              ? "Finish subscribing"
                              : "Enable notifications"}
                      </button>
                    </>
                  )}
                </div>
              )}
              <button
                className="button full"
                onClick={() => void continueOffer()}
                disabled={busy}
              >
                Continue to loan options
                <ArrowRight size={17} />
              </button>
              <p className="fine-print">
                You’ll continue to a third-party application. Your submitted
                name and contact details may be used to prefill it.
              </p>
            </>
          ) : question ? (
            <>
              <div className="form-progress">
                <span>LET’S START WITH YOU</span>
                <span>
                  {step + 1} / {questions.length}
                </span>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${((step + 1) / (questions.length + 1)) * 100}%`,
                  }}
                />
              </div>
              <h2>{question.label}</h2>
              <div className="quiz-options">
                {question.options.map((option: string) => (
                  <button
                    key={option}
                    className={
                      answers[question.id] === option ? "selected" : ""
                    }
                    onClick={() => {
                      setAnswers({ ...answers, [question.id]: option });
                      setStep(step + 1);
                    }}
                  >
                    {option}
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
              {step > 0 && (
                <button
                  className="text-button"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={15} />
                  Back
                </button>
              )}
              <p className="fine-print">
                <LockKeyhole size={12} />
                No credit check to answer these questions.
              </p>
            </>
          ) : (
            <form onSubmit={subscribe}>
              <div className="form-progress">
                <span>STAY IN THE LOOP, YOUR WAY</span>
                <span>{questions.length ? "LAST STEP" : "01"}</span>
              </div>
              <h2>How should we keep in touch?</h2>
              <p>
                Choose one or more channels for daily updates about loan
                options.
              </p>
              <div className="channel-choices">
                {[
                  ["PUSH", "Push", "In your browser", Bell],
                  ["SMS", "Text", "On your phone", MessageSquare],
                  ["EMAIL", "Email", "In your inbox", Mail],
                ].map(([channel, label, description, Icon]: any) => (
                  <button
                    type="button"
                    key={channel}
                    aria-pressed={channels.includes(channel)}
                    className={channels.includes(channel) ? "selected" : ""}
                    onClick={() => toggle(channel)}
                  >
                    <Icon size={21} />
                    <b>{label}</b>
                    <small>{description}</small>
                    <span className="channel-check">
                      {channels.includes(channel) && <Check size={11} />}
                    </span>
                  </button>
                ))}
              </div>
              <Field label="First name">
                <input
                  required
                  autoComplete="given-name"
                  placeholder="Your first name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              {channels.includes("EMAIL") && (
                <Field label="Email address">
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              )}
              {channels.includes("SMS") && (
                <Field label="US mobile number">
                  <input
                    required
                    type="tel"
                    autoComplete="tel"
                    placeholder="(555) 000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
              )}
              <div className="hp" aria-hidden="true">
                <label>
                  Company
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </label>
              </div>
              <label className="consent-check">
                <input
                  required
                  type="checkbox"
                  checked={adult}
                  onChange={(e) => setAdult(e.target.checked)}
                />
                <span>I am 18 or older and live in the United States.</span>
              </label>
              {channels.length > 0 && (
                <label className="consent-check">
                  <input
                    required
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    {channels
                      .map(
                        (c) =>
                          config[
                            c === "EMAIL"
                              ? "emailConsent"
                              : c === "SMS"
                                ? "smsConsent"
                                : "pushConsent"
                          ],
                      )
                      .join(" ")}{" "}
                    I have read the{" "}
                    <a href="/privacy" target="_blank">
                      Privacy Policy
                    </a>{" "}
                    and{" "}
                    <a href="/terms" target="_blank">
                      Terms
                    </a>
                    .
                  </span>
                </label>
              )}
              {!preview && (
                <Turnstile
                  key={captchaKey}
                  siteKey={session.turnstileSiteKey}
                  visitId={session.visitId}
                  onToken={setToken}
                />
              )}
              <button
                className="button full"
                disabled={
                  busy || preview || !channels.length || !turnstileToken
                }
              >
                {busy ? <Spinner /> : null}
                {config.button}
                <ArrowRight size={17} />
              </button>
              {questions.length > 0 && (
                <button
                  type="button"
                  className="text-button back-link"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={15} />
                  Back
                </button>
              )}
              <button
                type="button"
                className="skip-updates"
                disabled={preview || busy}
                onClick={() => void continueOffer()}
              >
                Continue without updates
              </button>
              <p className="fine-print">
                Subscribing is optional and does not affect loan eligibility.
              </p>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
function PublicHeader() {
  return (
    <header className="public-header">
      <a className="public-brand" href="/">
        <span className="brand-logo">S</span>sparecash<span>.</span>
      </a>
      <span>
        <LockKeyhole size={13} />
        Your choice. Your pace.
      </span>
    </header>
  );
}
function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>© {new Date().getFullYear()} SpareCash</span>
      <div>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms & disclosures</a>
      </div>
    </footer>
  );
}
function Utility() {
  const path = location.pathname,
    params = new URLSearchParams(location.search),
    token = params.get("token") ?? "";
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (["/privacy", "/terms"].includes(path))
      void api("/public/info")
        .then(setData)
        .catch((e) => setError(e.message));
    else if (path === "/follow-up")
      void api(`/public/followup-info?token=${encodeURIComponent(token)}`)
        .then(setData)
        .catch((e) => setError(e.message));
    else if (path === "/preferences")
      void api(`/public/preferences?token=${encodeURIComponent(token)}`)
        .then(setData)
        .catch((e) => setError(e.message));
  }, [path, token]);
  async function action(endpoint: string, extra: object = {}) {
    setBusy(true);
    try {
      const r = await post(`/public/${endpoint}`, { token, ...extra });
      if (r.url) location.assign(r.url);
      else setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const legal = path === "/privacy" || path === "/terms";
  return (
    <div className="public-page">
      <PublicHeader />
      <main className={`utility-card ${legal ? "legal" : ""}`}>
        <span className="tile-icon">
          {done ? <Check size={23} /> : <ShieldCheck size={23} />}
        </span>
        <h1>
          {path === "/confirm"
            ? done
              ? "Your email is confirmed."
              : "Confirm your email updates."
            : path === "/preferences"
              ? done
                ? "You’re unsubscribed."
                : "Your notification preferences"
              : path === "/follow-up"
                ? done
                  ? "Thanks for the update."
                  : "A next step, when you’re ready."
                : path === "/privacy"
                  ? "Privacy Policy"
                  : "Terms & disclosures"}
        </h1>
        {path === "/confirm" && !done && (
          <>
            <p>
              Confirm that you want to receive daily loan-option emails from
              SpareCash. You can unsubscribe at any time.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void action("confirm")}
            >
              Confirm subscription
              <Check size={17} />
            </button>
          </>
        )}
        {path === "/preferences" && data && !done && (
          <>
            <p>
              Your {data.channel.toLowerCase()} subscription is{" "}
              {data.status.toLowerCase()}.
            </p>
            <button
              className="button"
              disabled={busy || data.status === "UNSUBSCRIBED"}
              onClick={() => void action("unsubscribe")}
            >
              Unsubscribe from this channel
            </button>
          </>
        )}
        {path === "/follow-up" && !done && (
          <>
            <p>
              Explore loan options with our partner. Approval and terms depend
              on the lender and your application.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => void action("followup")}
            >
              Explore loan options
              <ArrowRight size={17} />
            </button>
            <div className="utility-answer">
              <p>Already applied?</p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void action("answer", { answer: "DECLINED" })}
              >
                I was declined
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void action("answer", { answer: "STILL_LOOKING" })
                }
              >
                I’m still looking
              </button>
            </div>
          </>
        )}
        {path === "/follow-up" && data?.preferenceToken && (
          <p>
            <a
              href={`/preferences?token=${encodeURIComponent(data.preferenceToken)}`}
            >
              Manage updates or unsubscribe
            </a>
          </p>
        )}
        {done && (
          <p>
            {path === "/preferences"
              ? "No further marketing messages will be sent on this channel."
              : "Your preference has been recorded."}
          </p>
        )}
        {legal && (
          <>
            <div className="legal-copy">
              {data?.[path === "/privacy" ? "privacyText" : "termsText"] ||
                "This information has not been published yet. Please check back before subscribing."}
            </div>
            {data?.contactEmail && (
              <p>
                Contact:{" "}
                <a href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a>
              </p>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
