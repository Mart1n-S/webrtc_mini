export const GRID_OPTIONS = {
  column: 24,
  cellHeight: 32,
  margin: 8,
  float: true,
  animate: true,
  draggable: { handle: '.w-header', scroll: true },
  resizable: { handles: 'e, s, se' },
};

export const DEFAULT_W = 7;
export const DEFAULT_H = 7;

export const TYPES = {
  NOTE: 'note',
  DRAW: 'draw',
};

export const NOTE_COLORS = [
  { bg: '#fff9a9', border: '#e2d77a' },
  { bg: '#a9ffd6', border: '#7ae2a9' },
  { bg: '#a9d0ff', border: '#7aaee2' },
  { bg: '#f9a9ff', border: '#e27ae2' },
  { bg: '#ffd6a9', border: '#e2a97a' },
];

// v3 car collaboration (structure sauv modifiée)
export const LS_KEY = 'whiteboard:grid:v3';

export const WS_PATH = '/ws';

// util: room depuis l’URL (hash ou query), sinon "demo"
export function getRoomId() {
  const url = new URL(window.location.href);
  const q = url.searchParams.get('room');
  const h = url.hash?.replace(/^#/, '');
  return (q || h || 'demo').trim();
}
