/* ChaosPanel — service / mode / magnitude / duration + active chaos list. */

import React, { useState } from "react";
import { Tooltip } from "./Primitives";

const MODE_DEFS = [
  { id: "latency", label: "Latency", hint: "Adds N ms of artificial delay to every RPC on the target service. Use for slow-but-not-failing scenarios." },
  { id: "errors",  label: "Errors",  hint: "Returns gRPC UNAVAILABLE on a fraction of requests. Use to simulate hard outages or flapping dependencies." },
  { id: "grey",    label: "Grey",    hint: "Combines latency + sporadic errors. The realistic, hard-to-detect failure mode SREs hate most." },
  { id: "none",    label: "None",    hint: "Clears the failure mode. Equivalent to pressing the Clear button." },
];

const DURATIONS = [15, 30, 60, 120];

const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const SERVICE_HINTS = {
  auth:           "Token issue + validate. Failures here block every authenticated flow.",
  order:          "Orchestrates checkout / refund / cart-merge. Sits at the centre of most flows.",
  inventory:      "Stock reserve / release / restock. Slow inventory cascades into Order's circuit breaker.",
  notification:   "User and ops notifications. Non-critical: order returns 'ok (notify degraded)' when this fails.",
  payments:       "Authorize / capture / refund. Failures here halt checkout at the payment stage.",
  fraud:          "Risk scoring. Failures cause checkout to hold orders for manual review.",
  shipping:       "Quote + label creation. Failures stop the post-payment shipping step.",
  recommendation: "Personalised SKUs. Recommendation reads inventory; cascades on inventory degradation.",
};

export function ChaosPanel({
  services, flowServices, chaos, activeChaos,
  onMode, onService, onErrorRate, onLatency, onDuration,
  onInject, onClear, onClearAll,
}) {
  const [scope, setScope] = useState("flow");
  const list = services.filter(s => scope === "all" || !flowServices || flowServices.includes(s.id));
  const activeList = Object.entries(activeChaos || {});

  return (
    <div className="card" id="chaos-panel">
      <div className="card-head">
        <div className="ttl"><span className="label">Chaos injector</span></div>
        <div className="meta chips">
          <Tooltip label="Active flow only" hint="Show only services that participate in the currently-selected flow." side="bottom">
            <button className={`chip ${scope === "flow" ? "on" : ""}`} onClick={() => setScope("flow")}>Active flow</button>
          </Tooltip>
          <Tooltip label="All services" hint="Show every service in the mesh — useful for cross-flow failure scenarios." side="bottom">
            <button className={`chip ${scope === "all" ? "on" : ""}`} onClick={() => setScope("all")}>All services</button>
          </Tooltip>
        </div>
      </div>
      <div className="card-body">
        <div className="field">
          <span className="label">Service</span>
          <div className="chips">
            {list.filter(s => s.id !== "gateway").map(s => (
              <Tooltip key={s.id}
                label={`Target: ${cap(s.label)}`}
                hint={SERVICE_HINTS[s.id] || `Inject the failure on ${s.label}.`}>
                <button className={`chip ${chaos.service === s.id ? "on" : ""}`} onClick={() => onService(s.id)}>
                  <span className="marker"></span>{cap(s.label)}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <span className="label">Mode</span>
          <div className="chips">
            {MODE_DEFS.map(m => (
              <Tooltip key={m.id} label={m.label} hint={m.hint}>
                <button className={`chip ${chaos.mode === m.id ? "on" : ""}`} onClick={() => onMode(m.id)}>
                  <span className="marker"></span>{m.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="field-row" style={{ marginTop: "var(--s-3)" }}>
          <Tooltip
            label="Added latency (ms)"
            hint="Milliseconds of artificial delay added to every RPC on the target. Active when mode is Latency or Grey.">
            <div className="field">
              <span className={`label ${chaos.mode === "latency" ? "" : "dim"}`}>Latency (ms)</span>
              <input
                type="number" min={0} max={5000} step={50}
                value={chaos.latency_ms || 0}
                onChange={(e) => onLatency(parseInt(e.target.value, 10))}
                style={{ opacity: chaos.mode === "errors" ? 0.45 : 1 }}
              />
            </div>
          </Tooltip>
          <Tooltip
            label="Failure ratio (0–1)"
            hint="Fraction of requests that return UNAVAILABLE. 0 = none, 1 = all. Active when mode is Errors or Grey.">
            <div className="field">
              <span className={`label ${chaos.mode === "errors" || chaos.mode === "grey" ? "" : "dim"}`}>Error rate (0–1)</span>
              <input
                type="number" min={0} max={1} step={0.05}
                value={chaos.error_rate || 0}
                onChange={(e) => onErrorRate(parseFloat(e.target.value))}
                style={{ opacity: chaos.mode === "latency" ? 0.45 : 1 }}
              />
            </div>
          </Tooltip>
        </div>

        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <span className="label">Duration</span>
          <div className="chips">
            {DURATIONS.map(d => (
              <Tooltip key={d} label={`${d} seconds`} hint={`Auto-clear the chaos after ${d}s. The agent has ample time to detect, decide, and remediate.`}>
                <button className={`chip ${chaos.duration_s === d ? "on" : ""}`} onClick={() => onDuration(d)}>
                  <span className="marker"></span>{d}s
                </button>
              </Tooltip>
            ))}
            <Tooltip label="Custom duration" hint="Set a non-preset auto-clear time, in seconds (1–600).">
              <input
                type="number" min={1} max={600}
                value={chaos.duration_s || 30}
                onChange={(e) => onDuration(parseInt(e.target.value, 10))}
                style={{ width: 64 }}
              />
            </Tooltip>
          </div>
        </div>

        <div className="row" style={{ gap: "var(--s-3)", marginTop: "var(--s-4)" }}>
          <Tooltip label="Inject failure" hint={`Apply ${cap(chaos.mode)} on ${cap(chaos.service)} for ${chaos.duration_s}s. The agent will detect and respond within ~5s.`}>
            <button className="btn warn" onClick={() => onInject(chaos)}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 1 L9 9 L1 9 Z" stroke="currentColor" fill="none" strokeWidth="1" /></svg>
              Inject failure
            </button>
          </Tooltip>
          <Tooltip label="Clear chaos" hint={`Removes any active failure on ${cap(chaos.service)} immediately.`}>
            <button className="btn" onClick={() => onClear(chaos.service)}>Clear on this service</button>
          </Tooltip>
          <Tooltip label="Clear all chaos" hint="Sweeps every active failure across all 8 services. Bound to the `c` keyboard shortcut." side="bottom">
            <button className="btn ghost" onClick={onClearAll}>↻ Clear all chaos</button>
          </Tooltip>
        </div>

        <div className="active-chaos">
          <div className="label">Active chaos</div>
          {activeList.length === 0 ? (
            <span style={{ color: "var(--fg-3)", fontSize: 12 }}>No active failures.</span>
          ) : activeList.map(([svc, c]) => (
            <div key={svc} className="active-chaos-row">
              <span><code style={{ background: "var(--bg-2)", padding: "1px 6px", border: "1px solid var(--hairline)", borderRadius: 4 }}>{svc}</code> · <span style={{ color: "var(--fg-3)" }}>{cap(c.mode)}</span> · {c.mode === "latency" ? `${c.magnitude}ms` : `${Math.round(c.magnitude * 100)}%`}</span>
              <Tooltip label="Clear" hint={`Stop chaos on ${svc}.`}>
                <button className="btn sm" onClick={() => onClear(svc)}>clear</button>
              </Tooltip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
