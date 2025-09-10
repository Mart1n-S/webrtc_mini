import { WS_PATH_WB } from "./constants.js";

export const SYNC = {
  APPLY: "wb-apply",
  REQUEST: "wb-request",
  SNAPSHOT: "wb-snapshot",
};

export function createSync(roomId, { onApply, onSnapshot, onJoined } = {}) {
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${
      location.host
    }${WS_PATH_WB}`
  );

  const queue = [];
  let ready = false;
  let myId = null;

  ws.addEventListener("open", () => {
    console.log("[SYNC] open, joining room:", roomId);
    send({ type: "join", roomId });
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === "joined") {
      myId = msg?.payload?.clientId || null;
      ready = true;
      console.log(
        "[SYNC] joined as",
        myId,
        "peers=",
        Array.isArray(msg?.payload?.peers) ? msg.payload.peers.length : 0
      );
      flush();
      onJoined?.(myId, msg?.payload?.peers || []);
      // Demande un snapshot aux pairs existants
      send({ type: SYNC.REQUEST, payload: { from: myId } });
      return;
    }

    if (msg.type === SYNC.APPLY) {
      if (msg?.payload?.from === myId) return; // ignore nos propres ops
      console.log("[SYNC] apply received:", msg.payload);
      onApply?.(msg.payload);
      return;
    }

    if (msg.type === SYNC.SNAPSHOT) {
      if (msg?.payload?.from === myId) return;
      onSnapshot?.(msg.payload?.state || []);
      return;
    }

    if (msg.type === SYNC.REQUEST) {
      // Un pair demande un snapshot → laisse l'app décider qui répond
      onSnapshot?.("__REQUEST__", msg?.payload);
      return;
    }

    if (msg.type === "error") {
      console.warn("[SYNC] server error:", msg?.payload?.message || msg);
      return;
    }
  });

  ws.addEventListener("close", () => {
    console.log("[SYNC] socket closed");
  });

  ws.addEventListener("error", (e) => {
    console.warn("[SYNC] socket error:", e?.message || e);
  });

  function send(obj) {
    const payload = JSON.stringify(obj);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload); // important: on n'attend plus "ready" pour envoyer JOIN
    } else {
      queue.push(payload);
    }
  }

  function flush() {
    while (queue.length && ws.readyState === WebSocket.OPEN && ready) {
      ws.send(queue.shift());
    }
  }

  return {
    id: () => myId,
    apply(op, data) {
      console.log("[SYNC] apply send:", op, data);
      send({ type: SYNC.APPLY, payload: { op, data, from: myId } });
    },
    requestSnapshot() {
      send({ type: SYNC.REQUEST, payload: { from: myId } });
    },
    sendSnapshot(state) {
      send({ type: SYNC.SNAPSHOT, payload: { state, from: myId } });
    },
  };
}
