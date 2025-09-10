import { DEFAULT_W, DEFAULT_H, TYPES } from './constants.js';

export function addDrawPad(grid, { x, y, w = DEFAULT_W+2, h = DEFAULT_H+2, image = null, id = null } = {}) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.dataset.type = TYPES.DRAW;
  el.dataset.id = id || crypto.randomUUID();

  // v11: set size/pos BEFORE makeWidget()
  if (w) el.setAttribute('gs-w', w);
  if (h) el.setAttribute('gs-h', h);
  if (x != null) el.setAttribute('gs-x', x);
  if (y != null) el.setAttribute('gs-y', y);

  el.innerHTML = `
    <div class="grid-stack-item-content drawpad">
      <div class="w-header">
        <span class="w-title">Bloc dessin</span>
        <div class="w-actions"><button class="w-close" title="Supprimer" type="button">×</button></div>
      </div>
      <canvas class="drawpad__canvas"></canvas>
      <div class="drawpad__toolbar">
        <button class="dp-btn" data-act="pen">✒️ Stylo</button>
        <button class="dp-btn" data-act="eraser">🧽 Gomme</button>
        <button class="dp-btn" data-act="clear">🗑️ Effacer</button>
      </div>
    </div>`;

  // v11: register the widget
  grid.el.appendChild(el);
  grid.makeWidget(el);

  const api = wireDrawInteractions(el, image);
  return { el, api };
}

export function createDrawFromNode(grid, node) {
  const { el } = addDrawPad(grid, {
    x: node.x, y: node.y, w: node.w, h: node.h,
    image: node.image || null, id: node?.id
  });
  return el;
}

export function drawpadSetImage(el, dataUrl) {
  const canvas = el.querySelector('canvas.drawpad__canvas');
  if (!canvas || !dataUrl) return;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    fitCanvas(canvas, false);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

function wireDrawInteractions(itemEl, imageDataURL) {
  const root   = itemEl.querySelector('.drawpad');
  const close  = root.querySelector('.w-close');
  const canvas = root.querySelector('canvas.drawpad__canvas');
  const ctx    = canvas.getContext('2d');

  let drawing = false;
  let mode = 'pen';
  let brush = 2;

  const ro = new ResizeObserver(() => fitCanvas(canvas, true));
  ro.observe(canvas);
  setTimeout(() => fitCanvas(canvas, false), 0);

  if (imageDataURL) {
    const img = new Image();
    img.onload = () => {
      fitCanvas(canvas, false);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = imageDataURL;
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX ?? e.touches?.[0]?.clientX) - r.left;
    const y = (e.clientY ?? e.touches?.[0]?.clientY) - r.top;
    return { x, y };
  };

  const start = (e) => { e.preventDefault(); drawing = true; const {x,y}=pos(e); ctx.beginPath(); ctx.moveTo(x,y); };
  const move  = (e) => {
    if (!drawing) return;
    const {x,y}=pos(e);
    ctx.lineWidth = brush;
    if (mode === 'pen') { ctx.globalCompositeOperation='source-over'; ctx.strokeStyle='#cfe0ff'; }
    else { ctx.globalCompositeOperation='destination-out'; ctx.strokeStyle='rgba(0,0,0,1)'; ctx.lineWidth=12; }
    ctx.lineTo(x,y); ctx.stroke();
  };
  const end   = () => { drawing = false; root.dispatchEvent(new CustomEvent('draw:end', { bubbles:true })); };

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  canvas.addEventListener('touchstart', start, {passive:false});
  canvas.addEventListener('touchmove', move, {passive:false});
  window.addEventListener('touchend', end);

  root.querySelector('[data-act="pen"]').addEventListener('click', () => mode='pen');
  root.querySelector('[data-act="eraser"]').addEventListener('click', () => mode='eraser');
  root.querySelector('[data-act="clear"]').addEventListener('click', () => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    root.dispatchEvent(new CustomEvent('draw:end', { bubbles:true }));
  });

  // notify removal
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    itemEl.remove();
    root.dispatchEvent(new CustomEvent('draw:remove', { bubbles:true }));
  });

  return { toDataURL: () => canvas.toDataURL('image/png') };
}

function fitCanvas(canvas, keep=true){
  const ctx = canvas.getContext('2d');
  const w = Math.floor(canvas.clientWidth);
  const h = Math.floor(canvas.clientHeight);
  if (w<=0 || h<=0) return;
  let snapshot = null;
  if (keep) snapshot = canvas.toDataURL('image/png');
  canvas.width = w; canvas.height = h;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (snapshot) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0,0,w,h);
    img.src = snapshot;
  }
}
