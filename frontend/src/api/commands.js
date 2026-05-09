import { GATEWAY_URL, jpost } from "./config";

let cachedToken = null;

export async function login() {
  if (cachedToken) return cachedToken;
  const r = await jpost(`${GATEWAY_URL}/login`, { user: "demo", password: "x" });
  cachedToken = r.token;
  return cachedToken;
}

const SKUS = ["sku-1", "sku-2", "sku-3"];
const NAMES = ["a.kim", "j.patel", "r.osei", "m.cole", "y.nakamura", "s.diaz", "t.ng", "h.park"];

/* Place a single order and return a shape the recent-orders log expects. */
export async function placeOrder() {
  const token = await login();
  const sku = SKUS[Math.floor(Math.random() * SKUS.length)];
  const who = NAMES[Math.floor(Math.random() * NAMES.length)];
  const t0 = performance.now();
  const r = await fetch(`${GATEWAY_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, sku, qty: 1 }),
  });
  let data;
  try { data = await r.json(); } catch { data = { ok: false, order_id: "", message: "parse error" }; }
  const latency_ms = Math.round(performance.now() - t0);
  return {
    ts: Date.now(),
    // `id` is the canonical backend order_id (e.g. "ord-a99e6ff9"). The
    // recent-orders log displays a short version via the component; the
    // FlowExerciser "use last" button needs the canonical id to refund/review.
    id: data.order_id || "",
    sku,
    who,
    status: data.ok ? "ok" : "failed",
    latency_ms,
  };
}

export async function injectChaos({ service, mode, error_rate, latency_ms, magnitude, duration_s = 60 }) {
  // The chaos panel sends an explicit shape; fall back to magnitude for
  // legacy callers (none of ours, but cheap).
  const er = error_rate != null ? error_rate
    : (mode === "errors" || mode === "grey") && magnitude != null
      ? Math.min(1, magnitude / 100)
      : 0;
  const lat = latency_ms != null ? latency_ms
    : (mode === "latency" || mode === "grey") && magnitude != null
      ? magnitude
      : 0;
  return jpost(`${GATEWAY_URL}/chaos/inject`, {
    service, mode, error_rate: er, latency_ms: lat, duration_s,
  });
}

export async function clearChaos(service) {
  const r = await fetch(`${GATEWAY_URL}/chaos/clear?service=${encodeURIComponent(service)}`, {
    method: "POST",
  });
  return r.json();
}

/* Manual flow exerciser — drives one of the 6 e-commerce endpoints. */
export async function exerciseFlow(flowId, body) {
  const token = await login();
  const enriched = { ...body, token };
  const t0 = performance.now();
  let res;
  try {
    if (flowId === "checkout") {
      res = await jpost(`${GATEWAY_URL}/checkout`, enriched);
    } else if (flowId === "refund") {
      res = await jpost(`${GATEWAY_URL}/refund`, enriched);
    } else if (flowId === "cart_merge") {
      res = await jpost(`${GATEWAY_URL}/cart/merge`, enriched);
    } else if (flowId === "restock") {
      res = await jpost(`${GATEWAY_URL}/inventory/restock`, enriched);
    } else if (flowId === "fraud_review") {
      res = await jpost(`${GATEWAY_URL}/fraud/review`, enriched);
    } else if (flowId === "recommendations") {
      const u = body.user || "demo";
      const r = await fetch(`${GATEWAY_URL}/recommendations/${encodeURIComponent(u)}?limit=${body.limit || 5}`);
      res = await r.json();
    }
  } catch (e) {
    res = { ok: false, error: String(e) };
  }
  const latency_ms = Math.round(performance.now() - t0);
  return { ok: !!res?.ok, body: { ...res, _latency_ms: latency_ms } };
}
