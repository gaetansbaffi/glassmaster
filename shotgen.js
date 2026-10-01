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
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const P = node ? require('./physics.js') : root.GlassPhysics;
  const G = node ? require('./geometry.js') : root.GlassGeometry;
  const S = node ? require('./scenarios.js') : root.GlassScenarios;
  const Q = node ? require('./quality.js') : root.GlassQuality;
  const DEFAULT_CONFIG = node ? require('./config.js') : root.GlassConfig;

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

  /** Balle à vitres : on réutilise le générateur des scénarios (familles A à D). */
  function glassCandidate(family, seed, level) {
    try {
      const sc = S.generate({ family, level, seed });
      return { init: sc.init, sim: sc.sim };
    } catch (e) {
      return null;
    }
  }

  /**
   * Génère une balle adverse.
   * o = { seed, family, level (1–5), player: { x, y } (position au moment de la frappe adverse), config? }
   * Retourne { family, seed, level, init, sim, tStart, endT, best, attempts }.
   * tStart (< 0) : instant de la frappe adverse, avant le passage du filet (t = 0).
   */
  function generateShot(o) {
    const cfg = o.config || DEFAULT_CONFIG;
    const level = Math.max(1, Math.min(cfg.shotgen.levels, o.level || 1));
    const player = o.player || cfg.player.start;
    for (let attempt = 0; attempt < cfg.shotgen.maxAttempts; attempt++) {
      const sub = mixSeed(o.seed, attempt);
      const cand = o.family === 'direct' ? directCandidate(sub, level, cfg) : glassCandidate(o.family, sub, level);
      if (!cand) continue;
      const { init, sim } = cand;
      if (sim.endReason !== 'floor' || !matchesFamily(sim, o.family)) continue; // (a)
      const f1 = sim.contacts[0].pos;
      const f2 = sim.contacts[sim.contacts.length - 1].pos;
      if (!(f1.y > 0 && f1.y < 10 && f2.y > 0 && f2.y < 10)) continue; // (b)
      const shot = { family: o.family, seed: o.seed, level, init, sim, tStart: -G.preNetDuration(init, sim.params.g), endT: sim.endT };
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
    const order = [o.family].concat(FAMILY_IDS.filter((f) => f !== o.family));
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

  if (node) module.exports = ShotGen;
  else root.GlassShotGen = ShotGen;
})(typeof self !== 'undefined' ? self : this);
