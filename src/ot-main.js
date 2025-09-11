// src/ot-main.js
import Quill from "quill";
import "quill/dist/quill.snow.css";
import QuillCursors from "quill-cursors";
import ShareDB from "sharedb/lib/client";
import richText from "rich-text";

// Enregistre le type OT "rich-text" côté client
ShareDB.types.register(richText.type);
Quill.register("modules/cursors", QuillCursors);

// ----- Utils (couleurs / labels stables) -----
function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}deg 80% 60%)`;
}

// ne JAMAIS retourner map["local"] pour un remote inconnu
function nameFor(id) {
  const map = window.PEER_NAMES || {};
  return map[id] || `User ${String(id).slice(0, 4)}`;
}

if (!window.__OT_V2_INIT__) {
  window.__OT_V2_INIT__ = true;

  const roomId = window.ROOM_ID;
  if (!roomId) {
    console.warn("[OT] Pas de ROOM_ID");
  } else {
    const start = (ev) => {
      const wrtcId =
        (ev && ev.detail && ev.detail.clientId) || window.WRTC_CLIENT_ID;
      initOT(roomId, wrtcId);
    };

    // Si l'ID WebRTC est déjà connu (après JOINED), on démarre tout de suite.
    if (window.WRTC_CLIENT_ID) {
      start();
    } else {
      // Sinon on attend l'événement émis par app.js dans JOINED
      window.addEventListener("wrtc-joined", start, { once: true });
    }
  }
} else {
  console.warn("[OT] déjà initialisé, on ignore.");
}

function initOT(roomId, myId) {
  // Sécurité (très rare): fallback si on n'a vraiment pas d'id
  myId ||= Math.random().toString(36).slice(2, 8);

  // WebSocket vers le serveur OT dédié (ot-server.js)
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const host = location.hostname;
  const otPort = Number(import.meta.env?.VITE_OT_PORT) || 3001;

  const socket = new WebSocket(`${proto}://${host}:${otPort}/?cid=${myId}`);
  const connection = new ShareDB.Connection(socket);

  // -------- Doc OT --------
  const doc = connection.get("docs", roomId);

  // Quill + module cursors
  const quill = new Quill("#editor", {
    theme: "snow",
    placeholder: "Écris ici… (collab en direct)",
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["link", "code-block", "blockquote"],
        ["clean"],
      ],
      cursors: true,
    },
  });
  const cursors = quill.getModule("cursors");

  // === Presence ShareDB au niveau DU DOCUMENT ===
  const docPresence = connection.getDocPresence("docs", roomId);
  const myPresence = docPresence.create(myId);

  const metaById = new Map();
  const lastRangeById = new Map();

  function ensureCursor(id) {
    const wantedName = nameFor(id);
    const meta = metaById.get(id);
    if (!meta) {
      const color = colorFromId(id);
      cursors.createCursor(id, wantedName, color);
      metaById.set(id, { name: wantedName, color });
      const last = lastRangeById.get(id);
      if (last) cursors.moveCursor(id, last);
    } else if (meta.name !== wantedName) {
      const r = lastRangeById.get(id);
      cursors.removeCursor(id);
      cursors.createCursor(id, wantedName, colorFromId(id));
      if (r) cursors.moveCursor(id, r);
      metaById.set(id, { name: wantedName, color: colorFromId(id) });
    }
  }

  function publishLocalSelection(range) {
    // range = {index, length} ou null
    myPresence.submit(range || null, (err) => {
      if (err) console.warn("[OT] presence submit warn:", err);
    });
  }

  docPresence.subscribe((err) => {
    if (err) console.error("[OT] docPresence subscribe error:", err);
  });

  // Curseurs distants (pour CE doc)
  docPresence.on("receive", (remoteId, range) => {
    if (remoteId === myId) return;
    if (range && typeof range.index === "number") {
      lastRangeById.set(remoteId, range);
      ensureCursor(remoteId);
      cursors.moveCursor(remoteId, range);
    } else {
      cursors.removeCursor(remoteId);
      metaById.delete(remoteId);
      lastRangeById.delete(remoteId);
    }
  });

  // Si un nom de pair change côté WebRTC → mettre à jour le label du curseur
  window.addEventListener("peer-name", (e) => {
    const { id, name } = e.detail || {};
    if (!id || !name) return;
    const r = lastRangeById.get(id);
    cursors.removeCursor(id);
    cursors.createCursor(id, name, colorFromId(id));
    if (r) cursors.moveCursor(id, r);
    metaById.set(id, { name, color: colorFromId(id) });
  });

  // Doc OT — contenu
  let bound = false;
  doc.subscribe((err) => {
    if (err) return console.error("[OT] subscribe error:", err);

    try {
      quill.setContents(doc.data || [{ insert: "\n" }], "silent");
    } catch {
      quill.setContents([{ insert: "\n" }], "silent");
    }

    if (bound) return;
    bound = true;

    // Quill -> ShareDB (ops locales)
    quill.on("text-change", (delta, _old, source) => {
      if (source !== "user") return;
      doc.submitOp(delta, { source: quill }, (e) => {
        if (e) console.warn("[OT] submitOp warn:", e);
      });
    });

    // Quill -> Presence (sélection locale)
    quill.on("selection-change", (range, _old, source) => {
      if (source !== "user") return;
      publishLocalSelection(range);
    });

    // ShareDB -> Quill (ops distantes)
    doc.on("op", (op, source) => {
      if (source === quill) return;
      quill.updateContents(op, "silent");
    });

    // Publier l'état initial (souvent null)
    publishLocalSelection(quill.getSelection());
    console.log("[OT] prêt (cursors on) pour", roomId, "id=", myId);
  });

  // Nettoyage présence à la fermeture
  window.addEventListener("beforeunload", () => {
    try {
      myPresence.submit(null, () => {});
    } catch {}
  });
}
