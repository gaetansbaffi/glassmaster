/*
 * Glass Lab — classification des coups, qualité de frappe et meilleur choix (mode Match infini).
 * Fonctions pures et déterministes, sans DOM. Constantes dans config.js.
 *
 * Une « balle » (shot) est l'objet produit par shotgen.js : { init, sim, tStart, endT, family, ... }.
 * Repère monde de physics.js : x largeur, y profondeur (0 = vitre de fond du joueur, 10 = filet), z hauteur.
 */
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const P = node ? require('./physics.js') : root.GlassPhysics;
  const G = node ? require('./geometry.js') : root.GlassGeometry;
  const DEFAULT_CONFIG = node ? require('./config.js') : root.GlassConfig;

  const SHOT_TYPES = ['volley', 'halfVolley', 'beforeGlass', 'afterGlass'];
  const SHOT_NAMES = {
    volley: 'Volée',
    halfVolley: 'Demi-volée',
    beforeGlass: 'Avant vitre',
    afterGlass: 'Après vitre',
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /** Score trapézoïdal : 1 dans [a, b], décroît linéairement jusqu'à 0 en z0 (gauche) et z1 (droite). */
  function trapezoid(v, z0, a, b, z1) {
    if (v >= a && v <= b) return 1;
    if (v < a) return a === z0 ? 0 : clamp01((v - z0) / (a - z0));
    return b === z1 ? 0 : clamp01((z1 - v) / (z1 - b));
  }

  /**
   * État de la balle à l'instant t, enrichi de l'historique des contacts :
   * { t, x, y, z, vx, vy, vz, floorBounces, wallHits, tSinceBounce }.
   * t < 0 : vol côté adverse, avant le filet (trajectoire remontée analytiquement).
   */
  function ballStateAt(shot, t) {
    const g = shot.sim.params.g;
    const s = t < 0 ? G.ballistic(shot.init, t, g) : P.stateAt(shot.sim, t);
    let floorBounces = 0;
    let wallHits = 0;
    let lastFloorT = null;
    for (const c of shot.sim.contacts) {
      if (c.t > t) break;
      if (c.type === 'floor') {
        floorBounces++;
        lastFloorT = c.t;
      } else wallHits++;
    }
    return Object.assign({ t, floorBounces, wallHits, tSinceBounce: lastFloorT == null ? null : t - lastFloorT }, s);
  }

  /**
   * Type de coup selon l'état de la balle au contact :
   *   volley      : aucun rebond au sol
   *   afterGlass  : au moins un contact avec une paroi
   *   halfVolley  : juste après le rebond (≤ ~150 ms), balle basse (< 0,4 m) et montante
   *   beforeGlass : au moins un rebond, aucune paroi
   */
  function classifyShot(b, cfg) {
    const c = (cfg || DEFAULT_CONFIG).classify;
    if (!b.floorBounces) return 'volley';
    if (b.wallHits > 0) return 'afterGlass';
    if (b.tSinceBounce != null && b.tSinceBounce <= c.halfVolleyWindow && b.z < c.halfVolleyMaxZ && b.vz > 0) return 'halfVolley';
    return 'beforeGlass';
  }

  /** La balle est-elle frappable depuis la position du joueur (hauteur et portée du type de coup) ? */
  function inZone(b, player, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    if (b.floorBounces >= 2) return false;
    const type = classifyShot(b, cfg);
    const z = cfg.zones[type];
    if (b.z < z.zMin || b.z > z.zMax) return false;
    return Math.hypot(b.x - player.x, b.y - player.y) <= z.reach;
  }

  /* ---------- Qualité ---------- */

  /** Hauteur : 1 dans la fenêtre idéale du type de coup, 0 aux limites de la zone. */
  function heightScore(type, z, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const zn = cfg.zones[type];
    return trapezoid(z, zn.zMin, zn.ideal[0], zn.ideal[1], zn.zMax);
  }

  /**
   * Placement : le joueur doit être derrière la ligne de la balle (balle devant lui, côté filet),
   * pas en dessous, à distance de bras latéralement.
   * Retourne { score, error } — error = distance (m) à la plage de placement idéale.
   */
  function placementScore(b, player, type, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const pc = cfg.placement;
    const ahead = b.y - player.y;
    const lateral = Math.abs(b.x - player.x);
    const reach = cfg.zones[type].reach;
    const sa = trapezoid(ahead, pc.aheadZero[0], pc.ahead[0], pc.ahead[1], pc.aheadZero[1]);
    const sl = trapezoid(lateral, pc.lateralZero, pc.lateral[0], pc.lateral[1], reach);
    const ea = ahead < pc.ahead[0] ? pc.ahead[0] - ahead : ahead > pc.ahead[1] ? ahead - pc.ahead[1] : 0;
    const el = lateral < pc.lateral[0] ? pc.lateral[0] - lateral : lateral > pc.lateral[1] ? lateral - pc.lateral[1] : 0;
    return { score: sa * sl, error: Math.hypot(ea, el), ahead, lateral };
  }

  /** Aisance : marge de temps (s) et vitesse de la balle au contact (plus lente = mieux). */
  function easeScore(b, timeMargin, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const e = cfg.ease;
    const m = clamp01((timeMargin || 0) / e.marginFull);
    const v = P.speed(b);
    const sv = clamp01(1 - (v - e.speedEasy) / (e.speedHard - e.speedEasy));
    return 0.5 * (m + sv);
  }

  /** Dégagement : distance de la balle aux parois au point de frappe ; un coin est pénalisé. */
  function clearanceScore(b, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const c = cfg.clearance;
    const dBack = b.y;
    const dSide = Math.min(b.x, 10 - b.x);
    const d = Math.min(dBack, dSide);
    let s = clamp01((d - c.min) / (c.full - c.min));
    if (dBack < c.full && dSide < c.full) s *= c.cornerPenalty;
    return { score: s, dist: d, corner: dBack < c.full && dSide < c.full };
  }

  /**
   * Qualité d'une frappe (0 à 1). ctx = { timeMargin } (s).
   * Retourne { score, type, parts: { height, placement, ease, clearance }, placementError, corner }.
   */
  function shotQuality(b, player, ctx, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const type = classifyShot(b, cfg);
    const w = cfg.quality.weights;
    const pl = placementScore(b, player, type, cfg);
    const cl = clearanceScore(b, cfg);
    const parts = {
      height: heightScore(type, b.z, cfg),
      placement: pl.score,
      ease: easeScore(b, ctx && ctx.timeMargin, cfg),
      clearance: cl.score,
    };
    const score = w.height * parts.height + w.placement * parts.placement + w.ease * parts.ease + w.clearance * parts.clearance;
    return { score, type, parts, placementError: pl.error, corner: cl.corner, clearance: cl.dist };
  }

  /* ---------- Meilleur choix ---------- */

  /** Position idéale du joueur pour frapper une balle en b, du côté le plus proche de `from`. */
  function idealPosition(b, from, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const o = cfg.placement.idealOffset;
    const B = cfg.player.bounds;
    const cand = [-1, 1].map((sgn) => ({
      x: Math.max(B.xMin, Math.min(B.xMax, b.x + sgn * o.lateral)),
      y: Math.max(B.yMin, Math.min(B.yMax, b.y - o.ahead)),
    }));
    const d = (p) => Math.hypot(p.x - from.x, p.y - from.y);
    return d(cand[0]) <= d(cand[1]) ? cand[0] : cand[1];
  }

  /** Marge de temps : temps disponible depuis la frappe adverse, moins réaction et trajet. */
  function timeMargin(shot, t, from, to, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const travel = Math.hypot(to.x - from.x, to.y - from.y) / cfg.player.speed;
    return t - shot.tStart - cfg.player.reactionTime - travel;
  }

  /**
   * Meilleur point de frappe atteignable pour chaque type de coup, par échantillonnage de la trajectoire.
   * from = position du joueur au moment de la frappe adverse.
   * Retourne { byType: { type: { quality, t, ball, pos, margin } | null }, bestType, best }.
   */
  function bestChoice(shot, from, cfg) {
    cfg = cfg || DEFAULT_CONFIG;
    const dt = cfg.strike.sampleDt;
    const byType = { volley: null, halfVolley: null, beforeGlass: null, afterGlass: null };
    const t0 = shot.tStart + cfg.player.reactionTime;
    for (let t = t0; t < shot.endT; t += dt) {
      const b = ballStateAt(shot, t);
      if (b.floorBounces >= 2) break;
      const type = classifyShot(b, cfg);
      const zn = cfg.zones[type];
      if (b.z < zn.zMin || b.z > zn.zMax) continue;
      const pos = idealPosition(b, from, cfg);
      if (Math.hypot(b.x - pos.x, b.y - pos.y) > zn.reach) continue;
      const margin = timeMargin(shot, t, from, pos, cfg);
      if (margin < 0) continue; // pas atteignable à temps
      const q = shotQuality(b, pos, { timeMargin: margin }, cfg);
      if (!byType[type] || q.score > byType[type].quality) byType[type] = { quality: q.score, t, ball: b, pos, margin, detail: q };
    }
    let bestType = null;
    for (const k of SHOT_TYPES) if (byType[k] && (!bestType || byType[k].quality > byType[bestType].quality)) bestType = k;
    return { byType, bestType, best: bestType ? byType[bestType] : null };
  }

  const Quality = {
    SHOT_TYPES,
    SHOT_NAMES,
    trapezoid,
    ballStateAt,
    classifyShot,
    inZone,
    heightScore,
    placementScore,
    easeScore,
    clearanceScore,
    shotQuality,
    idealPosition,
    timeMargin,
    bestChoice,
  };

  if (node) module.exports = Quality;
  else root.GlassQuality = Quality;
})(typeof self !== 'undefined' ? self : this);
