/* ServiceHealth — per-service rows filtered to active flow.
   Click row to toggle drill panel; highlights focused row. */

import React from "react";
import { CountUp, MetricSparkline } from "./Primitives";

export function ServiceHealth({ services, flowServices, health, sparks, focused, onFocus }) {
  const list = services.filter(s => !flowServices || flowServices.includes(s.id));
  return (
    <div className="card">
      <div className="card-head">
        <div className="ttl"><span className="label">Service health</span></div>
        <div className="meta"><span className="label">last 60s</span></div>
      </div>
      <div style={{ padding: "var(--s-2) 0 var(--s-2)" }}>
        {list.map(svc => {
          const m = health[svc.id] || { p95: 0, err: 0, status: "healthy" };
          const accent = m.status === "unreachable" ? "var(--crit)" : m.status === "degraded" ? "var(--warn)" : "var(--fg-2)";
          const cls = m.status === "unreachable" ? "crit" : m.status === "degraded" ? "warn" : "";
          return (
            <div key={svc.id}
              className={`svc-row ${m.status} ${focused === svc.id ? "focus" : ""}`}
              onClick={() => onFocus(svc.id === focused ? null : svc.id)}>
              <div className="name"><span className="dot"></span>{svc.label}</div>
              <div className="metric">
                <div className={`v ${cls}`}><CountUp value={m.p95} decimals={0} suffix="ms" /></div>
                <div className="l">p95</div>
              </div>
              <div className="metric">
                <div className={`v ${cls}`}><CountUp value={m.err * 100} decimals={1} suffix="%" /></div>
                <div className="l">err</div>
              </div>
              <MetricSparkline data={(sparks?.[svc.id]) || []} width={56} height={20} accent={accent} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
