import { DEFAULT_W, DEFAULT_H, NOTE_COLORS, TYPES } from './constants.js';
import { saveState } from './storage.js';

export function addNote(grid, { x, y, w = DEFAULT_W, h = DEFAULT_H, text = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.dataset.type = TYPES.NOTE;

  if (w) el.setAttribute('gs-w', w);
  if (h) el.setAttribute('gs-h', h);
  if (x != null) el.setAttribute('gs-x', x);
  if (y != null) el.setAttribute('gs-y', y);

  const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  el.innerHTML = `
    <div class="grid-stack-item-content note" tabindex="0"
         style="background:${color.bg}; border:1px solid ${color.border};">
      <div class="w-header"><span class="w-title">Post-it</span>
        <div class="w-actions"><button class="w-close" title="Supprimer" type="button">×</button></div>
      </div>
      <div class="note__body" contenteditable="false"></div>
    </div>`;

  el.querySelector('.note__body').textContent = text || 'Nouveau post-it';
  grid.addWidget(el);
  if (grid.update) grid.update(el, { w, h });

  wireNoteInteractions(grid, el);
  saveState(grid);
  return el;
}

export function createContentForNode(grid, node){
  if (node?.type === TYPES.DRAW) return null; // géré par drawpad.js
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.dataset.type = TYPES.NOTE;
  el.innerHTML = `
    <div class="grid-stack-item-content note" tabindex="0">
      <div class="w-header"><span class="w-title">Post-it</span>
        <div class="w-actions"><button class="w-close" title="Supprimer" type="button">×</button></div>
      </div>
      <div class="note__body" contenteditable="false"></div>
    </div>`;
  el.querySelector('.note__body').textContent = node?.content || 'Post-it';
  wireNoteInteractions(grid, el);
  return el;
}

function wireNoteInteractions(grid, itemEl){
  const note = itemEl.querySelector('.note');
  const body = itemEl.querySelector('.note__body');
  const close = itemEl.querySelector('.w-close');

  note.addEventListener('pointerdown', () => {
    document.querySelectorAll('.note.is-selected').forEach(n => n.classList.remove('is-selected'));
    note.classList.add('is-selected');
  });
  note.addEventListener('dblclick', (e) => {
    if (e.target !== body) return;
    body.setAttribute('contenteditable', 'true'); body.focus(); placeCaretAtEnd(body);
  });
  body.addEventListener('blur', () => { body.setAttribute('contenteditable', 'false'); saveState(grid); });
  close.addEventListener('click', (e) => { e.stopPropagation(); grid.removeWidget(itemEl); saveState(grid); });
}

function placeCaretAtEnd(el){
  const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
