import { WS_PATH } from './constants.js';

export const SYNC = {
  APPLY: 'wb-apply',
  REQUEST: 'wb-request',
  SNAPSHOT: 'wb-snapshot',
};

export function createSync(roomId, { onApply, onSnapshot, onJoined } = {}) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`);

  const queue = [];
  let ready = false;
  let myId = null;

  ws.addEventListener('open', () => {
    send({ type: 'join', roomId });
  });

  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'joined') {
      myId = msg?.payload?.clientId;
      ready = true;
      flush();
      onJoined?.(myId, msg?.payload?.peers || []);
      // demande un snapshot aux pairs existants
      send({ type: SYNC.REQUEST, payload: { from: myId } });
      return;
    }

    if (msg.type === SYNC.APPLY) {
      if (msg?.payload?.from === myId) return; // on ignore nos propres ops
      onApply?.(msg.payload);
      return;
    }

    if (msg.type === SYNC.SNAPSHOT) {
      if (msg?.payload?.from === myId) return;
      onSnapshot?.(msg.payload?.state || []);
      return;
    }

    if (msg.type === SYNC.REQUEST) {
      // another peer requests snapshot -> laisse l'app décider qui répond
      onSnapshot?.('__REQUEST__', msg?.payload);
      return;
    }
  });

  function send(obj) {
    const payload = JSON.stringify(obj);
    if (ws.readyState === WebSocket.OPEN && ready) ws.send(payload);
    else queue.push(payload);
  }
  function flush() {
    while (queue.length && ws.readyState === WebSocket.OPEN && ready) ws.send(queue.shift());
  }

  // helpers publics
  return {
    id: () => myId,
    apply(op, data) {
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
