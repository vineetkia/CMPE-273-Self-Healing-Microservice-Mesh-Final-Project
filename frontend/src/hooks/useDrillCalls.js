import { useMemo } from "react";

/* Derive a "recent calls" list per service from the agent's decisions feed.
   This is the only structured per-service signal the dashboard has access to
   without subscribing to the NATS event firehose directly. */
export function useDrillCalls(decisions) {
  return useMemo(() => {
    const out = {};
    for (const d of decisions || []) {
      if (!d.service) continue;
      out[d.service] = out[d.service] || [];
      out[d.service].push({
        ok: d.ok,
        method: d.action,
        latency_ms: 0,
        ts: d.ts,
      });
    }
    return out;
  }, [decisions]);
}
