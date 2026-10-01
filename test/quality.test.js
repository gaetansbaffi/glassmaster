/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import CFG from '../src/core/config.js';
import Q from '../src/core/quality.js';
import R from '../src/core/rally.js';
import SG from '../src/core/shotgen.js';
import { makeShot, botInput } from './helpers.js';

section('Classification, qualité et meilleur choix');

test('config : poids de qualité de somme 1, zones cohérentes', () => {
  const w = CFG.quality.weights;
  near(w.height + w.placement + w.ease + w.clearance, 1, 1e-12);
  for (const k of Q.SHOT_TYPES) {
    const z = CFG.zones[k];
    assert(z.zMin < z.ideal[0] && z.ideal[0] < z.ideal[1] && z.ideal[1] < z.zMax && z.reach > 0, k);
  }
  near(CFG.strike.timingTolerance, 0.25, 0);
});

test('classifyShot : volée, demi-volée, avant vitre, après vitre sur des états de référence', () => {
  const base = { x: 5, y: 3, vx: 0, vy: -5 };
  assert(Q.classifyShot(Object.assign({ z: 1.2, vz: -1, floorBounces: 0, wallHits: 0, tSinceBounce: null }, base)) === 'volley');
  assert(Q.classifyShot(Object.assign({ z: 0.2, vz: 2.5, floorBounces: 1, wallHits: 0, tSinceBounce: 0.08 }, base)) === 'halfVolley');
  assert(Q.classifyShot(Object.assign({ z: 0.2, vz: 2.5, floorBounces: 1, wallHits: 0, tSinceBounce: 0.3 }, base)) === 'beforeGlass', 'trop tard pour une demi-volée');
  assert(Q.classifyShot(Object.assign({ z: 0.6, vz: 2.5, floorBounces: 1, wallHits: 0, tSinceBounce: 0.1 }, base)) === 'beforeGlass', 'trop haute pour une demi-volée');
  assert(Q.classifyShot(Object.assign({ z: 0.2, vz: -2, floorBounces: 1, wallHits: 0, tSinceBounce: 0.1 }, base)) === 'beforeGlass', 'descendante');
  assert(Q.classifyShot(Object.assign({ z: 1.0, vz: -1, floorBounces: 1, wallHits: 0, tSinceBounce: 0.5 }, base)) === 'beforeGlass');
  assert(Q.classifyShot(Object.assign({ z: 1.0, vz: -1, floorBounces: 1, wallHits: 1, tSinceBounce: 0.5 }, base)) === 'afterGlass');
  assert(Q.classifyShot(Object.assign({ z: 1.0, vz: -1, floorBounces: 1, wallHits: 2, tSinceBounce: 0.7 }, base)) === 'afterGlass', 'double vitre');
});

test('classifyShot sur une vraie trajectoire : volée avant le rebond, après vitre après la paroi', () => {
  const shot = makeShot({ x: 5.6, y: 10, z: 1.6 }, { x: 5.6, y: 1.2 }, 1.0);
  const floor = shot.sim.contacts[0];
  const wall = shot.sim.contacts[1];
  assert(Q.classifyShot(Q.ballStateAt(shot, floor.t - 0.1)) === 'volley');
  assert(Q.classifyShot(Q.ballStateAt(shot, wall.t + 0.2)) === 'afterGlass');
  assert(Q.classifyShot(Q.ballStateAt(shot, -0.05)) === 'volley', 'côté adverse, avant le filet');
});

test('qualité monotone : mieux placé = score plus élevé', () => {
  const b = { x: 5, y: 3, z: 1.1, vx: 0, vy: -6, vz: -1, floorBounces: 1, wallHits: 1, tSinceBounce: 0.5 };
  const ctx = { timeMargin: 1 };
  const q = (p) => Q.shotQuality(b, p, ctx).score;
  // Latéralement : à distance de bras > trop loin > beaucoup trop loin
  const lat = [0.65, 0.95, 1.1, 1.25].map((d) => q({ x: 5 - d, y: 2.8 }));
  for (let i = 1; i < lat.length; i++) assert(lat[i] < lat[i - 1], 'latéral ' + lat.join(' > '));
  // Sous la balle = moins bien qu'à côté
  assert(q({ x: 5.05, y: 2.8 }) < lat[0], 'sous la balle');
  // Devant la balle (la balle derrière le joueur) = moins bien que derrière la ligne de la balle
  const depth = [2.8, 3.3, 3.6].map((y) => q({ x: 4.35, y }));
  assert(depth[0] > depth[1] && depth[1] > depth[2], 'profondeur ' + depth.join(' > '));
  // Hauteur : idéale > basse > très basse
  const h = [1.1, 0.6, 0.4].map((z) => Q.shotQuality(Object.assign({}, b, { z }), { x: 4.35, y: 2.8 }, ctx).score);
  assert(h[0] > h[1] && h[1] > h[2], 'hauteur ' + h.join(' > '));
  // Aisance : plus de marge et balle plus lente = mieux
  assert(Q.shotQuality(b, { x: 4.35, y: 2.8 }, { timeMargin: 0.6 }).score > Q.shotQuality(b, { x: 4.35, y: 2.8 }, { timeMargin: 0.05 }).score);
  assert(Q.shotQuality(b, { x: 4.35, y: 2.8 }, ctx).score > Q.shotQuality(Object.assign({}, b, { vy: -20 }), { x: 4.35, y: 2.8 }, ctx).score);
  // Dégagement : au milieu > près de la vitre > dans le coin
  const mid = Q.clearanceScore({ x: 5, y: 3 }).score;
  const glass = Q.clearanceScore({ x: 5, y: 0.5 }).score;
  const corner = Q.clearanceScore({ x: 9.5, y: 0.5 }).score;
  assert(mid === 1 && glass < mid && corner < glass, 'dégagement');
});

test('qualité : scores entre 0 et 1, composantes exposées', () => {
  const rng = P.mulberry32(17);
  for (let i = 0; i < 300; i++) {
    const b = { x: rng() * 10, y: rng() * 10, z: rng() * 2, vx: (rng() - 0.5) * 20, vy: (rng() - 0.5) * 20, vz: (rng() - 0.5) * 10, floorBounces: Math.floor(rng() * 2), wallHits: Math.floor(rng() * 3), tSinceBounce: rng() };
    const r = Q.shotQuality(b, { x: rng() * 10, y: rng() * 10 }, { timeMargin: rng() });
    assert(r.score >= 0 && r.score <= 1, 'score hors [0, 1] : ' + r.score);
    for (const k in r.parts) assert(r.parts[k] >= 0 && r.parts[k] <= 1, k);
  }
});

test('meilleur choix : balle courte loin du joueur → avant vitre (volée et demi-volée inatteignables)', () => {
  const shot = makeShot({ x: 5, y: 10, z: 1.0 }, { x: 5.3, y: 7 }, 1.3);
  assert(P.contactSequence(shot.sim).join(',') === 'floor,floor', 'balle directe');
  const r = Q.bestChoice(shot, { x: 5, y: 1 });
  assert(r.bestType === 'beforeGlass', 'attendu avant vitre, obtenu ' + r.bestType);
  assert(r.byType.volley === null && r.byType.halfVolley === null && r.byType.afterGlass === null);
  assert(r.best.margin >= 0, 'atteignable à temps');
});

test('meilleur choix : balle qui file mourir dans le coin (double vitre) → la volée est le meilleur choix', () => {
  const shot = makeShot({ x: 7.5, y: 10, z: 1.2 }, { x: 9.3, y: 0.2 }, 0.8);
  assert(P.contactSequence(shot.sim).join(',') === 'floor,back,right,floor', 'fond puis latérale');
  const r = Q.bestChoice(shot, { x: 8.5, y: 3 });
  assert(r.bestType === 'volley', 'attendu volée, obtenu ' + r.bestType);
  const others = ['halfVolley', 'beforeGlass', 'afterGlass'].map((k) => (r.byType[k] ? r.byType[k].quality : 0));
  assert(r.best.quality - Math.max(...others) > 0.1, 'avance nette de la volée');
});

test('feedback et règle à retenir générés à partir des données', () => {
  let st = R.createRally({ seed: 2024 });
  const shot = st.shot;
  for (let i = 0; i < 600 && st.phase === 'incoming'; i++) st = R.step(st, 1 / 60, botInput(st, 1 / 60));
  const fb = Q.feedback(st.last, SG.FAMILIES[shot.family].name);
  assert(['good', 'ok', 'bad'].includes(fb.level) && /Volée|Demi-volée|Avant vitre|Après vitre/.test(fb.text), fb.text);
  const ex = Q.explainBall(shot, st.last);
  assert(ex.lines.length >= 3 && ex.rule.length > 40);
  assert(/km\/h/.test(ex.lines.join(' ')), 'vitesses chiffrées');
  // Cas de l'énoncé : après vitre médiocre alors que la demi-volée était meilleure, balle dans le coin
  const r = { outcome: 'hit', type: 'afterGlass', quality: 0.45, bestType: 'halfVolley', bestQuality: 0.85, corner: true, parts: { height: 0.9, placement: 0.9, ease: 0.8, clearance: 0.1 }, ball: { z: 1 }, player: { x: 9, y: 1 } };
  const t = Q.feedback(r, 'Fond puis latérale').text;
  assert(t === 'Après vitre (0,45) — Fond puis latérale. Meilleur choix : Demi-volée (0,85), la balle mourait dans le coin.', t);
  assert(Q.feedback(r).level === 'ok');
  assert(Q.feedback({ outcome: 'miss', reason: 'early', reasonLabel: 'Trop tôt', bestType: 'volley', bestQuality: 0.9 }, 'Directe').level === 'bad');
});
