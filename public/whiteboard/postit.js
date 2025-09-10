// public/whiteboard/postit.js
(() => {
  'use strict';

  // Attendre que le DOM soit prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    const board = document.getElementById('board');
    if (!board) return; // sécurité si l'ID change

    const toolButtons = document.querySelectorAll('.tbtn[data-tool]');
    let activeTool = 'select';
    let zCounter = 1;
    let dragState = null; // { el, startX, startY, originLeft, originTop }

    // ----- Utils (déclarés en haut pour éviter no-use-before-define)
    function clamp(v, min, max) {
      return Math.min(Math.max(v, min), Math.max(min, max));
    }
    function bringFront(el) {
      zCounter += 1;
      el.style.zIndex = String(zCounter);
    }
    function selectNote(el) {
      document
        .querySelectorAll('.note.is-selected')
        .forEach((n) => n.classList.remove('is-selected'));
      if (el) el.classList.add('is-selected');
    }
    function placeCaretAtEnd(el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // ----- Outils
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTool = btn.dataset.tool || 'select';
        toolButtons.forEach((b) =>
          b.classList.toggle('is-active', b === btn)
        );
        board.focus();
      });
    });

    // ----- Création d’un post-it (outil note)
    board.addEventListener('pointerdown', (e) => {
      if (activeTool !== 'note') return;
      if (e.target !== board) return;

      const rect = board.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const note = createNote({
        left: x - 80,
        top: y - 20,
        text: 'Double-clique pour éditer ✍️',
      });
      board.appendChild(note);
      selectNote(note);

      // repasser en sélection
      activeTool = 'select';
      toolButtons.forEach((b) =>
        b.classList.toggle('is-active', (b.dataset.tool || '') === 'select')
      );
    });

    // ----- Fabrique un post-it
    function createNote(opts) {
      const left = typeof opts?.left === 'number' ? opts.left : 20;
      const top = typeof opts?.top === 'number' ? opts.top : 20;
      const text = typeof opts?.text === 'string' ? opts.text : '';

      const note = document.createElement('div');
      note.className = 'note';
      // attention à clientWidth/Height (camelCase correct)
      note.style.left =
        clamp(left, 0, board.clientWidth - 160 /* largeur min */) + 'px';
      note.style.top =
        clamp(top, 0, board.clientHeight - 120 /* hauteur min */) + 'px';
      bringFront(note);

      note.innerHTML = `
        <div class="note__header" role="button" aria-label="Déplacer le post-it">
          <span class="note__title">Post-it</span>
          <button class="note__close" type="button" title="Supprimer">×</button>
        </div>
        <div class="note__body" contenteditable="false"></div>
      `;

      const header = note.querySelector('.note__header');
      const body = note.querySelector('.note__body');
      const closeBtn = note.querySelector('.note__close');

      if (body) body.textContent = text;

      // drag via header
      if (header) {
        header.addEventListener('pointerdown', (e) => startDrag(e, note));
        // fallback souris/tactile si pointer non supporté
        header.addEventListener('mousedown', (e) => {
          if (!window.PointerEvent) startDrag(e, note);
        });
        header.addEventListener('touchstart', (e) => {
          if (!window.PointerEvent) {
            const t = e.touches[0];
            if (t) startDrag({ clientX: t.clientX, clientY: t.clientY, preventDefault(){} }, note);
          }
        });
      }

      // sélection
      note.addEventListener('pointerdown', () => {
        bringFront(note);
        selectNote(note);
      });

      // édition au double-clic
      note.addEventListener('dblclick', (e) => {
        if (e.target === body && body) {
          body.setAttribute('contenteditable', 'true');
          body.focus();
          placeCaretAtEnd(body);
        }
      });
      if (body) {
        body.addEventListener('blur', () => {
          body.setAttribute('contenteditable', 'false');
        });
      }

      // supprimer
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          note.remove();
        });
      }

      return note;
    }

    // ----- Drag logic
    function startDrag(e, el) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      dragState = {
        el,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: rect.left - boardRect.left,
        originTop: rect.top - boardRect.top,
      };
      el.classList.add('is-dragging');
      bringFront(el);

      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag, { once: true });

      // fallback
      if (!window.PointerEvent) {
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', endDrag, { once: true });
        window.addEventListener(
          'touchmove',
          (ev) => {
            const t = ev.touches[0];
            if (t) onDragMove({ clientX: t.clientX, clientY: t.clientY });
          },
          { passive: false }
        );
        window.addEventListener(
          'touchend',
          () => endDrag(),
          { once: true }
        );
      }
    }

    function onDragMove(e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      const w = dragState.el.offsetWidth;
      const h = dragState.el.offsetHeight;

      let nextLeft = dragState.originLeft + dx;
      let nextTop = dragState.originTop + dy;

      nextLeft = clamp(nextLeft, 0, board.clientWidth - w);
      nextTop = clamp(nextTop, 0, board.clientHeight - h);

      dragState.el.style.left = nextLeft + 'px';
      dragState.el.style.top = nextTop + 'px';
    }

    function endDrag() {
      if (!dragState) return;
      dragState.el.classList.remove('is-dragging');
      dragState = null;
      window.removeEventListener('pointermove', onDragMove);
      // fallbacks nettoyés automatiquement via {once:true} ou non ajoutés si PointerEvent
    }

    // ----- Clavier
    board.addEventListener('keydown', (e) => {
      const selected = document.querySelector('.note.is-selected');
      if (!selected) return;

      const active = document.activeElement;
      if (active && active.getAttribute('contenteditable') === 'true') return;

      const step = e.shiftKey ? 10 : 1;
      const left = parseInt(selected.style.left || '0', 10);
      const top = parseInt(selected.style.top || '0', 10);

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          selected.remove();
          e.preventDefault();
          break;
        case 'ArrowLeft':
          selected.style.left =
            clamp(left - step, 0, board.clientWidth - selected.offsetWidth) +
            'px';
          e.preventDefault();
          break;
        case 'ArrowRight':
          selected.style.left =
            clamp(left + step, 0, board.clientWidth - selected.offsetWidth) +
            'px';
          e.preventDefault();
          break;
        case 'ArrowUp':
          selected.style.top =
            clamp(top - step, 0, board.clientHeight - selected.offsetHeight) +
            'px';
          e.preventDefault();
          break;
        case 'ArrowDown':
          selected.style.top =
            clamp(top + step, 0, board.clientHeight - selected.offsetHeight) +
            'px';
          e.preventDefault();
          break;
        default:
          break;
      }
    });

    // ----- Désélection clic vide
    board.addEventListener('pointerdown', (e) => {
      if (e.target === board) selectNote(null);
    });

    // focus clavier
    board.addEventListener('pointerdown', () => board.focus());
  }
})();
