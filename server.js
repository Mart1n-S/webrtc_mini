/**
 * WebRTC Signaling Server — Express + ws
 * --------------------------------------
 * - Sert le dossier /public (client statique)
 * - Assure la signalisation WebRTC via WebSocket : join, offer, answer, ice-candidate
 * - Gère des rooms simples (1:N toléré, mais pensé pour 1:1)
 * - Nettoie les connexions mortes (heartbeat)
 *
 * Démarrage : `npm start`
 */

///////////////////////////////
// Imports & Setup de base  //
///////////////////////////////

const express = require("express");
const { WebSocketServer } = require("ws");
const { nanoid } = require("nanoid");
const http = require("http");
const path = require("path");
const twig = require("twig");
const mongoose = require("mongoose");
const Room = require("./models/Room");

///////////////////////////////
// Constantes de configuration
///////////////////////////////

/** Port HTTP d'écoute (priorité à la variable d'env) */
const PORT = process.env.PORT || 3000;
/** Chemin WebSocket (évite les collisions avec d'autres WS) */
const WS_PATH = "/ws";
/** Chemin WebSocket spécifique Whiteboard */
const WS_WB_PATH = "/ws-wb";
/** Intervalle de heartbeat (ms) pour vérifier que les clients sont vivants */
const HEARTBEAT_INTERVAL = 30_000;
/** Taille max d'une room (0 = illimité). Pour 1:1 mets 2. */
const MAX_ROOM_SIZE = 0;

/**
 * URI MongoDB
 */
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/webrtcmini";

//////////////////////////////////////
// États & Structures de données   //
//////////////////////////////////////

/**
 * Rooms: Map<roomId, Map<clientId, Client>>
 * Un client = { id: string, ws: WebSocket, isAlive: boolean }
 */
const rooms = new Map();
/** Rooms Whiteboard (séparées des rooms A/V) */
const wbRooms = new Map();

/** Codes de type de messages échangés */
const MSG = {
  JOIN: "join",
  JOINED: "joined",
  PEER_JOINED: "peer-joined",
  PEER_LEFT: "peer-left",
  OFFER: "offer",
  ANSWER: "answer",
  ICE: "ice-candidate",
  ERROR: "error",
  MEDIA: "media-state",
  WB_APPLY: "wb-apply",
  WB_REQUEST: "wb-request",
  WB_SNAPSHOT: "wb-snapshot",
};

///////////////////////////////////
// Connexion à la base de données  //
///////////////////////////////////
mongoose
  .connect(MONGODB_URI, { dbName: "webrtcmini" })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

///////////////////////////////
// Helpers utilitaires       //
///////////////////////////////

function safeJsonParse(data) {
  try {
    return { ok: true, value: JSON.parse(data) };
  } catch (error) {
    return { ok: false, error };
  }
}
function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
function broadcastToOthers(roomId, message, excludeClientId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const [cid, client] of room) {
    if (cid === excludeClientId) continue;
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}
function sendTo(roomId, targetClientId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  const client = room.get(targetClientId);
  if (client && client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}
function ensureRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}
function deleteRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.size === 0) rooms.delete(roomId);
}

/** Helpers Whiteboard */
function wbBroadcastToOthers(roomId, message, excludeClientId) {
  const room = wbRooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const [cid, client] of room) {
    if (cid === excludeClientId) continue;
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}
function wbSendTo(roomId, targetClientId, message) {
  const room = wbRooms.get(roomId);
  if (!room) return;
  const client = room.get(targetClientId);
  if (client && client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}
function wbEnsureRoom(roomId) {
  if (!wbRooms.has(roomId)) wbRooms.set(roomId, new Map());
  return wbRooms.get(roomId);
}
function wbDeleteRoomIfEmpty(roomId) {
  const room = wbRooms.get(roomId);
  if (room && room.size === 0) wbRooms.delete(roomId);
}

function validateIncoming(msg) {
  if (!msg || typeof msg !== "object")
    return { ok: false, reason: "Invalid JSON payload" };
  if (typeof msg.type !== "string")
    return { ok: false, reason: "Missing message type" };
  if (
    msg.type === MSG.JOIN &&
    (!msg.roomId || typeof msg.roomId !== "string")
  ) {
    return { ok: false, reason: "Missing roomId" };
  }
  return { ok: true };
}

///////////////////////////////
// Serveur HTTP + WebSocket  //
///////////////////////////////

const app = express();
// Vue engine Twig
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "twig");
app.engine("twig", twig.__express);

// API: création d'une room via la landing
app.post("/api/rooms/new", async (req, res) => {
  try {
    let rid;
    do {
      rid = Math.random().toString().slice(2, 8);
    } while (await Room.exists({ roomId: rid }));
    await Room.create({ roomId: rid });
    const url = `/room/${rid}?autojoin=1&host=1`;
    res.json({ roomId: rid, url });
  } catch (e) {
    console.error("Create room error", e);
    res.status(500).json({ error: "create_failed" });
  }
});

app.get("/", (req, res) => {
  res.render("landing", { title: "Cam’Memo" });
});

app.get("/room/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const exists = await Room.exists({ roomId, status: { $ne: "archived" } });
  if (!exists) return res.redirect(`/?error=room_not_found`);
  res.render("workspace", { title: "Whiteboard + Call", roomId });
});

// Statique (JS/CSS/images)
app.use(express.static("public", { index: false }));

const server = http.createServer(app);

/**
 * === WebSocket SERVERS en mode noServer + upgrade manuel ===
 * (évite les conflits et les “Invalid frame header”)
 */
const wssAV = new WebSocketServer({ noServer: true }); // /ws
const wssWB = new WebSocketServer({ noServer: true }); // /ws-wb

server.on("upgrade", (req, socket, head) => {
  try {
    const { headers, url } = req;
    const host = headers.host || "localhost";
    const pathname = new URL(url, `http://${host}`).pathname;

    if (pathname === WS_PATH) {
      wssAV.handleUpgrade(req, socket, head, (ws) => {
        wssAV.emit("connection", ws, req);
      });
    } else if (pathname === WS_WB_PATH) {
      wssWB.handleUpgrade(req, socket, head, (ws) => {
        wssWB.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch {
    socket.destroy();
  }
});

/**
 * Gestion des connexions WebSocket (A/V)
 */
wssAV.on("connection", (ws) => {
  const clientId = nanoid(10);
  let joinedRoomId = null;

  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok)
      return send(ws, {
        type: MSG.ERROR,
        payload: { message: "Invalid JSON" },
      });

    const msg = parsed.value;
    const validation = validateIncoming(msg);
    if (!validation.ok)
      return send(ws, {
        type: MSG.ERROR,
        payload: { message: validation.reason },
      });

    const { type, roomId, payload } = msg;

    if (type === MSG.JOIN) {
      try {
        const exists = await Room.exists({
          roomId,
          status: { $ne: "archived" },
        });
        if (!exists)
          return send(ws, {
            type: MSG.ERROR,
            payload: { message: "Room not available. Create it from landing." },
          });
      } catch (e) {
        console.error("[WS JOIN] DB check error:", e);
        return send(ws, {
          type: MSG.ERROR,
          payload: { message: "Server error while checking room" },
        });
      }

      const room = ensureRoom(roomId);
      if (MAX_ROOM_SIZE > 0 && room.size >= MAX_ROOM_SIZE) {
        return send(ws, {
          type: MSG.ERROR,
          payload: { message: "Room is full" },
        });
      }

      const peers = Array.from(room.keys());
      room.set(clientId, { id: clientId, ws, isAlive: true });
      joinedRoomId = roomId;

      send(ws, {
        type: MSG.JOINED,
        payload: { clientId, roomSize: room.size, peers },
      });
      broadcastToOthers(
        roomId,
        { type: MSG.PEER_JOINED, payload: { clientId } },
        clientId
      );
      return;
    }

    if (!joinedRoomId) return;

    if ([MSG.OFFER, MSG.ANSWER, MSG.ICE, MSG.MEDIA].includes(type)) {
      const targetId = payload?.to || null;
      const message = { type, payload: { ...payload, from: clientId } };
      return targetId
        ? sendTo(joinedRoomId, targetId, message)
        : broadcastToOthers(joinedRoomId, message, clientId);
    }

    send(ws, {
      type: MSG.ERROR,
      payload: { message: `Unsupported type on ${WS_PATH}: ${type}` },
    });
  });

  ws.on("close", () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (room) {
      room.delete(clientId);
      broadcastToOthers(
        joinedRoomId,
        { type: MSG.PEER_LEFT, payload: { clientId } },
        clientId
      );
      deleteRoomIfEmpty(joinedRoomId);
    }
    joinedRoomId = null;
  });

  ws.on("error", (err) => {
    console.error(`[WS A/V error][${clientId}]`, err?.message || err);
  });
});

/**
 * Gestion des connexions WebSocket (Whiteboard)
 */
wssWB.on("connection", (ws) => {
  const clientId = nanoid(10);
  let joinedRoomId = null;

  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok)
      return send(ws, {
        type: MSG.ERROR,
        payload: { message: "Invalid JSON" },
      });

    const msg = parsed.value;
    const { type, roomId, payload } = msg;

    if (type === MSG.JOIN) {
      try {
        const exists = await Room.exists({
          roomId,
          status: { $ne: "archived" },
        });
        if (!exists)
          return send(ws, {
            type: MSG.ERROR,
            payload: { message: "Room not available. Create it from landing." },
          });
      } catch (e) {
        console.error("[WS-WB JOIN] DB check error:", e);
        return send(ws, {
          type: MSG.ERROR,
          payload: { message: "Server error while checking room" },
        });
      }

      const room = wbEnsureRoom(roomId);
      const peers = Array.from(room.keys());
      room.set(clientId, { id: clientId, ws, isAlive: true });
      joinedRoomId = roomId;

      send(ws, {
        type: MSG.JOINED,
        payload: { clientId, roomSize: room.size, peers },
      });
      return;
    }

    if (!joinedRoomId) return;

    if ([MSG.WB_APPLY, MSG.WB_REQUEST, MSG.WB_SNAPSHOT].includes(type)) {
      const targetId = payload?.to || null;
      const message = { type, payload: { ...payload, from: clientId } };
      return targetId
        ? wbSendTo(joinedRoomId, targetId, message)
        : wbBroadcastToOthers(joinedRoomId, message, clientId);
    }

    send(ws, {
      type: MSG.ERROR,
      payload: { message: `Unsupported type on ${WS_WB_PATH}: ${type}` },
    });
  });

  ws.on("close", () => {
    if (!joinedRoomId) return;
    const room = wbRooms.get(joinedRoomId);
    if (room) {
      room.delete(clientId);
      wbDeleteRoomIfEmpty(joinedRoomId);
    }
    joinedRoomId = null;
  });

  ws.on("error", (err) => {
    console.error(`[WS WB error][${clientId}]`, err?.message || err);
  });
});

//////////////////////////////////
// Heartbeat (nettoyage sockets) //
//////////////////////////////////

const heartbeatAV = setInterval(() => {
  for (const client of wssAV.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL);

const heartbeatWB = setInterval(() => {
  for (const client of wssWB.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL);

wssAV.on("close", () => clearInterval(heartbeatAV));
wssWB.on("close", () => clearInterval(heartbeatWB));

///////////////////////////////
// Lancement du serveur      //
///////////////////////////////

server.listen(PORT, () => {
  console.log(
    `✅ Server running on http://localhost:${PORT} (ws A/V: ${WS_PATH}, ws WB: ${WS_WB_PATH})`
  );
});
