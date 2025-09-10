/**
 * Constantes & utilitaires du whiteboard
 * --------------------------------------
 * - Options GridStack
 * - Types et tailles par défaut
 * - Couleurs des post-it
 * - Helpers: getRoomId(), lsKeyFor(roomId)
 */

export const GRID_OPTIONS = {
  column: 24,
  cellHeight: 32,
  margin: 8,
  float: true,
  animate: true,
  draggable: { handle: ".w-header", scroll: true },
  resizable: { handles: "e, s, se" },
};

export const DEFAULT_W = 7;
export const DEFAULT_H = 7;

export const TYPES = {
  NOTE: "note",
  DRAW: "draw",
};

export const NOTE_COLORS = [
  { bg: "#fff9a9", border: "#e2d77a" },
  { bg: "#a9ffd6", border: "#7ae2a9" },
  { bg: "#a9d0ff", border: "#7aaee2" },
  { bg: "#f9a9ff", border: "#e27ae2" },
  { bg: "#ffd6a9", border: "#e2a97a" },
];

/**
 * Clé "base" de stockage local.
 * Recommandation: composer une clé PAR room via lsKeyFor(roomId).
 */
export const LS_KEY = "whiteboard:grid:v3";

/** Chemin du WebSocket côté serveur */
export const WS_PATH_AV = "/ws";
export const WS_PATH_WB = "/ws-wb";

/**
 * Récupère l'ID de room courant.
 * Priorité:
 *  1) window.ROOM_ID (injecté côté /room/:id)
 *  2) query ?room=...
 *  3) hash #room
 *  4) fallback 'demo' (utile en dev)
 */
export function getRoomId() {
  if (typeof window !== "undefined" && window.ROOM_ID) {
    return String(window.ROOM_ID).trim();
  }
  const url = new URL(window.location.href);
  const q = url.searchParams.get("room");
  const h = (url.hash || "").replace(/^#/, "");
  return (q || h || "demo").trim();
}

/**
 * Construit une clé locale NAMESPACEE PAR ROOM.
 * Exemple d'usage (dans storage.js):
 *   localStorage.setItem(lsKeyFor(roomId), JSON.stringify(state))
 */
export function lsKeyFor(roomId) {
  return `${LS_KEY}:${roomId}`;
}
