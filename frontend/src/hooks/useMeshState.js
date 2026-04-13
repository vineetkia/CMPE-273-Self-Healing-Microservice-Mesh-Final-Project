import { useEffect, useRef, useState } from "react";
import { fetchHealth } from "../api/health";
import { fetchAgent } from "../api/agent";

const SERVICE_DEFS = [
  { id: "gateway",        label: "gateway",        kind: "edge", port: 8080  },
  { id: "order",          label: "order",          kind: "core", port: 50052 },
  { id: "auth",           label: "auth",           kind: "core", port: 50051 },
  { id: "inventory",      label: "inventory",      kind: "core", port: 50053 },
  { id: "notification",   label: "notification",   kind: "core", port: 50054 },
  { id: "payments",       label: "payments",       kind: "core", port: 50055 },
  { id: "fraud",          label: "fraud",          kind: "core", port: 50056 },
  { id: "shipping",       label: "shipping",       kind: "core", port: 50057 },
  { id: "recommendation", label: "recommendation", kind: "core", port: 50058 },
];
const SERVICE_IDS = SERVICE_DEFS.map(s => s.id);

function emptySparks() {
  return Object.fromEntries(SERVICE_IDS.map(id => [id, Array(60).fill(0)]));
}
function emptyHealth() {
  return Object.fromEntries(SERVICE_IDS.map(id => [
    id, { p95: 0, err: 0, rps: 0, status: "unknown", n: 0, circuit_opens: 0, addr: "" },
  ]));
}

/* Polls /services/health (gateway) and /state (healer) every `interval` ms.
   Returns the unified shape the dashboard consumes. */
export function useMeshState(interval = 1500) {
  const [health, setHealth] = useState(emptyHealth());
  const [sparks, setSparks] = useState(emptySparks());
  const [pulse, setPulse] = useState(Array(60).fill(0));
  const [rps, setRps] = useState(0);
  const [incident, setIncident] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [actions, setActions] = useState([]);
  const [lastIncidentAt, setLastIncidentAt] = useState(null);
  const [lastTickAt, setLastTickAt] = useState(null);
  const sparksRef = useRef(emptySparks());
  const pulseRef = useRef(Array(60).fill(0));
  const bootedAtRef = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [hs, ag] = await Promise.all([
          fetchHealth().catch(() => ({})),
          fetchAgent().catch(() => ({
            services: {}, incident: null, incidents: [], decisions: [], actions: [], lastIncidentAt: null,
          })),
        ]);
        if (!alive) return;

        const merged = emptyHealth();
        for (const id of SERVICE_IDS) {
          const gw = hs[id];
          const am = ag.services[id];
          merged[id] = {
            p95: am?.p95 ?? 0,
            err: am?.err ?? 0,
            rps: am?.rps ?? 0,
            n: am?.n ?? 0,
            circuit_opens: am?.circuit_opens ?? 0,
            status: gw?.status || am?.status || "unknown",
            addr: gw?.addr || "",
          };
        }
        setHealth(merged);

        const nextSparks = { ...sparksRef.current };
        for (const id of SERVICE_IDS) {
          nextSparks[id] = [...(nextSparks[id] || Array(60).fill(0)).slice(1), merged[id].p95];
        }
        sparksRef.current = nextSparks;
        setSparks(nextSparks);

        // Global rps = end-user request rate (one number per user request).
        // We can't read this from `gateway` directly — gateway is FastAPI and
        // doesn't publish to mesh.events, only to OTel. So we pick the busiest
        // *entry-tier* service: auth.Validate fires once per authenticated
        // request, before order's circuit-breaker can short-circuit anything,
        // so it's a reliable lower bound on user-facing throughput. We take
        // the max with order.rps as a fallback for flows that bypass auth.
        const entryRps = Math.max(
          merged.auth?.rps || 0,
          merged.order?.rps || 0,
        );
        const globalRps = Math.round(entryRps);
        const nextPulse = [...pulseRef.current.slice(1), globalRps];
        pulseRef.current = nextPulse;
        setPulse(nextPulse);
        setRps(globalRps);

        setIncident(ag.incident || null);
        setIncidents(ag.incidents || []);
        setDecisions(ag.decisions || []);
        setActions(ag.actions || []);
        setLastIncidentAt(ag.lastIncidentAt || null);
        setLastTickAt(Date.now());
      } catch {
        /* swallow */
      }
    }
    tick();
    const id = setInterval(tick, interval);
    return () => { alive = false; clearInterval(id); };
  }, [interval]);

  return {
    services: SERVICE_DEFS,
    health, sparks, pulse, rps,
    incident, incidents, decisions, actions,
    lastIncidentAt, lastTickAt,
    bootedAt: bootedAtRef.current,
  };
}
