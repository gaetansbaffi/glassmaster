/*
 * Glass Lab — point d'entrée : écrans, boucle de jeu, caméra, plein écran.
 *
 * La physique avance à pas fixe (120 Hz de temps de jeu) indépendamment du rendu ;
 * la position affichée est interpolée entre les deux derniers pas.
 */
import CFG from './core/config.js';
import G from './core/geometry.js';
import P from './core/physics.js';
import Q from './core/quality.js';
import R from './core/rally.js';
import Stats from './core/stats.js';
import { createRenderer, webglAvailable } from './render.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { loadState, saveState, exportState, importStateFile, storageAvailable } from './storage.js';

const STEP = 1 / 120; // pas de physique (s de jeu)
const MAX_STEPS = 12; // au plus 0,1 s de rattrapage par image
const TOAST_MS = 1500;
const REPLAY_SPEED = 0.4;

const canvas = document.getElementById('game');
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

/* ---------- Plein écran, orientation, veille ---------- */

const device = {
  isTouch: (() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      return false;
    }
  })(),
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
  wantAwake: false,
  async keepAwake(on) {
    device.wantAwake = on;
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

/* ---------- État ---------- */

let save = loadState();
const settings = () => save.settings;

const game = {
  screen: 'home', // home | playing | paused | detail
  cur: null, // état de l'échange au dernier pas
  prev: null, // état au pas précédent (interpolation)
  acc: 0,
  strike: false,
  move: { x: 0, y: 0 },
  look: { yaw: 0, pitch: -0.05 },
  lookReady: false,
  session: 0,
  lastError: null, // { shot, result } : pour le Détail
  replay: null, // { shot, result, t, cam, auto }
  firstBallSeen: false,
};

let renderer = null;
let input = null;
let hud = null;
const audio = createAudio();

/* ---------- Vue (objets réutilisés d'une image à l'autre) ---------- */

const ballPos = { x: 0, y: 0, z: 0 };
const bestMarker = { bx: 0, by: 0, bz: 0, px: 0, py: 0 };
const mineMarker = { bx: 0, by: 0, bz: 0 };
const reachMarker = { x: 0, y: 0 };
const view = {
  ball: null,
  player: { x: 5, y: 3 },
  cam: { px: 5, py: 1, pz: 1.7, tx: 5, ty: 12, tz: 1, topDown: false },
  fov: 70,
  path: 'off',
  pathT: 0,
  best: null,
  mine: null,
  reach: null,
  showPlayer: false,
  viewShift: 0,
  viewShiftY: 0,
};

/** Caméra : suit la balle en douceur, amplitude et vitesse bornées (option « réduire les mouvements »). */
function cameraOptions() {
  return settings().reduceMotion
    ? { halfLife: 0.35, maxYaw: 1.3, pitchMin: -0.3, pitchMax: 0.35, maxSpeed: 1.6 }
    : { halfLife: 0.14, maxYaw: 2.7, pitchMin: -0.5, pitchMax: 0.6, maxSpeed: 4 };
}

function shotSamples(shot) {
  const out = [];
  const g = shot.sim.params.g;
  for (let t = shot.tStart; t < 0; t += 1 / 60) out.push(Object.assign({ t }, G.ballistic(shot.init, t, g)));
  for (const s of P.sample(shot.sim, 1 / 90)) out.push(s);
  return out;
}

function showShot(shot) {
  renderer.setShot(shotSamples(shot), G.ballistic(shot.init, shot.tStart, shot.sim.params.g));
}

/* ---------- Partie ---------- */

function startGame() {
  const s = settings();
  const seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : (Math.random() * 4294967296) >>> 0;
  game.session = Date.now();
  game.cur = game.prev = R.createRally({
    seed,
    player: CFG.player.start,
    level: save.level,
    weights: Stats.familyWeights(save.balls),
    auto: s.auto,
  });
  game.acc = 0;
  game.lookReady = false;
  game.lastError = null;
  game.firstBallSeen = false;
  showShot(game.cur.shot);
  hud.setStreak(0);
  hud.hideToast();
  setScreen('playing');
  if (!save.guideDone) hud.guideShow(0);
  if (device.isTouch && window.innerHeight > window.innerWidth) {
    hud.setHint(true);
    setTimeout(() => hud.setHint(false), 4500);
  }
}

function setScreen(name) {
  game.screen = name;
  const playing = name === 'playing';
  $('ui').hidden = !(playing || name === 'paused');
  $('detail').hidden = name !== 'detail';
  input.setEnabled(playing);
  device.keepAwake(playing || name === 'detail');
  if (name === 'home') hud.show('home');
  else if (name === 'paused') {
    hud.renderSummary(Stats.sessionSummary(save.balls, game.session));
    $('lastDetailBtn').hidden = !game.lastError;
    hud.show('pause');
  } else hud.show(null);
}

function pause() {
  if (game.screen === 'playing') setScreen('paused');
}

function resume() {
  if (game.screen === 'paused' || game.screen === 'detail') {
    if (game.replay) showShot(game.cur.shot);
    game.replay = null;
    setScreen('playing');
  }
}

function quit() {
  game.cur = game.prev = null;
  game.replay = null;
  hud.hideToast();
  setScreen('home');
}

/* ---------- Événements de l'échange ---------- */

function applyRallySettings() {
  if (!game.cur) return;
  const patch = { auto: settings().auto, weights: Stats.familyWeights(save.balls), level: save.level };
  game.cur = R.withSettings(game.cur, patch);
  game.prev = R.withSettings(game.prev, patch);
}

function onBallResult(r, shot) {
  const ball = {
    ts: Date.now(),
    session: game.session,
    family: r.family,
    outcome: r.outcome,
    reason: r.reason,
    type: r.type,
    quality: typeof r.quality === 'number' ? Math.round(r.quality * 1000) / 1000 : undefined,
    bestType: r.bestType,
    bestQuality: Math.round(r.bestQuality * 1000) / 1000,
    decisionOk: r.outcome === 'hit' ? r.decisionOk : undefined,
    placementError: typeof r.placementError === 'number' ? Math.round(r.placementError * 100) / 100 : undefined,
    level: r.level,
    streak: game.cur.streak,
    speed: settings().speed,
    auto: settings().auto,
  };
  save = Stats.recordBall(save, ball, CFG.difficulty).state;
  saveState(save);
  applyRallySettings();
  hud.setStreak(game.cur.streak);

  const error = r.outcome === 'miss' || r.quality < CFG.quality.ok;
  if (error) game.lastError = { shot, result: r };
  hud.showToast(r, CFG, TOAST_MS, error);
  if (hud.guideStep === 0 || hud.guideStep === 1) hud.guideShow(2);
  if (r.outcome === 'miss' && settings().autoReplay) startReplay(shot, r, true);
}

function onRallyEvent(e) {
  if (e.type === 'newBall') {
    audio.hit(0.35); // frappe adverse
    return showShot(game.cur.shot);
  }
  if (e.type === 'hit') {
    audio.hit(0.6 + 0.4 * e.result.quality);
    audio.buzz(18);
    setTimeout(() => audio.success(e.result.quality), 60);
  } else if (e.type === 'miss') {
    if (e.result.reason === 'weak') audio.hit(0.4);
    audio.miss();
    audio.buzz([30, 40, 30]);
  }
  if (e.type === 'hit' || e.type === 'miss') onBallResult(e.result, game.cur.shot);
}

function stepGame(dtReal) {
  game.acc += dtReal * settings().speed;
  let n = 0;
  while (game.acc >= STEP && n < MAX_STEPS) {
    game.prev = game.cur;
    game.cur = R.step(game.cur, STEP, { move: game.move, strike: game.strike });
    game.strike = false;
    contactSounds(game.prev, game.cur);
    for (const e of game.cur.events) onRallyEvent(e);
    game.acc -= STEP;
    n++;
    if (game.screen !== 'playing') break; // replay automatique lancé : on fige l'échange
  }
  if (n === MAX_STEPS) game.acc = 0; // trop de retard (onglet ralenti) : on ne rattrape pas
  // Guide n° 2 : quand la première balle approche du joueur
  if (!game.firstBallSeen && game.cur.phase === 'incoming' && game.cur.t > 0) {
    game.firstBallSeen = true;
    if (!save.guideDone) hud.guideShow(1);
  }
}

/* ---------- Sons des contacts ---------- */

/** Joue les sons des rebonds (sol, vitres) franchis pendant le dernier pas de physique. */
function contactSounds(a, b) {
  if (a.shot !== b.shot) return;
  if (a.phase === 'incoming') {
    const p = b.player;
    for (const c of b.shot.sim.contacts) {
      if (c.t <= a.t || c.t > b.t) continue;
      // Plus fort si la balle est rapide et proche du joueur
      const dist = Math.hypot(c.pos.x - p.x, c.pos.y - p.y);
      const k = Math.min(1, P.speed(c.vIn) / 18) * Math.max(0.35, 1 - dist / 12);
      if (c.type === 'floor') audio.floor(k);
      else audio.glass(k);
    }
  } else if (a.phase === 'return' && a.ret && b.ret && a.ret.t < a.ret.T && b.ret.t >= b.ret.T) {
    audio.floor(0.25); // rebond du renvoi dans le camp adverse
  }
}

/* ---------- Détail : replay au ralenti ---------- */

function startReplay(shot, result, auto) {
  game.replay = { shot, result, t: shot.tStart, cam: auto ? 'top' : 'fp', auto };
  hud.setCamButtons(game.replay.cam);
  showShot(shot);
  if (auto) {
    // Replay automatique : sans panneau ni bouton, l'échange reprend tout seul à la fin
    game.screen = 'detail';
    input.setEnabled(false);
  } else {
    hud.renderDetail(shot, result, CFG);
    hud.hideToast();
    setScreen('detail');
  }
}

function stepReplay(dt) {
  const rp = game.replay;
  rp.t = Math.min(rp.shot.endT, rp.t + dt * REPLAY_SPEED);
  if (rp.auto && rp.t >= rp.shot.endT) {
    game.replay = null;
    showShot(game.cur.shot);
    setScreen('playing');
  }
}

function replayView(dt, aspect) {
  const rp = game.replay;
  // Panneau du Détail à droite en paysage : l'image est recentrée sur la partie libre de l'écran
  view.viewShift = !rp.auto && aspect > 1 ? 0.2 : 0;
  view.viewShiftY = !rp.auto && aspect <= 1 ? 0.22 : 0; // en portrait, panneau en bas
  const b = Q.ballStateAt(rp.shot, rp.t);
  ballPos.x = b.x;
  ballPos.y = b.y;
  ballPos.z = b.z;
  view.ball = ballPos;
  view.path = 'upTo';
  view.pathT = rp.t;
  const r = rp.result;
  const best = rp.shot.best.best;
  Object.assign(bestMarker, { bx: best.ball.x, by: best.ball.y, bz: best.ball.z, px: best.pos.x, py: best.pos.y });
  view.best = bestMarker;
  if (r.ball) {
    Object.assign(mineMarker, { bx: r.ball.x, by: r.ball.y, bz: r.ball.z });
    view.mine = mineMarker;
  } else view.mine = null;
  reachMarker.x = r.player.x;
  reachMarker.y = r.player.y;
  view.reach = reachMarker;
  view.player.x = r.player.x;
  view.player.y = r.player.y;
  view.showPlayer = rp.cam !== 'fp';
  if (rp.cam === 'fp') return followCamera(dt, aspect);
  const c = view.cam;
  if (rp.cam === 'top') {
    const dist = 16;
    const half = 5.9;
    Object.assign(c, { px: 5, py: 5, pz: dist, tx: 5, ty: 5, tz: 0, topDown: true });
    view.fov = (2 * Math.atan(Math.max(half, half / aspect) / dist) * 180) / Math.PI;
  } else {
    Object.assign(c, { px: 19, py: 5, pz: 1.6, tx: 5, ty: 5, tz: 1.4, topDown: false });
    view.fov = G.verticalFov(48, aspect, 20, 90);
  }
}

/* ---------- Caméra et vue de jeu ---------- */

function followCamera(dt, aspect) {
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
  Object.assign(view.cam, { px: e2.x, py: e2.y, pz: e2.z, tx: e2.x + dir.x, ty: e2.y + dir.y, tz: e2.z + dir.z, topDown: false });
  // Paysage prioritaire ; en portrait le champ vertical s'élargit pour garder ~75° en horizontal
  view.fov = G.verticalFov(75, aspect, 40, 95);
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

function gameView(dt, aspect) {
  view.viewShift = 0;
  view.viewShiftY = 0;
  view.showPlayer = false;
  view.mine = null;
  view.reach = null;
  if (!game.cur) {
    // Accueil : court vide, regard vers le filet
    view.ball = null;
    view.best = null;
    view.path = 'off';
    view.player.x = 5;
    view.player.y = 2.2;
    return followCamera(dt, aspect);
  }
  const alpha = game.acc / STEP;
  view.ball = interpolatedBall(alpha, ballPos);
  const pa = game.prev.player;
  const pb = game.cur.player;
  view.player.x = pa.x + (pb.x - pa.x) * alpha;
  view.player.y = pa.y + (pb.y - pa.y) * alpha;
  const s = settings();
  const phase = game.cur.phase;
  view.path = s.showPath && phase === 'incoming' ? 'full' : 'off';
  // Meilleur point de frappe de la balle qui vient d'être jouée (pendant le renvoi ou la pause)
  if (s.showBest && phase !== 'incoming' && game.cur.shot.best.best) {
    const best = game.cur.shot.best.best;
    Object.assign(bestMarker, { bx: best.ball.x, by: best.ball.y, bz: best.ball.z, px: best.pos.x, py: best.pos.y });
    view.best = bestMarker;
  } else view.best = null;
  followCamera(dt, aspect);
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

/* ---------- Performance : résolution dynamique et compteur ---------- */

const perf = {
  maxPr: Math.min(window.devicePixelRatio || 1, 2), // pixel ratio plafonné à 2
  pr: 0, // fixé au démarrage par applySettings()
  fps: 60,
  low: 0, // durée cumulée sous 50 i/s
  high: 0, // durée cumulée au-dessus de 58 i/s
  debug: params.get('debug') === '1',
  shown: 0,
};

function setPixelRatio(pr) {
  perf.pr = pr;
  renderer.setPixelRatio(pr);
}

/** Qualité « auto » : baisse la résolution si < 50 i/s pendant 2 s, la remonte si stable (≥ 58 i/s, 4 s). */
function adaptResolution(dt) {
  perf.fps += (1 / Math.max(dt, 1e-3) - perf.fps) * 0.1;
  if (settings().quality !== 'auto') return;
  if (perf.fps < 50) {
    perf.low += dt;
    perf.high = 0;
    if (perf.low > 2) {
      perf.low = 0;
      if (perf.pr > 0.6) setPixelRatio(Math.max(0.6, +(perf.pr * 0.85).toFixed(2)));
    }
  } else if (perf.fps >= 58) {
    perf.high += dt;
    perf.low = 0;
    if (perf.high > 4) {
      perf.high = 0;
      if (perf.pr < perf.maxPr) setPixelRatio(Math.min(perf.maxPr, +(perf.pr * 1.1).toFixed(2)));
    }
  } else perf.low = perf.high = 0;
}

function showFps(now) {
  if (!perf.debug || now - perf.shown < 500) return;
  perf.shown = now;
  const info = renderer.renderer.info.render;
  $('fps').textContent = `${Math.round(perf.fps)} i/s · résolution ×${perf.pr.toFixed(2)} · ${info.calls} appels · ${info.triangles} triangles`;
}

/* ---------- Boucle ---------- */

let last = 0;
let rafId = 0;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  const aspect = screenSize.w / screenSize.h;
  if (game.screen === 'playing') {
    game.move = G.cameraRelativeMove(input.moveVector(), game.look.yaw);
    if (input.consumeStrike()) game.strike = true;
    stepGame(dt);
  }
  if (game.replay) {
    stepReplay(dt);
    if (game.replay) replayView(dt, aspect);
    else gameView(dt, aspect);
  } else gameView(dt, aspect);
  renderer.update(view);
  renderer.render();
  adaptResolution(dt);
  showFps(now);
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

/* ---------- Réglages ---------- */

function applySettings() {
  const s = settings();
  input.setLefty(s.lefty);
  input.setSensitivity(s.sensitivity);
  audio.setEnabled(s.sound);
  audio.setVibration(s.vibration);
  if (s.quality === 'low') setPixelRatio(Math.min(1, perf.maxPr));
  else if (s.quality === 'normal' || !perf.pr || perf.pr > perf.maxPr) setPixelRatio(perf.maxPr);
  applyRallySettings();
}

function changeSetting(key, value) {
  save = Object.assign({}, save, { settings: Object.assign({}, save.settings, { [key]: value }) });
  saveState(save);
  applySettings();
}

/* ---------- Écrans : branchements ---------- */

function wireUi() {
  $('playBtn').addEventListener('click', () => {
    if (device.isTouch) device.fullscreen(true).then(() => device.lockLandscape());
    startGame();
  });
  $('pauseBtn').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    pause();
  });
  $('resumeBtn').addEventListener('click', resume);
  $('quitBtn').addEventListener('click', quit);
  $('lastDetailBtn').addEventListener('click', () => game.lastError && startReplay(game.lastError.shot, game.lastError.result, false));
  $('toastDetail').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (game.lastError) startReplay(game.lastError.shot, game.lastError.result, false);
  });
  $('detailResumeBtn').addEventListener('click', resume);
  $('replayAgainBtn').addEventListener('click', () => game.replay && (game.replay.t = game.replay.shot.tStart));
  document.querySelectorAll('.cam-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (!game.replay) return;
      game.replay.cam = b.dataset.cam;
      hud.setCamButtons(b.dataset.cam);
    })
  );
  document.querySelectorAll('.fs-btn').forEach((b) => b.addEventListener('click', () => device.fullscreen()));
  document.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      const from = game.screen === 'home' ? 'home' : 'pause';
      if (b.dataset.open === 'settings') hud.renderSettings(settings(), changeSetting);
      else hud.renderStats(save);
      hud.openSub(b.dataset.open, from);
    })
  );
  document.querySelectorAll('.back-btn').forEach((b) => b.addEventListener('click', () => hud.back()));

  // Données
  $('exportBtn').addEventListener('click', () => {
    exportState(save);
    hud.dataMessage('Sauvegarde exportée.');
  });
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    importStateFile(file)
      .then((st) => {
        save = st;
        saveState(save);
        applySettings();
        hud.renderSettings(settings(), changeSetting);
        hud.dataMessage(`Import réussi : ${save.balls.length} balles.`);
      })
      .catch((err) => hud.dataMessage('Import impossible : ' + err.message));
  });
  $('resetBtn').addEventListener('click', () => {
    if (!window.confirm('Effacer toute la progression et les réglages ? (pense à exporter avant)')) return;
    save = Stats.createState(DEFAULT_SETTINGS);
    saveState(save);
    applySettings();
    hud.renderSettings(settings(), changeSetting);
    hud.dataMessage('Progression effacée.');
  });
  if (!storageAvailable) hud.dataMessage('Stockage indisponible (navigation privée ?) : la progression ne sera pas conservée.');

  input.on('pause', () => {
    if (game.screen === 'playing') pause();
    else if (game.screen === 'paused') resume();
  });
  input.on('fullscreen', () => device.fullscreen());
  input.on('activity', () => hud.guideStep === 0 && hud.guideHide(0));
  hud.onGuideDone(() => {
    save = Object.assign({}, save, { guideDone: true });
    saveState(save);
  });
}

/* ---------- Démarrage ---------- */

function fatal(msg) {
  if (msg) $('fatalText').textContent = msg;
  $('fatal').hidden = false;
}

function boot() {
  if (!webglAvailable()) return fatal();
  try {
    renderer = createRenderer(canvas, { antialias: (window.devicePixelRatio || 1) < 1.5 });
  } catch (e) {
    return fatal('Impossible de démarrer le rendu 3D (' + e.message + ').');
  }
  input = createInput({ touchLayer: $('touch'), strikeButton: $('strikeBtn') });
  hud = createHud();
  measure();
  applySettings();
  wireUi();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', measure);
  // Pas de zoom ni de menu contextuel involontaires
  for (const ev of ['contextmenu', 'gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!e.target.closest || !e.target.closest('.scroll, .detail-sheet')) e.preventDefault();
    },
    { passive: false }
  );
  // Pause automatique quand l'onglet perd le focus ; rendu suspendu en arrière-plan
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
      stopLoop();
      audio.suspend();
    } else {
      startLoop();
      audio.unlock();
      if (device.wantAwake) device.keepAwake(true); // le verrou de veille est perdu en arrière-plan
    }
  });
  window.addEventListener('blur', pause);
  // L'audio ne peut démarrer qu'après un geste de l'utilisateur
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
  $('fps').hidden = !perf.debug;
  setScreen('home');
  startLoop();
  registerServiceWorker();
}

/** PWA : service worker (hors ligne après le premier chargement), seulement en HTTPS ou en local. */
function registerServiceWorker() {
  try {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || local) && !params.has('nosw')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (e) {
    /* ignoré */
  }
}

boot();
