import { LS_KEY, TYPES } from "./constants.js";

export function saveState(grid, roomId) {
  if (!grid || !roomId) return;
  const nodes = [];
  grid.engine.nodes.forEach((n) => {
    const type = n.el.dataset.type || TYPES.NOTE;
    const data = { id: n.el.dataset.id, x: n.x, y: n.y, w: n.w, h: n.h, type };
    if (type === TYPES.NOTE) {
      const body = n.el.querySelector(".note__body");
      data.content = body ? body.textContent : "";
    } else if (type === TYPES.DRAW) {
      const canvas = n.el.querySelector("canvas.drawpad__canvas");
      try {
        data.image = canvas?.toDataURL("image/png") || null;
      } catch {
        data.image = null;
      }
    }
    nodes.push(data);
  });
  localStorage.setItem(`${LS_KEY}:${roomId}`, JSON.stringify(nodes));
}

export function loadState(roomId) {
  try {
    const raw = localStorage.getItem(`${LS_KEY}:${roomId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
