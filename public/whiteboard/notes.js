import { DEFAULT_W, DEFAULT_H, NOTE_COLORS, TYPES } from './constants.js';
import { saveState } from './storage.js';

export function addNote(grid, { x, y, w = DEFAULT_W, h = DEFAULT_H, text = '', id = null } = {}) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.dataset.type = TYPES.NOTE;
  el.dataset.id = id || crypto.randomUUID();

  // v11: set size/pos BEFORE makeWidget()
  if (w) el.setAttribute('gs-w', w);
  if (h) el.setAttribute('gs-h', h);
  if (x != null) el.setAttribute('gs-x', x);
  if (y != null) el.setAttribute('gs-y', y);

  const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  el.innerHTML = `
    <div class="grid-stack-item-content note" tabindex="0"
         style="background:${color.bg}; border:1px solid ${color.border};">
      <div class="w-header">
        <span class="w-title">Post-it</span>
        <div class="w-actions">
          <button class="w-close" title="Supprimer" type="button">×</button>
        </div>
      </div>
      <div class="note__body" contenteditable="false"></div>
    </div>`;

  el.querySelector('.note__body').textContent = text || 'Nouveau post-it';

  // v11: register the widget (no addWidget / no update)
  grid.el.appendChild(el);
  grid.makeWidget(el);

  wireNoteInteractions(grid, el);
  saveState(grid);
  return el;
}

export function createContentForNode(grid, node) {
  return addNote(grid, {
    x: node.x, y: node.y, w: node.w, h: node.h,
    text: node?.content || '', id: node?.id
  });
}

export function editNote(el, content) {
  const body = el.querySelector('.note__body');
  if (body) body.textContent = content ?? '';
}

export function removeNote(grid, el) {
  grid.removeWidget(el);
}

function wireNoteInteractions(grid, itemEl) {
  const note  = itemEl.querySelector('.note');
  const body  = itemEl.querySelector('.note__body');
  const close = itemEl.querySelector('.w-close');

  note.addEventListener('pointerdown', () => {
    document.querySelectorAll('.note.is-selected').forEach(n => n.classList.remove('is-selected'));
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
  });

  // IMPORTANT: broadcast removal
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    grid.removeWidget(itemEl);
    itemEl.dispatchEvent(new CustomEvent('wb:remove', {
      bubbles: true,
      detail: { id: itemEl.dataset.id }
    }));
  });
}

function placeCaretAtEnd(el) {
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
