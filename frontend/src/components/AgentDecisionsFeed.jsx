/* AgentDecisionsFeed — last 30 agent decisions with [llm]/[rules] badge. */

import React from "react";
import { StatusPill, CheckGlyph, XGlyph, relTime } from "./Primitives";

const VERB_MAP = {
  clear_failure:    "Cleared failure on",
  enable_fallback:  "Enabled fallback at",
  disable_fallback: "Disabled fallback at",
  mark_degraded:    "Marked degraded:",
  register:         "Registered",
};

export function AgentDecisionsFeed({ decisions, lastTickAt }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="ttl">
          <span className="label">Agent decisions</span>
          <span className="label" style={{ color: "var(--fg-4)" }}>updated {relTime(lastTickAt)}</span>
        </div>
        <div className="meta">
          <StatusPill status="healthy" label="live" transmitting />
        </div>
      </div>
      <div className="scroll-y maxh-360">
        {decisions.length === 0 ? (
          <div className="empty"><span className="label">no decisions yet</span></div>
        ) : decisions.slice(0, 30).map((d, i) => {
          const verb = VERB_MAP[d.action] || d.action;
          return (
            <div key={i} className="dec-row">
              <span className="ts">{relTime(d.ts)}</span>
              <span className={`src-badge ${d.source}`}>[{d.source}]</span>
              <span className="body">
                {verb} <code>{d.service}</code>
              </span>
              <span className={`glyph ${d.ok ? "ok" : "err"}`}>
                {d.ok ? <CheckGlyph size={11} /> : <XGlyph size={11} />}
              </span>
              <div className="tip">{d.message}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
