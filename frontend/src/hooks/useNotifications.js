import { useState, useEffect, useCallback, useRef } from "react";
import * as N from "../api/notifications";

/* useNotifications — polls the user's notification list every 4s when
   authed; exposes mark-read / mark-all-read actions. Returns { items,
   unread, refresh, markRead, markAllRead }. */
export function useNotifications(token) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!token) { setItems([]); setUnread(0); return; }
    try {
      const r = await N.listNotifications(token);
      if (!aliveRef.current) return;
      setItems(r.items || []);
      setUnread(r.unread || 0);
    } catch { /* keep existing state */ }
  }, [token]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    if (!token) return;
    const id = setInterval(refresh, 4000);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [token, refresh]);

  const markRead = useCallback(async (notification_id) => {
    if (!token) return;
    try {
      const r = await N.markNotificationRead(token, notification_id);
      if (r && typeof r.unread === "number") setUnread(r.unread);
      setItems(prev => prev.map(n => n.id === notification_id ? { ...n, read: true } : n));
    } catch { /* ignore */ }
  }, [token]);

  const markAllRead = useCallback(async () => {
    if (!token) return;
    try {
      await N.markAllNotificationsRead(token);
      setUnread(0);
      setItems(prev => prev.map(n => ({ ...n, read: true })));
    } catch { /* ignore */ }
  }, [token]);

  return { items, unread, refresh, markRead, markAllRead };
}
