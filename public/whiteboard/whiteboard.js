import { GRID_OPTIONS, DEFAULT_W, DEFAULT_H } from './constants.js';
import { saveState, loadState } from './storage.js';
import { addNote, createContentForNode } from './notes.js';

// GridStack est global (chargé par /libs/gridstack/gridstack-all.js)
let grid;

document.addEventListener('DOMContentLoaded', () => {
  if (!window.GridStack) {
    console.error('GridStack non chargé. Vérifie /libs/gridstack/gridstack-all.js');
    return;
  }

  grid = GridStack.init(GRID_OPTIONS, '.grid-stack');

  const saved = loadState();
  if (saved) {
    grid.load(saved, (node) => createContentForNode(grid, node));
  } else {
    addNote(grid, { w: DEFAULT_W, h: DEFAULT_H, text: 'Double-clique pour éditer ✍️' });
  }

  setupToolbar();
  grid.on('change', debounce(() => saveState(grid), 300));

  document.getElementById('btnClear').addEventListener('click', () => {
    grid.removeAll();
    saveState(grid);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = document.querySelector('.note.is-selected');
    if (!selected) return;
    const item = selected.closest('.grid-stack-item');
    if (item) {
      grid.removeWidget(item);
      saveState(grid);
      e.preventDefault();
    }
  });

  // Recalcule la grille si la zone de board change de taille (layout responsive)
  const board = document.getElementById('board');
  const ro = new ResizeObserver(() => window.dispatchEvent(new Event('resize')));
  ro.observe(board);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
});

function setupToolbar() {
  const btns = document.querySelectorAll('.btn[data-tool]');
  let tool = 'select';
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool || 'select';
      btns.forEach((x) => x.classList.toggle('is-active', x === b));
      if (tool === 'note') {
        const y = grid.engine.getRow() || 0;
        addNote(grid, { x: 0, y, w: DEFAULT_W, h: DEFAULT_H, text: '' });
        tool = 'select';
        btns.forEach((x) => x.classList.toggle('is-active', (x.dataset.tool || '') === 'select'));
      }
    })
  );
}

function debounce(fn, t) {
  let id;
  return (...a) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), t);
  };
}
