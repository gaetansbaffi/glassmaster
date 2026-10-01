/*
 * Glass Lab — machine d'états du mode Match infini (sans DOM, déterministe).
 *
 * Phases :
 *   incoming : la balle adverse vole, le joueur se déplace et peut frapper
 *   return   : la frappe est partie, la balle repart vers le camp adverse
 *   miss     : échange perdu, courte pause avant la balle suivante
 *
 * step(state, dt, input) renvoie un NOUVEL état (l'ancien n'est pas modifié) ;
 * state.events liste ce qui s'est passé pendant ce pas (nouvelle balle, frappe, échange perdu).
 * dt est en temps de jeu (la vitesse de jeu 50 / 75 / 100 % est appliquée par l'appelant).
 */

import P from './physics.js';
import G from './geometry.js';
import Q from './quality.js';
import SG from './shotgen.js';
import DEFAULT_CONFIG from './config.js';

const MISS_REASONS = {
  early: 'Trop tôt',
  late: 'Trop tard',
  far: 'Trop loin',
  notReached: 'Pas atteinte',
  weak: 'Frappe trop faible (filet)',
};

const NET_HEIGHT = 0.88;

/**
 * Nouvelle partie.
 * o = { seed, config?, level?, weights?, auto?, player? }
 */
function createRally(o) {
  const cfg = o.config || DEFAULT_CONFIG;
  const state = {
    seed: o.seed >>> 0,
    cfg,
    level: o.level || 1,
    weights: o.weights || null,
    auto: !!o.auto,
    index: 0,
    phase: 'incoming',
    t: 0,
    player: Object.assign({}, o.player || cfg.player.start),
    spawnPlayer: null,
    shot: null,
    pending: null,
    ret: null,
    pauseLeft: 0,
    opponent: { x: 5, y: 18 },
    nextServe: null,
    streak: 0,
    bestStreak: 0,
    balls: 0,
    hits: 0,
    last: null,
    events: [],
  };
  spawn(state);
  return state;
}

/** Point de départ d'un nouveau point (après une faute) : l'adversaire au fond de son camp. */
function servePoint(s, index) {
  const sv = s.cfg.rally.serve;
  const rng = P.mulberry32(SG.mixSeed(s.seed, index) ^ 0x1b873593);
  return { x: sv.x[0] + (sv.x[1] - sv.x[0]) * rng(), y: sv.y[0] + (sv.y[1] - sv.y[0]) * rng(), z: sv.z };
}

/** Position de l'adversaire pour frapper une balle en `p` : à distance de bras, côté centre du court. */
function opponentSpot(p, cfg) {
  const side = p.x > 5 ? -1 : 1;
  return { x: Math.max(0.4, Math.min(9.6, p.x + side * cfg.rally.oppReach)), y: Math.min(19.6, p.y + 0.15) };
}

/**
 * Lance la balle adverse suivante (graine dérivée du numéro de balle), frappée depuis `origin` :
 * l'endroit où l'adversaire a joué ton renvoi (échange continu) ou son point de service.
 */
function spawn(s, origin) {
  s.index++;
  const seed = SG.mixSeed(s.seed, s.index);
  const family = SG.pickFamily(s.weights, P.mulberry32(seed ^ 0x5f3759df));
  if (!origin) origin = servePoint(s, s.index);
  let shot;
  try {
    shot = SG.generateAny({ seed, family, level: s.level, player: s.player, config: s.cfg, origin });
  } catch (e) {
    // Aucune balle atteignable depuis ce point : l'adversaire rejoue depuis le fond (cas rare)
    shot = SG.generateAny({ seed, family, level: s.level, player: s.player, config: s.cfg });
  }
  shot.index = s.index;
  s.shot = shot;
  s.t = shot.tStart;
  s.spawnPlayer = Object.assign({}, s.player);
  s.pending = null;
  s.ret = null;
  s.phase = 'incoming';
  s.balls++;
  const hit = G.ballistic(shot.init, shot.tStart, shot.sim.params.g);
  s.opponent = opponentSpot(hit, s.cfg);
  s.events.push({ type: 'newBall', index: s.index, family: shot.family });
}

/**
 * Où et quand l'adversaire frappe ton renvoi : après le rebond dans son camp, quand la balle redescend
 * à la hauteur de frappe (ou à son sommet s'il est plus bas), au plus `oppStepIn` m après le rebond
 * (sur une balle courte, il avance), avant sa vitre de fond et ses parois.
 * Retourne { t (depuis ta frappe), point { x, y, z }, after (état juste après le rebond) }.
 */
function opponentHit(init, T, cfg) {
  const g = P.DEFAULT_PARAMS.g;
  const p = P.DEFAULT_PARAMS;
  const land = G.ballistic(init, T, g);
  const after = { x: land.x, y: land.y, z: p.radius, vx: land.vx * p.floorTangent, vy: land.vy * p.floorTangent, vz: -land.vz * p.eFloor };
  const h = cfg.rally.oppHitHeight;
  const apex = after.vz / g;
  const zApex = after.z + (after.vz * after.vz) / (2 * g);
  // Redescente à la hauteur h (racine la plus tardive), sinon le sommet
  let tau = zApex > h ? (after.vz + Math.sqrt(after.vz * after.vz - 2 * g * (h - after.z))) / g : apex;
  // Il avance sur une balle courte, et frappe avant sa vitre de fond et ses parois latérales
  if (after.vy > 0) tau = Math.min(tau, (Math.min(cfg.rally.oppMaxY, after.y + cfg.rally.oppStepIn) - after.y) / after.vy);
  if (after.vx > 0) tau = Math.min(tau, (9.7 - after.x) / after.vx);
  if (after.vx < 0) tau = Math.min(tau, (0.3 - after.x) / after.vx);
  tau = Math.max(0.05, tau);
  const b = G.ballistic(after, tau, g);
  return { t: T + tau, point: { x: b.x, y: b.y, z: Math.max(0.3, b.z) }, after };
}

/** L'adversaire se déplace vers sa position cible à vitesse bornée. */
function moveOpponent(s, target, dt) {
  const o = s.opponent;
  const dx = target.x - o.x;
  const dy = target.y - o.y;
  const d = Math.hypot(dx, dy);
  const step = s.cfg.rally.oppSpeed * dt;
  s.opponent = d <= step ? { x: target.x, y: target.y } : { x: o.x + (dx / d) * step, y: o.y + (dy / d) * step };
}

/** Renvoi automatique vers le camp adverse : plus la qualité est haute, plus il est profond. */
function computeReturn(contact, quality, rng, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const rc = cfg.returnShot;
  const g = P.DEFAULT_PARAMS.g;
  const r = P.DEFAULT_PARAMS.radius;
  const q = Math.max(0, Math.min(1, quality));
  const landing = {
    x: Math.max(0.8, Math.min(9.2, 5 + (rng() * 2 - 1) * rc.xSpread)),
    y: rc.shortY + (rc.deepY - rc.shortY) * q,
  };
  let T = rc.flightTime[0] + (rc.flightTime[1] - rc.flightTime[0]) * q;
  let init = null;
  let netZ = 0;
  for (let i = 0; i < 40; i++) {
    init = P.launchToBounce({ x: contact.x, y: contact.y, z: contact.z }, landing, T, { radius: r });
    const tn = (10 - init.y) / init.vy;
    netZ = init.z + init.vz * tn - 0.5 * g * tn * tn;
    if (netZ >= NET_HEIGHT + rc.netMargin) break;
    T += 0.08; // plus haut, plus lent, jusqu'à passer le filet
  }
  const hit = opponentHit(init, T, cfg);
  return { init, T, landing, netZ, hit };
}

/** Position de la balle affichée, quelle que soit la phase. */
function ballPosition(s) {
  if (s.phase === 'return' && s.ret) {
    const g = P.DEFAULT_PARAMS.g;
    const t = Math.min(s.ret.t, s.ret.hit.t);
    // Avant le rebond dans le camp adverse, puis après (jusqu'à la frappe de l'adversaire)
    return t < s.ret.T ? G.ballistic(s.ret.init, t, g) : G.ballistic(s.ret.hit.after, t - s.ret.T, g);
  }
  return Q.ballStateAt(s.shot, Math.min(s.t, s.shot.endT));
}

/** Instants (pas d'échantillonnage) où la balle est dans la zone de frappe du joueur. */
function zoneTimes(s, from, to, player) {
  const out = [];
  const dt = s.cfg.strike.sampleDt;
  for (let t = Math.max(from, s.shot.tStart); t < Math.min(to, s.shot.endT); t += dt) {
    if (Q.inZone(Q.ballStateAt(s.shot, t), player, s.cfg)) out.push(t);
  }
  return out;
}

function finishMiss(s, reason) {
  const best = s.shot.best;
  s.last = {
    outcome: 'miss',
    reason,
    reasonLabel: MISS_REASONS[reason],
    family: s.shot.family,
    index: s.index,
    t: s.t,
    player: Object.assign({}, s.player),
    bestType: best.bestType,
    bestQuality: best.best.quality,
    level: s.level,
  };
  s.streak = 0;
  s.phase = 'miss';
  s.pauseLeft = s.cfg.game.missPause;
  s.events.push({ type: 'miss', result: s.last });
}

function performHit(s, tc, pos) {
  const cfg = s.cfg;
  const shot = s.shot;
  const b = Q.ballStateAt(shot, tc);
  const margin = Q.timeMargin(shot, tc, s.spawnPlayer, pos, cfg);
  const q = Q.shotQuality(b, pos, { timeMargin: Math.max(0, margin) }, cfg);
  const best = shot.best;
  const chosenBest = best.byType[q.type];
  const result = {
    outcome: 'hit',
    family: shot.family,
    index: s.index,
    type: q.type,
    quality: q.score,
    parts: q.parts,
    placementError: q.placementError,
    corner: q.corner,
    contactT: tc,
    ball: b,
    player: Object.assign({}, pos),
    bestType: best.bestType,
    bestQuality: best.best.quality,
    // Décision juste : le type choisi permettait (presque) la meilleure qualité possible
    decisionOk: !!chosenBest && chosenBest.quality >= best.best.quality - cfg.quality.decisionTolerance,
    level: s.level,
  };
  s.pending = null;
  if (q.score < cfg.quality.minReturn) {
    s.t = tc;
    finishMiss(s, 'weak');
    Object.assign(s.last, { type: result.type, quality: result.quality, contactT: tc, ball: b, placementError: result.placementError });
    return;
  }
  s.hits++;
  s.streak = q.score >= cfg.quality.streak ? s.streak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  result.streak = s.streak;
  s.ret = Object.assign({ t: 0 }, computeReturn(b, q.score, P.mulberry32(SG.mixSeed(s.seed, s.index) ^ 0x2545f491), cfg));
  result.returnLanding = s.ret.landing;
  s.last = result;
  s.t = tc;
  s.phase = 'return';
  s.events.push({ type: 'hit', result });
}

/** Appui sur « Frappe » à l'instant tp. */
function press(s, tp) {
  const tol = s.cfg.strike.timingTolerance;
  const times = zoneTimes(s, tp - tol, tp + tol, s.player);
  if (times.length) {
    let tc = times[0];
    for (const t of times) if (Math.abs(t - tp) < Math.abs(tc - tp)) tc = t;
    if (tc <= s.t) performHit(s, tc, s.player);
    else s.pending = { t: tc, player: Object.assign({}, s.player), pressT: tp };
    return;
  }
  // Hors zone : pourquoi ?
  const all = zoneTimes(s, s.shot.tStart, s.shot.endT, s.player);
  if (all.some((t) => t > tp + tol)) finishMiss(s, 'early');
  else if (all.some((t) => t < tp - tol)) finishMiss(s, 'late');
  else finishMiss(s, 'far');
}

function movePlayer(s, move, dt) {
  if (!move || (!move.x && !move.y) || s.pending) return;
  const l = Math.hypot(move.x, move.y);
  const k = l > 1 ? 1 / l : 1;
  const B = s.cfg.player.bounds;
  const step = s.cfg.player.speed * dt * k;
  s.player = {
    x: Math.max(B.xMin, Math.min(B.xMax, s.player.x + move.x * step)),
    y: Math.max(B.yMin, Math.min(B.yMax, s.player.y + move.y * step)),
  };
}

/**
 * Avance l'échange de dt secondes de jeu.
 * input = { move: { x, y } (repère monde, norme ≤ 1), strike: booléen (appui sur « Frappe ») }
 */
function step(state, dt, input) {
  const s = Object.assign({}, state, { events: [] });
  input = input || {};
  const cfg = s.cfg;
  movePlayer(s, input.move, dt);

  if (s.phase === 'return') {
    // Échange continu : l'adversaire court vers ta balle et la renvoie depuis l'endroit où il la frappe
    s.ret = Object.assign({}, s.ret, { t: s.ret.t + dt });
    moveOpponent(s, opponentSpot(s.ret.hit.point, cfg), dt);
    if (s.ret.t >= s.ret.hit.t) spawn(s, s.ret.hit.point);
    return s;
  }
  if (s.phase === 'miss') {
    // Point perdu : l'adversaire se replace au fond pour servir le point suivant ; ton joueur reste où il est
    s.pauseLeft -= dt;
    if (!s.nextServe) s.nextServe = servePoint(s, s.index + 1);
    moveOpponent(s, opponentSpot(s.nextServe, cfg), dt);
    if (s.pauseLeft <= 0) {
      const origin = s.nextServe;
      s.nextServe = null;
      spawn(s, origin);
    }
    return s;
  }

  // incoming
  const t0 = s.t;
  s.t = t0 + dt;
  if (s.pending) {
    if (s.t >= s.pending.t) performHit(s, s.pending.t, s.pending.player);
    return s;
  }
  if (input.strike) {
    press(s, s.t);
    return s;
  }
  if (s.auto && s.t >= s.shot.tStart + cfg.player.reactionTime) {
    // Frappe automatique : premier passage de la balle dans la zone pendant ce pas
    const times = zoneTimes(s, Math.max(t0, s.shot.tStart + cfg.player.reactionTime), s.t + 1e-9, s.player);
    if (times.length) {
      performHit(s, times[0], s.player);
      return s;
    }
  }
  if (s.t >= s.shot.endT) {
    s.t = s.shot.endT;
    finishMiss(s, 'notReached'); // 2e rebond au sol
    return s;
  }
  // Balle directe (sans vitre) déjà passée derrière le joueur après son rebond : elle est perdue
  const b = Q.ballStateAt(s.shot, s.t);
  const reach = cfg.zones.beforeGlass.reach;
  if (s.shot.family === 'direct' && b.floorBounces >= 1 && b.vy < 0 && b.y < s.player.y - reach - 0.3) {
    finishMiss(s, 'notReached');
  }
  return s;
}

/** Mise à jour des poids de familles (répétition espacée) et du niveau, sans muter l'état. */
function withSettings(state, patch) {
  return Object.assign({}, state, patch);
}

const Rally = {
  MISS_REASONS,
  createRally,
  step,
  computeReturn,
  ballPosition,
  zoneTimes,
  withSettings,
};

export default Rally;
