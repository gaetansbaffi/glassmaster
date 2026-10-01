/*
 * Glass Lab — point d'entrée : boucle de jeu, caméra, plein écran.
 *
 * La physique avance à pas fixe (120 Hz de temps de jeu) indépendamment du rendu ;
 * la position affichée est interpolée entre les deux derniers pas.
 */
import CFG from './core/config.js';
import G from './core/geometry.js';
import P from './core/physics.js';
import R from './core/rally.js';
import { createRenderer, webglAvailable } from './render.js';

const STEP = 1 / 120; // pas de physique (s de jeu)
const MAX_STEPS = 12; // au plus 0,1 s de rattrapage par image

const canvas = document.getElementById('game');

/* ---------- Plein écran, orientation, veille ---------- */

export const device = {
  async fullscreen(on) {
    try {
      const el = document.documentElement;
      const isOn = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (on === undefined) on = !isOn;
      if (on && !isOn) await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
      else if (!on && isOn) await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen());
    } catch (e) {
      /* refusé ou indisponible (iOS Safari) : le manifeste PWA prend le relais */
    }
  },
  async lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) {
      /* verrouillage impossible hors plein écran ou non supporté : le portrait reste jouable */
    }
  },
  wakeLock: null,
  async keepAwake(on) {
    try {
      if (on && !device.wakeLock && navigator.wakeLock) {
        device.wakeLock = await navigator.wakeLock.request('screen');
        device.wakeLock.addEventListener('release', () => (device.wakeLock = null));
      } else if (!on && device.wakeLock) {
        await device.wakeLock.release();
        device.wakeLock = null;
      }
    } catch (e) {
      device.wakeLock = null;
    }
  },
};

/* ---------- Jeu ---------- */

const game = {
  state: 'idle', // idle | playing | paused
  cur: null, // état de l'échange au dernier pas
  prev: null, // état au pas précédent (interpolation)
  acc: 0,
  speed: 1,
  strike: false,
  move: { x: 0, y: 0 },
  look: { yaw: 0, pitch: -0.05 },
  lookReady: false,
  reducedMotion: false,
  listeners: [], // abonnés aux événements de l'échange (HUD, audio, stats)
};

export function onRallyEvent(fn) {
  game.listeners.push(fn);
}

/** Caméra : suit la balle en douceur, amplitude et vitesse bornées (option « réduire les mouvements »). */
function cameraOptions() {
  return game.reducedMotion
    ? { halfLife: 0.35, maxYaw: 1.3, pitchMin: -0.3, pitchMax: 0.35, maxSpeed: 1.6 }
    : { halfLife: 0.14, maxYaw: 2.7, pitchMin: -0.5, pitchMax: 0.6, maxSpeed: 4 };
}

let renderer = null;
const ballPos = { x: 0, y: 0, z: 0 };
const view = {
  ball: null,
  player: { x: 5, y: 3 },
  cam: { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, topDown: false },
  fov: 70,
  path: 'off',
  pathT: 0,
  best: null,
  mine: null,
  reach: null,
  showPlayer: false,
};

function shotSamples(shot) {
  const out = [];
  const g = shot.sim.params.g;
  for (let t = shot.tStart; t < 0; t += 1 / 60) out.push(Object.assign({ t }, G.ballistic(shot.init, t, g)));
  for (const s of P.sample(shot.sim, 1 / 90)) out.push(s);
  return out;
}

function onNewBall(shot) {
  const hit = G.ballistic(shot.init, shot.tStart, shot.sim.params.g);
  renderer.setShot(shotSamples(shot), hit);
}

export function startGame(opts) {
  opts = opts || {};
  const seed = opts.seed != null ? opts.seed : (Math.random() * 4294967296) >>> 0;
  game.cur = game.prev = R.createRally({ seed, player: CFG.player.start, level: opts.level || 1, weights: opts.weights || null, auto: !!opts.auto });
  game.acc = 0;
  game.lookReady = false;
  game.state = 'playing';
  onNewBall(game.cur.shot);
  for (const fn of game.listeners) for (const e of game.cur.events) fn(e, game.cur);
  device.keepAwake(true);
}

export function setPaused(p) {
  if (game.state === 'idle') return;
  game.state = p ? 'paused' : 'playing';
  device.keepAwake(!p);
}

function stepGame(dtReal) {
  game.acc += dtReal * game.speed;
  let n = 0;
  while (game.acc >= STEP && n < MAX_STEPS) {
    game.prev = game.cur;
    game.cur = R.step(game.cur, STEP, { move: game.move, strike: game.strike });
    game.strike = false;
    for (const e of game.cur.events) {
      if (e.type === 'newBall') onNewBall(game.cur.shot);
      for (const fn of game.listeners) fn(e, game.cur, game.prev);
    }
    game.acc -= STEP;
    n++;
  }
  if (n === MAX_STEPS) game.acc = 0; // trop de retard (onglet ralenti) : on ne rattrape pas
}

/** Position interpolée entre le pas précédent et le pas courant (sauf changement de balle ou de phase). */
function interpolatedBall(alpha, out) {
  const a = R.ballPosition(game.cur);
  if (game.prev.shot !== game.cur.shot || game.prev.phase !== game.cur.phase) {
    out.x = a.x;
    out.y = a.y;
    out.z = a.z;
    return out;
  }
  const b = R.ballPosition(game.prev);
  out.x = b.x + (a.x - b.x) * alpha;
  out.y = b.y + (a.y - b.y) * alpha;
  out.z = b.z + (a.z - b.z) * alpha;
  return out;
}

function updateCamera(dt, aspect) {
  const p = view.player;
  const eye = G.eyePosition(p, game.look.yaw);
  const b = view.ball;
  // Vise la balle (relevée à 0,5 m minimum pour garder l'horizon), ou le filet sans balle
  const target = b ? { x: b.x, y: b.y, z: Math.max(b.z, 0.5) } : { x: 5, y: 12, z: 1 };
  const want = G.lookAngles(eye, target);
  if (!game.lookReady) {
    game.look = G.cameraStep({ yaw: want.yaw, pitch: want.pitch }, want, 0, cameraOptions());
    game.lookReady = true;
  } else game.look = G.cameraStep(game.look, want, dt, cameraOptions());
  const dir = G.dirFromAngles(game.look.yaw, game.look.pitch);
  const e2 = G.eyePosition(p, game.look.yaw);
  const c = view.cam;
  c.px = e2.x;
  c.py = e2.y;
  c.pz = e2.z;
  c.tx = e2.x + dir.x;
  c.ty = e2.y + dir.y;
  c.tz = e2.z + dir.z;
  c.topDown = false;
  // Paysage prioritaire ; en portrait le champ vertical s'élargit pour garder ~75° en horizontal
  view.fov = G.verticalFov(75, aspect, 40, 95);
}

/* ---------- Taille d'écran ---------- */

const screenSize = { w: 1, h: 1 };

function measure() {
  const vv = window.visualViewport;
  screenSize.w = Math.round(vv ? vv.width : window.innerWidth);
  screenSize.h = Math.round(vv ? vv.height : window.innerHeight);
  if (renderer) renderer.resize(screenSize.w, screenSize.h);
  document.documentElement.classList.toggle('portrait', screenSize.h > screenSize.w);
}

export function aspect() {
  return screenSize.w / screenSize.h;
}

/* ---------- Boucle ---------- */

let last = 0;
let rafId = 0;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  if (game.moveInput) game.move = G.cameraRelativeMove(game.moveInput(), game.look.yaw);
  if (game.state === 'playing') stepGame(dt);
  if (game.cur) {
    const alpha = game.acc / STEP;
    view.ball = interpolatedBall(alpha, ballPos);
    const pa = game.prev.player;
    const pb = game.cur.player;
    view.player.x = pa.x + (pb.x - pa.x) * alpha;
    view.player.y = pa.y + (pb.y - pa.y) * alpha;
  } else view.ball = null;
  updateCamera(dt, aspect());
  renderer.update(view);
  renderer.render();
}

function startLoop() {
  if (rafId) return;
  last = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ---------- Démarrage ---------- */

function fatal(msg) {
  const el = document.getElementById('fatal');
  if (msg) document.getElementById('fatalText').textContent = msg;
  el.hidden = false;
}

function boot() {
  if (!webglAvailable()) return fatal();
  try {
    renderer = createRenderer(canvas, { antialias: (window.devicePixelRatio || 1) < 1.5 });
  } catch (e) {
    return fatal('Impossible de démarrer le rendu 3D (' + e.message + ').');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', measure);
  // Pas de zoom ni de menu contextuel involontaires
  for (const ev of ['contextmenu', 'gesturestart', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop(); // rendu suspendu en arrière-plan
      setPaused(true);
    } else startLoop();
  });

  // Provisoire (étape 3) : clavier minimal et lancement direct ; contrôles et écrans arrivent ensuite
  const keys = new Set();
  game.moveInput = () => G.keyboardVector(keys);
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') game.strike = true;
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  startGame();
  startLoop();
}

boot();
