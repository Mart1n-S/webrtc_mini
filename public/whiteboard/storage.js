import { LS_KEY } from './constants.js';

export function saveState(grid) {
  if (!grid) return;
  const nodes = [];
  grid.engine.nodes.forEach((n) => {
    const body = n.el.querySelector('.note__body');
    nodes.push({ x: n.x, y: n.y, w: n.w, h: n.h, content: body ? body.textContent : '' });
  });
  localStorage.setItem(LS_KEY, JSON.stringify(nodes));
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
