import { useEffect, useRef, useState } from "react";
import { placeOrder } from "../api/commands";

export function useTraffic() {
  const [traffic, setTraffic] = useState({ running: false, rps: 4 });
  const [orders, setOrders] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!traffic.running) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    // Fractional accumulator: each tick adds `targetPerTick` (a float) to a
    // running budget, and we fire the integer portion. This lets a 100ms tick
    // deliver an *exact* slider rate — 21 rps → 2.1 per tick → fires 2, 2, 3,
    // 2, 2, 3 … averaging exactly 21/s. Without this, naive Math.round(rps/10)
    // quantises into 10-rps steps and the dashboard reads ≈20 for sliders 11-25.
    const TICK_MS = 100;
    const targetPerTick = (traffic.rps * TICK_MS) / 1000;
    let budget = 0;
    const fire = () => {
      placeOrder()
        .then(order => setOrders(prev => [order, ...prev].slice(0, 24)))
        .catch(() => setOrders(prev => [{
          ts: Date.now(), id: "#---", sku: "", who: "", status: "failed", latency_ms: 0,
        }, ...prev].slice(0, 24)));
    };
    timerRef.current = setInterval(() => {
      budget += targetPerTick;
      const toFire = Math.floor(budget);
      budget -= toFire;
      for (let i = 0; i < toFire; i++) fire();
    }, TICK_MS);
    return () => clearInterval(timerRef.current);
  }, [traffic.running, traffic.rps]);

  const burst = async () => {
    for (let i = 0; i < 20; i++) {
      placeOrder().then(o => setOrders(prev => [o, ...prev].slice(0, 24))).catch(() => {});
      await new Promise(r => setTimeout(r, 100));
    }
  };

  return {
    traffic,
    orders,
    setRunning: (running) => setTraffic(t => ({ ...t, running })),
    setRps: (rps) => setTraffic(t => ({ ...t, rps })),
    burst,
  };
}
