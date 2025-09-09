import { DEFAULT_W, DEFAULT_H, NOTE_COLORS } from './constants.js';
import { saveState } from './storage.js';

export function addNote(grid, { x, y, w = DEFAULT_W, h = DEFAULT_H, text = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  if (w) el.setAttribute('gs-w', w);
  if (h) el.setAttribute('gs-h', h);
  if (x != null) el.setAttribute('gs-x', x);
  if (y != null) el.setAttribute('gs-y', y);

  const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  el.innerHTML = `
    <div class="grid-stack-item-content note" tabindex="0"
         style="background:${color.bg}; border:1px solid ${color.border};">
      <div class="note__header">
        <span class="note__title">Post-it</span>
        <div class="note__actions">
          <span class="chip">Drag</span>
          <button class="icon-btn" title="Supprimer" type="button" aria-label="Supprimer">×</button>
        </div>
      </div>
      <div class="note__body" contenteditable="false"></div>
    </div>`;

  el.querySelector('.note__body').textContent = text || 'Nouveau post-it';
  grid.addWidget(el);
  if (grid.update) grid.update(el, { w, h }); // compat versions

  wireNoteInteractions(grid, el);
  saveState(grid);
  return el;
}

export function createContentForNode(grid, node) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.innerHTML = `
    <div class="grid-stack-item-content note" tabindex="0">
      <div class="note__header">
        <span class="note__title">Post-it</span>
        <div class="note__actions">
          <span class="chip">Drag</span>
          <button class="icon-btn" title="Supprimer" type="button" aria-label="Supprimer">×</button>
        </div>
      </div>
      <div class="note__body" contenteditable="false"></div>
    </div>`;
  el.querySelector('.note__body').textContent = node?.content || 'Post-it';
  wireNoteInteractions(grid, el);
  return el;
}

function wireNoteInteractions(grid, itemEl) {
  const note = itemEl.querySelector('.note');
  const body = itemEl.querySelector('.note__body');
  const close = itemEl.querySelector('.icon-btn');

  note.addEventListener('pointerdown', () => {
    document.querySelectorAll('.note.is-selected').forEach((n) => n.classList.remove('is-selected'));
    note.classList.add('is-selected');
  });

  note.addEventListener('dblclick', (e) => {
    if (e.target !== body) return;
    body.setAttribute('contenteditable', 'true');
    body.focus();
    placeCaretAtEnd(body);
  });

  body.addEventListener('blur', () => {
    body.setAttribute('contenteditable', 'false');
    saveState(grid);
  });

  close.addEventListener('click', (e) => {
    e.stopPropagation();
    grid.removeWidget(itemEl);
    saveState(grid);
  });
}

function placeCaretAtEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
