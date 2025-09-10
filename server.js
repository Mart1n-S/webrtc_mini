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
  WB_APPLY: "wb-apply",          // opération à appliquer (add/update/remove/note/draw)
  WB_REQUEST: "wb-request",      // demander un snapshot
  WB_SNAPSHOT: "wb-snapshot",    // envoyer un snapshot complet
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

/**
 * Parse JSON en sécurité.
 * @param {string|Buffer} data
 * @returns {{ok: true, value: any} | {ok:false, error: Error}}
 */
function safeJsonParse(data) {
  try {
    const value = JSON.parse(data);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Envoie un message JSON à un client si la socket est ouverte.
 * @param {import('ws').WebSocket} ws
 * @param {object} message
 */
function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Diffuse un message à tous les clients de la room sauf l'émetteur.
 * @param {string} roomId
 * @param {object} message
 * @param {string} [excludeClientId]
 */
function broadcastToOthers(roomId, message, excludeClientId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const [cid, client] of room) {
    if (cid === excludeClientId) continue;
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(payload);
    }
  }
}

/**
 * Envoie un message à un client spécifique dans une room.
 * @param {string} roomId
 * @param {string} targetClientId
 * @param {object} message
 */
function sendTo(roomId, targetClientId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  const client = room.get(targetClientId);
  if (client && client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

/**
 * Retourne (et crée au besoin) la Map de clients d'une room.
 * @param {string} roomId
 * @returns {Map<string, {id: string, ws: import('ws').WebSocket, isAlive: boolean}>}
 */
function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId);
}

/**
 * Supprime la room si vide.
 * @param {string} roomId
 */
function deleteRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.size === 0) {
    rooms.delete(roomId);
  }
}

/**
 * Validation basique d’un message entrant (type + shape minimal).
 * @param {any} msg
 * @returns {{ok: true} | {ok:false, reason: string}}
 */
function validateIncoming(msg) {
  if (!msg || typeof msg !== "object") {
    return { ok: false, reason: "Invalid JSON payload" };
  }
  if (typeof msg.type !== "string") {
    return { ok: false, reason: "Missing message type" };
  }
  // Pour JOIN, roomId est requis
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
    // Génère un ID 6 chiffres (re-essaie si collision)
    let rid;
    do {
      rid = Math.random().toString().slice(2, 8);
    } while (await Room.exists({ roomId: rid }));

    await Room.create({ roomId: rid });

    // URL canonique pour l’hôte
    const url = `/room/${rid}?autojoin=1&host=1`;
    res.json({ roomId: rid, url });
  } catch (e) {
    console.error("Create room error", e);
    res.status(500).json({ error: "create_failed" });
  }
});

// Route HTML principale rendue via Twig
app.get("/", (req, res) => {
  res.render("landing", { title: "Cam’Memo" });
});

// Workspace (nouvelle route)
// On passe roomId au template pour auto-join côté client
app.get("/room/:roomId", async (req, res) => {
  const { roomId } = req.params;

  // Vérifie en base
  const exists = await Room.exists({ roomId, status: { $ne: "archived" } });
  if (!exists) {
    return res.redirect(`/?error=room_not_found`);
  }

  // OK → on rend la page workspace
  res.render("workspace", { title: "Whiteboard + Call", roomId });
});

// Statique (JS/CSS/images). Désactive l’index.html implicite pour laisser Twig gérer "/"
app.use(express.static("public", { index: false }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

/**
 * Gestion des connexions WebSocket
 */
wss.on("connection", (ws) => {
  /** ID unique du client */
  const clientId = nanoid(10);
  /** Room rejointe par ce client (null tant qu'il n'a pas JOIN) */
  let joinedRoomId = null;

  // Marqueur de liveness pour heartbeat
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  /**
   * Réception de messages depuis le client
   */
  ws.on("message", async (data) => {
    const parsed = safeJsonParse(data);
    if (!parsed.ok) {
      return send(ws, {
        type: MSG.ERROR,
        payload: { message: "Invalid JSON" },
      });
    }

    const msg = parsed.value;
    const validation = validateIncoming(msg);
    if (!validation.ok) {
      return send(ws, {
        type: MSG.ERROR,
        payload: { message: validation.reason },
      });
    }

    const { type, roomId, payload } = msg;

    // --- JOIN ---
    if (type === MSG.JOIN) {
      // Vérifie en base que la room existe (empêche la création sauvage via URL/WS)
      try {
        const exists = await Room.exists({
          roomId,
          status: { $ne: "archived" },
        });
        if (!exists) {
          return send(ws, {
            type: MSG.ERROR,
            payload: { message: "Room not available. Create it from landing." },
          });
        }
      } catch (e) {
        console.error("[WS JOIN] DB check error:", e);
        return send(ws, {
          type: MSG.ERROR,
          payload: { message: "Server error while checking room" },
        });
      }

      const room = ensureRoom(roomId);

      // Optionnel : limiter la taille d’une room
      if (MAX_ROOM_SIZE > 0 && room.size >= MAX_ROOM_SIZE) {
        return send(ws, {
          type: MSG.ERROR,
          payload: { message: "Room is full" },
        });
      }

      // Liste des pairs déjà présents (AVANT d'ajouter le nouveau)
      const peers = Array.from(room.keys());

      // Ajoute le client à la room
      room.set(clientId, { id: clientId, ws, isAlive: true });
      joinedRoomId = roomId;

      // Répond au nouvel arrivant avec la liste des pairs et la taille actuelle
      send(ws, {
        type: MSG.JOINED,
        payload: { clientId, roomSize: room.size, peers },
      });

      // Notifie les autres qu'un pair arrive
      broadcastToOthers(
        roomId,
        { type: MSG.PEER_JOINED, payload: { clientId } },
        clientId
      );
      return;
    }

    // Ignore tout message tant que pas JOIN
    if (!joinedRoomId) return;

    // --- Signalisation relai ---
if ([MSG.OFFER, MSG.ANSWER, MSG.ICE, MSG.MEDIA, MSG.WB_APPLY, MSG.WB_REQUEST, MSG.WB_SNAPSHOT].includes(type)) {      const targetId = payload?.to || null;
      const message = { type, payload: { ...payload, from: clientId } };

      if (targetId) {
        sendTo(joinedRoomId, targetId, message);
      } else {
        broadcastToOthers(joinedRoomId, message, clientId);
      }
      return;
    }

    // Types non supportés
    send(ws, {
      type: MSG.ERROR,
      payload: { message: `Unsupported type: ${type}` },
    });
  });

  /**
   * Fermeture de la connexion
   */
  ws.on("close", () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;

    // Retire le client
    room.delete(clientId);
    // Notifie les autres
    broadcastToOthers(
      joinedRoomId,
      { type: MSG.PEER_LEFT, payload: { clientId } },
      clientId
    );

    // Supprime room si vide
    deleteRoomIfEmpty(joinedRoomId);

    joinedRoomId = null;
  });

  /**
   * Gestion d'erreurs WS
   */
  ws.on("error", (err) => {
    // Log serveur ; côté client on n’envoie rien de plus ici
    console.error(`[WS error][${clientId}]`, err?.message || err);
  });
});

//////////////////////////////////
// Heartbeat (nettoyage sockets) //
//////////////////////////////////

// Ping périodique pour fermer les connexions mortes.
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      // pas de pong => on ferme
      return client.terminate();
    }
    client.isAlive = false;
    client.ping(); // le client doit répondre `pong` (géré plus haut)
  }
}, HEARTBEAT_INTERVAL);

// Nettoyage quand le serveur s’arrête
wss.on("close", () => clearInterval(heartbeat));

///////////////////////////////
// Lancement du serveur      //
///////////////////////////////

server.listen(PORT, () => {
  console.log(
    `✅ Server running on http://localhost:${PORT} (ws path: ${WS_PATH})`
  );
});

