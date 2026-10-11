import { useEffect, useState } from "react";
import { api, money } from "../api";
import { ShieldCheck } from "lucide-react";

export function RetargetingSettings() {
  const [status, setStatus] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [groupBy, setGroupBy] = useState("campaign");
  const [revision, refresh] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setReport(null);
    void Promise.all([
      api("/admin/retargeting/status"),
      api(`/admin/retargeting/report?groupBy=${groupBy}`),
    ])
      .then(([status, report]) => {
        if (active) {
          setStatus(status);
          setReport(report);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [groupBy, revision]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <ShieldCheck size={20} />
        <div>
          <h3>Retargeting</h3>
          <p>
            {status
              ? `${status.config.enabled && status.validation.collectionReady ? "Audience collection enabled" : "Audience collection inactive"} · ${status.config.controlPercent}% control group`
              : "Loading audience setup…"}
          </p>
        </div>
      </div>
      <p>
        Configure audiences and event stages through SpareCash MCP. Campaign
        creation, targeting and advertising statistics stay in PropellerAds MCP.
      </p>
      {error && <p role="alert">{error}</p>}
      {status && (
        <>
          {status.validation.gaps.length > 0 && (
            <details>
              <summary>
                {status.validation.gaps.length} setup checks need attention
              </summary>
              <ul>
                {status.validation.gaps.map((gap: string) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="help">
            {status.config.audiences.length} audiences configured ·{" "}
            {status.paidJourneysSuppressed} journeys suppressed after a paid
            lead · {status.staleUnacknowledgedAttempts} pixel attempts without a
            receipt. Pixel loads do not confirm audience membership.
          </p>
          {status.attempts.length > 0 && (
            <details>
              <summary>Pixel attempts and failures</summary>
              <ul>
                {status.attempts.map((row: any) => (
                  <li key={`${row.action}:${row.state}`}>
                    {row.action} · {row.state}: {row._count}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <div className="advertising-choices">
        <label>
          Report by{" "}
          <select
            aria-label="Retargeting report grouping"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="campaign">Campaign</option>
            <option value="audience">Audience</option>
            <option value="zone">Advertising zone</option>
            <option value="original_angle">Original landing</option>
            <option value="group">Treatment / control</option>
          </select>
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => refresh((n) => n + 1)}
        >
          Refresh report
        </button>
      </div>
      {report && (
        <>
          <p className="help">
            {report.window.from} – {report.window.through} UTC · Arrival
            cohorts; later outcomes included. Missing spend is unknown.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Raw visits</th>
                  <th>Verified</th>
                  <th>Verified returns</th>
                  <th>Applications</th>
                  <th>Subscriptions</th>
                  <th>Paid leads</th>
                  <th>Commission</th>
                  <th>Spend</th>
                  <th>Cost / paid lead</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row: any) => (
                  <tr key={row.key}>
                    <td>{row.key}</td>
                    <td>{row.rawVisits}</td>
                    <td>{row.verifiedVisits}</td>
                    <td>{row.verifiedReturnVisits}</td>
                    <td>{row.applicationClicks}</td>
                    <td>{row.confirmedSubscriptions}</td>
                    <td>{row.paidLeads}</td>
                    <td>{money(row.commission)}</td>
                    <td>{row.spend === null ? "Unknown" : money(row.spend)}</td>
                    <td>
                      {row.paidLeadAcquisitionCost === null
                        ? "—"
                        : money(row.paidLeadAcquisitionCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>
              Control comparison · {report.controlStudy.observationDays}-day
              observation window
            </summary>
            <ul>
              {report.controlStudy.arms.map((arm: any) => (
                <li key={arm.group}>
                  {arm.group}: {arm.convertedJourneys} of {arm.eligibleJourneys}{" "}
                  eligible journeys generated a paid lead;{" "}
                  {arm.controlJourneysWithRetargetingClicks} control journeys
                  had retargeting clicks.
                </li>
              ))}
            </ul>
            <p className="help">{report.controlStudy.interpretation}</p>
          </details>
        </>
      )}
    </section>
  );
}
