import { useState, useCallback } from "react";
import { injectChaos as injectApi, clearChaos as clearApi } from "../api/commands";

const DEFAULT = {
  service: "inventory",
  mode: "errors",
  error_rate: 0.6,
  latency_ms: 1200,
  duration_s: 30,
};

export function useChaos(initialService = "inventory") {
  const [chaos, setChaos] = useState({ ...DEFAULT, service: initialService });
  const [activeChaos, setActiveChaos] = useState({});

  const inject = useCallback(async (next = chaos) => {
    try {
      await injectApi(next);
      setActiveChaos(a => ({
        ...a,
        [next.service]: {
          mode: next.mode,
          magnitude: next.mode === "latency" ? next.latency_ms : next.error_rate,
          startedAt: Date.now(),
          duration_s: next.duration_s,
        },
      }));
      // Auto-expire so the active list doesn't grow forever.
      setTimeout(() => {
        setActiveChaos(a => {
          const c = a[next.service];
          if (!c) return a;
          if (Date.now() - c.startedAt < c.duration_s * 1000 - 500) return a;
          const { [next.service]: _gone, ...rest } = a;
          return rest;
        });
      }, next.duration_s * 1000 + 1000);
    } catch (e) { console.warn("inject failed", e); }
  }, [chaos]);

  const clear = useCallback(async (service) => {
    try {
      await clearApi(service);
      setActiveChaos(a => {
        const { [service]: _gone, ...rest } = a;
        return rest;
      });
    } catch (e) { console.warn("clear failed", e); }
  }, []);

  const clearAll = useCallback(async () => {
    // Sweep every service that supports chaos, not just locally-tracked ones.
    // Chaos can be injected externally (curl, scripted demo, prior session)
    // and we want one button to make everything healthy again.
    const services = [
      "auth", "order", "inventory", "notification",
      "payments", "fraud", "shipping", "recommendation",
    ];
    await Promise.all(services.map(s => clearApi(s).catch(() => {})));
    setActiveChaos({});
  }, []);

  return {
    chaos,
    activeChaos,
    setMode:      (mode)       => setChaos(c => ({ ...c, mode })),
    setService:   (service)    => setChaos(c => ({ ...c, service })),
    setErrorRate: (error_rate) => setChaos(c => ({ ...c, error_rate })),
    setLatency:   (latency_ms) => setChaos(c => ({ ...c, latency_ms })),
    setDuration:  (duration_s) => setChaos(c => ({ ...c, duration_s })),
    inject, clear, clearAll,
  };
}
