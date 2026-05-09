/* NotificationBell — icon button with unread count badge + click-out
   dropdown listing the latest notifications. Polls via useNotifications
   hook supplied by the parent. */

import React, { useState, useRef, useEffect } from "react";
import { Tooltip, relTime } from "./Primitives";

function KindIcon({ kind }) {
  const color =
    kind === "incident" ? "var(--crit)" :
    kind === "warning"  ? "var(--warn)" :
                          "var(--signal)";
  return <span className="notif-dot" style={{ background: color }} />;
}

export function NotificationBell({ unread, items, onMarkRead, onMarkAllRead }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const visible = items.slice(0, 12);

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <Tooltip
        label={unread > 0 ? `${unread} unread` : "Notifications"}
        hint="Order updates and agent incident notifications. Click to expand."
        side="bottom"
      >
        <button className="icon-btn notif-btn" onClick={() => setOpen(o => !o)} aria-label="Notifications">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 6 a4 4 0 0 1 8 0 v3 l1 2 H2 l1 -2 z" stroke="currentColor" strokeWidth="1.1" />
            <path d="M5.5 11.5 a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          {unread > 0 ? <span className="notif-badge">{unread > 9 ? "9+" : unread}</span> : null}
        </button>
      </Tooltip>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <span className="label">Notifications</span>
            {unread > 0 && (
              <button className="btn sm" onClick={onMarkAllRead}>Mark all read</button>
            )}
          </div>
          <div className="notif-body">
            {visible.length === 0 ? (
              <div className="notif-empty">No notifications yet.</div>
            ) : visible.map(n => (
              <div
                key={n.id}
                className={`notif-row ${n.read ? "read" : "unread"} ${n.kind}`}
                onClick={() => { if (!n.read) onMarkRead(n.id); }}
              >
                <KindIcon kind={n.kind} />
                <div className="notif-content">
                  <div className="notif-msg">{n.message}</div>
                  <div className="notif-meta">
                    {n.user === "ops" ? <span className="notif-tag">ops</span> : null}
                    <span className="notif-when">{relTime(n.ts_ms)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
