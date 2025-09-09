import { DEFAULT_W, DEFAULT_H, TYPES } from './constants.js';
import { saveState } from './storage.js';

export function addDrawPad(grid, { x, y, w = DEFAULT_W, h = DEFAULT_H, image = null } = {}) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.dataset.type = TYPES.DRAW;

  if (w) el.setAttribute('gs-w', w);
  if (h) el.setAttribute('gs-h', h);
  if (x != null) el.setAttribute('gs-x', x);
  if (y != null) el.setAttribute('gs-y', y);

  el.innerHTML = `
    <div class="grid-stack-item-content drawpad">
      <div class="w-header"><span class="w-title">Bloc dessin</span>
        <div class="w-actions"><button class="w-close" title="Supprimer" type="button">×</button></div>
      </div>
      <canvas class="drawpad__canvas"></canvas>
      <div class="drawpad__toolbar">
        <button class="dp-btn" data-act="pen">✒️ Stylo</button>
        <button class="dp-btn" data-act="eraser">🧽 Gomme</button>
        <button class="dp-btn" data-act="clear">🗑️ Effacer</button>
      </div>
    </div>`;

  grid.addWidget(el);
  if (grid.update) grid.update(el, { w, h });

  wireDrawInteractions(grid, el, image);
  saveState(grid);
  return el;
}

export function createDrawFromNode(grid, node){
  return addDrawPad(grid, { x: node.x, y: node.y, w: node.w, h: node.h, image: node.image || null });
}

function wireDrawInteractions(grid, itemEl, imageDataURL){
  const root = itemEl.querySelector('.drawpad');
  const close = root.querySelector('.w-close');
  const canvas = root.querySelector('canvas.drawpad__canvas');
  const ctx = canvas.getContext('2d');

  // state
  let drawing = false;
  let mode = 'pen'; // 'pen' | 'eraser'
  let brush = 2;

  // resize canvas to container size (and keep content)
  const fitCanvas = (keep=true) => {
    const w = Math.floor(canvas.clientWidth);
    const h = Math.floor(canvas.clientHeight);
    if (w <= 0 || h <=0) return;
    let snapshot = null;
    if (keep) snapshot = canvas.toDataURL('image/png');
    canvas.width = w; canvas.height = h;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (snapshot) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, h);
      img.src = snapshot;
    }
  };
  // initial size + keep restored image
  const ro = new ResizeObserver(() => fitCanvas(true));
  ro.observe(canvas);
  setTimeout(() => fitCanvas(false), 0);

  // restore previous image if any
  if (imageDataURL) {
    const img = new Image();
    img.onload = () => {
      fitCanvas(false);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = imageDataURL;
  }

  // pointer drawing
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX ?? e.touches?.[0]?.clientX) - r.left;
    const y = (e.clientY ?? e.touches?.[0]?.clientY) - r.top;
    return { x, y };
  };

  const start = (e) => {
    e.preventDefault();
    drawing = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing) return;
    const { x, y } = pos(e);
    ctx.lineWidth = brush;
    if (mode === 'pen') { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#cfe0ff'; }
    else { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = 12; }
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => { if (!drawing) return; drawing = false; saveState(grid); };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);

  // touch fallback (au cas où)
  canvas.addEventListener('touchstart', start, { passive:false });
  canvas.addEventListener('touchmove', move, { passive:false });
  window.addEventListener('touchend', end);

  // toolbar actions
  root.querySelector('[data-act="pen"]').addEventListener('click', () => { mode = 'pen'; });
  root.querySelector('[data-act="eraser"]').addEventListener('click', () => { mode = 'eraser'; });
  root.querySelector('[data-act="clear"]').addEventListener('click', () => { ctx.clearRect(0,0,canvas.width,canvas.height); saveState(grid); });

  // delete widget
  close.addEventListener('click', (e) => { e.stopPropagation(); grid.removeWidget(itemEl); saveState(grid); });

  // sélection visuelle
  root.addEventListener('pointerdown', () => {
    document.querySelectorAll('.drawpad.is-selected').forEach(n => n.classList.remove('is-selected'));
    root.classList.add('is-selected');
  });
}
