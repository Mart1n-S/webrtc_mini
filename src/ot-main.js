// src/ot-main.js
import Quill from "quill";
import "quill/dist/quill.snow.css";

import ShareDB from "sharedb/lib/client";
import richText from "rich-text";

// Enregistre le type OT "rich-text" côté client
ShareDB.types.register(richText.type);

// Évite un double init si le module est injecté deux fois
if (!window.__OT_V2_INIT__) {
  window.__OT_V2_INIT__ = true;

  const roomId = window.ROOM_ID;
  if (!roomId) {
    console.warn("[OT] Pas de ROOM_ID");
  } else {
    // WebSocket vers le serveur OT dédié (ot-server.js)
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const host = location.hostname;
    const otPort = Number(import.meta.env?.VITE_OT_PORT) || 3001; // configurables via Vite env
    const cid = Math.random().toString(36).slice(2, 8);
    const socket = new WebSocket(`${proto}://${host}:${otPort}/?cid=${cid}`);
    console.log("[OT] socket cid=", cid, "→", `${proto}://${host}:${otPort}/`);

    const connection = new ShareDB.Connection(socket);
    const doc = connection.get("docs", roomId);

    // Quill
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
      },
    });

    let bound = false;

    // On suppose que le serveur a pré-créé le doc (ensureOTDoc)
    doc.subscribe((err) => {
      if (err) {
        console.error("[OT] subscribe error:", err);
        return;
      }

      // Snapshot initial
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

      // ShareDB -> Quill (ops distantes)
      doc.on("op", (op, source) => {
        if (source === quill) return; // ne rejoue pas nos propres ops
        quill.updateContents(op, "silent"); // évite de re-déclencher text-change
      });

      console.log("[OT] prêt pour", roomId, "cid=", cid);
    });
  }
} else {
  console.warn("[OT] déjà initialisé, on ignore.");
}
