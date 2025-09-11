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

    // ======= Board (notes) – JSON0 =======
    const boardDoc = connection.get("boards", roomId);
    const notesLayer = document.getElementById("notesLayer");
    const boardScroll = document.getElementById("board"); // conteneur scrollable (wb-canvas)

    const PADDING_BOTTOM = 24; // marge sous la note la plus basse
    const NEW_NOTE_OFFSET = 40; // offset quand on ajoute une note

    // id simple
    const newId = () => Math.random().toString(36).slice(2);

    /** Recalcule une min-height pour notesLayer selon la note la plus basse. */
    function recomputeMinHeight() {
      if (!notesLayer || !boardDoc.data || !boardDoc.data.notes) return;
      let maxBottom = 0;
      // calcule le maxBottom à partir des DOM existants (plus fiable que data.width/height)
      const nodes = notesLayer.querySelectorAll(".note");
      nodes.forEach((el) => {
        const top = parseInt(el.style.top || "0", 10);
        const h = el.offsetHeight || 120;
        const bottom = top + h;
        if (bottom > maxBottom) maxBottom = bottom;
      });
      const desired = Math.max(
        notesLayer.clientHeight,
        maxBottom + PADDING_BOTTOM
      );
      notesLayer.style.minHeight = `${desired}px`;
    }

    const MIN_W = 160;
    const MIN_H = 110;
    const NOTE_MARGIN = 16; // marge entre notes

    function rectsOverlap(a, b) {
      return !(
        a.x + a.w <= b.x ||
        b.x + b.w <= a.x ||
        a.y + a.h <= b.y ||
        b.y + b.h <= a.y
      );
    }

    function anyOverlap(x, y, w, h, notes, ignoreId) {
      const me = { x, y, w, h };
      for (const n of notes) {
        if (n.id === ignoreId) continue;
        const r = { x: n.x, y: n.y, w: n.w || 180, h: n.h || 120 };
        // applique une marge
        r.x -= NOTE_MARGIN / 2;
        r.y -= NOTE_MARGIN / 2;
        r.w += NOTE_MARGIN;
        r.h += NOTE_MARGIN;
        if (rectsOverlap(me, r)) return true;
      }
      return false;
    }

    /**
     * Trouve un spot libre dans la zone (scan en grille vers le bas)
     * @returns { x:number, y:number }
     */
    function findFreeSpot(desiredX, desiredY, w, h) {
      const layerW = notesLayer.clientWidth || 1000;
      // clamp X dans la largeur visible
      const startX = Math.max(0, Math.min(desiredX, Math.max(0, layerW - w)));
      const notes = (boardDoc.data && boardDoc.data.notes) || [];

      const stepX = w + NOTE_MARGIN;
      const stepY = h + NOTE_MARGIN;

      // On scanne du y désiré vers le bas, par lignes, jusqu’à 4000px
      const MAX_SCAN = 4000;
      for (let y = Math.max(0, desiredY); y < MAX_SCAN; y += stepY) {
        for (
          let x = 0;
          x <= layerW - w;
          x += Math.max(100, Math.min(stepX, 260))
        ) {
          // priorité à la colonne proche du startX (petit tri)
          const xx = Math.abs(x - startX) < 80 ? startX : x;
          if (!anyOverlap(xx, y, w, h, notes)) {
            // étend la min-height si besoin
            const bottom = y + h + PADDING_BOTTOM;
            const currentMin = parseInt(
              getComputedStyle(notesLayer).minHeight || "0",
              10
            );
            if (bottom > currentMin) notesLayer.style.minHeight = `${bottom}px`;
            return { x: xx, y };
          }
        }
      }
      // fallback : place quand même (pour ne pas bloquer), en bas
      const fallbackY = (notesLayer.scrollHeight || 0) + NOTE_MARGIN;
      return { x: startX, y: fallbackY };
    }

    /** Rendu complet (notes) */
    function renderAllNotes() {
      if (!notesLayer) return;
      notesLayer.innerHTML = "";
      const data = boardDoc.data || { notes: [] };
      for (const n of data.notes) {
        const el = renderNoteDom(n);
        notesLayer.appendChild(el);
      }
      // ajuste la hauteur mini en fonction des notes rendues
      recomputeMinHeight();
    }

    /** Crée un post-it DOM + interactions (drag + edit) */
    function renderNoteDom(note) {
      const el = document.createElement("div");
      el.className = "note";
      el.tabIndex = 0;
      el.dataset.id = note.id;

      // width/height avec fallback + min
      const w = Math.max(MIN_W, note.w || 180);
      const h = Math.max(MIN_H, note.h || 120);

      el.style.left = `${note.x}px`;
      el.style.top = `${note.y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;

      // bouton croix
      const close = document.createElement("button");
      close.className = "note__close";
      close.type = "button";
      close.setAttribute("aria-label", "Supprimer la note");
      close.textContent = "×";
      el.appendChild(close);

      // texte
      const txt = document.createElement("div");
      txt.className = "note__text";
      txt.textContent = note.text || "Votre note…";
      el.appendChild(txt);

      // poignée de resize (coin bas-droite)
      const grip = document.createElement("div");
      grip.className = "note__resize";
      el.appendChild(grip);

      // --- suppression unitaire ---
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteNote(note.id);
      });

      // ---- Drag (avec contraintes et extension vers le bas) ----
      let startX = 0,
        startY = 0,
        baseX = note.x,
        baseY = note.y,
        dragging = false;

      const onMouseMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // dimensions courantes
        const layerW = notesLayer.clientWidth;
        const noteW = el.offsetWidth;
        const noteH = el.offsetHeight;

        // clamp X: [0 .. layerW - noteW]
        const nextX = Math.max(
          0,
          Math.min(baseX + dx, Math.max(0, layerW - noteW))
        );

        // Y: >= 0, et si dépasse en bas → on agrandit la min-height
        const nextY = Math.max(0, baseY + dy);
        const bottom = nextY + noteH;

        // si on dépasse la hauteur visible → on étend la min-height
        const minNeeded = bottom + PADDING_BOTTOM;
        const currentMin = parseInt(
          getComputedStyle(notesLayer).minHeight || "0",
          10
        );
        if (minNeeded > currentMin) {
          notesLayer.style.minHeight = `${minNeeded}px`;
          if (boardScroll) boardScroll.scrollTop = boardScroll.scrollHeight;
        }

        el.style.left = `${nextX}px`;
        el.style.top = `${nextY}px`;
      };

      const onMouseUp = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("dragging");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);

        // position finale (clampée)
        const curX = parseInt(el.style.left || "0", 10);
        const curY = parseInt(el.style.top || "0", 10);
        const finalX = Math.max(0, curX);
        const finalY = Math.max(0, curY);

        // soumettre op json0: remplacer x,y
        const idx = (boardDoc.data.notes || []).findIndex(
          (n) => n.id === note.id
        );
        if (idx >= 0) {
          boardDoc.submitOp(
            [
              { p: ["notes", idx, "x"], od: note.x, oi: finalX },
              { p: ["notes", idx, "y"], od: note.y, oi: finalY },
            ],
            (err) => err && console.warn("[board] move error:", err)
          );
        }
      };

      el.addEventListener("mousedown", (e) => {
        // pas de drag sur texte / croix / grip, ni en mode édition
        if (e.target === txt || e.target.closest(".note__text")) return;
        if (e.target === close || e.target === grip) return;
        if (el.classList.contains("editing")) return;

        dragging = true;
        el.classList.add("dragging");
        startX = e.clientX;
        startY = e.clientY;
        baseX = parseInt(el.style.left, 10) || 0;
        baseY = parseInt(el.style.top, 10) || 0;
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });

      // ---- Edition du texte (double-clic) ----
      txt.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startEditingNoteText(note.id, txt);
      });

      // ---- Resize (coin SE) ----
      grip.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const startMx = e.clientX,
          startMy = e.clientY;
        const startW = el.offsetWidth,
          startH = el.offsetHeight;
        el.classList.add("resizing");

        const onMove = (ev) => {
          const dw = ev.clientX - startMx;
          const dh = ev.clientY - startMy;
          const newW = Math.max(MIN_W, startW + dw);
          const newH = Math.max(MIN_H, startH + dh);
          el.style.width = `${newW}px`;
          el.style.height = `${newH}px`;

          // agrandit le board si besoin
          const top = parseInt(el.style.top || "0", 10);
          const bottom = top + newH + PADDING_BOTTOM;
          const currentMin = parseInt(
            getComputedStyle(notesLayer).minHeight || "0",
            10
          );
          if (bottom > currentMin) {
            notesLayer.style.minHeight = `${bottom}px`;
            if (boardScroll) boardScroll.scrollTop = boardScroll.scrollHeight;
          }
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          el.classList.remove("resizing");

          // Commit OT: w/h
          const idx = (boardDoc.data.notes || []).findIndex(
            (n) => n.id === note.id
          );
          if (idx >= 0) {
            const oldW = boardDoc.data.notes[idx].w || startW;
            const oldH = boardDoc.data.notes[idx].h || startH;
            const finalW = Math.max(MIN_W, Math.round(el.offsetWidth));
            const finalH = Math.max(MIN_H, Math.round(el.offsetHeight));
            boardDoc.submitOp(
              [
                { p: ["notes", idx, "w"], od: oldW, oi: finalW },
                { p: ["notes", idx, "h"], od: oldH, oi: finalH },
              ],
              (err) => err && console.warn("[board] resize error:", err)
            );
          }
          recomputeMinHeight();
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      return el;
    }

    /** Lance l'édition (contenteditable) et submit OT sur validation */
    function startEditingNoteText(noteId, textEl) {
      const idx = (boardDoc.data.notes || []).findIndex((n) => n.id === noteId);
      if (idx < 0) return;

      const oldVal = boardDoc.data.notes[idx].text || "";
      const noteEl = textEl.closest(".note");
      if (!noteEl) return;

      // hauteur de départ (pour comparer)
      const startHeight = noteEl.offsetHeight;

      // passe en mode édition
      noteEl.classList.add("editing");
      textEl.setAttribute("contenteditable", "true");
      textEl.focus();

      // place le caret à la fin
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textEl);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // auto-grow à l’entrée en édition (au cas où)
      autoGrowNoteHeight(noteEl, textEl);

      // pendant la saisie, ajuste la hauteur (sans envoyer d’OP)
      const onInput = () => {
        // un rAF pour lisser (évite jank pendant frappe)
        requestAnimationFrame(() => autoGrowNoteHeight(noteEl, textEl));
      };

      const onKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          textEl.blur();
        }
      };

      const onBlur = () => {
        textEl.removeEventListener("input", onInput);
        textEl.removeEventListener("keydown", onKeyDown);
        textEl.removeEventListener("blur", onBlur);
        textEl.removeAttribute("contenteditable");
        noteEl.classList.remove("editing");

        const newVal = textEl.textContent || "";
        const finalH = Math.max(MIN_H, Math.round(noteEl.offsetHeight));

        const ops = [];

        // 1) texte changé ?
        if (newVal !== oldVal) {
          ops.push({ p: ["notes", idx, "text"], od: oldVal, oi: newVal });
        }

        // 2) hauteur à persister ?
        const oldH = boardDoc.data.notes[idx].h || startHeight;
        if (finalH !== oldH) {
          ops.push({ p: ["notes", idx, "h"], od: oldH, oi: finalH });
        }

        if (ops.length) {
          boardDoc.submitOp(
            ops,
            (err) => err && console.warn("[board] edit/height error:", err)
          );
        }

        // ajuste la min-height globale après édition
        recomputeMinHeight();
      };

      textEl.addEventListener("input", onInput);
      textEl.addEventListener("keydown", onKeyDown);
      textEl.addEventListener("blur", onBlur);
    }

    /** Ajoute une note, centrée approximativement */
    function addNote(x, y) {
      if (!notesLayer) return;

      const defaultW = 180,
        defaultH = 120;
      // centre visible
      const rect = notesLayer.getBoundingClientRect();
      const desiredX = Math.max(
        0,
        typeof x === "number" ? x : Math.round(rect.width / 2 - defaultW / 2)
      );
      const desiredY = Math.max(
        0,
        typeof y === "number" ? y : Math.round(rect.height / 2 - defaultH / 2)
      );

      // trouve une place libre
      const spot = findFreeSpot(desiredX, desiredY, defaultW, defaultH);

      const note = {
        id: newId(),
        x: spot.x,
        y: spot.y,
        w: defaultW,
        h: defaultH,
        text: "Nouvelle note",
        color: "#fff6a9",
      };
      const notes = (boardDoc.data && boardDoc.data.notes) || [];
      const pos = notes.length;

      boardDoc.submitOp([{ p: ["notes", pos], li: note }], (err) => {
        if (err) console.warn("[board] add error:", err);
        requestAnimationFrame(() => {
          recomputeMinHeight();
          if (boardScroll) boardScroll.scrollTop = boardScroll.scrollHeight;
        });
      });
    }

    /** Supprime une note par son id */
    function deleteNote(noteId) {
      const notes = (boardDoc.data && boardDoc.data.notes) || [];
      const idx = notes.findIndex((n) => n.id === noteId);
      if (idx < 0) return;
      const old = notes[idx];
      // json0: suppression d’un élément de tableau => ld (old value)
      boardDoc.submitOp([{ p: ["notes", idx], ld: old }], (err) => {
        if (err) console.warn("[board] delete error:", err);
      });
    }

    function autoGrowNoteHeight(noteEl, textEl) {
      // calcule une hauteur qui englobe tout le texte + padding de la note (8+8)
      const contentH = Math.max(MIN_H, (textEl.scrollHeight || 0) + 16);
      noteEl.style.height = `${contentH}px`;

      // agrandit la zone si on touche le bas
      const top = parseInt(noteEl.style.top || "0", 10);
      const bottom = top + contentH + PADDING_BOTTOM;
      const currentMin = parseInt(
        getComputedStyle(notesLayer).minHeight || "0",
        10
      );
      if (bottom > currentMin) {
        notesLayer.style.minHeight = `${bottom}px`;
        if (boardScroll) boardScroll.scrollTop = boardScroll.scrollHeight;
      }
    }

    /** Supprime toutes les notes (avec confirmation) */
    function clearAllNotes() {
      const notes = (boardDoc.data && boardDoc.data.notes) || [];
      if (notes.length === 0) return;

      const ok = window.confirm(
        `Supprimer ${notes.length} post-it${notes.length > 1 ? "s" : ""} ?`
      );
      if (!ok) return;

      // json0: remplacer le tableau complet
      boardDoc.submitOp([{ p: ["notes"], od: notes, oi: [] }], (err) => {
        if (err) console.warn("[board] clear-all error:", err);
        // optionnel: feedback
        if (!err && window.Toastify) {
          Toastify({
            text: "Tous les post-its ont été supprimés.",
            duration: 2500,
            gravity: "top",
            position: "center",
            close: true,
            backgroundColor: "#2b6cff",
            stopOnFocus: true,
          }).showToast();
        }
      });
    }

    // Sync initial + live ops
    boardDoc.subscribe((err) => {
      if (err) return console.error("[board] subscribe error", err);
      if (!boardDoc.type) {
        // doc créé côté serveur via ensureBoardDoc
        // Le snapshot arrivera → on re-rendera à la prochaine op
      }
      renderAllNotes();

      boardDoc.on("op", (_ops, _src) => {
        // simple et robuste : re-render complet
        renderAllNotes();
      });
    });

    // Toolbar: outil Post-it
    const btnToolNote = document.getElementById("btnToolNote");
    if (btnToolNote && notesLayer) {
      btnToolNote.addEventListener("click", () => {
        // Ajoute une note ~au centre, puis pousse vers le bas si besoin
        addNote(
          undefined,
          (notesLayer.scrollHeight || notesLayer.clientHeight) / 2 -
            60 +
            NEW_NOTE_OFFSET
        );
      });
    }

    // Toolbar: clear notes
    const btnClearNotes = document.getElementById("btnClearNotes");

    if (btnClearNotes) {
      btnClearNotes.addEventListener("click", clearAllNotes);
    }

    // --- Export helpers ---
    function download(filename, mime, textOrBlob) {
      const blob =
        textOrBlob instanceof Blob
          ? textOrBlob
          : new Blob([textOrBlob], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    }

    function exportNote(fmt) {
      const base = `note_${roomId}`;
      if (fmt === "delta") {
        const delta = doc.data || quill.getContents();
        download(
          `${base}.delta.json`,
          "application/json;charset=utf-8",
          JSON.stringify(delta, null, 2)
        );
        return;
      }
      if (fmt === "html") {
        // HTML “propre” (innerHTML du conteneur Quill)
        const html = quill.root.innerHTML;
        download(
          `${base}.html`,
          "text/html;charset=utf-8",
          `<!doctype html>
<html><head><meta charset="utf-8"><title>${base}</title></head><body>${html}</body></html>`
        );
        return;
      }
      if (fmt === "md") {
        if (!window.TurndownService) {
          alert(
            "Turndown (Markdown) non chargé. Garde HTML/Delta/TXT ou ajoute le <script> CDN."
          );
          return;
        }
        const turndown = new window.TurndownService();
        const md = turndown.turndown(quill.root.innerHTML);
        download(`${base}.md`, "text/markdown;charset=utf-8", md);
        return;
      }
      if (fmt === "txt") {
        const txt = quill.getText(); // sans mise en forme
        download(`${base}.txt`, "text/plain;charset=utf-8", txt);
        return;
      }
      if (fmt === "pdf") {
        if (!window.html2pdf) {
          alert(
            "html2pdf.js non chargé. Ajoute le <script> CDN ou choisis un autre format."
          );
          return;
        }
        // Utilise l’élément #editor directement
        const opt = {
          margin: 10,
          filename: `${base}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        };
        window.html2pdf().set(opt).from(quill.root).save();
        return;
      }
      alert("Format d’export inconnu.");
    }

    // Bouton exporter
    const btnExport = document.getElementById("btnExport");
    const selFmt = document.getElementById("selExportFmt");
    if (btnExport && selFmt) {
      btnExport.addEventListener("click", () => exportNote(selFmt.value));
    }
  });

  // Nettoyage présence à la fermeture
  window.addEventListener("beforeunload", () => {
    try {
      myPresence.submit(null, () => {});
    } catch {}
  });
}
