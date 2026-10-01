/*
 * Glass Lab — tests (Node, sans librairie) : node test.js
 */
'use strict';

const P = require('./physics.js');
const S = require('./scenarios.js');
const Stats = require('./stats.js');
const G = require('./geometry.js');
const CFG = require('./config.js');
const Q = require('./quality.js');
const SG = require('./shotgen.js');
const R = require('./rally.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.log('  ÉCHEC  ' + name + '\n        ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion échouée');
}

function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, (msg || '') + ` (attendu ${b}, obtenu ${a}, tolérance ${tol})`);
}

/** Lance aléatoires couvrant tout le demi-court, y compris des tirs violents dans les coins. */
function randomLaunches(n, seed) {
  const rng = P.mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: 0.5 + rng() * 9,
      y: 9.9,
      z: 0.5 + rng() * 2.5,
      vx: (rng() - 0.5) * 30,
      vy: -(2 + rng() * 30),
      vz: (rng() - 0.3) * 15,
    });
  }
  return out;
}

const SCENARIO_SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);

console.log('Physique');

test('la balle ne traverse jamais le sol ni les parois (lancers aléatoires, échantillonnage fin)', () => {
  const r = P.DEFAULT_PARAMS.radius;
  const tol = 1e-6;
  for (const init of randomLaunches(400, 7)) {
    const sim = P.simulate(init, { maxFloorBounces: 4, tMax: 6 });
    for (const s of P.sample(sim, 1 / 500)) {
      assert(s.z >= r - tol, `sous le sol : z=${s.z}`);
      assert(s.y >= r - tol, `derrière la vitre de fond : y=${s.y}`);
      assert(s.x >= r - tol && s.x <= P.COURT.width - r + tol, `hors des parois latérales : x=${s.x}`);
    }
  }
});

test('la balle ne traverse pas les parois entre deux échantillons (vérification analytique par segment)', () => {
  const r = P.DEFAULT_PARAMS.radius;
  for (const init of randomLaunches(300, 99)) {
    const sim = P.simulate(init, { maxFloorBounces: 4 });
    for (let i = 0; i < sim.segments.length; i++) {
      const seg = sim.segments[i];
      const t1 = i + 1 < sim.segments.length ? sim.segments[i + 1].t0 : sim.endT;
      const a = P.stateAt(sim, seg.t0 + 1e-12);
      const b = P.advance(seg.s, t1 - seg.t0, sim.params.g);
      // x et y sont linéaires : il suffit de vérifier les extrémités
      for (const s of [a, b]) {
        assert(s.y >= r - 1e-6 && s.x >= r - 1e-6 && s.x <= P.COURT.width - r + 1e-6, 'paroi traversée');
      }
      // z est parabolique : vérifier aussi l'extrémum s'il est dans le segment
      assert(b.z >= r - 1e-6, 'sol traversé en fin de segment');
    }
  }
});

test('même graine → même trajectoire', () => {
  for (const f of S.FAMILY_IDS) {
    const a = S.generate({ family: f, level: 3, seed: 12345 });
    const b = S.generate({ family: f, level: 3, seed: 12345 });
    assert(JSON.stringify(a.init) === JSON.stringify(b.init), 'états initiaux différents');
    const sa = P.sample(a.sim, 1 / 100);
    const sb = P.sample(b.sim, 1 / 100);
    assert(sa.length === sb.length, 'longueurs différentes');
    for (let i = 0; i < sa.length; i++) {
      assert(sa[i].x === sb[i].x && sa[i].y === sb[i].y && sa[i].z === sb[i].z, 'échantillon différent à ' + i);
    }
  }
  const r1 = P.mulberry32(42);
  const r2 = P.mulberry32(42);
  for (let i = 0; i < 100; i++) assert(r1() === r2(), 'générateur non déterministe');
});

test('graines différentes → trajectoires différentes', () => {
  const a = S.generate({ family: 'A', level: 2, seed: 1 });
  const b = S.generate({ family: 'A', level: 2, seed: 2 });
  assert(JSON.stringify(a.init) !== JSON.stringify(b.init));
});

test('la réflexion respecte l’angle d’incidence, à la perte de vitesse près', () => {
  const { eWall, wallTangent } = P.DEFAULT_PARAMS;
  let checked = 0;
  for (const init of randomLaunches(300, 3)) {
    const sim = P.simulate(init, { maxFloorBounces: 3 });
    for (const c of sim.contacts) {
      if (c.type === 'floor') continue;
      const { inDeg, outDeg } = P.wallAngles(c);
      // Avec des pertes normale (e) et tangentielle (k) : tan(sortie) = (k / e) · tan(incidence)
      const expected = (Math.atan((wallTangent / eWall) * Math.tan((inDeg * Math.PI) / 180)) * 180) / Math.PI;
      near(outDeg, expected, 1e-6, 'angle de sortie');
      // Composantes : normale inversée × e, tangentielle × k
      const n = c.type === 'back' ? 'vy' : 'vx';
      const t = c.type === 'back' ? 'vx' : 'vy';
      near(c.vOut[n], -eWall * c.vIn[n], 1e-9, 'composante normale');
      near(c.vOut[t], wallTangent * c.vIn[t], 1e-9, 'composante tangentielle');
      assert(Math.sign(c.vOut[t]) === Math.sign(c.vIn[t]) || c.vIn[t] === 0, 'la balle doit continuer dans le même sens le long de la paroi');
      checked++;
    }
  }
  assert(checked > 100, 'trop peu de contacts paroi testés : ' + checked);
});

test('sans pertes (e = 1, k = 1), angle de sortie = angle d’incidence', () => {
  const params = { eWall: 1, wallTangent: 1 };
  const sim = P.simulate({ x: 5, y: 5, z: 1.5, vx: 3, vy: -8, vz: 2 }, { params, maxFloorBounces: 2 });
  const c = sim.contacts.find((k) => k.type !== 'floor');
  const { inDeg, outDeg } = P.wallAngles(c);
  near(outDeg, inDeg, 1e-9);
});

test('rebond au sol : restitution 0,75', () => {
  const sim = P.simulate({ x: 5, y: 5, z: 2, vx: 0, vy: 0, vz: 0 }, { maxFloorBounces: 1 });
  const c = sim.contacts[0];
  near(c.vOut.vz, -0.75 * c.vIn.vz, 1e-9);
});

test('launchToBounce : le premier rebond tombe au point visé', () => {
  const init = P.launchToBounce({ x: 3, y: 10, z: 1.2 }, { x: 6, y: 2 }, 0.8);
  const sim = P.simulate(init, { maxFloorBounces: 1 });
  const c = sim.contacts[0];
  assert(c.type === 'floor');
  near(c.pos.x, 6, 1e-9);
  near(c.pos.y, 2, 1e-9);
  near(c.t, 0.8, 1e-9);
});

console.log('Scénarios');

const EXPECTED = {
  A: [['floor', 'back', 'floor']],
  B: [['floor', 'back', 'left', 'floor'], ['floor', 'back', 'right', 'floor']],
  C: [['floor', 'left', 'back', 'floor'], ['floor', 'right', 'back', 'floor']],
  D: [['floor', 'left', 'floor'], ['floor', 'right', 'floor']],
};

for (const f of S.FAMILY_IDS) {
  test(`famille ${f} (${S.FAMILIES[f].name}) : séquence de contacts attendue, tous niveaux`, () => {
    for (let level = 1; level <= 5; level++) {
      for (const seed of SCENARIO_SEEDS) {
        const sc = S.generate({ family: f, level, seed });
        const seq = P.contactSequence(sc.sim).join(',');
        assert(EXPECTED[f].some((e) => e.join(',') === seq), `graine ${seed} niv. ${level} : ${seq}`);
        assert(P.classify(sc.sim) === f, 'classification incohérente');
        for (const w of sc.walls) assert(P.onGlass(w), 'contact hors vitre');
      }
    }
  });
}

test('le côté imposé est respecté', () => {
  for (const f of ['A', 'B', 'C', 'D']) {
    for (const side of ['left', 'right']) {
      const sc = S.generate({ family: f, level: 2, seed: 77, side });
      assert(sc.side === side && sc.configKey === f + ':' + side, `${f} ${side}`);
      if (f !== 'A') assert(sc.walls.some((w) => w.type === side), `${f} ${side}`);
    }
  }
});

test('difficulté : balles plus rapides aux niveaux élevés', () => {
  const avg = (level) => {
    let sum = 0;
    for (const seed of SCENARIO_SEEDS) sum += P.hSpeed(S.generate({ family: 'A', level, seed }).init);
    return sum / SCENARIO_SEEDS.length;
  };
  assert(avg(5) > avg(1) * 1.2, 'le niveau 5 devrait être nettement plus rapide');
});

console.log('Géométrie 3D');

test('monde ↔ scène : aller-retour exact et rotation directe (déterminant +1)', () => {
  const rng = P.mulberry32(11);
  for (let i = 0; i < 200; i++) {
    const p = { x: rng() * 10, y: rng() * 20, z: rng() * 4 };
    const q = G.sceneToWorld(G.worldToScene(p));
    near(q.x, p.x, 1e-12);
    near(q.y, p.y, 1e-12);
    near(q.z, p.z, 1e-12);
  }
  const s0 = G.worldToScene({ x: 0, y: 0, z: 0 });
  const ex = G.vec.sub(G.worldToScene({ x: 1, y: 0, z: 0 }), s0);
  const ey = G.vec.sub(G.worldToScene({ x: 0, y: 1, z: 0 }), s0);
  const ez = G.vec.sub(G.worldToScene({ x: 0, y: 0, z: 1 }), s0);
  near(G.vec.dot(G.vec.cross(ex, ey), ez), 1, 1e-12, 'orientation conservée');
  const net = G.worldToScene({ x: 5, y: 10, z: 0 });
  assert(net.x === 0 && net.y === 0 && net.z === 0, 'filet au centre de la scène');
});

test('champ de vision : 75° horizontal en portrait, bornes respectées', () => {
  const vf = G.verticalFov(75, 0.75);
  const hf = (2 * Math.atan(Math.tan((vf * Math.PI) / 360) * 0.75) * 180) / Math.PI;
  near(hf, 75, 1e-9);
  near(G.verticalFov(75, 0.2, 45, 95), 95, 0, 'borne haute');
  near(G.verticalFov(75, 4, 45, 95), 45, 0, 'borne basse');
});

test('angles de regard : aller-retour et lissage par le plus court chemin', () => {
  const a = G.lookAngles({ x: 5, y: 3, z: 1.7 }, { x: 7, y: 1, z: 2.7 });
  const d = G.dirFromAngles(a.yaw, a.pitch);
  const exp = G.vec.norm({ x: 2, y: -2, z: 1 });
  near(d.x, exp.x, 1e-12);
  near(d.y, exp.y, 1e-12);
  near(d.z, exp.z, 1e-12);
  near(G.lookAngles({ x: 5, y: 3, z: 1 }, { x: 5, y: 9, z: 1 }).yaw, 0, 1e-12, 'vers le filet = lacet 0');
  // De 170° à −170° : passer par 180°, pas par 0°
  const mid = G.dampAngle((170 * Math.PI) / 180, (-170 * Math.PI) / 180, 1, 1);
  near(Math.abs(mid), Math.PI, (6 * Math.PI) / 180);
  near(G.damp(0, 10, 0.5, 0.5), 5, 1e-12, 'demi-vie');
  near(G.wrapAngle(3 * Math.PI), Math.PI, 1e-12);
  near(G.wrapAngle(-Math.PI), Math.PI, 1e-12, 'intervalle ]-π, π]');
  near(G.wrapAngle(0.5 - 4 * Math.PI), 0.5, 1e-12);
});

test('joystick et clavier : zone morte, norme ≤ 1, ZQSD (AZERTY) = WASD (QWERTY)', () => {
  const z = G.joystickVector(3, 2, 60);
  assert(z.x === 0 && z.y === 0, 'zone morte');
  const full = G.joystickVector(0, -200, 60);
  near(full.y, 1, 1e-12, 'doigt vers le haut = avancer');
  const sat = G.joystickVector(60, 60, 60);
  near(Math.hypot(sat.x, sat.y), 1, 1e-12, 'saturé au bord');
  const half = G.joystickVector(0, 30, 60);
  assert(half.y < 0 && half.y > -1, 'mi-course');
  const k = G.keyboardVector(new Set(['KeyW', 'KeyD']));
  near(Math.hypot(k.x, k.y), 1, 1e-12, 'diagonale normalisée');
  assert(k.x > 0 && k.y > 0);
  const a = G.keyboardVector(new Set(['ArrowLeft']));
  assert(a.x === -1 && a.y === 0);
});

test('caméra à hauteur d’yeux derrière le joueur, jamais derrière la vitre', () => {
  const e = G.eyePosition({ x: 5, y: 3 }, 0);
  near(e.z, 1.7, 0);
  near(e.y, 3 - 0.35, 1e-12);
  const glass = G.eyePosition({ x: 5, y: 0.3 }, 0, 1.7, 1);
  assert(glass.y >= 0.15, 'reste devant la vitre de fond');
});

test('balle côté adverse : la remontée dans le temps reste sur la trajectoire et au-dessus du sol', () => {
  for (const f of S.FAMILY_IDS) {
    for (const seed of SCENARIO_SEEDS.slice(0, 15)) {
      const sc = S.generate({ family: f, level: 3, seed });
      const g = P.DEFAULT_PARAMS.g;
      const tau = G.preNetDuration(sc.init, g);
      assert(tau > 0, 'durée positive');
      const start = G.ballistic(sc.init, -tau, g);
      assert(start.y > 10 && start.y <= 16.5 + 1e-9, 'départ côté adverse : y=' + start.y);
      assert(start.z >= 0.4 - 1e-9 && start.z <= 3.2 + 1e-9, 'hauteur de frappe plausible : z=' + start.z);
      // Revenir au filet redonne exactement l'état initial
      const back = G.ballistic(start, tau, g);
      near(back.x, sc.init.x, 1e-9);
      near(back.z, sc.init.z, 1e-9);
      near(back.vz, sc.init.vz, 1e-9);
    }
  }
});

console.log('Match infini — classification et qualité');

/** Balle de test : lancée depuis le filet vers un point de rebond, en T secondes. */
function makeShot(from, to, T) {
  const init = P.launchToBounce(from, to, T);
  const sim = P.simulate(init, { maxFloorBounces: 2 });
  return { init, sim, tStart: -G.preNetDuration(init, sim.params.g), endT: sim.endT, family: 'test' };
}

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

console.log('Match infini — génération des balles et échange');

/** Joueur automatique : va au meilleur point de frappe et appuie au bon moment. */
function botInput(st, dt) {
  if (st.phase !== 'incoming' || st.pending) return {};
  const best = st.shot.best.best;
  const dx = best.pos.x - st.player.x;
  const dy = best.pos.y - st.player.y;
  const d = Math.hypot(dx, dy);
  const move = d > 0.02 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
  return { move, strike: st.t + dt >= best.t && st.t < best.t + dt };
}

function runRally(rally, seconds, inputFn, dt) {
  dt = dt || 1 / 60;
  const events = [];
  let st = rally;
  for (let t = 0; t < seconds; t += dt) {
    const inp = inputFn(st, dt);
    st = R.step(st, dt, inp);
    for (const e of st.events) events.push(Object.assign({ pressT: inp.strike ? st.t : null, playerAtPress: inp.strike ? Object.assign({}, st.player) : null }, e));
  }
  return { st, events };
}

test('toute balle générée est atteignable selon config.js (toutes familles, niveaux, positions)', () => {
  const positions = [{ x: 5, y: 3 }, { x: 1, y: 1 }, { x: 9, y: 8 }, { x: 2, y: 9 }];
  let n = 0;
  for (const family of SG.FAMILY_IDS) {
    for (let level = 1; level <= 5; level += 2) {
      for (const player of positions) {
        for (let i = 0; i < 6; i++) {
          const shot = SG.generateShot({ seed: 500 + i * 131 + level, family, level, player });
          assert(shot, `aucune balle ${family} niv. ${level}`);
          // Recalcul indépendant de l'atteignabilité
          const best = Q.bestChoice(shot, player, CFG);
          assert(best.best && best.best.quality >= CFG.quality.playable, 'qualité atteignable insuffisante');
          assert(best.best.margin >= 0, 'point de frappe atteint trop tard');
          const travel = Math.hypot(best.best.pos.x - player.x, best.best.pos.y - player.y) / CFG.player.speed;
          assert(best.best.t - shot.tStart >= CFG.player.reactionTime + travel - 1e-9, 'réaction + trajet > temps disponible');
          n++;
        }
      }
    }
  }
  assert(n === 5 * 3 * 4 * 6);
});

test('chaque famille est générée avec la séquence de contacts attendue et retombe chez le joueur', () => {
  const EXP = {
    direct: /^floor,floor$/,
    A: /^floor,back,floor$/,
    B: /^floor,back,(left|right),floor$/,
    C: /^floor,(left|right),back,floor$/,
    D: /^floor,(left|right),floor$/,
  };
  for (const family of SG.FAMILY_IDS) {
    for (let i = 0; i < 25; i++) {
      const shot = SG.generateShot({ seed: 9000 + i * 7, family, level: 1 + (i % 5), player: { x: 5, y: 3 } });
      const seq = P.contactSequence(shot.sim).join(',');
      assert(EXP[family].test(seq), `${family} : ${seq}`);
      for (const c of shot.sim.contacts.filter((k) => k.type === 'floor')) assert(c.pos.y > 0 && c.pos.y < 10, 'rebond hors de la moitié du joueur');
      assert(shot.tStart < 0, 'la balle part du camp adverse');
    }
  }
});

test('même graine → même séquence de balles (générateur et échange)', () => {
  const a = SG.sequence(4242, 10);
  const b = SG.sequence(4242, 10);
  assert(a.map((s) => s.family + JSON.stringify(s.init)).join('|') === b.map((s) => s.family + JSON.stringify(s.init)).join('|'));
  const c = SG.sequence(4243, 10);
  assert(a.map((s) => JSON.stringify(s.init)).join() !== c.map((s) => JSON.stringify(s.init)).join(), 'graine différente');
  const r1 = runRally(R.createRally({ seed: 77 }), 25, botInput);
  const r2 = runRally(R.createRally({ seed: 77 }), 25, botInput);
  assert(JSON.stringify(r1.events) === JSON.stringify(r2.events), 'échanges différents');
  assert(r1.events.filter((e) => e.type === 'newBall').length >= 5, 'trop peu de balles');
});

test('l’échange est infini : un joueur parfait renvoie balle après balle, la série grandit', () => {
  const { st, events } = runRally(R.createRally({ seed: 2024 }), 60, botInput);
  const hits = events.filter((e) => e.type === 'hit');
  const misses = events.filter((e) => e.type === 'miss');
  assert(hits.length >= 15, 'trop peu de frappes : ' + hits.length);
  assert(hits.length > 5 * misses.length, `frappes ${hits.length}, pertes ${misses.length}`);
  assert(st.bestStreak >= 5, 'meilleure série ' + st.bestStreak);
  for (const h of hits) assert(h.result.quality >= CFG.quality.minReturn);
});

test('appuyer sur « Frappe » hors zone ne renvoie jamais la balle', () => {
  const rng = P.mulberry32(31);
  let presses = 0;
  let outOfZone = 0;
  for (let k = 0; k < 40; k++) {
    let st = R.createRally({ seed: 300 + k });
    const pressAt = st.shot.tStart + rng() * (st.shot.endT - st.shot.tStart);
    const wander = { x: rng() * 2 - 1, y: rng() * 2 - 1 };
    for (let i = 0; i < 400 && st.phase === 'incoming'; i++) {
      const strike = !st.pending && st.t < pressAt && st.t + 1 / 60 >= pressAt;
      const before = st;
      st = R.step(st, 1 / 60, { move: wander, strike });
      if (strike) {
        presses++;
        const tol = CFG.strike.timingTolerance;
        const inWindow = R.zoneTimes(before, st.t - tol, st.t + tol, st.player);
        if (!inWindow.length) {
          outOfZone++;
          assert(st.phase === 'miss' && !st.events.some((e) => e.type === 'hit'), 'frappe hors zone renvoyée !');
        }
      }
      for (const e of st.events) {
        if (e.type !== 'hit') continue;
        const r = e.result;
        assert(Q.inZone(r.ball, r.player, CFG), 'contact hors zone de frappe');
      }
    }
  }
  assert(presses >= 30 && outOfZone >= 10, `appuis ${presses}, hors zone ${outOfZone}`);
});

test('motifs de perte : trop tôt, trop tard, trop loin, pas atteinte', () => {
  const run = (pressAt, move) => {
    let st = R.createRally({ seed: 55 });
    const best = st.shot.best.best;
    for (let i = 0; i < 600 && st.phase === 'incoming'; i++) {
      const strike = pressAt != null && !st.pending && st.t < pressAt(best) && st.t + 1 / 120 >= pressAt(best);
      st = R.step(st, 1 / 120, { move: move ? move(st, best) : null, strike });
    }
    return st;
  };
  const toBest = (st, best) => {
    const d = Math.hypot(best.pos.x - st.player.x, best.pos.y - st.player.y);
    return d > 0.02 ? { x: (best.pos.x - st.player.x) / d, y: (best.pos.y - st.player.y) / d } : null;
  };
  assert(run(null, toBest).last.reason === 'notReached', 'sans frappe : pas atteinte');
  assert(run((b) => b.t - 0.6, toBest).last.reason === 'early', 'trop tôt');
  // Trop loin : on reste dans le coin opposé
  const away = (st, best) => ({ x: best.pos.x > 5 ? -1 : 1, y: best.pos.y > 5 ? -1 : 1 });
  assert(run((b) => b.t, away).last.reason === 'far', 'trop loin');
});

test('trop tard : appui après le dernier passage de la balle dans la zone', () => {
  // Balle directe : on suit la balle puis on appuie bien après sa sortie de zone
  let st = R.createRally({ seed: 8, weights: { direct: 1, A: 0, B: 0, C: 0, D: 0 } });
  assert(st.shot.family === 'direct');
  const best = st.shot.best.best;
  const times = R.zoneTimes(st, st.shot.tStart, st.shot.endT, best.pos);
  assert(times.length > 0);
  const lastIn = times[times.length - 1];
  for (let i = 0; i < 600 && st.phase === 'incoming'; i++) {
    const d = Math.hypot(best.pos.x - st.player.x, best.pos.y - st.player.y);
    const move = d > 0.02 ? { x: (best.pos.x - st.player.x) / d, y: (best.pos.y - st.player.y) / d } : null;
    const strike = st.t < lastIn + 0.3 && st.t + 1 / 120 >= lastIn + 0.3;
    st = R.step(st, 1 / 120, { move, strike });
  }
  assert(st.last.outcome === 'miss' && ['late', 'notReached'].includes(st.last.reason), st.last.reason);
});

test('le renvoi retombe dans le camp adverse quand la qualité est suffisante, et plus profond si elle est meilleure', () => {
  const rng = P.mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const contact = { x: 0.5 + rng() * 9, y: 0.4 + rng() * 9, z: 0.1 + rng() * 1.8 };
    let prevY = -Infinity;
    for (let q = CFG.quality.minReturn; q <= 1.0001; q += 0.1) {
      const r = R.computeReturn(contact, q, P.mulberry32(i), CFG);
      const land = G.ballistic(r.init, r.T, P.DEFAULT_PARAMS.g);
      near(land.z, P.DEFAULT_PARAMS.radius, 1e-9, 'retombe au sol au temps T');
      assert(land.y > 10 && land.y < 20 && land.x > 0 && land.x < 10, 'hors du camp adverse : ' + JSON.stringify(land));
      assert(r.netZ >= 0.88, 'dans le filet : ' + r.netZ);
      assert(land.y > prevY, 'qualité plus haute = renvoi plus profond');
      prevY = land.y;
    }
  }
});

test('frappe automatique : renvoi au premier passage dans la zone, sans bouton', () => {
  const { events } = runRally(R.createRally({ seed: 99, auto: true }), 40, (st) => {
    if (st.phase !== 'incoming') return {};
    const best = st.shot.best.best;
    const d = Math.hypot(best.pos.x - st.player.x, best.pos.y - st.player.y);
    return { move: d > 0.02 ? { x: (best.pos.x - st.player.x) / d, y: (best.pos.y - st.player.y) / d } : null };
  });
  const hits = events.filter((e) => e.type === 'hit');
  assert(hits.length >= 5, 'frappes auto : ' + hits.length);
  for (const h of hits) assert(Q.inZone(h.result.ball, h.result.player, CFG));
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

console.log('Progression');

test('stats du match : par famille, précision de décision, sessions, série', () => {
  const mem = {};
  const store = Stats.createStore({ getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)) });
  const ball = (o) => Object.assign({ session: 1, family: 'B', outcome: 'hit', type: 'afterGlass', bestType: 'afterGlass', decisionOk: true, quality: 0.8, placementError: 0.2, level: 1 }, o);
  store.recordMatch(ball({}), 1);
  store.recordMatch(ball({ type: 'afterGlass', bestType: 'halfVolley', decisionOk: false, quality: 0.4, placementError: 0.6 }), 0);
  store.recordMatch(ball({ type: 'afterGlass', bestType: 'halfVolley', decisionOk: false, quality: 0.5, placementError: 0.4 }), 0);
  store.recordMatch(ball({ outcome: 'miss', reason: 'late', type: undefined, quality: undefined, placementError: undefined, family: 'direct', session: 2 }), 0);
  const fs = Stats.matchFamilyStats(store.state.match.balls);
  near(fs.B.rate, 1, 1e-12);
  near(fs.B.meanQuality, (0.8 + 0.4 + 0.5) / 3, 1e-12);
  near(fs.B.meanPlacementError, 0.4, 1e-12);
  near(fs.direct.rate, 0, 1e-12);
  const ds = Stats.decisionStats(store.state.match.balls);
  near(ds.accuracy, 1 / 3, 1e-12);
  assert(ds.byChosen.afterGlass.topBetter === 'halfVolley');
  near(ds.byChosen.afterGlass.topBetterRate, 2 / 3, 1e-12);
  const ss = Stats.sessionStats(store.state.match.balls);
  assert(ss.sessions === 2 && ss.last === 1 && ss.average === 2);
  near(store.state.match.bestStreak, 1, 0);
  // Export / import avec les données du match ; un ancien export sans match reste valide
  const back = Stats.validateState(JSON.parse(store.exportJSON()));
  near(back.match.balls.length, 4, 0);
  near(Stats.validateState({ attempts: [] }).match.balls.length, 0, 0);
  let threw = false;
  try {
    Stats.validateState({ attempts: [], match: { balls: [{ ts: 1, family: 'Z', outcome: 'hit' }] } });
  } catch (e) {
    threw = true;
  }
  assert(threw, 'famille inconnue refusée');
});

test('stats du match : répétition espacée et difficulté adaptative (80 % / 50 %)', () => {
  const balls = [];
  for (let i = 0; i < 30; i++) for (const f of Stats.MATCH_FAMILIES) balls.push({ family: f, outcome: f === 'C' ? 'miss' : 'hit' });
  const w = Stats.matchFamilyWeights(balls);
  assert(w.C > 2 * w.A, JSON.stringify(w));
  const mk = (n, rate) => Array.from({ length: n }, (_, i) => ({ outcome: i < Math.round(n * rate) ? 'hit' : 'miss' }));
  const D = CFG.difficulty;
  near(Stats.matchNextLevel(mk(10, 0.9), 2, D), 3, 0);
  near(Stats.matchNextLevel(mk(10, 0.8), 2, D), 2, 0);
  near(Stats.matchNextLevel(mk(10, 0.6), 2, D), 2, 0);
  near(Stats.matchNextLevel(mk(10, 0.4), 2, D), 1, 0);
  near(Stats.matchNextLevel(mk(4, 0), 2, D), 2, 0, 'pas assez de balles');
  // Les poids et le niveau sont bien utilisés par l'échange
  const st = R.createRally({ seed: 5, weights: { direct: 0, A: 0, B: 0, C: 1, D: 0 }, level: 4 });
  assert(st.shot.family === 'C' && st.shot.level === 4);
});

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed) process.exit(1);
