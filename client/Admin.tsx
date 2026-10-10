import { flushSettings } from "./autosave";
import { ConnectionSettings } from "./components/connection-settings";
import { useEffect, useState, useCallback } from "react";
import {
  LayoutDashboard,
  Users,
  FlaskConical,
  Workflow,
  ShieldCheck,
  Plug,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Bell,
  Mail,
  MessageSquare,
  ChevronRight,
  Search,
  LogOut,
  Menu,
  X,
  Check,
  Copy,
  Terminal,
  Activity,
  MousePointer2,
  Wallet,
  LockKeyhole,
  RefreshCw,
  ChevronDown,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, post, money, number, date } from "./api";
import { Badge, Empty, Modal, Field, Spinner, External } from "./components/ui";
import { ExperimentEditor, ChainEditor } from "./components/editors";
import { SettingsView } from "./components/settings";
import { TimezoneSelect } from "./components/timezone-select";
const nav: [string, string, LucideIcon][] = [
  ["overview", "Overview", LayoutDashboard],
  ["audience", "Audience", Users],
  ["experiments", "Experiments", FlaskConical],
  ["journeys", "Follow-up chains", Workflow],
  ["traffic", "Traffic protection", ShieldCheck],
  ["integrations", "Integrations", Plug],
  ["settings", "Settings", Settings],
];
const channelIcon: Record<string, LucideIcon> = {
  EMAIL: Mail,
  SMS: MessageSquare,
  PUSH: Bell,
};
const goalName: Record<string, string> = {
  SUBSCRIPTIONS: "Subscriptions",
  SOLD: "Purchased leads",
  APPROVED: "Approvals",
  FUNDED: "Funded loans",
  REVENUE: "Revenue / visitor",
};
const stateTone = (state: string) =>
  ["ACTIVE", "SENT", "FUNDED", "BLOCKED", "APPLIED"].includes(state)
    ? "green"
    : ["PENDING", "DRAFT", "RECOMMENDED", "UNCERTAIN"].includes(state)
      ? "amber"
      : "neutral";
export function Admin() {
  const [page, setPage] = useState(
      location.pathname.split("/")[2] || "overview",
    ),
    [data, setData] = useState<any>(null),
    [needsLogin, setNeedsLogin] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState<any>(null),
    [extra, setExtra] = useState<any>(null),
    [query, setQuery] = useState(""),
    [listPage, setListPage] = useState(1),
    [loading, setLoading] = useState(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setData(await api("/admin/dashboard"));
      setNeedsLogin(false);
      setError("");
    } catch (e) {
      if ((e as any).status === 401) setNeedsLogin(true);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const listener = async () => {
      if (!(await flushSettings())) {
        history.pushState({}, "", "/admin/settings");
        return;
      }
      setPage(location.pathname.split("/")[2] || "overview");
      setExtra(null);
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  const loadPage = useCallback(async () => {
    if (!data) return;
    setLoading(true);
    try {
      if (page === "audience")
        setExtra(
          await api(
            `/admin/leads?q=${encodeURIComponent(query)}&page=${listPage}`,
          ),
        );
      else if (page === "traffic") setExtra(await api("/admin/sources"));
      else if (page === "journeys") setExtra(await api("/admin/deliveries"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, query, listPage, data]);
  useEffect(() => {
    const timer = setTimeout(() => void loadPage(), 180);
    return () => clearTimeout(timer);
  }, [loadPage]);
  const go = async (next: string) => {
    if (!(await flushSettings())) return;
    setExtra(null);
    setPage(next);
    setListPage(1);
    setQuery("");
    history.pushState({}, "", `/admin/${next}`);
    setMobile(false);
  };
  const closeModal = useCallback(() => setModal(null), []);
  async function mutate(path: string, body: any, message: string) {
    try {
      await post(path, body);
      notify(message);
      await refresh();
      await loadPage();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (needsLogin) return <Login onLogin={refresh} />;
  if (!data)
    return (
      <div className="startup">
        <div className="brand-logo">S</div>
        <h2>SpareCash</h2>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button className="button" onClick={() => void refresh()}>
              Retry connection
            </button>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    );
  const stats = data.stats,
    connected = data.integrations.filter((x: any) => x.connected).length;
  const title = nav.find((x) => x[0] === page)?.[1] ?? "Overview";
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="/admin"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          <span className="brand-logo">S</span>
          <span>
            sparecash<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-chip">
          <span className="workspace-avatar">SC</span>
          <div>
            SpareCash workspace<small>United States · Owner</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.slice(0, 5).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => go(key)}
              className={page === key ? "selected" : ""}
            >
              <Icon size={19} />
              {label}
              {key === "traffic" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-label">MANAGE</div>
        <nav>
          {nav.slice(5).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => go(key)}
              className={page === key ? "selected" : ""}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mcp-small">
            <div>
              <Terminal size={17} />
              <b>Made for your AI</b>
            </div>
            <p>Your workspace, one conversation away.</p>
            <button onClick={() => go("integrations")}>
              Connect MCP <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="owner"
            onClick={() =>
              void post("/auth/logout").then(() => setNeedsLogin(true))
            }
          >
            <span className="avatar">SC</span>
            <span>
              Workspace owner<small>Private workspace</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{title}</b>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <LockKeyhole size={13} />
              Private
            </span>
            <button
              className="icon-button"
              aria-label="Refresh data"
              onClick={() => {
                void refresh();
                notify("Workspace refreshed");
              }}
            >
              <RefreshCw size={16} />
            </button>
            <span className="avatar small">SC</span>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "YOUR ACQUISITION WORKSPACE"
                  : page === "traffic"
                    ? "PROTECT YOUR AD SPEND"
                    : "SPARECASH WORKSPACE"}
              </div>
              <h1>
                {page === "overview"
                  ? "Every click, a better connection."
                  : title}
              </h1>
              <p>
                {
                  (
                    {
                      overview:
                        "Turn traffic into relationships. See what’s working, from first click to funded loan.",
                      audience:
                        "Your contacts, their preferences, and every step of their journey.",
                      experiments:
                        "Find the pages and quizzes that turn more visitors into subscribers.",
                      journeys:
                        "The right follow-up, on the channel each person chooses.",
                      traffic:
                        "Understand your sources. Keep suspicious traffic out of your funnel.",
                      integrations:
                        "Connect the services behind your acquisition and follow-up engine.",
                      settings:
                        "Set the rules that keep your workspace running.",
                    } as any
                  )[page]
                }
              </p>
            </div>
            {page === "overview" ? (
              <button
                className="button"
                onClick={() => {
                  go("experiments");
                  setModal({ type: "experiment" });
                }}
              >
                <Plus size={17} />
                New experiment
              </button>
            ) : page === "experiments" ? (
              <button
                className="button"
                onClick={() => setModal({ type: "experiment" })}
              >
                <Plus size={17} />
                New experiment
              </button>
            ) : page === "journeys" ? (
              <button
                className="button"
                onClick={() => setModal({ type: "chain" })}
              >
                <Plus size={17} />
                Create chain
              </button>
            ) : null}
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="launch-banner">
                <div className="launch-icon">
                  <Plug size={21} />
                </div>
                <div>
                  <b>
                    {connected === 6
                      ? "Your connections are configured"
                      : "Let’s get your funnel ready"}
                  </b>
                  <p>
                    {connected} of 6 integrations configured.{" "}
                    {data.liveDelivery
                      ? "Live message delivery is enabled."
                      : "Message delivery is paused while you set up."}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => go("integrations")}
                >
                  View setup
                  <ArrowRight size={17} />
                </button>
              </div>
              <div className="stats-grid">
                <Metric
                  label="Tracked visitors"
                  value={number(stats.visits)}
                  caption={`${number(stats.verified)} verified submissions`}
                  icon={MousePointer2}
                />
                <Metric
                  label="Active subscriptions"
                  value={number(stats.subscriptions)}
                  caption="Across push, text & email"
                  icon={Users}
                />
                <Metric
                  label="Funded loans"
                  value={number(stats.funded)}
                  caption={`${stats.approved} approvals · ${stats.sold} purchased leads`}
                  icon={Check}
                />
                <Metric
                  label="Recorded revenue"
                  value={money(stats.revenue)}
                  caption="Reported through postbacks"
                  icon={Wallet}
                />
              </div>
              <div className="overview-columns">
                <section className="panel funnel-panel">
                  <div className="section-heading">
                    <div>
                      <h2>Your conversion funnel</h2>
                      <p>Follow the journey from interest to outcome.</p>
                    </div>
                    <span className="small-label">ALL TIME</span>
                  </div>
                  <div className="funnel-visual">
                    {[
                      ["Visitors", stats.visits, "#193e35"],
                      ["Verified visits", stats.verified, "#3d6c58"],
                      ["Active subscriptions", stats.subscriptions, "#709d78"],
                      ["Purchased leads", stats.sold, "#a1c496"],
                      ["Funded loans", stats.funded, "#d1e3b7"],
                    ].map(([label, value, color], i) => (
                      <div className="funnel-row" key={label}>
                        <div className="funnel-label">
                          <span>
                            <i style={{ background: String(color) }} />
                            {label}
                          </span>
                          <strong>{number(Number(value))}</strong>
                        </div>
                        <div className="funnel-track">
                          <div
                            style={{
                              width: stats.visits
                                ? `${Math.min(100, (Number(value) / stats.visits) * 100)}%`
                                : "0%",
                              background: String(color),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="funnel-foot">
                    <Activity size={15} />
                    {stats.visits
                      ? "Counts reflect distinct stages; one person may subscribe to several channels."
                      : "Your funnel will fill as real visitors arrive."}
                  </div>
                </section>
                <section className="panel shield-panel">
                  <div className="shield-art">
                    <ShieldCheck size={36} strokeWidth={1.4} />
                    <span className="orbit-dot one" />
                    <span className="orbit-dot two" />
                  </div>
                  <Badge tone="green">Traffic protection</Badge>
                  <h2>
                    Better traffic.
                    <br />
                    Less wasted spend.
                  </h2>
                  <p>
                    Turnstile verification and source-level evidence help you
                    spot suspicious traffic early.
                  </p>
                  <div className="shield-stats">
                    <div>
                      <strong>{stats.blocked}</strong>
                      <span>Sources excluded</span>
                    </div>
                    <div>
                      <strong>
                        {data.settings.sourceAutomation ? "On" : "Off"}
                      </strong>
                      <span>Auto evaluation</span>
                    </div>
                  </div>
                  <button
                    className="button secondary full"
                    onClick={() => go("traffic")}
                  >
                    Review traffic quality
                    <ArrowUpRight size={15} />
                  </button>
                </section>
              </div>
              <div className="overview-columns lower">
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Experiments in your workspace</h2>
                      <p>Test an idea. Learn what resonates.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => go("experiments")}
                    >
                      View all
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {data.experiments.length ? (
                    data.experiments.slice(0, 3).map((exp: any) => (
                      <button
                        className="experiment-row"
                        key={exp.id}
                        onClick={() =>
                          setModal({ type: "experiment", value: exp })
                        }
                      >
                        <span className="tile-icon">
                          <FlaskConical size={19} />
                        </span>
                        <span>
                          <b>{exp.name}</b>
                          <small>
                            {exp.variants.length} variants ·{" "}
                            {goalName[exp.objective]}
                          </small>
                        </span>
                        <Badge tone={stateTone(exp.status)}>
                          {exp.status.toLowerCase()}
                        </Badge>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <Empty
                      title="A fresh start"
                      description="Create your first landing-page experiment."
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>A clear record of workspace changes.</p>
                    </div>
                    <Clock size={18} />
                  </div>
                  {data.events.length ? (
                    data.events.slice(0, 4).map((event: any) => (
                      <div className="activity-row" key={event.id}>
                        <span className="activity-dot" />
                        <div>
                          <b>
                            {event.action
                              .replaceAll(".", " · ")
                              .replaceAll("_", " ")}
                          </b>
                          <small>
                            {event.actor} · {date(event.createdAt)}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty
                      title="Your activity starts here"
                      description="Changes made here or through MCP appear in this feed."
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {page === "experiments" && (
            <div className="experiment-grid">
              {data.experiments.map((exp: any) => (
                <section className="panel experiment-card" key={exp.id}>
                  <div className="card-top">
                    <span className="tile-icon">
                      <FlaskConical size={22} />
                    </span>
                    <Badge tone={stateTone(exp.status)}>
                      {exp.status.toLowerCase()}
                    </Badge>
                  </div>
                  <h2>{exp.name}</h2>
                  <p className="muted">/go/{exp.slug}</p>
                  <div className="variant-miniatures">
                    {exp.variants.slice(0, 4).map((variant: any, i: number) => (
                      <a
                        key={variant.id}
                        className={`mini-page theme-${variant.config.theme}`}
                        href={`/preview/${exp.id}?variant=${variant.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="mini-label">
                          VARIANT {String.fromCharCode(65 + i)}
                        </span>
                        <strong>{variant.config.title}</strong>
                        <span className="mini-line" />
                        <span className="mini-button" />
                        {variant.config.questions.length > 0 && (
                          <span className="mini-quiz">
                            {variant.config.questions.length} question quiz
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                  <div className="experiment-facts">
                    <span>
                      <small>OPTIMIZING FOR</small>
                      <b>{goalName[exp.objective]}</b>
                    </span>
                    <span>
                      <small>VISITORS</small>
                      <b>{exp._count.visits}</b>
                    </span>
                  </div>
                  <div className="card-actions">
                    <button
                      className="button secondary"
                      onClick={() =>
                        setModal({ type: "experiment", value: exp })
                      }
                    >
                      <SlidersHorizontal size={15} />
                      Edit experiment
                    </button>
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          setModal({
                            type: "results",
                            value: await api(`/admin/experiments/${exp.id}`),
                          });
                        } catch (e) {
                          notify((e as Error).message);
                        }
                      }}
                    >
                      Results
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                </section>
              ))}
              <button
                className="new-card"
                onClick={() => setModal({ type: "experiment" })}
              >
                <span>
                  <Plus size={25} />
                </span>
                <h3>Try your next idea</h3>
                <p>
                  A new prelander, a shorter quiz,
                  <br />a different first impression.
                </p>
              </button>
            </div>
          )}
          {page === "audience" && (
            <section className="panel table-panel">
              <div className="table-toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search audience"
                    placeholder="Search names, emails, or phone numbers…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setListPage(1);
                    }}
                  />
                </div>
                <span className="muted">
                  {extra?.total ?? 0} contacts {loading && <Spinner />}
                </span>
              </div>
              {extra?.items?.length ? (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Contact</th>
                          <th>Channels</th>
                          <th>Stage</th>
                          <th>Source</th>
                          <th>Added</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {extra.items.map((lead: any) => (
                          <tr key={lead.id}>
                            <td>
                              <button
                                className="contact-button"
                                onClick={async () => {
                                  try {
                                    setModal({
                                      type: "lead",
                                      value: await api(
                                        `/admin/leads/${lead.id}`,
                                      ),
                                    });
                                  } catch (e) {
                                    notify((e as Error).message);
                                  }
                                }}
                              >
                                <span className="avatar">
                                  {(lead.name || "Visitor")
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </span>
                                <span>
                                  <b>{lead.name || "Unnamed visitor"}</b>
                                  <small>
                                    {lead.subscriptions.find(
                                      (s: any) => s.channel === "EMAIL",
                                    )?.address ??
                                      lead.subscriptions[0]?.address ??
                                      "No subscription"}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <div className="channel-icons">
                                {lead.subscriptions.map((s: any) => {
                                  const Icon = channelIcon[s.channel];
                                  return (
                                    <span
                                      className={
                                        s.status === "ACTIVE" ? "active" : ""
                                      }
                                      key={s.id}
                                      title={`${s.channel}: ${s.status}`}
                                    >
                                      <Icon size={16} />
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td>
                              <Badge tone={stateTone(lead.status)}>
                                {lead.status.toLowerCase()}
                              </Badge>
                            </td>
                            <td>{lead.visit.source?.zoneId ?? "Direct"}</td>
                            <td className="muted">{date(lead.createdAt)}</td>
                            <td>
                              <ChevronRight size={16} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <button
                      className="button secondary"
                      disabled={listPage === 1}
                      onClick={() => setListPage(listPage - 1)}
                    >
                      Previous
                    </button>
                    <span>Page {listPage}</span>
                    <button
                      className="button secondary"
                      disabled={listPage * 30 >= extra.total}
                      onClick={() => setListPage(listPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <Empty
                  title={
                    query
                      ? "No matching contacts"
                      : "Your audience starts with a choice"
                  }
                  description={
                    query
                      ? "Try another name or contact address."
                      : "Once visitors choose push, text, or email, their contact records and consent history will appear here."
                  }
                />
              )}
            </section>
          )}
          {page === "journeys" && (
            <>
              <div className="notice subtle">
                <Workflow size={20} />
                <span>
                  Each channel follows its own chain. Clicked, declined, and
                  elapsed-time branches start only when you activate a chain for
                  that condition.
                </span>
              </div>
              <div className="chain-grid">
                {data.chains.map((chain: any) => {
                  const Icon = channelIcon[chain.channel];
                  return (
                    <section className="panel chain-card" key={chain.id}>
                      <div className="card-top">
                        <span
                          className={`channel-tile ${chain.channel.toLowerCase()}`}
                        >
                          <Icon size={21} />
                        </span>
                        <Badge tone={stateTone(chain.status)}>
                          {chain.status.toLowerCase()}
                        </Badge>
                      </div>
                      <h2>{chain.name}</h2>
                      <p className="muted">
                        {chain.channel.toLowerCase()} ·{" "}
                        {chain.trigger.toLowerCase().replaceAll("_", " ")}
                      </p>
                      <div className="chain-preview">
                        <div className="chain-trigger">
                          <span />
                          Subscription or matching event
                        </div>
                        {chain.steps.slice(0, 3).map((step: any, i: number) => (
                          <div className="chain-node" key={step.id}>
                            <span className="chain-line" />
                            <small>Wait {step.delayHours} hours</small>
                            <div>
                              <Icon size={14} />
                              <b>{step.subject}</b>
                            </div>
                          </div>
                        ))}
                        {chain.steps.length > 3 && (
                          <small className="muted">
                            +{chain.steps.length - 3} more steps
                          </small>
                        )}
                      </div>
                      <div className="chain-meta">
                        <span>{chain._count.enrollments} enrollments</span>
                        <span>{chain.maxDays}-day limit</span>
                      </div>
                      <div className="card-actions">
                        <button
                          className="button secondary"
                          onClick={() =>
                            setModal({ type: "chain", value: chain })
                          }
                        >
                          Edit chain
                        </button>
                        <button
                          className="icon-button"
                          title="Duplicate chain"
                          aria-label="Duplicate chain"
                          onClick={() =>
                            setModal({
                              type: "chain",
                              value: {
                                ...chain,
                                id: undefined,
                                name: `${chain.name} copy`,
                                status: "DRAFT",
                              },
                            })
                          }
                        >
                          <Copy size={16} />
                        </button>
                        {chain.status === "ACTIVE" &&
                          chain.trigger === "SUBSCRIBED" && (
                            <button
                              className="text-button"
                              onClick={() =>
                                void mutate(
                                  `/admin/chains/${chain.id}/enroll`,
                                  {},
                                  "Existing subscribers enrolled",
                                )
                              }
                            >
                              Enroll existing
                            </button>
                          )}
                      </div>
                    </section>
                  );
                })}
              </div>
              <section className="panel table-panel">
                <div className="section-heading">
                  <div>
                    <h2>Delivery log</h2>
                    <p>
                      Every attempt, including provider failures and uncertain
                      outcomes.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      void mutate(
                        "/admin/worker/run",
                        {},
                        "Worker cycle completed",
                      )
                    }
                  >
                    Process due messages
                    <RefreshCw size={14} />
                  </button>
                </div>
                {Array.isArray(extra) && extra.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Recipient</th>
                          <th>Message</th>
                          <th>State</th>
                          <th>Clicked</th>
                          <th>Created</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {extra.map((d: any) => (
                          <tr key={d.id}>
                            <td>
                              {d.subscription.lead.name}
                              <small className="block muted">
                                {d.subscription.channel}
                              </small>
                            </td>
                            <td>
                              {d.subject}
                              {d.error && (
                                <small className="block error">{d.error}</small>
                              )}
                            </td>
                            <td>
                              <Badge tone={stateTone(d.status)}>
                                {d.status.toLowerCase()}
                              </Badge>
                            </td>
                            <td>{d.clickCount}</td>
                            <td>{date(d.createdAt)}</td>
                            <td>
                              {["FAILED", "UNCERTAIN"].includes(d.status) && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setModal({ type: "resolve", value: d })
                                  }
                                >
                                  Resolve
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No messages sent yet"
                    description="Activate a chain and connect its provider. Due messages will appear here when live delivery is enabled."
                  />
                )}
              </section>
            </>
          )}
          {page === "traffic" && (
            <>
              <div className="stats-grid three">
                <Metric
                  label="Sources observed"
                  value={number(Array.isArray(extra) ? extra.length : 0)}
                  caption={`Last ${data.settings.lookbackDays} days of evidence`}
                  icon={Activity}
                />
                <Metric
                  label="Sources excluded"
                  value={number(stats.blocked)}
                  caption="Applied to PropellerAds"
                  icon={ShieldCheck}
                />
                <Metric
                  label="Automation mode"
                  value={
                    data.settings.sourceAutomation
                      ? data.liveSourceBlocking
                        ? "Live"
                        : "Observe"
                      : "Paused"
                  }
                  caption={`At least ${data.settings.minimumVisits} visits before a decision`}
                  icon={SlidersHorizontal}
                />
              </div>
              <div className="notice subtle">
                <ShieldCheck size={21} />
                <span>
                  <b>Evidence before action.</b> A source must pass your minimum
                  sample size, observation period, and confidence threshold. Low
                  conversion by itself does not trigger a bot exclusion.
                </span>
                <button className="text-button" onClick={() => go("settings")}>
                  Edit rules
                  <ArrowRight size={15} />
                </button>
              </div>
              <section className="panel table-panel">
                <div className="section-heading">
                  <div>
                    <h2>Traffic sources</h2>
                    <p>Quality and exclusion status by campaign and zone.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      void mutate(
                        "/admin/worker/run",
                        {},
                        "Source evaluation completed",
                      )
                    }
                  >
                    Evaluate now
                    <RefreshCw size={14} />
                  </button>
                </div>
                {Array.isArray(extra) && extra.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Campaign / zone</th>
                          <th>Visits</th>
                          <th>Bot evidence</th>
                          <th>Verified</th>
                          <th>Subscribers</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {extra.map((s: any) => (
                          <tr key={s.id}>
                            <td>
                              <b>{s.zoneId}</b>
                              <small className="block muted">
                                Campaign {s.campaignId}
                              </small>
                            </td>
                            <td>{s.total}</td>
                            <td>
                              {Math.round(s.rate * 100)}%
                              <small className="block muted">
                                {Math.round(s.lower * 100)}% lower bound
                              </small>
                            </td>
                            <td>{s.verified}</td>
                            <td>{s.subscribers}</td>
                            <td>
                              <Badge tone={stateTone(s.state)}>
                                {s.state.toLowerCase()}
                              </Badge>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                disabled={!s.eligible || s.state === "BLOCKED"}
                                onClick={() =>
                                  void mutate(
                                    `/admin/sources/${s.id}/block`,
                                    {},
                                    data.liveSourceBlocking
                                      ? "Source excluded"
                                      : "Exclusion recorded in observe mode",
                                  )
                                }
                              >
                                {data.liveSourceBlocking
                                  ? "Exclude"
                                  : "Evaluate"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="Waiting for your first traffic sources"
                    description="Pass campaign_id, zone_id, and click_id in your landing-page URL to attribute visitors to PropellerAds sources."
                  />
                )}
              </section>
            </>
          )}
          {page === "integrations" && (
            <>
              <div className="integration-grid">
                {data.integrations.map((integration: any, i: number) => (
                  <section
                    className="panel integration-card"
                    key={integration.id}
                  >
                    <div className="card-top">
                      <span className={`integration-logo logo-${i}`}>
                        {["C", "P", "R", "O", "B", "B"][i]}
                      </span>
                      <Badge tone={integration.connected ? "green" : "neutral"}>
                        {integration.connected ? "Configured" : "Not connected"}
                      </Badge>
                    </div>
                    <h2>{integration.name}</h2>
                    <p>{integration.purpose}</p>
                    <div className="integration-help">
                      {
                        (
                          {
                            turnstile:
                              "Add the site key and secret key in Settings. Validation runs on the server.",
                            propeller:
                              "Add the advertiser API token. Source exclusions use the v5 API.",
                            roundsky:
                              "LeadTechX self-optimizing link configured. Copy the sold-lead S2S pixel URL from Settings.",
                            onesignal:
                              "Add your App ID and API key. The service worker is included at the site root.",
                            brevo:
                              "Add your API key, sender address and campaign folder ID. Configure the suppression webhook.",
                            bluebubbles:
                              "Add your server URL and password. Connect the inbound message webhook for STOP replies.",
                          } as any
                        )[integration.id]
                      }
                    </div>
                    {
                      <button
                        className="text-button"
                        onClick={() => go("settings")}
                      >
                        Open settings
                        <ArrowUpRight size={14} />
                      </button>
                    }
                  </section>
                ))}
              </div>
              <section className="panel mcp-panel">
                <div className="mcp-intro">
                  <span className="tile-icon">
                    <Terminal size={24} />
                  </span>
                  <div>
                    <div className="eyebrow">REMOTE MCP</div>
                    <h2>Your workspace, in your AI chat.</h2>
                    <p>
                      Create experiments, write sequences, inspect contacts, and
                      control traffic protection using your external AI client.
                    </p>
                  </div>
                </div>
                <div className="endpoint-row">
                  <code>{data.appUrl}/mcp</code>
                  <button
                    className="icon-button"
                    aria-label="Copy MCP endpoint"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${data.appUrl}/mcp`);
                      notify("MCP endpoint copied");
                    }}
                  >
                    <Copy size={17} />
                  </button>
                </div>
                <div className="mcp-facts">
                  <span>
                    <Check size={16} />
                    Streamable HTTP
                  </span>
                  <span>
                    <LockKeyhole size={16} />
                    Bearer token authentication
                  </span>
                  <span>
                    <Activity size={16} />
                    Audited changes
                  </span>
                </div>
                <p className="help">
                  Configure your client’s Authorization header as Bearer
                  followed by the MCP bearer token from Settings. Clients that
                  require OAuth need an OAuth gateway. Credentials are never
                  returned through MCP tools.
                </p>
              </section>
              <section className="panel">
                <h3>Runtime switches</h3>
                <div className="runtime-row">
                  <span>Message delivery</span>
                  <Badge tone={data.liveDelivery ? "green" : "amber"}>
                    {data.liveDelivery ? "Live" : "Paused"}
                  </Badge>
                  <button
                    className="text-button"
                    onClick={() => go("settings")}
                  >
                    Manage in Settings
                  </button>
                </div>
                <div className="runtime-row">
                  <span>Paid-source exclusions</span>
                  <Badge tone={data.liveSourceBlocking ? "green" : "amber"}>
                    {data.liveSourceBlocking ? "Live" : "Observe only"}
                  </Badge>
                  <button
                    className="text-button"
                    onClick={() => go("settings")}
                  >
                    Manage in Settings
                  </button>
                </div>
                <p className="help">
                  Set these in Settings after connecting providers and checking
                  a test contact and postback.
                </p>
              </section>
            </>
          )}
          {page === "settings" && (
            <>
              <ConnectionSettings notify={notify} onSaved={refresh} />
              <SettingsView
                value={data.settings}
                ipTimezoneConfigured={data.ipTimezoneConfigured}
                onSaved={refresh}
              />
            </>
          )}
          <footer className="page-footer">
            <span>SpareCash · Your relationships, connected.</span>
            <span>
              <span className="status-dot" />
              PostgreSQL connected
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal?.type === "experiment" && (
        <Modal
          title={modal.value ? "Edit experiment" : "Create an experiment"}
          onClose={closeModal}
          wide
        >
          <ExperimentEditor
            initial={modal.value}
            onSaved={() => {
              setModal(null);
              void refresh();
            }}
            notify={notify}
          />
        </Modal>
      )}
      {modal?.type === "chain" && (
        <Modal
          title={
            modal.value ? "Edit follow-up chain" : "Create a follow-up chain"
          }
          onClose={closeModal}
          wide
        >
          <ChainEditor
            initial={modal.value}
            onSaved={() => {
              setModal(null);
              void refresh();
            }}
            notify={notify}
          />
        </Modal>
      )}
      {modal?.type === "lead" && (
        <Modal title={modal.value.name} onClose={closeModal} wide>
          <LeadDetails
            lead={modal.value}
            notify={notify}
            onSaved={() => {
              setModal(null);
              void refresh();
            }}
          />
        </Modal>
      )}
      {modal?.type === "results" && (
        <Modal
          title={`${modal.value.name} · results`}
          onClose={closeModal}
          wide
        >
          <div className="modal-body">
            <p className="muted">
              Objective: {goalName[modal.value.objective]}. Scores are
              descriptive; traffic weights remain under your control.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Visitors</th>
                    <th>Subscriptions</th>
                    <th>Sold</th>
                    <th>Approved</th>
                    <th>Funded</th>
                    <th>Revenue</th>
                    <th>Score / visit</th>
                  </tr>
                </thead>
                <tbody>
                  {modal.value.variants.map((v: any) => (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td>{v.visits}</td>
                      <td>{v.subscriptions}</td>
                      <td>{v.sold}</td>
                      <td>{v.approved}</td>
                      <td>{v.funded}</td>
                      <td>{money(v.revenue)}</td>
                      <td>{v.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Page engagement</h3>
            <p className="muted">
              Unique visit sessions, including visitors who never subscribe.
              These actions are not loan conversions. Recording starts with this
              update.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Answered a question</th>
                    <th>Completed quiz</th>
                    <th>Opened updates</th>
                    <th>Continued without updates</th>
                  </tr>
                </thead>
                <tbody>
                  {modal.value.variants.map((v: any) => (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td>{v.engagement?.quizStartedVisitors ?? 0}</td>
                      <td>{v.engagement?.quizCompletedVisitors ?? 0}</td>
                      <td>{v.engagement?.updatesOpenedVisitors ?? 0}</td>
                      <td>
                        {v.engagement?.continuedWithoutUpdatesVisitors ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
      {modal?.type === "resolve" && (
        <Modal title="Resolve delivery outcome" onClose={closeModal}>
          <ResolveDelivery
            id={modal.value.id}
            onSaved={() => {
              setModal(null);
              void loadPage();
              notify("Delivery resolved");
            }}
          />
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: LucideIcon;
}) {
  return (
    <section className="metric">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{caption}</small>
    </section>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-brand">
        <span className="brand-logo">S</span>
        <span>sparecash.</span>
      </div>
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post("/auth/login", { password });
            onLogin();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="tile-icon">
          <LockKeyhole size={23} />
        </span>
        <h1>Welcome back.</h1>
        <p>Your acquisition workspace is ready when you are.</p>
        <Field label="Owner password">
          <input
            autoComplete="current-password"
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button full" disabled={busy}>
          {busy ? <Spinner /> : null}Sign in
          <ArrowRight size={16} />
        </button>
        <small>Private access · SpareCash owner</small>
      </form>
      <p className="login-tagline">Every click is the start of a connection.</p>
    </div>
  );
}
function LeadDetails({
  lead,
  notify,
  onSaved,
}: {
  lead: any;
  notify: (s: string) => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes),
    [error, setError] = useState("");
  const [timezone, setTimezone] = useState(lead.timezone);
  const [savingTimezone, setSavingTimezone] = useState(false);
  return (
    <div className="modal-body">
      <div className="lead-summary">
        <Badge tone={stateTone(lead.status)}>{lead.status.toLowerCase()}</Badge>
        <span>{lead.timezone}</span>
        <span>Added {date(lead.createdAt)}</span>
      </div>
      <h3>Contact preferences</h3>
      <Field
        label="Lead time zone"
        hint={`Source: ${{ BROWSER: "browser", IP: "IP location", MANUAL: "owner override", DEFAULT: "workspace fallback", UNKNOWN: "previously recorded" }[lead.timezoneSource as string] ?? "previously recorded"}.`}
      >
        <TimezoneSelect value={timezone} onChange={setTimezone} />
      </Field>
      {lead.timing && (
        <p className="help">
          Follow-ups run between{" "}
          {String(lead.timing.startHour).padStart(2, "0")}:00 and{" "}
          {String(lead.timing.endHour).padStart(2, "0")}:00 in{" "}
          {lead.timing.timezone}.{" "}
          {lead.timing.mode === "WORKSPACE" &&
            "Workspace mode currently applies to everyone; choose each lead’s time zone in Settings to use this override."}
        </p>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={savingTimezone}
        onClick={async () => {
          setSavingTimezone(true);
          setError("");
          try {
            await api(`/admin/leads/${lead.id}/timezone`, {
              method: "PUT",
              body: JSON.stringify({ timezone }),
            });
            notify("Lead time zone saved");
            onSaved();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setSavingTimezone(false);
          }
        }}
      >
        {savingTimezone && <Spinner />}Save lead time zone
      </button>
      {lead.subscriptions.map((s: any) => (
        <div className="subscription-detail" key={s.id}>
          <div>
            <b>
              {s.channel} · {s.address}
            </b>
            <Badge tone={stateTone(s.status)}>{s.status.toLowerCase()}</Badge>
          </div>
          <p>{s.consentText}</p>
          <small>
            Consent {s.consentVersion} · {date(s.consentAt)}
            {s.confirmedAt ? ` · Confirmed ${date(s.confirmedAt)}` : ""}
          </small>
          {s.status !== "UNSUBSCRIBED" && (
            <button
              className="text-button danger"
              onClick={async () => {
                try {
                  await post(`/admin/subscriptions/${s.id}/unsubscribe`);
                  notify("Contact unsubscribed");
                  onSaved();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Unsubscribe this channel
            </button>
          )}
        </div>
      ))}
      <Field label="Owner notes">
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="row-actions">
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await api(`/admin/leads/${lead.id}`, {
                method: "PATCH",
                body: JSON.stringify({ notes }),
              });
              notify("Notes saved");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save notes
        </button>
        <button
          className="text-button"
          onClick={async () => {
            try {
              await post(`/admin/leads/${lead.id}/decline`);
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Record explicit decline
        </button>
      </div>
      <h3>Journey timeline</h3>
      {lead.events.length ? (
        lead.events.map((e: any) => (
          <div className="activity-row" key={e.id}>
            <span className="activity-dot" />
            <div>
              <b>{e.detail}</b>
              <small>{date(e.createdAt)}</small>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No confirmed events yet.</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
function ResolveDelivery({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [outcome, setOutcome] = useState("SENT"),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await post(`/admin/deliveries/${id}/resolve`, { outcome, note });
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <div className="modal-body">
        <p>Check the provider’s logs before resolving an uncertain attempt.</p>
        <Field label="Confirmed outcome">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="SENT">Provider confirms it was sent</option>
            <option value="FAILED">
              Provider confirms it was not sent — retry
            </option>
          </select>
        </Field>
        <Field label="Resolution note">
          <textarea
            required
            minLength={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="modal-footer">
        <button className="button">Save resolution</button>
      </div>
    </form>
  );
}
