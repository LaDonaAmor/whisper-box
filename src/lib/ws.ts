// WebSocket client with auto-reconnect and message dispatch.

import { WS_BASE, getAccessTokenForWs } from "./api";
import type { MessageResponse } from "./types";

type Handler = (msg: MessageResponse) => void;
type StatusHandler = (status: "connecting" | "open" | "closed") => void;

let ws: WebSocket | null = null;
const handlers = new Set<Handler>();
const statusHandlers = new Set<StatusHandler>();
let backoff = 1000;
let stopped = false;
let pingTimer: number | null = null;

function notifyStatus(s: "connecting" | "open" | "closed") {
  statusHandlers.forEach((h) => h(s));
}

async function open() {
  if (stopped) return;
  notifyStatus("connecting");
  const tok = await getAccessTokenForWs();
  if (!tok) {
    notifyStatus("closed");
    return;
  }
  const url = `${WS_BASE}/ws?token=${encodeURIComponent(tok)}`;
  const sock = new WebSocket(url);
  ws = sock;

  sock.onopen = () => {
    backoff = 1000;
    notifyStatus("open");
    if (pingTimer) window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => {
      try {
        sock.send(JSON.stringify({ event: "ping" }));
      } catch {
        /* ignore */
      }
    }, 25_000);
  };

  sock.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      // Server sends events with `event` field, fields flat at top-level
      if (data.event === "message.receive") {
        const msg: MessageResponse = {
          id: data.id,
          from_user_id: data.from_user_id,
          to_user_id: data.to_user_id,
          payload: data.payload,
          delivered: true,
          created_at: data.created_at,
        };
        handlers.forEach((h) => h(msg));
      }
    } catch {
      /* ignore non-JSON frames */
    }
  };

  sock.onclose = (ev) => {
    if (pingTimer) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    notifyStatus("closed");
    if (stopped) return;
    // 4003 = invalid token, don't retry
    if (ev.code === 4003) return;
    window.setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 15_000);
  };

  sock.onerror = () => {
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  };
}

export function startWs() {
  stopped = false;
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  )
    return;
  open();
}

export function stopWs() {
  stopped = true;
  if (pingTimer) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  notifyStatus("closed");
}

export function sendWs(payload: unknown): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

export function onMessage(h: Handler) {
  handlers.add(h);
  return () => {
    handlers.delete(h);
  };
}
export function onStatus(h: StatusHandler) {
  statusHandlers.add(h);
  return () => {
    statusHandlers.delete(h);
  };
}
