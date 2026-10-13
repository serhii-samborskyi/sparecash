import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ArrowUpRight,
  MousePointer2,
  ShieldCheck,
  Activity,
  Users,
} from "lucide-react";
import { api, money, number } from "../api";
import { Empty, Field, Spinner } from "./ui";
import {
  orderStatistics,
  statisticsCsv,
  type NumericMetric,
  type StatisticsRow,
} from "../statistics";
import type {
  StatisticsInput,
  StatisticsReport,
} from "../../server/services/statistics";
import "../statistics.css";

const groups = {
  zone: "Zone",
  campaign: "Campaign",
  landing: "Landing page",
  country: "Country",
  state: "State / region",
  city: "City",
  device: "Device",
  browser: "Browser",
  os: "Operating system",
  creative: "Creative",
  subzone: "Subzone",
  connection: "Connection type",
  carrier: "Carrier",
  language: "Browser language",
  browserVersion: "Browser version",
  osVersion: "OS version",
  day: "Day",
};
const pct = (v: number | null) =>
  v === null
    ? "—"
    : `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
type Column = {
  key: NumericMetric;
  label: string;
  type?: "rate" | "money" | "multiple";
  count?: NumericMetric;
  hint?: string;
};
const columns: Record<string, Column[]> = {
  performance: [
    { key: "visits", label: "Visits" },
    {
      key: "ctr",
      label: "Ad CTR",
      type: "rate",
      hint: "PropellerAds clicks ÷ impressions",
    },
    { key: "verifiedRate", label: "Verified", type: "rate", count: "verified" },
    {
      key: "botRate",
      label: "Suspected bots",
      type: "rate",
      count: "suspectedBots",
    },
    {
      key: "engagementRate",
      label: "Engagement",
      type: "rate",
      count: "engaged",
    },
    {
      key: "subscriptionRate",
      label: "Subscriptions",
      type: "rate",
      count: "subscribers",
    },
    { key: "sold", label: "Purchased leads" },
    { key: "adSpend", label: "Ad spend", type: "money" },
    { key: "revenue", label: "Commission", type: "money" },
  ],
  acquisition: [
    { key: "impressions", label: "Impressions" },
    { key: "adClicks", label: "Ad clicks" },
    { key: "ctr", label: "Ad CTR", type: "rate" },
    { key: "visits", label: "Tracked visits" },
    { key: "adSpend", label: "Ad spend", type: "money" },
    { key: "cpc", label: "Ad CPC", type: "money" },
  ],
  quality: [
    { key: "visits", label: "Visits" },
    { key: "verifiedRate", label: "Verified", type: "rate", count: "verified" },
    {
      key: "botRate",
      label: "Suspected bots",
      type: "rate",
      count: "suspectedBots",
    },
    {
      key: "unverifiedRate",
      label: "Unverified",
      type: "rate",
      count: "unverified",
    },
    { key: "verificationFailed", label: "Failed checks" },
    { key: "verificationErrors", label: "Check errors" },
    {
      key: "verifiedEngagementRate",
      label: "Engaged / verified",
      type: "rate",
      count: "verifiedEngaged",
    },
  ],
  engagement: [
    { key: "visits", label: "Visits" },
    {
      key: "engagementRate",
      label: "Engagement",
      type: "rate",
      count: "engaged",
    },
    { key: "quizStarted", label: "Quiz starts" },
    { key: "quizCompleted", label: "Quiz completions" },
    { key: "quizCompletionRate", label: "Quiz completion rate", type: "rate" },
    { key: "updatesOpened", label: "Updates opened" },
    {
      key: "applicationRate",
      label: "Application clicks",
      type: "rate",
      count: "applicationVisitors",
    },
  ],
  subscriptions: [
    { key: "visits", label: "Visits" },
    {
      key: "subscriptionRate",
      label: "Confirmed / visit",
      type: "rate",
      count: "subscribers",
    },
    { key: "activeSubscribers", label: "Active subscriber visits" },
    { key: "emailSubscribers", label: "Email" },
    { key: "smsSubscribers", label: "Text" },
    { key: "pushSubscribers", label: "Push" },
    { key: "costPerSubscriber", label: "Cost / subscriber", type: "money" },
  ],
  revenue: [
    { key: "visits", label: "Visits" },
    { key: "applications", label: "Application clicks" },
    { key: "sold", label: "Purchased leads" },
    { key: "saleRate", label: "Sale / visit", type: "rate" },
    { key: "revenue", label: "Commission", type: "money" },
    { key: "adSpend", label: "Ad spend", type: "money" },
    { key: "costPerSale", label: "Cost / sale", type: "money" },
    { key: "adContribution", label: "After ad spend", type: "money" },
    { key: "returnOnAdSpend", label: "ROAS", type: "multiple" },
    {
      key: "recordedClickCost",
      label: "Recorded click costs",
      type: "money",
      hint: "Separate cost source; never added to ad spend",
    },
  ],
  clarity: [
    { key: "claritySessions", label: "Clarity sessions" },
    { key: "clarityHumanSessions", label: "Estimated human" },
    { key: "clarityBotSessions", label: "Estimated bots" },
    { key: "clarityBotRate", label: "Estimated bot rate", type: "rate" },
    {
      key: "clarityPagesPerSession",
      label: "Pages / session",
      type: "multiple",
    },
  ],
};
function dates(days: number): Pick<StatisticsInput, "from" | "to"> {
  const now = new Date();
  return {
    to: now.toISOString().slice(0, 10),
    from: new Date(now.getTime() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
function display(value: number | null, type?: Column["type"]) {
  if (value === null) return "—";
  return type === "rate"
    ? pct(value)
    : type === "money"
      ? money(value)
      : type === "multiple"
        ? `${value.toFixed(2)}×`
        : number(value);
}

export function Statistics() {
  const [filters, setFilters] = useState<StatisticsInput>(() => ({
    ...dates(7),
    groupBy: "zone",
  }));
  const [draft, setDraft] = useState(filters);
  const [report, setReport] = useState<StatisticsReport | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [advanced, setAdvanced] = useState(false);
  const refreshAds = useRef(false);
  const [claritySyncing, setClaritySyncing] = useState(false),
    [clarityNotice, setClarityNotice] = useState("");
  const [view, setView] = useState("performance"),
    [search, setSearch] = useState(""),
    [minimum, setMinimum] = useState(0);
  const [sort, setSort] = useState<{
    key: NumericMetric;
    direction: "asc" | "desc";
  }>({ key: "visits", direction: "desc" });
  const [page, setPage] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    const forceAds = refreshAds.current;
    refreshAds.current = false;
    setLoading(true);
    setError("");
    setReport(null);
    void api<StatisticsReport>("/admin/statistics/report", {
      method: "POST",
      body: JSON.stringify({ ...filters, refreshAds: forceAds }),
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setReport(data);
          setPage(1);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [filters, revision]);
  useEffect(() => setPage(1), [filters, search, minimum, sort]);
  const rows = useMemo(
    () =>
      orderStatistics(
        (report?.rows ?? []).filter(
          (r) =>
            r.visits >= minimum &&
            `${r.label} ${r.detail}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        ),
        sort.key,
        sort.direction,
      ),
    [report, minimum, search, sort],
  );
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const visible = rows.slice((page - 1) * 50, page * 50);
  const columnGroups = Object.entries(columns).filter(
    ([key]) => key !== "clarity" || report?.clarity.aligned,
  );
  const activeColumns = columns[view] ?? columns.performance;
  useEffect(() => {
    if (report && view === "clarity" && !report.clarity.aligned) {
      setView("performance");
      setSort({ key: "visits", direction: "desc" });
    }
  }, [report, view]);
  const apply = (next: StatisticsInput) => {
    setRevision(0);
    setFilters(next);
    setDraft(next);
  };
  const drill = (row: StatisticsRow) => {
    const next = { ...filters, ...row.filters };
    next.groupBy =
      filters.groupBy === "country"
        ? "state"
        : filters.groupBy === "state"
          ? "city"
          : filters.groupBy === "campaign"
            ? "zone"
            : "landing";
    apply(next);
    setAdvanced(true);
    setSearch("");
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", statisticsCsv(rows)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `sparecash-${filters.groupBy}-${filters.from}-${filters.to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const refreshClarity = async () => {
    setClaritySyncing(true);
    setClarityNotice("");
    try {
      await api("/admin/statistics/clarity/refresh", { method: "POST" });
      setClarityNotice("Clarity import completed.");
      setRevision((value) => value + 1);
    } catch (e) {
      setClarityNotice(
        e instanceof Error ? e.message : "Clarity refresh failed.",
      );
    } finally {
      setClaritySyncing(false);
    }
  };
  return (
    <div className="statistics-page">
      <form
        className="panel statistics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <div className="statistics-filter-row">
          <Field label="Break down by">
            <select
              value={filters.groupBy}
              onChange={(e) =>
                apply({
                  ...draft,
                  groupBy: e.target.value as StatisticsInput["groupBy"],
                })
              }
            >
              {Object.entries(groups).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From (UTC)">
            <input
              required
              type="date"
              value={draft.from}
              max={draft.to}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </Field>
          <Field label="Through (UTC)">
            <input
              required
              type="date"
              value={draft.to}
              min={draft.from}
              max={dates(1).to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </Field>
          <button className="button" type="submit">
            Apply
          </button>
          <button
            className="button secondary"
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <SlidersHorizontal size={16} />
            Filters
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={loading}
            onClick={() => {
              refreshAds.current = true;
              setRevision((r) => r + 1);
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        <div className="statistics-presets">
          {[1, 7, 30].map((days) => (
            <button
              key={days}
              type="button"
              className="text-button"
              onClick={() => apply({ ...filters, ...dates(days) })}
            >
              {days === 1 ? "Today" : `Last ${days} days`}
            </button>
          ))}
          <span>All dates in UTC</span>
          {Object.entries(filters).some(
            ([k, v]) => !["from", "to", "groupBy"].includes(k) && v,
          ) && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                apply({
                  from: filters.from,
                  to: filters.to,
                  groupBy: filters.groupBy,
                })
              }
            >
              Clear filters
            </button>
          )}
        </div>
        {advanced && (
          <div className="statistics-advanced">
            <Field label="Campaign ID">
              <input
                placeholder="All tracked campaigns"
                inputMode="numeric"
                value={draft.campaignId ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    campaignId: e.target.value || undefined,
                  })
                }
              />
            </Field>
            <Field label="Zone ID">
              <input
                placeholder="All zones"
                inputMode="numeric"
                value={draft.zoneId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, zoneId: e.target.value || undefined })
                }
              />
            </Field>
            <Field label="Landing variant">
              <select
                value={draft.variantId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, variantId: e.target.value || undefined })
                }
              >
                <option value="">All landing pages</option>
                {report?.options.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
                {draft.variantId &&
                  !report?.options.variants.some(
                    (v) => v.id === draft.variantId,
                  ) && (
                    <option value={draft.variantId}>{draft.variantId}</option>
                  )}
              </select>
            </Field>
            <Field label="Country code">
              <input
                placeholder="For example, US"
                maxLength={2}
                value={draft.country ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    country: e.target.value.toUpperCase() || undefined,
                  })
                }
              />
            </Field>
            <Field label="State / region">
              <input
                placeholder="For example, Illinois"
                value={draft.region ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, region: e.target.value || undefined })
                }
              />
            </Field>
            <Field label="City">
              <input
                placeholder="All cities"
                value={draft.city ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, city: e.target.value || undefined })
                }
              />
            </Field>
            <Field label="Device">
              <select
                value={draft.device ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    device: (e.target.value ||
                      undefined) as StatisticsInput["device"],
                  })
                }
              >
                <option value="">All devices</option>
                {["Mobile", "Tablet", "Desktop", "Unknown"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Browser">
              <select
                value={draft.browser ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, browser: e.target.value || undefined })
                }
              >
                <option value="">All browsers</option>
                {[
                  "Chrome",
                  "Safari",
                  "Edge",
                  "Firefox",
                  "Opera",
                  "Samsung Internet",
                  "Unknown",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Operating system">
              <select
                value={draft.os ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, os: e.target.value || undefined })
                }
              >
                <option value="">All operating systems</option>
                {["Android", "iOS", "Windows", "macOS", "Linux", "Unknown"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </Field>
          </div>
        )}
        <div className="statistics-active">
          {Object.entries(filters)
            .filter(([k, v]) => !["from", "to", "groupBy"].includes(k) && v)
            .map(([k, v]) => (
              <span key={k}>
                {(
                  {
                    campaignId: "Campaign",
                    zoneId: "Zone",
                    variantId: "Landing",
                    region: "State",
                    os: "OS",
                  } as Record<string, string>
                )[k] ?? k}
                : {String(v)}
              </span>
            ))}
        </div>
      </form>
      {loading && (
        <div className="panel statistics-loading" role="status">
          <Spinner />
          <span>Loading visits and advertiser statistics…</span>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setRevision((r) => r + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {report && (
        <>
          <div className="statistics-source" role="status">
            <span className={`statistics-status ${report.advertiser.status}`} />
            <span>
              {report.advertiser.message}
              {report.advertiser.fetchedAt && (
                <>
                  {" "}
                  Last read{" "}
                  {new Date(report.advertiser.fetchedAt).toLocaleString()}.
                </>
              )}
            </span>
            {report.advertiser.status === "unavailable" && (
              <a href="/admin/integrations">
                Integrations <ArrowUpRight size={13} />
              </a>
            )}
          </div>
          <section
            className="panel statistics-clarity"
            aria-label="Microsoft Clarity"
          >
            <div className="statistics-clarity-heading">
              <div>
                <span
                  className={`statistics-status ${report.clarity.status}`}
                />
                <div>
                  <h3>Microsoft Clarity</h3>
                  <p>{report.clarity.message}</p>
                </div>
              </div>
              {report.clarity.status === "unavailable" ? (
                <a className="button secondary" href="/admin/integrations">
                  Configure
                  <ArrowUpRight size={14} />
                </a>
              ) : (
                <button
                  className="button secondary"
                  type="button"
                  disabled={claritySyncing || !report.clarity.refreshAvailable}
                  onClick={refreshClarity}
                >
                  <RefreshCw
                    size={15}
                    className={claritySyncing ? "spin" : ""}
                  />
                  {claritySyncing ? "Importing…" : "Import latest"}
                </button>
              )}
            </div>
            {report.clarity.status === "empty" ? (
              <div className="statistics-clarity-empty">
                No processed Clarity rows yet. This does not mean zero bots or
                zero sessions.
              </div>
            ) : report.clarity.snapshot ? (
              <div className="statistics-clarity-metrics">
                <div>
                  <span>Attributed sessions</span>
                  <strong>
                    {number(report.clarity.summary.attributedSessions)}
                  </strong>
                </div>
                <div>
                  <span>Estimated human</span>
                  <strong>
                    {number(report.clarity.summary.humanSessions)}
                  </strong>
                </div>
                <div>
                  <span>Estimated bots</span>
                  <strong>{number(report.clarity.summary.botSessions)}</strong>
                </div>
                <div>
                  <span>Estimated bot rate</span>
                  <strong>{pct(report.clarity.summary.botRate)}</strong>
                </div>
                <div>
                  <span>Pages / session</span>
                  <strong>
                    {report.clarity.summary.pagesPerSession === null
                      ? "—"
                      : `${report.clarity.summary.pagesPerSession.toFixed(2)}×`}
                  </strong>
                </div>
                <div>
                  <span>Unattributed sessions</span>
                  <strong>
                    {number(report.clarity.summary.unattributedSessions)}
                  </strong>
                </div>
              </div>
            ) : null}
            <div className="statistics-clarity-meta">
              <span>
                {report.clarity.snapshot ? (
                  <>
                    Rolling window:{" "}
                    {new Date(
                      report.clarity.snapshot.windowStart,
                    ).toLocaleString()}{" "}
                    –{" "}
                    {new Date(
                      report.clarity.snapshot.windowEnd,
                    ).toLocaleString()}{" "}
                    · imported{" "}
                    {new Date(
                      report.clarity.snapshot.fetchedAt,
                    ).toLocaleString()}
                  </>
                ) : (
                  "No Clarity export has been imported yet."
                )}
              </span>
              <span>{report.clarity.alignmentMessage}</span>
              {!report.clarity.refreshAvailable &&
                report.clarity.nextRefreshAt && (
                  <span>
                    Next manual import after{" "}
                    {new Date(report.clarity.nextRefreshAt).toLocaleString()}.
                    Clarity allows 10 exports per day.
                  </span>
                )}
              {clarityNotice && <span role="status">{clarityNotice}</span>}
            </div>
          </section>
          <div className="stats-grid statistics-summary">
            <div className="metric">
              <div>
                Ad CTR <MousePointer2 size={19} />
              </div>
              <strong>{pct(report.summary.ctr)}</strong>
              <small>
                {display(report.summary.adClicks)} clicks /{" "}
                {display(report.summary.impressions)} impressions
              </small>
            </div>
            <div className="metric">
              <div>
                Verified visits <ShieldCheck size={19} />
              </div>
              <strong>{pct(report.summary.verifiedRate)}</strong>
              <small>
                {number(report.summary.verified)} of{" "}
                {number(report.summary.visits)} visits
              </small>
            </div>
            <div className="metric">
              <div>
                Engagement rate <Activity size={19} />
              </div>
              <strong>{pct(report.summary.engagementRate)}</strong>
              <small>
                {number(report.summary.engaged)} visits took a qualifying action
              </small>
            </div>
            <div className="metric">
              <div>
                Subscription rate <Users size={19} />
              </div>
              <strong>{pct(report.summary.subscriptionRate)}</strong>
              <small>
                {number(report.summary.subscribers)} visits with a confirmed
                opt-in
              </small>
            </div>
          </div>
          <section
            className="panel statistics-quality"
            aria-label="Traffic quality"
          >
            <div>
              <h3>Traffic quality</h3>
              <p>
                {number(report.summary.visits)} tracked visits ·{" "}
                {number(report.summary.applicationVisitors)} application visits
                · {money(report.summary.revenue)} commission
              </p>
            </div>
            <div className="statistics-quality-chart">
              <div
                className="statistics-quality-bar"
                role="img"
                aria-label={`${number(report.summary.verified)} verified, ${number(report.summary.suspectedBots)} suspected bots, ${number(report.summary.unverified)} unverified`}
              >
                <span
                  className="verified"
                  style={{
                    width: `${(report.summary.verifiedRate ?? 0) * 100}%`,
                  }}
                />
                <span
                  className="bots"
                  style={{ width: `${(report.summary.botRate ?? 0) * 100}%` }}
                />
                <span
                  className="unknown"
                  style={{
                    width: `${(report.summary.unverifiedRate ?? 0) * 100}%`,
                  }}
                />
              </div>
              <div className="statistics-legend">
                <span>
                  <i className="verified" />
                  Verified {pct(report.summary.verifiedRate)}
                </span>
                <span>
                  <i className="bots" />
                  Suspected bots {pct(report.summary.botRate)}
                </span>
                <span>
                  <i className="unknown" />
                  Unverified {pct(report.summary.unverifiedRate)}
                </span>
              </div>
            </div>
          </section>
          {["country", "state", "city"].includes(filters.groupBy ?? "") && (
            <div className="statistics-note">
              Location recorded for {number(report.location.captured)} of{" "}
              {number(report.summary.visits)} visits. Missing locations remain
              “Unknown”.{" "}
              {!report.location.configured && (
                <>
                  <a href="/admin/integrations">
                    Configure trusted location headers
                  </a>{" "}
                  to capture locations on new visits.
                </>
              )}
            </div>
          )}
          <section className="panel table-panel statistics-table-panel">
            <div className="section-heading">
              <div>
                <h2>
                  Compare {groups[filters.groupBy ?? "zone"].toLowerCase()}{" "}
                  results
                </h2>
                <p>
                  Rates include the visit count. Under 30 visits is marked as a
                  small sample.
                </p>
              </div>
              <button
                className="button secondary"
                disabled={!rows.length}
                onClick={exportCsv}
              >
                <Download size={16} />
                Export CSV
              </button>
            </div>
            <div className="statistics-tabs" aria-label="Metrics">
              {columnGroups.map(([key]) => (
                <button
                  key={key}
                  className={view === key ? "active" : ""}
                  aria-pressed={view === key}
                  onClick={() => {
                    setView(key);
                    setSort({ key: columns[key][0].key, direction: "desc" });
                  }}
                >
                  {key[0].toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
            <div className="statistics-table-tools">
              <label className="statistics-search">
                <Search size={16} />
                <input
                  aria-label="Search segments"
                  placeholder="Search segments…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <Field label="Minimum visits">
                <input
                  type="number"
                  min={0}
                  max={50000}
                  value={minimum}
                  onChange={(e) =>
                    setMinimum(Math.max(0, Number(e.target.value)))
                  }
                />
              </Field>
              <span>
                {number(rows.length)} matching segments · summary includes all
                report traffic
              </span>
            </div>
            {!rows.length ? (
              <Empty
                title="No matching traffic"
                description="Try a wider date range or clear the table filters. New visits will appear here as they arrive."
              />
            ) : (
              <>
                <div
                  className="table-scroll statistics-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Traffic statistics table"
                >
                  <table className="statistics-table">
                    <thead>
                      <tr>
                        <th scope="col">{groups[filters.groupBy ?? "zone"]}</th>
                        {activeColumns.map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            aria-sort={
                              sort.key === c.key
                                ? sort.direction === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            <button
                              title={c.hint}
                              onClick={() =>
                                setSort({
                                  key: c.key,
                                  direction:
                                    sort.key === c.key &&
                                    sort.direction === "desc"
                                      ? "asc"
                                      : "desc",
                                })
                              }
                            >
                              {c.label}
                              {sort.key === c.key &&
                                (sort.direction === "desc" ? (
                                  <ArrowDown size={13} />
                                ) : (
                                  <ArrowUp size={13} />
                                ))}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => (
                        <tr key={row.key}>
                          <th scope="row">
                            <div className="statistics-segment">
                              <span>
                                <b>{row.label}</b>
                                {row.detail && <small>{row.detail}</small>}
                                {row.visits < 30 && (
                                  <em>
                                    {row.visits
                                      ? "Small sample"
                                      : "No tracked visits"}
                                  </em>
                                )}
                              </span>
                              {Object.values(row.filters).some(Boolean) && (
                                <button
                                  className="icon-button"
                                  title={`Drill into ${row.label}`}
                                  aria-label={`Drill into ${row.label}`}
                                  onClick={() => drill(row)}
                                >
                                  <ArrowUpRight size={15} />
                                </button>
                              )}
                            </div>
                          </th>
                          {activeColumns.map((c) => (
                            <td
                              key={c.key}
                              className={
                                ["botRate", "clarityBotRate"].includes(c.key) &&
                                (row[c.key] ?? 0) > 0.3
                                  ? "statistics-warning"
                                  : undefined
                              }
                            >
                              <b>{display(row[c.key], c.type)}</b>
                              {c.count && (
                                <small>
                                  {number(row[c.count] ?? 0)} visits
                                </small>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="statistics-pagination">
                  <span>
                    Page {page} of {pages} · {number(rows.length)} segments
                  </span>
                  <div>
                    <button
                      className="button secondary"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="button secondary"
                      disabled={page >= pages}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
          <details className="panel statistics-definitions">
            <summary>How these numbers are counted</summary>
            <dl>
              {Object.entries(report.definitions).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {(
                      {
                        suspectedBots: "Suspected bots",
                        ctr: "Ad CTR",
                      } as Record<string, string>
                    )[key] ?? key[0].toUpperCase() + key.slice(1)}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>
              CSV rate fields use decimals (0.25 = 25%). Blank values mean
              unavailable, not zero.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
