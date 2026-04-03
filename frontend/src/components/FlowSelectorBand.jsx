/* FlowSelectorBand — full-width band below TopBar.
   Owns 6 flow chips. Click chip = select. Inline play icon = scripted demo
   for that flow without changing selection. Keyboard 1–6 maps to chip index. */

import React from "react";
import { PlayGlyph } from "./Primitives";

export const FLOW_ORDER = ["checkout", "refund", "cart_merge", "restock", "fraud_review", "recommendations"];

export function FlowSelectorBand({ flows, activeFlow, onSelect, onScripted, scriptedRunning }) {
  return (
    <nav className="flow-band">
      {FLOW_ORDER.map((id, i) => {
        const f = flows[id];
        if (!f) return null;
        const on = activeFlow === id;
        const running = scriptedRunning?.[id];
        return (
          <button
            key={id}
            className={`flow-chip ${on ? "on" : ""}`}
            onClick={() => onSelect(id)}
          >
            <span className="key">{i + 1}</span>
            <span className="lines">
              <span className="ttl">{f.title}</span>
              <span className="ep">{f.endpoint}</span>
            </span>
            {running ? (
              <span className="running">{Math.ceil(running)}s</span>
            ) : (
              <span
                className="play"
                role="button"
                aria-label={`Run scripted ${f.title} demo`}
                onClick={(e) => { e.stopPropagation(); onScripted(id); }}
              >
                <PlayGlyph size={9} color="currentColor" />
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
