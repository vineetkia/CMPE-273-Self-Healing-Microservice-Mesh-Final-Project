// All external endpoints are env-driven so the frontend bundle is the same
// artifact across local dev and AWS deployment. Vite bakes these in at build
// time; in dev they fall back to localhost.
export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "http://localhost:8080";
export const HEALER_URL  = import.meta.env.VITE_HEALER_URL  || "http://localhost:8090";
export const JAEGER_URL  = import.meta.env.VITE_JAEGER_URL  || "http://localhost:16686";
export const PROM_URL    = import.meta.env.VITE_PROM_URL    || "http://localhost:9090";

export async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
