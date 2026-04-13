/* IncidentCard — postmortem-styled centerpiece. Status row, headline +
   summary + blast-radius mini-graph, RCA chain, token telemetry footer,
   agent action log, mark-resolved + re-run-rca buttons. */

import React from "react";
import { StatusPill, CheckGlyph, XGlyph, Tooltip, relTime } from "./Primitives";
import { MiniDependencyGraph } from "./DependencyGraph";
import { explainIncident, explainAction } from "../lib/plainEnglish";

export function IncidentCard({ incident, services, edges, layout, actions, onMarkResolved }) {
  if (!incident) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="ttl">
            <span className="label">Incident</span>
            <StatusPill status="healthy" label="System healthy" transmitting />
          </div>
          <div className="meta"><span className="label" style={{ fontSize: 10 }}>last 24h</span></div>
        </div>
        <div className="empty">
          <CheckGlyph size={22} />
          <div style={{ color: "var(--fg)" }}>No incidents in the last 24h.</div>
          <div className="label">Mesh nominal across {services.length} services</div>
        </div>
      </div>
    );
  }
  const incActions = (actions || []).filter(a => a.ts >= incident.startedAt - 1500).slice().reverse();
  const summaryHtml = (incident.summary || "").split(/(`[^`]+`)/g).map((p, i) =>
    p.startsWith("`") && p.endsWith("`")
      ? <code key={i}>{p.slice(1, -1)}</code>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );

  return (
    <div className="card">
      <div className="incident-status">
        <StatusPill status="unreachable" label="Active incident" transmitting />
        <span className={`src-badge ${incident.source}`}>[{incident.source}]</span>
        <span className="age mono">{incident.severity || "S2"} · started {relTime(incident.startedAt)}</span>
        <span className="id mono">{incident.id}</span>
      </div>

      <div className="incident-headline">
        <div>
          <h2><code>{incident.rootCause}</code> is the root cause of {(incident.suspects || []).length > 1 ? "upstream failures" : "errors in this flow"}.</h2>
          <div className="summary">{summaryHtml}</div>
        </div>
        <div className="mini-graph">
          <div className="mg-head">
            <div className="label">Blast radius</div>
            <div className="mg-legend">
              <span><span className="dot root"></span>root</span>
              <span><span className="dot vict"></span>victim</span>
              <span><span className="dot heal"></span>healthy</span>
            </div>
          </div>
          <MiniDependencyGraph services={services} edges={edges} layout={layout} faulty={incident.rootCause} />
          <div className="mg-foot">
            <span><span className="k" style={{ color: "var(--fg-4)" }}>impacted</span> <span className="v crit">{(incident.suspects || []).length + 1}</span> / {services.length}</span>
            <span><span className="k" style={{ color: "var(--fg-4)" }}>severity</span> <span className="v warn">{incident.severity || "S2"}</span></span>
          </div>
        </div>
      </div>

      <div className="plain-explain">
        <div className="label">What happened, in plain English</div>
        <p className="plain-body">{explainIncident(incident)}</p>
      </div>

      <div className="rca">
        <div className="label">Technical analysis</div>
        {(incident.rca || []).map((step, i) => (
          <div key={i} className={`rca-step ${step.therefore ? "therefore" : ""}`}>
            <div className="conn">{step.conn}</div>
            <div className="body" dangerouslySetInnerHTML={{ __html: step.body }} />
          </div>
        ))}
      </div>

      {incident.llm && (
        <div className="token-foot">
          <span><span className="k">prompt</span><span className="v">{incident.llm.prompt_tokens}</span></span>
          <span><span className="k">completion</span><span className="v">{incident.llm.completion_tokens}</span></span>
          <span><span className="k">total</span><span className="v">{incident.llm.total_tokens}</span></span>
          <span><span className="k">llm_latency</span><span className="v">{incident.llm.latency_ms}ms</span></span>
        </div>
      )}

      <div className="actions plain-actions">
        <div className="label">Remediation steps the agent took</div>
        {(incident.actions || []).length === 0 ? (
          <div style={{ color: "var(--fg-3)", fontSize: 12 }}>The agent is still analysing — no actions yet.</div>
        ) : (
          incident.actions.map((a, idx) => {
            const e = explainAction(a, incident.rootCause);
            if (!e) return null;
            return (
              <div key={`${a.service}-${a.action}-${idx}`} className={`plain-action-row ${e.ok ? "ok" : "err"}`}>
                <div className="ok-glyph">
                  {e.ok ? <CheckGlyph size={11} color="var(--signal)" /> : <XGlyph size={11} color="var(--crit)" />}
                </div>
                <div className="step-num">{idx + 1}</div>
                <div className="step-body">
                  <div className="step-title">
                    {e.title} <span className="step-target">on <code>{e.target}</code></span>
                  </div>
                  {e.targetBlurb ? (
                    <div className="step-blurb">
                      <span className="step-blurb-label">about <code>{e.target}</code>:</span> {e.targetBlurb}
                    </div>
                  ) : null}
                  <div className="step-why">{e.why}</div>
                  <div className="step-raw">technical: <code>{e.raw}</code></div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="incident-foot">
        <Tooltip label="Re-evaluate root cause" hint="The agent automatically re-runs analysis every 2s — this is informational only.">
          <button className="btn ghost">Re-run RCA</button>
        </Tooltip>
        <Tooltip label="Mark resolved" hint="Clears chaos on the root cause and closes this incident. The agent will reopen if symptoms persist.">
          <button className="btn primary" onClick={() => onMarkResolved(incident.rootCause)}>
            <CheckGlyph size={11} color="currentColor" />
            Mark resolved
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
