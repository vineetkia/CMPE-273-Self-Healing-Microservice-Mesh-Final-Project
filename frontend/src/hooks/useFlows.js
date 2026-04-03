import { useEffect, useState, useCallback } from "react";
import { fetchFlows, runScriptedDemo, scriptedDemoStatus } from "../api/flows";

const FALLBACK = {
  checkout: {
    id: "checkout", title: "Checkout", endpoint: "POST /checkout",
    summary: "End-to-end purchase: auth, inventory hold, fraud scoring, payment, shipping label, notification.",
    services: ["gateway", "order", "auth", "inventory", "fraud", "payments", "shipping", "notification"],
    edges: [["gateway","order"],["order","auth"],["order","inventory"],["order","fraud"],["order","payments"],["order","shipping"],["order","notification"]],
  },
  refund: {
    id: "refund", title: "Refund", endpoint: "POST /refund",
    summary: "Reverse charge, restock inventory, notify customer.",
    services: ["gateway", "order", "auth", "payments", "inventory", "notification"],
    edges: [["gateway","order"],["order","auth"],["order","payments"],["order","inventory"],["order","notification"]],
  },
  cart_merge: {
    id: "cart_merge", title: "Cart merge", endpoint: "POST /cart/merge",
    summary: "Combine guest cart with logged-in user, validate inventory.",
    services: ["gateway", "order", "auth", "inventory"],
    edges: [["gateway","order"],["order","auth"],["order","inventory"]],
  },
  restock: {
    id: "restock", title: "Restock", endpoint: "POST /inventory/restock",
    summary: "Admin replenishes a SKU; recommendation refreshes its candidate set.",
    services: ["gateway", "auth", "inventory", "recommendation"],
    edges: [["gateway","auth"],["gateway","inventory"],["gateway","recommendation"]],
  },
  fraud_review: {
    id: "fraud_review", title: "Fraud review", endpoint: "POST /fraud/review",
    summary: "Manual fraud verdict; adjust order status; notify.",
    services: ["gateway", "order", "auth", "fraud", "notification"],
    edges: [["gateway","order"],["order","auth"],["order","fraud"],["order","notification"]],
  },
  recommendations: {
    id: "recommendations", title: "Recommendations", endpoint: "GET /recommendations/{user}",
    summary: "Personalized SKUs; recommendation reads inventory for stock.",
    services: ["gateway", "auth", "order", "recommendation", "inventory"],
    edges: [["gateway","auth"],["gateway","order"],["gateway","recommendation"],["recommendation","inventory"]],
  },
};

export function useFlows(initial = "checkout") {
  const [flows, setFlows] = useState(FALLBACK);
  const [activeFlow, setActiveFlow] = useState(initial);
  const [scriptedRunning, setScriptedRunning] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const f = await fetchFlows();
        if (!alive) return;
        if (f && f.flows && Object.keys(f.flows).length) {
          // Backend doesn't include `id` per flow; inject it so consumers
          // can use flow.id as a stable identity (e.g. memo deps).
          const enriched = Object.fromEntries(
            Object.entries(f.flows).map(([k, v]) => [k, { id: k, ...v }])
          );
          setFlows(enriched);
        }
      } catch { /* keep fallback */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const s = await scriptedDemoStatus();
        if (!alive) return;
        setScriptedRunning(s.running || {});
      } catch { /* ignore */ }
    }
    tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const runScripted = useCallback(async (flowId) => {
    try {
      await runScriptedDemo(flowId);
    } catch (e) {
      console.warn("scripted demo failed", e);
    }
  }, []);

  return { flows, activeFlow, setActiveFlow, scriptedRunning, runScripted };
}
