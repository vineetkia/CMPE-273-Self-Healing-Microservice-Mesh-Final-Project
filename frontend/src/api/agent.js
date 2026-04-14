import { HEALER_URL, jget } from "./config";

const VERB_MAP = {
  clear_failure:    "Cleared failure on",
  enable_fallback:  "Enabled fallback at",
  disable_fallback: "Disabled fallback at",
  mark_degraded:    "Marked degraded:",
};

/* The healer emits a single `reasoning` string per incident, prefixed with
   either `[llm]` or `[rules]`. We render that into the IncidentCard's
   "Observed → Because → Therefore" chain heuristically: if the text contains
   markers (`Observed:`, `Because:`, `Therefore:`) we honor them; otherwise
   we render the whole paragraph as a single Observed step and synthesize the
   Therefore from the agent's chosen actions. */
function parseReasoning(raw, rootCause, suspects) {
  if (!raw) return [];
  let body = String(raw).replace(/^\[(llm|rules)\]\s*/, "");

  const wrapCode = (s) =>
    s.replace(/\b(gateway|order|auth|inventory|notification|payments|fraud|shipping|recommendation)\b/g, "<code>$1</code>")
     .replace(/(\d+(?:\.\d+)?\s*(?:%|ms))/g, '<span class="num">$1</span>');

  // Try labelled split first.
  const labelled = body.match(/(observed|because|therefore)\s*:\s*([\s\S]*?)(?=(observed|because|therefore)\s*:|$)/gi);
  if (labelled && labelled.length) {
    return labelled.map(seg => {
      const m = seg.match(/^(observed|because|therefore)\s*:\s*([\s\S]*)/i);
      const conn = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      return {
        conn,
        body: wrapCode(m[2].trim()),
        therefore: conn.toLowerCase() === "therefore",
      };
    });
  }

  // Otherwise: 1 Observed + (optional Because for suspects) + Therefore.
  const steps = [{ conn: "Observed", body: wrapCode(body) }];
  if (suspects && suspects.length > 1) {
    steps.push({
      conn: "Because",
      body: wrapCode(
        `Suspect set is ${suspects.map(s => `\`${s}\``).join(", ")}. Walk the dependency graph to find the deepest failing service.`
          .replace(/`([^`]+)`/g, "<code>$1</code>")
      ),
    });
  }
  if (rootCause) {
    steps.push({
      conn: "Therefore",
      body: wrapCode(`<code>${rootCause}</code> is the root cause. Applying remediation actions.`),
      therefore: true,
    });
  }
  return steps;
}

/* Map a healer incident object into the shape IncidentCard expects. */
function shapeIncident(raw) {
  if (!raw) return null;
  const source = raw.reasoning?.startsWith("[rules]") ? "rules" : "llm";
  const idStr = `INC-${String(raw.ts_ms).slice(-6)}`;
  return {
    id: idStr,
    source,
    severity: raw.severity || "S2",
    startedAt: raw.ts_ms,
    rootCause: raw.root_cause,
    suspects: raw.suspects || [],
    summary:
      (raw.llm_reasoning || raw.reasoning || "")
        .replace(/^\[(llm|rules)\]\s*/, "")
        .slice(0, 280),
    rca: parseReasoning(raw.reasoning, raw.root_cause, raw.suspects || []),
    actions: raw.actions || [],
    llm: raw.llm_telemetry || null, // backend may not populate this — kept optional
    closedAt: raw.closedAt || null,
  };
}

function shapeDecision(d, idx) {
  return {
    id: `d-${d.ts_ms}-${idx}`,
    ts: d.ts_ms,
    source: d.source || "rules",
    service: d.service,
    action: d.action,
    ok: d.ok !== false,
    message: d.message || "",
  };
}

function shapeAction(d, idx) {
  return {
    ts: d.ts_ms,
    verb: VERB_MAP[d.action] || `Action ${d.action}`,
    target: d.service,
    tag: d.source === "rules" ? "remediate" : "rca",
    id: `a-${d.ts_ms}-${idx}`,
  };
}

export async function fetchAgent() {
  const raw = await jget(`${HEALER_URL}/state`);

  const services = {};
  for (const [id, m] of Object.entries(raw.services || {})) {
    // The healer reports `n` as the count of RPC events seen in its 20s
    // sliding window. Divide by 20 for true per-second rate.
    const n = m.n || 0;
    services[id] = {
      p95: m.p95_latency_ms || 0,
      err: m.error_rate || 0,
      // Sub-rps precision: 194 events / 20s = 9.7 (not 10). The UI rounds
      // for compact display but the underlying number stays accurate so the
      // global throughput in TopBar reflects what the user actually set.
      rps: n / 20,
      n,
      circuit_opens: m.circuit_opens_in_window || 0,
      status: m.health || "unknown",
    };
  }

  const allIncidents = (raw.incidents || []).map(shapeIncident).filter(Boolean);
  const lastIncidentAt = allIncidents.length ? allIncidents[allIncidents.length - 1].startedAt : null;

  // "Active" = most recent incident, within 25s, and a suspect is still bad.
  let active = null;
  if (allIncidents.length) {
    const latest = allIncidents[allIncidents.length - 1];
    const ageMs = Date.now() - latest.startedAt;
    const stillBad = (latest.suspects || []).some(s => {
      const st = services[s];
      if (!st) return false;
      return st.status === "degraded" || st.status === "unreachable" || st.err >= 0.10;
    });
    if (ageMs < 25_000 && stillBad) active = latest;
  }

  // Closed incidents (everything except the active, newest first).
  const closed = allIncidents
    .filter(i => !active || i.id !== active.id)
    .reverse();

  const decisions = (raw.decisions || []).slice().reverse().map(shapeDecision);
  const actions = (raw.decisions || []).map(shapeAction);

  return {
    services, incident: active, incidents: closed,
    decisions, actions, lastIncidentAt,
  };
}
