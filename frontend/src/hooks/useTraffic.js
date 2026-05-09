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
    const interval = Math.max(50, Math.round(1000 / Math.max(1, traffic.rps)));
    timerRef.current = setInterval(async () => {
      try {
        const order = await placeOrder();
        setOrders(prev => [order, ...prev].slice(0, 24));
      } catch {
        setOrders(prev => [{
          ts: Date.now(), id: "#---", sku: "", who: "", status: "failed", latency_ms: 0,
        }, ...prev].slice(0, 24));
      }
    }, interval);
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
