import { GRID_OPTIONS, DEFAULT_W, DEFAULT_H, TYPES, getRoomId } from './constants.js';
import { saveState, loadState } from './storage.js';
import { addNote, createContentForNode as createNoteFromNode, editNote } from './notes.js';
import { addDrawPad, createDrawFromNode, drawpadSetImage } from './drawpad.js';
import { createSync } from './sync.js';

let grid;
let sync;

document.addEventListener('DOMContentLoaded', () => {
  grid = GridStack.init(GRID_OPTIONS, '.grid-stack');

  sync = createSync(getRoomId(), {
    onApply: handleRemoteApply,
    onSnapshot: handleSnapshotMessage,
  });

  const saved = loadState();
  if (saved?.length) {
    grid.load(saved, (node) => node.type === TYPES.DRAW
      ? createDrawFromNode(grid, node)
      : createNoteFromNode(grid, node)
    );
  } else {
    addNote(grid, { w: DEFAULT_W, h: DEFAULT_H, text: 'Double-clique pour éditer ✍️' });
  }

  setupToolbar();

  // ENVOI layout précis sur drag/resize
  grid.on('change', (event, items) => {
    if (!items || !items.length) return;
    const layout = items.map(i => ({
      id: i.el?.dataset?.id, x: i.x, y: i.y, w: i.w, h: i.h
    })).filter(n => n.id);
    sync.apply('layout', layout);
    saveState(grid);
  });
  ['dragstop','resizestop'].forEach(ev => {
    grid.on(ev, () => {
      const layout = grid.engine.nodes.map(n => ({
        id: n.el?.dataset?.id, x:n.x, y:n.y, w:n.w, h:n.h
      })).filter(n=>n.id);
      sync.apply('layout', layout);
      saveState(grid);
    });
  });

  document.getElementById('btnClear')?.addEventListener('click', () => {
    grid.removeAll(); saveState(grid);
    sync.apply('clear', {});
  });

  // Suppr via clavier
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = document.querySelector('.note.is-selected, .drawpad.is-selected');
    if (!selected) return;
    const item = selected.closest('.grid-stack-item');
    if (!item) return;
    const id = item.dataset.id;
    grid.removeWidget(item);
    saveState(grid);
    sync.apply('remove', { id });
    e.preventDefault();
  });

  // Dessin : fin de trait → envoie image
  document.addEventListener('draw:end', (e) => {
    const item = e.target.closest('.grid-stack-item');
    if (!item) return;
    const id = item.dataset.id;
    const canvas = item.querySelector('canvas.drawpad__canvas');
    const image = canvas?.toDataURL('image/png') || null;
    if (image) { sync.apply('draw-image', { id, image }); saveState(grid); }
  });

  document.addEventListener('draw:remove', (e) => {
    const item = e.target.closest('.grid-stack-item');
    if (!item) return;
    const id = item.dataset.id;
    sync.apply('remove', { id });
    saveState(grid);
  });
});

function setupToolbar(){
  const btns = document.querySelectorAll('.btn[data-tool]');
  btns.forEach(b => b.addEventListener('click', () => {
    const tool = b.dataset.tool || 'select';
    btns.forEach(x => x.classList.toggle('is-active', x === b));

    if (tool === 'note') {
      const y = grid.engine.getRow() || 0;
      const el = addNote(grid, { x:0, y, w: DEFAULT_W, h: DEFAULT_H, text: '' });
      sync.apply('add', nodeFromEl(el));
      selectTool(btns, 'select');
    }
    if (tool === 'draw') {
      const y = grid.engine.getRow() || 0;
      const { el } = addDrawPad(grid, { x:0, y, w: DEFAULT_W+2, h: DEFAULT_H+2 });
      sync.apply('add', nodeFromEl(el));
      selectTool(btns, 'select');
    }
  }));

  // Diffuse édition note à la sortie de focus
  document.addEventListener('blur', (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (!e.target.classList.contains('note__body')) return;
    const item = e.target.closest('.grid-stack-item');
    if (!item) return;
    sync.apply('note', { id: item.dataset.id, content: e.target.textContent || '' });
    saveState(grid);
  }, true);
}

function selectTool(btns, tool){
  btns.forEach(x => x.classList.toggle('is-active', (x.dataset.tool||'')===tool));
}

function nodeFromEl(el){
  const n = el.gridstackNode || {};
  const type = el.dataset.type;
  const data = { id: el.dataset.id, type, x:n.x, y:n.y, w:n.w, h:n.h };
  if (type === TYPES.NOTE) data.content = el.querySelector('.note__body')?.textContent || '';
  if (type === TYPES.DRAW)  data.image = el.querySelector('canvas.drawpad__canvas')?.toDataURL('image/png') || null;
  return data;
}

/* ---------- Réception réseau ---------- */
function handleRemoteApply({ op, data }) {
  if (op === 'add') {
    if (document.querySelector(`.grid-stack-item[data-id="${data.id}"]`)) return;
    data.type === TYPES.NOTE ? addNote(grid, data) : createDrawFromNode(grid, data);
    saveState(grid); return;
  }
  if (op === 'remove') {
    const el = document.querySelector(`.grid-stack-item[data-id="${data.id}"]`);
    if (el) { grid.removeWidget(el); saveState(grid); } return;
  }
  if (op === 'layout') {
    (data || []).forEach(d => {
      const el = document.querySelector(`.grid-stack-item[data-id="${d.id}"]`);
      if (!el) return;
      grid.update(el, { x:d.x, y:d.y, w:d.w, h:d.h });
    });
    saveState(grid); return;
  }
  if (op === 'note') {
    const el = document.querySelector(`.grid-stack-item[data-id="${data.id}"]`);
    if (el) { editNote(el, data.content || ''); saveState(grid); } return;
  }
  if (op === 'draw-image') {
    const el = document.querySelector(`.grid-stack-item[data-id="${data.id}"]`);
    if (el) { drawpadSetImage(el, data.image); saveState(grid); } return;
  }
  if (op === 'clear') { grid.removeAll(); saveState(grid); return; }
}

// Snapshots
function handleSnapshotMessage(kind, info){
  if (kind === '__REQUEST__') {
    const state = grid.engine.nodes.map(n => {
      const item = n.el, type = item.dataset.type;
      const base = { id:item.dataset.id, type, x:n.x, y:n.y, w:n.w, h:n.h };
      if (type === TYPES.NOTE) base.content = item.querySelector('.note__body')?.textContent || '';
      if (type === TYPES.DRAW) base.image  = item.querySelector('canvas.drawpad__canvas')?.toDataURL('image/png') || null;
      return base;
    });
    if (state.length) sync.sendSnapshot(state);
    return;
  }
  const state = kind;
  if (!Array.isArray(state) || grid.engine.nodes.length) return;
  state.forEach(node => node.type === TYPES.NOTE
    ? addNote(grid, node)
    : createDrawFromNode(grid, node));
  saveState(grid);
}
