export const GRID_OPTIONS = {
  column: 24,
  cellHeight: 32,
  margin: 8,
  float: true,
  animate: true,
  draggable: { handle: '.note__header', scroll: true },
  resizable: { handles: 'e, s, se' },
};

export const DEFAULT_W = 7;
export const DEFAULT_H = 7;

export const NOTE_COLORS = [
  { bg: '#fff9a9', border: '#e2d77a' }, // jaune
  { bg: '#a9ffd6', border: '#7ae2a9' }, // vert
  { bg: '#a9d0ff', border: '#7aaee2' }, // bleu
  { bg: '#f9a9ff', border: '#e27ae2' }, // rose
  { bg: '#ffd6a9', border: '#e2a97a' }, // orange
];

export const LS_KEY = 'whiteboard:grid:v1';
