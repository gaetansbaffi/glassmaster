/*
 * Glass Lab — génération des balles adverses du mode Match infini.
 * Échantillonnage par rejet, déterministe pour une graine donnée, sans DOM.
 *
 * Une balle retenue doit :
 *   (a) suivre la séquence de contacts de sa famille,
 *   (b) retomber dans la moitié du joueur,
 *   (c) être atteignable : au moins un type de coup atteint la qualité de jouabilité
 *       (config.quality.playable) dans le temps disponible, depuis la position du joueur.
 */

import P from './physics.js';
import G from './geometry.js';
import Q from './quality.js';
import DEFAULT_CONFIG from './config.js';

const FAMILIES = {
  direct: { id: 'direct', name: 'Directe', short: 'Directe' },
  A: { id: 'A', name: 'Vitre de fond', short: 'Fond' },
  B: { id: 'B', name: 'Fond puis latérale (double vitre)', short: 'Fond → lat.' },
  C: { id: 'C', name: 'Latérale puis fond (double vitre inversée)', short: 'Lat. → fond' },
  D: { id: 'D', name: 'Latérale seule croisée', short: 'Latérale' },
};
const FAMILY_IDS = ['direct', 'A', 'B', 'C', 'D'];

/** Séquences de contacts attendues (sol = 1er et dernier contact). */
const SEQUENCES = {
  direct: [['floor', 'floor']],
  A: [['floor', 'back', 'floor']],
  B: [['floor', 'back', 'left', 'floor'], ['floor', 'back', 'right', 'floor']],
  C: [['floor', 'left', 'back', 'floor'], ['floor', 'right', 'back', 'floor']],
  D: [['floor', 'left', 'floor'], ['floor', 'right', 'floor']],
};

function matchesFamily(sim, family) {
  const seq = P.contactSequence(sim).join(',');
  return SEQUENCES[family].some((s) => s.join(',') === seq);
}

/** Graine dérivée (balle n° i d'une partie, tirage n° j…), bien mélangée. */
function mixSeed(seed, i) {
  return (P.mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)() * 4294967296) >>> 0;
}

/** Tirage pondéré d'une famille. weights = { famille: poids > 0 } (familles absentes : poids 1). */
function pickFamily(weights, rng) {
  const w = FAMILY_IDS.map((f) => Math.max(0, weights && weights[f] != null ? weights[f] : 1));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let r = rng() * total;
  for (let i = 0; i < FAMILY_IDS.length; i++) {
    r -= w[i];
    if (r <= 0) return FAMILY_IDS[i];
  }
  return FAMILY_IDS[FAMILY_IDS.length - 1];
}

const lerp = (a, b, k) => a + (b - a) * k;

/** Balle directe : rebond court puis 2e rebond avant toute vitre. */
function directCandidate(seed, level, cfg) {
  const rng = P.mulberry32(seed);
  const d = cfg.shotgen.direct;
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const rnd = (a) => lerp(a[0], a[1], rng());
  const T = rnd([lerp(d.T[0][0], d.T[1][0], k), lerp(d.T[0][1], d.T[1][1], k)]);
  const yb = rnd(d.yb);
  const xb = rnd([1.5, 8.5]);
  const angle = (rnd(d.angle) * (1 + k) * Math.PI) / 180;
  const x0 = xb - (10 - yb) * Math.tan(angle);
  if (x0 < 0.3 || x0 > 9.7) return null;
  const init = P.launchToBounce({ x: x0, y: 10, z: rnd(d.z0) }, { x: xb, y: yb }, T);
  return { init, sim: P.simulate(init, { maxFloorBounces: 2, tMax: 6 }) };
}

/** Contrôles de vraisemblance d'une balle à vitres. */
function glassPlausible(sim, family) {
  if (sim.endReason !== 'floor' || P.classify(sim) !== family) return false;
  const walls = sim.contacts.filter((c) => c.type !== 'floor');
  const floors = sim.contacts.filter((c) => c.type === 'floor');
  if (!walls.every(P.onGlass)) return false; // contacts sur les parties vitrées seulement
  // Au moins 0,6 m de hauteur après la dernière paroi pour que la balle reste jouable
  const lastWall = walls[walls.length - 1];
  let maxZ = 0;
  for (const s of P.sample(sim, 1 / 60, lastWall.t, floors[1].t)) maxZ = Math.max(maxZ, s.z);
  if (maxZ < 0.6) return false;
  if (floors[1].pos.y < 0.5) return false; // retombe à au moins 0,5 m de la vitre de fond
  let apex = 0;
  for (const s of P.sample(sim, 1 / 30, 0, floors[0].t)) apex = Math.max(apex, s.z);
  return apex < 3.5; // pas de chandelle irréaliste
}

/** Balle à vitres (familles A à D) : un tirage de paramètres de lancer, côté gauche ou droit. */
function glassCandidate(family, seed, level, cfg) {
  const rng = P.mulberry32(seed);
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const r = cfg.shotgen.glass[family];
  const between = (pair) => [lerp(pair[0][0], pair[1][0], k), lerp(pair[0][1], pair[1][1], k)];
  const rnd = (a) => lerp(a[0], a[1], rng());
  const right = rng() < 0.5;
  const T = rnd(between(cfg.shotgen.glassT));
  let xb = rnd(r.xb);
  const yb = rnd(r.yb);
  const angle = (rnd(between(r.angle)) * Math.PI) / 180;
  const z0 = rnd(r.z0);
  let x0 = xb - (10 - yb) * Math.tan(angle);
  if (!right) {
    xb = 10 - xb;
    x0 = 10 - x0;
  }
  if (x0 < 0.3 || x0 > 9.7) return null;
  const init = P.launchToBounce({ x: x0, y: 10, z: z0 }, { x: xb, y: yb }, T);
  const sim = P.simulate(init, { maxFloorBounces: 2, tMax: 6 });
  return glassPlausible(sim, family) ? { init, sim } : null;
}

/**
 * Balle frappée depuis un point imposé `origin` (camp adverse) : c'est l'échange continu, l'adversaire
 * renvoie depuis l'endroit où il a joué ta balle. Le point de rebond suit les plages de la famille ;
 * la vitesse dépend du niveau, et augmente si l'adversaire frappe près du filet (attaque).
 * Retourne { init (état au passage du filet, t = 0), sim, tStart (< 0 : instant de la frappe) } ou null.
 */
function originCandidate(family, seed, level, origin, cfg) {
  const rng = P.mulberry32(seed);
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const rc = cfg.rally;
  const rnd = (a) => lerp(a[0], a[1], rng());
  const right = rng() < 0.5;
  let xb;
  let yb;
  if (family === 'direct') {
    xb = rnd([1.5, 8.5]);
    yb = rnd(cfg.shotgen.direct.yb);
  } else {
    const r = cfg.shotgen.glass[family];
    xb = rnd(r.xb);
    yb = rnd(r.yb);
    if (!right) xb = 10 - xb;
  }
  // Hauteur au-dessus du filet : plus basse quand le niveau monte, et quand l'adversaire frappe près du
  // filet (renvoi court = attaque). La durée de vol s'en déduit exactement (passage par le filet à
  // cette hauteur et rebond au point visé) : z(f·T) = z0 + (r − z0)·f + g·T²·f(1 − f)/2.
  const attack = Math.max(0, Math.min(1, (17 - origin.y) / 5));
  const hr = [lerp(rc.netHeight[0][0], rc.netHeight[1][0], k), lerp(rc.netHeight[0][1], rc.netHeight[1][1], k)];
  const hNet = Math.max(rc.minNetHeight, rnd(hr) - rc.attackDrop * attack);
  const r0 = P.DEFAULT_PARAMS.radius;
  const g = P.DEFAULT_PARAMS.g;
  const f = (origin.y - 10) / (origin.y - yb); // fraction du trajet horizontal parcourue au filet
  if (!(f > 0 && f < 1)) return null;
  const T2 = (2 * (hNet - origin.z - (r0 - origin.z) * f)) / (g * f * (1 - f));
  if (!(T2 > 0)) return null;
  const T = Math.sqrt(T2);
  const vh = Math.hypot(xb - origin.x, yb - origin.y) / T;
  if (vh < rc.hSpeed[0] || vh > rc.hSpeed[1]) return null;
  const st = P.launchToBounce(origin, { x: xb, y: yb }, T);
  const tn = f * T; // instant du passage au-dessus du filet
  const net = G.ballistic(st, tn, g);
  if (net.x < 0.2 || net.x > 9.8) return null;
  const init = { x: net.x, y: 10, z: net.z, vx: net.vx, vy: net.vy, vz: net.vz };
  const sim = P.simulate(init, { maxFloorBounces: 2, tMax: 6 });
  if (family === 'direct' ? sim.endReason !== 'floor' : !glassPlausible(sim, family)) return null;
  return { init, sim, tStart: -tn };
}

/**
 * Génère une balle adverse.
 * o = { seed, family, level (1–5), player: { x, y } (position au moment de la frappe adverse), config?,
 *       origin? : { x, y, z } point de frappe adverse imposé (échange continu) }
 * Retourne { family, seed, level, init, sim, tStart, endT, best, attempts }.
 * tStart (< 0) : instant de la frappe adverse, avant le passage du filet (t = 0).
 */
function generateShot(o) {
  const cfg = o.config || DEFAULT_CONFIG;
  const level = Math.max(1, Math.min(cfg.shotgen.levels, o.level || 1));
  const player = o.player || cfg.player.start;
  for (let attempt = 0; attempt < cfg.shotgen.maxAttempts; attempt++) {
    const sub = mixSeed(o.seed, attempt);
    const cand = o.origin
      ? originCandidate(o.family, sub, level, o.origin, cfg)
      : o.family === 'direct'
        ? directCandidate(sub, level, cfg)
        : glassCandidate(o.family, sub, level, cfg);
    if (!cand) continue;
    const { init, sim } = cand;
    if (sim.endReason !== 'floor' || !matchesFamily(sim, o.family)) continue; // (a)
    const f1 = sim.contacts[0].pos;
    const f2 = sim.contacts[sim.contacts.length - 1].pos;
    if (!(f1.y > 0 && f1.y < 10 && f2.y > 0 && f2.y < 10)) continue; // (b)
    const tStart = cand.tStart != null ? cand.tStart : -G.preNetDuration(init, sim.params.g);
    const shot = { family: o.family, seed: o.seed, level, init, sim, tStart, endT: sim.endT, origin: o.origin || null };
    const best = Q.bestChoice(shot, player, cfg);
    if (!best.best || best.best.quality < cfg.quality.playable) continue; // (c)
    shot.best = best;
    shot.attempts = attempt + 1;
    return shot;
  }
  return null;
}

/**
 * Génère une balle en essayant d'abord la famille demandée, puis les autres (dans l'ordre),
 * pour ne jamais bloquer la partie si une famille est injouable depuis la position du joueur.
 */
function generateAny(o) {
  // Repli : les autres familles dans un ordre pseudo-aléatoire (reproductible), pour ne pas favoriser l'une d'elles
  const others = FAMILY_IDS.filter((f) => f !== o.family);
  const key = (f) => mixSeed(o.seed ^ 0x68e31da4, FAMILY_IDS.indexOf(f));
  const order = [o.family].concat(others.sort((a, b) => key(a) - key(b)));
  for (const family of order) {
    const shot = generateShot(Object.assign({}, o, { family }));
    if (shot) return shot;
  }
  throw new Error('Aucune balle atteignable (graine ' + o.seed + ')');
}

/** Séquence déterministe de n balles (joueur immobile) : utile pour les tests et le débogage. */
function sequence(seed, n, o) {
  o = o || {};
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = mixSeed(seed, 1000 + i);
    const family = pickFamily(o.weights, P.mulberry32(s));
    out.push(generateAny({ seed: s, family, level: o.level || 1, player: o.player, config: o.config }));
  }
  return out;
}

const ShotGen = {
  FAMILIES,
  FAMILY_IDS,
  SEQUENCES,
  matchesFamily,
  mixSeed,
  pickFamily,
  generateShot,
  generateAny,
  sequence,
};

export default ShotGen;
