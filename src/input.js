/*
 * Glass Lab — entrées : joystick virtuel dynamique (multi-touch), bouton Frappe, clavier.
 *
 * Mobile : le joystick apparaît là où le pouce se pose dans la moitié gauche (droite en mode gaucher) ;
 * le bouton Frappe est un élément séparé, donc les deux se pilotent en même temps (pointerId distincts).
 * PC : ZQSD / WASD / flèches, Espace = Frappe, Échap = Pause, F = plein écran. Pas de capture de souris.
 * Le calcul du vecteur (zone morte, courbe, normalisation) est la fonction pure G.joystickVector.
 */
import G from './core/geometry.js';

const MOVE_KEYS = /^(Arrow(Up|Down|Left|Right)|Key[WASD])$/;

export function createInput(opts) {
  const touch = opts.touchLayer; // calque plein écran sous l'interface
  const strikeBtn = opts.strikeButton;
  const handlers = { pause: [], fullscreen: [], activity: [] };
  const emit = (name) => handlers[name].forEach((fn) => fn());

  const cfg = { lefty: false, sensitivity: 1, enabled: false };
  const keys = new Set();
  let strikeQueued = false;

  /* ----- Joystick dynamique ----- */

  const base = document.createElement('div');
  base.className = 'joy-base ghost';
  base.innerHTML = '<div class="joy-knob"></div>';
  base.setAttribute('aria-hidden', 'true');
  touch.appendChild(base);
  const knob = base.firstChild;
  const joy = { id: null, ox: 0, oy: 0, vec: { x: 0, y: 0 } };

  function radius() {
    return Math.max(48, Math.min(80, Math.min(window.innerWidth, window.innerHeight) * 0.13));
  }

  /** Joystick au repos : fantôme discret à sa place par défaut (positionné en CSS). */
  function placeGhost() {
    const r = radius();
    base.style.width = base.style.height = 2 * r + 'px';
    base.style.left = base.style.top = base.style.right = '';
    base.classList.add('ghost');
    base.classList.toggle('right', cfg.lefty);
  }

  function inMoveZone(x) {
    const half = window.innerWidth / 2;
    return cfg.lefty ? x >= half : x < half;
  }

  touch.addEventListener('pointerdown', (e) => {
    if (!cfg.enabled || joy.id !== null || !inMoveZone(e.clientX)) return;
    e.preventDefault();
    joy.id = e.pointerId;
    joy.ox = e.clientX;
    joy.oy = e.clientY;
    const r = radius();
    base.classList.remove('ghost', 'right');
    base.style.width = base.style.height = 2 * r + 'px';
    base.style.left = joy.ox - r + 'px';
    base.style.top = joy.oy - r + 'px';
    knob.style.transform = 'translate(-50%, -50%)';
    try {
      touch.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignoré */
    }
    emit('activity');
  });

  touch.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joy.id) return;
    const r = radius();
    const dx = e.clientX - joy.ox;
    const dy = e.clientY - joy.oy;
    joy.vec = G.joystickVector(dx, dy, r, { deadZone: 0.15, curve: 1.5, sensitivity: cfg.sensitivity });
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, r / l);
    knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
  });

  function releaseJoy(e) {
    if (e && e.pointerId !== joy.id) return;
    joy.id = null;
    joy.vec = { x: 0, y: 0 };
    knob.style.transform = 'translate(-50%, -50%)';
    placeGhost();
  }
  touch.addEventListener('pointerup', releaseJoy);
  touch.addEventListener('pointercancel', releaseJoy);
  touch.addEventListener('lostpointercapture', releaseJoy);

  /* ----- Bouton Frappe ----- */

  strikeBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!cfg.enabled) return;
    strikeQueued = true;
    strikeBtn.classList.add('pressed');
    emit('activity');
  });
  const unpress = () => strikeBtn.classList.remove('pressed');
  strikeBtn.addEventListener('pointerup', unpress);
  strikeBtn.addEventListener('pointercancel', unpress);
  strikeBtn.addEventListener('pointerleave', unpress);
  strikeBtn.addEventListener('click', (e) => e.preventDefault());

  /* ----- Clavier ----- */

  window.addEventListener('keydown', (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      return emit('pause');
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      return emit('fullscreen');
    }
    if (!cfg.enabled) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) {
        strikeQueued = true;
        strikeBtn.classList.add('pressed');
        setTimeout(unpress, 120);
      }
      return;
    }
    if (MOVE_KEYS.test(e.code)) {
      e.preventDefault();
      keys.add(e.code);
      emit('activity');
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    releaseJoy();
  });

  placeGhost();
  window.addEventListener('resize', () => joy.id === null && placeGhost());

  return {
    /** Entrée de déplacement relative au regard : x = pas de côté, y = avancer (norme ≤ 1). */
    moveVector() {
      if (!cfg.enabled) return { x: 0, y: 0 };
      const k = G.keyboardVector(keys);
      const x = k.x + joy.vec.x;
      const y = k.y + joy.vec.y;
      const l = Math.hypot(x, y);
      return l > 1 ? { x: x / l, y: y / l } : { x, y };
    },
    /** Vrai une seule fois par appui sur Frappe. */
    consumeStrike() {
      const s = strikeQueued;
      strikeQueued = false;
      return s;
    },
    setEnabled(on) {
      cfg.enabled = !!on;
      strikeQueued = false;
      keys.clear();
      releaseJoy();
    },
    setLefty(on) {
      cfg.lefty = !!on;
      document.documentElement.classList.toggle('lefty', cfg.lefty);
      placeGhost();
    },
    setSensitivity(s) {
      cfg.sensitivity = s;
    },
    on(name, fn) {
      handlers[name].push(fn);
    },
  };
}
