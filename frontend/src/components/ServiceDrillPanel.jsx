/* ServiceDrillPanel — right-side drawer (~360px). Slides in 200ms.
   Status pill, address, KPIs, p95 sparkline, recent calls, control-action
   chips, jaeger/prom/inject footer links. */

import React, { useEffect } from "react";
import {
  StatusPill, CountUp, MetricSparkline, IconBtn, Tooltip,
  CheckGlyph, XGlyph, ExtLink, relTime,
} from "./Primitives";

export function ServiceDrillPanel({ svc, services, health, sparks, calls, onClose, onJumpToChaos }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!svc) return <aside className="drill-side"></aside>;
  const meta = services.find(s => s.id === svc) || { id: svc, label: svc, port: 0 };
  const m = health[svc] || { p95: 0, err: 0, rps: 0, status: "unknown", n: 0, circuit_opens: 0, addr: `${svc}:0` };
  const data = sparks?.[svc] || [];
  const list = calls?.[svc] || [];

  const errClass = m.status === "unreachable" ? "crit" : m.status === "degraded" ? "warn" : "";

  return (
    <aside className="drill-side open">
      <div className="drill-head">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)" }}>
          <StatusPill status={m.status} label={m.status} transmitting />
          <div className="name">{meta.label}</div>
        </div>
        <IconBtn title="Close (Esc)" onClick={onClose}>
          <XGlyph size={14} color="var(--fg-3)" />
        </IconBtn>
      </div>

      <div className="drill-sub">
        <span>{m.addr || `${svc}:${meta.port}`}</span>
        <span className="copy" onClick={() => navigator.clipboard?.writeText(m.addr || `${svc}:${meta.port}`)}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="2" y="3" width="6" height="6" stroke="currentColor" strokeWidth="0.9" />
            <path d="M3 2 L8 2 L8 7" stroke="currentColor" strokeWidth="0.9" fill="none" />
          </svg>
          copy
        </span>
      </div>

      <div className="drill-body">
        <div className="kpi-grid">
          <div className="cell">
            <div className={`v ${errClass}`}><CountUp value={m.p95} decimals={0} suffix="ms" /></div>
            <div className="l">p95 latency</div>
          </div>
          <div className="cell">
            <div className={`v ${errClass}`}><CountUp value={m.err * 100} decimals={1} suffix="%" /></div>
            <div className="l">error rate</div>
          </div>
          <div className="cell">
            <div className="v"><CountUp value={m.n} decimals={0} /></div>
            <div className="l">requests / 20s</div>
          </div>
          <div className="cell">
            <div className={`v ${m.circuit_opens > 0 ? "warn" : ""}`}><CountUp value={m.circuit_opens || 0} decimals={0} /></div>
            <div className="l">circuit opens</div>
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: "var(--s-2)" }}>p95 — last 60s</div>
          <MetricSparkline data={data} width={310} height={48}
            accent={m.status === "unreachable" ? "var(--crit)" : m.status === "degraded" ? "var(--warn)" : "var(--fg-2)"} />
        </div>

        <div>
          <div className="label" style={{ marginBottom: "var(--s-2)" }}>Recent calls</div>
          <div className="calls-list">
            {list.length === 0 ? <div className="empty" style={{ padding: "var(--s-4) 0" }}><span className="label">no calls in window</span></div> : (
              list.slice(0, 8).map((c, i) => (
                <div key={i} className="call-row">
                  <span className={`glyph ${c.ok ? "ok" : "err"}`}>
                    {c.ok ? <CheckGlyph size={10} /> : <XGlyph size={10} />}
                  </span>
                  <span className="method">{c.method}</span>
                  <span className="lat">{c.latency_ms}ms</span>
                  <span className="when">{relTime(c.ts)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: "var(--s-2)" }}>Control actions</div>
          <div className="chips">
            <Tooltip label="clear_failure" hint="Removes any active fault on this service. The agent uses this when it believes the root cause is recoverable.">
              <button className="chip" onClick={() => onJumpToChaos(svc)}>clear_failure</button>
            </Tooltip>
            <Tooltip label="enable_fallback" hint="Routes traffic to a degraded but available code path. Used to shed load on a failing dependency.">
              <button className="chip" onClick={() => onJumpToChaos(svc)}>enable_fallback</button>
            </Tooltip>
            <Tooltip label="disable_fallback" hint="Returns to the primary path. Used after the dependency has recovered.">
              <button className="chip" onClick={() => onJumpToChaos(svc)}>disable_fallback</button>
            </Tooltip>
            <Tooltip label="mark_degraded" hint="Flags the service as serving partial responses. Visible to upstream routers.">
              <button className="chip" onClick={() => onJumpToChaos(svc)}>mark_degraded</button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="drill-foot">
        <a className="foot-link" href={`http://localhost:16686/search?service=${svc}`} target="_blank" rel="noreferrer">
          <span>Open in Jaeger</span>
          <span className="out"><ExtLink /></span>
        </a>
        <a className="foot-link" href={`http://localhost:9090/graph?g0.expr=${svc}_requests_total`} target="_blank" rel="noreferrer">
          <span>Open in Prometheus</span>
          <span className="out"><ExtLink /></span>
        </a>
        <button className="foot-link" onClick={() => onJumpToChaos(svc)}>
          <span>Inject failure on this service</span>
          <span className="out">→</span>
        </button>
      </div>
    </aside>
  );
}
