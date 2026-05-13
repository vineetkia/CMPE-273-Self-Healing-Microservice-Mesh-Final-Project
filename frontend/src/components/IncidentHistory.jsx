/* IncidentHistory — collapsible card. Last 50, newest first.
   Click a row to expand inline reasoning + action results. */

import React, { useState } from "react";
import { Disclosure, CheckGlyph, XGlyph, relTime } from "./Primitives";
import { explainIncident, explainAction } from "../lib/plainEnglish";

export function IncidentHistory({ incidents, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="card">
      <div className="card-head">
        <Disclosure open={open} onToggle={() => setOpen(o => !o)}
          label={<span className="label">Incident history</span>} count={incidents.length} />
        <div className="meta"><span className="label">last 50</span></div>
      </div>
      {open && (
        <div>
          {incidents.length === 0 ? (
            <div className="empty"><span className="label">no closed incidents</span></div>
          ) : (
            incidents.map((inc, i) => {
              const isOpen = expanded === inc.id;
              const verbs = (inc.actions || []).map(a => `${a.action} on ${a.service}`).join(" · ") || "rca only";
              return (
                <React.Fragment key={inc.id + "_" + i}>
                  <div className="hist-row" tabIndex={0}
                    onClick={() => setExpanded(isOpen ? null : inc.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") setExpanded(isOpen ? null : inc.id); }}>
                    <span className="when">{relTime(inc.startedAt)}</span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className={`src-badge ${inc.source}`}>[{inc.source}]</span>
                      <span className="root"><code>{inc.rootCause}</code></span>
                    </span>
                    <span className="verbs">{verbs}</span>
                  </div>
                  {isOpen && (
                    <div className="hist-expand">
                      <div className="plain-explain">
                        <div className="label" style={{ marginBottom: 6 }}>What happened</div>
                        <p className="plain-body">{explainIncident(inc)}</p>
                      </div>
                      <div className="plain-actions">
                        <div className="label" style={{ marginBottom: 6 }}>Remediation steps</div>
                        {(inc.actions && inc.actions.length) ? inc.actions.map((a, idx) => {
                          const e = explainAction(a, inc.rootCause);
                          if (!e) return null;
                          return (
                            <div key={idx} className={`plain-action-row ${e.ok ? "ok" : "err"}`}>
                              <div className="ok-glyph">
                                {e.ok ? <CheckGlyph size={10} color="var(--signal)" /> : <XGlyph size={10} color="var(--crit)" />}
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
                        }) : <span style={{ color: "var(--fg-3)", fontSize: 11.5 }}>no actions recorded</span>}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
