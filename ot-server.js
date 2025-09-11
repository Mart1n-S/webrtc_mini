// ot-server.js — serveur ShareDB séparé (port 3001)
const http = require("http");
const { WebSocketServer } = require("ws");
const ShareDB = require("sharedb");
const ShareDBMongo = require("sharedb-mongo");
const richText = require("rich-text");
const WebSocketJSONStream = require("websocket-json-stream");
const json0 = require("ot-json0");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/webrtcmini";
const OT_PORT = process.env.OT_PORT || 3001;
console.log("[OT]  MONGODB_URI =", MONGODB_URI);

// Enregistre le type OT "rich-text"
ShareDB.types.register(richText.type);

// Enregistre le type OT "json0"
ShareDB.types.register(json0.type);

// Backend ShareDB (même Mongo que ton app principale)
const backend = new ShareDB({
  db: ShareDBMongo(MONGODB_URI, { db: { name: "webrtcmini" } }),
  presence: true,
});

// Petit serveur HTTP + WebSocket
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws, request) => {
  try {
    const u = new URL(request.url, `http://${request.headers.host}`);
    const cid = u.searchParams.get("cid") || "-";
    console.log("WS (OT) connected, cid=", cid);
  } catch {}
  const stream = new WebSocketJSONStream(ws);
  backend.listen(stream);
});

server.listen(OT_PORT, () => {
  console.log(`✅ ShareDB OT server on ws://localhost:${OT_PORT}`);
});
