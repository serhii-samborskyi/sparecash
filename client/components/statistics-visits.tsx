import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  MousePointer2,
  ShieldQuestion,
} from "lucide-react";
import { api, date, money, number } from "../api";
import type { StatisticsRow } from "../statistics";
import type {
  StatisticsInput,
  StatisticsVisits,
} from "../../server/services/statistics";
import { Modal, Spinner } from "./ui";

type Visit = StatisticsVisits["items"][number];

function elapsed(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function shown(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function KeyValues({ values }: { values: [string, unknown][] }) {
  return (
    <dl className="visit-key-values">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={shown(value)}>{shown(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function quality(visit: Visit) {
  if (visit.verification.verified)
    return { label: "Verified", tone: "verified", icon: CheckCircle2 };
  if (visit.verification.botScore >= 70)
    return { label: "Suspected bot", tone: "bot", icon: Bot };
  return {
    label: humanize(visit.verification.state),
    tone: "unknown",
    icon: ShieldQuestion,
  };
}

function outcome(visit: Visit) {
  if (visit.applications.some((application) => application.postbacks.length))
    return "Purchased lead";
  if (visit.applications.length) return "Application click";
  if (
    visit.leads.some((lead) =>
      lead.subscriptions.some((subscription) => subscription.confirmedAt),
    )
  )
    return "Subscribed";
  if (visit.events.some((event) => event.kind === "QUIZ_COMPLETED"))
    return "Quiz completed";
  if (visit.events.some((event) => event.kind === "QUESTION_ANSWERED"))
    return "Quiz started";
  return "Visit only";
}

function retargetingOutcome(visit: Visit) {
  const journey = visit.retargeting.journey;
  const attempts = visit.retargeting.pixels;
  if (attempts.length) {
    const loaded = attempts.some((attempt) => attempt.state === "LOADED");
    const failed = attempts.some((attempt) =>
      ["FAILED", "UNCERTAIN"].includes(attempt.state),
    );
    if (loaded) return "Pixel loaded in the visitor's browser";
    if (failed) return "Pixel attempt failed or was uncertain";
    return "Pixel issued; browser receipt is pending";
  }
  if (!journey) return "No browser journey recorded";
  if (journey.privacy === "DENIED")
    return "No pixel: personalized advertising was declined";
  if (journey.group === "CONTROL")
    return "No pixel: visitor is in the persistent control group";
  if (journey.suppressedAt)
    return "No pixel: journey is suppressed from retargeting";
  if (
    visit.verification.verified &&
    visit.events.some((event) =>
      ["QUESTION_ANSWERED", "CHANNEL_SELECTED", "QUIZ_COMPLETED"].includes(
        event.kind,
      ),
    )
  )
    return "No pixel attempt recorded for this qualifying visit";
  return "No qualifying retargeting activity recorded";
}

function VisitDetails({ visit }: { visit: Visit }) {
  const adContext = Object.entries(visit.adContext).map(
    ([key, value]) => [humanize(key), value] as [string, unknown],
  );
  return (
    <div className="visit-detail-body">
      <section>
        <h4>Attribution</h4>
        <KeyValues
          values={[
            ["Visit ID", visit.id],
            ["External click ID", visit.externalClickId],
            ["Campaign", visit.source?.campaignId],
            ["Zone", visit.source?.zoneId],
            ["Traffic source ID", visit.source?.id],
            [
              "Recorded click cost",
              visit.cost.recorded ? money(visit.cost.amount) : "Not imported",
            ],
            ...adContext,
          ]}
        />
      </section>
      <section>
        <h4>Landing and visitor</h4>
        <KeyValues
          values={[
            ["Experiment", visit.experiment.name],
            ["Experiment ID", visit.experimentId],
            ["Landing slug", `/go/${visit.experiment.slug}`],
            ["Variant", visit.variant.name],
            ["Variant ID", visit.variantId],
            ["Country", visit.location.country],
            ["State / region", visit.location.region],
            ["City", visit.location.city],
            ["Location source", visit.location.source],
            ["Device", visit.browserContext.device],
            ["Browser", visit.browserContext.browser],
            ["Operating system", visit.browserContext.os],
            ["User agent", visit.userAgent],
          ]}
        />
      </section>
      <section>
        <h4>Quality and page activity</h4>
        <KeyValues
          values={[
            ["Verification state", visit.verification.state],
            ["Verified", visit.verification.verified],
            ["Challenge shown", visit.verification.challenged],
            ["Bot score", visit.verification.botScore],
            ["Evidence", visit.verification.evidence],
            [
              "Verified at",
              visit.verification.verifiedAt
                ? date(visit.verification.verifiedAt)
                : null,
            ],
            [
              "Verification expires",
              visit.verification.expiresAt
                ? date(visit.verification.expiresAt)
                : null,
            ],
            ["Pre-quiz active time", elapsed(visit.preQuiz.activeSeconds)],
            ["Pre-quiz clicks", visit.preQuiz.clicks],
            ["Pre-quiz scrolls", visit.preQuiz.scrolls],
            [
              "Measurement started",
              visit.preQuiz.measuredAt ? date(visit.preQuiz.measuredAt) : null,
            ],
            [
              "Measurement ended",
              visit.preQuiz.endedAt ? date(visit.preQuiz.endedAt) : null,
            ],
          ]}
        />
        {!!visit.verification.attempts.length && (
          <div className="visit-timeline compact">
            {visit.verification.attempts.map((attempt, index) => (
              <div key={`${attempt.createdAt}-${index}`}>
                <time>{date(attempt.createdAt)}</time>
                <b>{humanize(attempt.state)}</b>
                <span>
                  {attempt.errors.length
                    ? attempt.errors.join(", ")
                    : "No recorded errors"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h4>Event timeline and quiz answers</h4>
        {visit.events.length ? (
          <div className="visit-timeline">
            {visit.events.map((event, index) => (
              <div key={`${event.kind}-${event.questionId}-${index}`}>
                <time>{date(event.createdAt)}</time>
                <b>{humanize(event.kind)}</b>
                <span>
                  {[event.questionId, event.answer]
                    .filter(Boolean)
                    .join(": ") || "Recorded"}
                  {event.verifiedAt ? " · verified" : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="visit-empty-detail">
            No quiz or funnel events recorded.
          </p>
        )}
      </section>
      <section>
        <h4>Lead, subscription and application outcomes</h4>
        {visit.leads.length ? (
          visit.leads.map((lead) => (
            <div className="visit-outcome-card" key={lead.id}>
              <KeyValues
                values={[
                  ["Lead ID", lead.id],
                  ["Name", lead.name],
                  ["Status", lead.status],
                  ["Created", date(lead.createdAt)],
                  ["Timezone", `${lead.timezone} (${lead.timezoneSource})`],
                  ["Submitted answers", lead.answers],
                ]}
              />
              {lead.subscriptions.map((subscription, index) => (
                <p key={`${subscription.channel}-${index}`}>
                  <b>{subscription.channel}</b> · {subscription.status} ·
                  consent {date(subscription.consentAt)}
                  {subscription.confirmedAt
                    ? ` · confirmed ${date(subscription.confirmedAt)}`
                    : ""}
                  {subscription.stoppedAt
                    ? ` · stopped ${date(subscription.stoppedAt)}`
                    : ""}
                </p>
              ))}
            </div>
          ))
        ) : (
          <p className="visit-empty-detail">
            No lead or subscription recorded.
          </p>
        )}
        {visit.applications.map((application) => (
          <div className="visit-outcome-card" key={application.id}>
            <p>
              <b>Application click</b> · {date(application.createdAt)} ·{" "}
              {application.id}
            </p>
            {application.postbacks.map((postback, index) => (
              <p key={`${postback.event}-${index}`}>
                <b>{postback.event}</b> · {money(postback.revenue)} ·{" "}
                {date(postback.createdAt)}
              </p>
            ))}
            {application.advertiserConversions.map((conversion, index) => (
              <p key={`${conversion.event}-${index}`}>
                Advertiser goal {conversion.goal} · {conversion.event} ·{" "}
                {conversion.status}
                {conversion.payout ? ` · ${money(conversion.payout)}` : ""}
                {conversion.error ? ` · ${conversion.error}` : ""}
              </p>
            ))}
          </div>
        ))}
      </section>
      <section>
        <h4>Retargeting</h4>
        <KeyValues
          values={[
            ["Result", retargetingOutcome(visit)],
            ["Pixel attempts", visit.retargeting.pixels.length],
            ["Journey ID", visit.journeyId],
            ["Journey group", visit.retargeting.journey?.group],
            ["Privacy choice", visit.retargeting.journey?.privacy],
            [
              "Eligible at",
              visit.retargeting.journey?.eligibleAt
                ? date(visit.retargeting.journey.eligibleAt)
                : null,
            ],
            [
              "Suppressed at",
              visit.retargeting.journey?.suppressedAt
                ? date(visit.retargeting.journey.suppressedAt)
                : null,
            ],
            [
              "Suppression reason",
              visit.retargeting.journey?.suppressionReason,
            ],
            ["Campaign", visit.retargeting.campaignId],
            ["Audience", visit.retargeting.audienceId],
          ]}
        />
        {visit.retargeting.pixels.map((pixel, index) => (
          <p className="visit-pixel" key={`${pixel.audienceId}-${index}`}>
            <b>{pixel.audienceId}</b> · {pixel.action} · {pixel.state} ·{" "}
            {date(pixel.createdAt)}
            {pixel.reason ? ` · ${pixel.reason}` : ""}
          </p>
        ))}
        {!visit.retargeting.pixels.length && (
          <p className="visit-empty-detail">
            No PropellerAds audience request was recorded for this visit.
          </p>
        )}
      </section>
    </div>
  );
}

export function StatisticsVisitsModal({
  filters,
  row,
  onClose,
}: {
  filters: StatisticsInput;
  row: StatisticsRow;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<StatisticsVisits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const { refreshAds: _refreshAds, ...visitFilters } = filters;
    setLoading(true);
    setError("");
    void api<StatisticsVisits>("/admin/statistics/visits", {
      method: "POST",
      body: JSON.stringify({
        ...visitFilters,
        ...row.filters,
        groupBy: filters.groupBy,
        segmentKey: row.key,
        page,
        pageSize: 50,
      }),
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Could not load visits.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, row, page]);
  const first = result?.total ? (page - 1) * 50 + 1 : 0;
  const last = result ? Math.min(page * 50, result.total) : 0;
  return (
    <Modal
      title={`${row.label} · click details`}
      onClose={onClose}
      wide
      className="statistics-visits-modal"
    >
      <div className="modal-body statistics-visits-body">
        <div className="statistics-visits-intro">
          <div>
            <strong>
              {result ? number(result.total) : number(row.visits)} tracked
              visits
            </strong>
            <span>
              {filters.from} through {filters.to} UTC
            </span>
          </div>
          <p>
            One row per landing visit. Expand a row for all recorded
            attribution, quality, behavior, quiz, subscription, application and
            retargeting data.
          </p>
        </div>
        {loading && (
          <div className="statistics-visits-loading" role="status">
            <Spinner /> Loading click details…
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && result && !result.items.length && (
          <p className="visit-empty-detail">
            No tracked visits match this row and date range.
          </p>
        )}
        {!loading && !error && result && !!result.items.length && (
          <div className="statistics-visit-list">
            <div className="statistics-visit-head" aria-hidden="true">
              <span>Arrived</span>
              <span>Traffic source</span>
              <span>Landing</span>
              <span>Visitor</span>
              <span>Quality</span>
              <span>Activity</span>
              <span>Outcome</span>
              <span />
            </div>
            {result.items.map((visit) => {
              const state = quality(visit);
              const Icon = state.icon;
              return (
                <details className="statistics-visit" key={visit.id}>
                  <summary>
                    <span>
                      <b>{date(visit.createdAt)}</b>
                      <small>
                        {visit.externalClickId
                          ? `Click ${visit.externalClickId}`
                          : "No external click ID"}
                      </small>
                    </span>
                    <span>
                      <b>
                        {visit.source
                          ? `Campaign ${visit.source.campaignId}`
                          : "Unattributed"}
                      </b>
                      <small>
                        {visit.source
                          ? `Zone ${visit.source.zoneId}`
                          : "No campaign or zone"}
                      </small>
                    </span>
                    <span>
                      <b>{visit.experiment.name}</b>
                      <small>{visit.variant.name}</small>
                    </span>
                    <span>
                      <b>
                        {[
                          visit.location.city,
                          visit.location.region,
                          visit.location.country,
                        ]
                          .filter(Boolean)
                          .join(", ") || "Unknown location"}
                      </b>
                      <small>
                        {visit.browserContext.device} ·{" "}
                        {visit.browserContext.browser} ·{" "}
                        {visit.browserContext.os}
                      </small>
                    </span>
                    <span className={`visit-quality ${state.tone}`}>
                      <b>
                        <Icon size={14} />
                        {state.label}
                      </b>
                      <small>Bot score {visit.verification.botScore}</small>
                    </span>
                    <span>
                      <b>
                        <Clock3 size={14} />{" "}
                        {elapsed(visit.preQuiz.activeSeconds)}
                      </b>
                      <small>
                        <MousePointer2 size={12} /> {visit.preQuiz.clicks}{" "}
                        clicks · {visit.preQuiz.scrolls} scrolls
                      </small>
                    </span>
                    <span>
                      <b>{outcome(visit)}</b>
                      <small>
                        {visit.events.length} events ·{" "}
                        {visit.applications.length} applications
                      </small>
                    </span>
                    <ChevronDown className="visit-chevron" size={17} />
                  </summary>
                  <VisitDetails visit={visit} />
                </details>
              );
            })}
          </div>
        )}
      </div>
      <div className="modal-footer statistics-visits-footer">
        <p>
          {result
            ? `Showing ${number(first)}–${number(last)} of ${number(result.total)}`
            : "Click details"}
          . IP hashes and subscription addresses stay out of this traffic view.
        </p>
        <div>
          <button
            className="button secondary"
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <button
            className="button secondary"
            disabled={loading || !result || page >= result.pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </Modal>
  );
}
