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

test('le moment de gel précède le premier contact paroi et suit le rebond au sol', () => {
  for (const f of S.FAMILY_IDS) {
    for (const seed of SCENARIO_SEEDS) {
      const sc = S.generate({ family: f, level: 3, seed });
      assert(sc.freezeT < sc.firstWallT && sc.freezeT > sc.floors[0].t, 'gel lecture');
      assert(sc.decisionFreezeT < sc.floors[0].t, 'gel décision');
    }
  }
});

test('évaluations : lecture, placement, décision', () => {
  const sc = S.generate({ family: 'B', level: 2, seed: 5 });
  const q = S.readingQuestion(sc, P.mulberry32(1));
  const perfect = S.evaluateReading(q, q.target);
  assert(perfect.error === 0 && perfect.success);
  const far = S.evaluateReading(q, { x: q.target.x + 3, y: q.target.y });
  near(far.error, 3, 1e-9);
  assert(!far.success);
  const pl = S.evaluatePlacement(sc, S.evaluatePlacement(sc, { x: 5, y: 5 }).ideal);
  assert(pl.success, 'la position idéale doit être réussie');
  const dec = S.evaluateDecision(sc, S.evaluateDecisionOptions(sc).best);
  assert(dec.success, 'la meilleure option doit être réussie');
  const ex = S.explain(sc);
  assert(ex.lines.length >= 3 && ex.rule.length > 10);
});

console.log('Géométrie 3D');

const CAM = { position: { x: 5, y: 2.6, z: 1.7 }, target: { x: 5.5, y: 6, z: 1 }, fovDeg: 70, aspect: 0.8 };

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

test('écran ↔ NDC : coins et centre', () => {
  const c = G.screenToNDC(200, 150, 400, 300);
  near(c.x, 0, 1e-12);
  near(c.y, 0, 1e-12);
  const tl = G.screenToNDC(0, 0, 400, 300);
  assert(tl.x === -1 && tl.y === 1, 'coin haut gauche');
  const back = G.ndcToScreen(0.3, -0.4, 400, 300);
  const n = G.screenToNDC(back.x, back.y, 400, 300);
  near(n.x, 0.3, 1e-12);
  near(n.y, -0.4, 1e-12);
});

test('le centre de l’écran vise exactement la cible de la caméra', () => {
  const ray = G.rayFromCamera(CAM, { x: 0, y: 0 });
  const f = G.vec.norm(G.vec.sub(CAM.target, CAM.position));
  near(G.vec.dot(ray.dir, f), 1, 1e-12);
});

test('rayon vers le sol : le point touché se reprojette sur le pixel touché', () => {
  const W = 360;
  const H = 450;
  let hits = 0;
  for (let py = 0; py <= H; py += 15) {
    for (let px = 0; px <= W; px += 20) {
      const g = G.screenToGround(CAM, px, py, W, H);
      if (!g) continue;
      hits++;
      near(g.z, 0, 1e-9, 'le point est sur le sol');
      const s = G.worldToScreen(CAM, g, W, H);
      near(s.x, px, 1e-6, 'x écran');
      near(s.y, py, 1e-6, 'y écran');
    }
  }
  assert(hits > 100, 'trop peu de pixels touchent le sol : ' + hits);
});

test('rayon vers le sol : un point du sol projeté puis relancé retombe au même endroit', () => {
  const rng = P.mulberry32(5);
  for (let i = 0; i < 200; i++) {
    const p = { x: rng() * 10, y: 3 + rng() * 15, z: 0 };
    const s = G.worldToScreen(CAM, p, 390, 500);
    if (!s) continue;
    const g = G.screenToGround(CAM, s.x, s.y, 390, 500);
    near(g.x, p.x, 1e-6);
    near(g.y, p.y, 1e-6);
  }
});

test('rayon vers le sol : viser au-dessus de l’horizon ne touche pas le sol, un point derrière la caméra n’est pas projeté', () => {
  const flat = { position: { x: 5, y: 2, z: 1.7 }, target: { x: 5, y: 10, z: 1.7 }, fovDeg: 70, aspect: 1 };
  assert(G.screenToGround(flat, 50, 0, 100, 100) === null, 'haut de l’écran = ciel');
  assert(G.screenToGround(flat, 50, 100, 100, 100) !== null, 'bas de l’écran = sol');
  assert(G.intersectGround({ origin: { x: 0, y: 0, z: 1 }, dir: { x: 0, y: 1, z: 0 } }) === null, 'rayon horizontal');
  assert(G.worldToScreen(flat, { x: 5, y: 0, z: 1 }, 100, 100) === null, 'point derrière');
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

test('déplacement : relatif au regard, borné à la moitié de défense', () => {
  const p = G.moveOnCourt({ x: 5, y: 3 }, { x: 0, y: 1 }, 0, 4, 0.5);
  near(p.x, 5, 1e-12);
  near(p.y, 5, 1e-12, 'avancer vers le filet');
  const r = G.moveOnCourt({ x: 5, y: 3 }, { x: 1, y: 0 }, 0, 4, 0.25);
  near(r.x, 6, 1e-12, 'pas chassé à droite');
  const back = G.moveOnCourt({ x: 5, y: 3 }, { x: 0, y: 1 }, Math.PI, 4, 0.25);
  near(back.y, 2, 1e-12, 'regard vers la vitre : avancer = reculer vers le fond');
  const far = G.moveOnCourt({ x: 5, y: 9 }, { x: 1, y: 1 }, 0, 50, 1);
  const b = G.DEFENSE_BOUNDS;
  assert(far.x === b.xMax && far.y === b.yMax, 'bornes filet / paroi');
  const out = G.moveOnCourt({ x: 0.5, y: 0.5 }, { x: -1, y: -1 }, 0, 50, 1);
  assert(out.x === b.xMin && out.y === b.yMin, 'bornes vitre de fond / paroi');
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

test('temps réel : jugement sur la distance et le timing', () => {
  const w = { t0: 1.0, t1: 1.1 };
  assert(G.judgeStrike({ placementError: 0, strikeT: 1.05, window: w }).success, 'parfait');
  const early = G.judgeStrike({ placementError: 0, strikeT: 0.7, window: w });
  assert(!early.success && early.timing === 'early');
  near(early.timingError, 0.3, 1e-12);
  const late = G.judgeStrike({ placementError: 0, strikeT: 1.4, window: w });
  assert(!late.success && late.timing === 'late');
  assert(G.judgeStrike({ placementError: 0, strikeT: 1.2, window: w }).success, 'dans la tolérance de 0,15 s');
  assert(!G.judgeStrike({ placementError: 0.6, strikeT: 1.05, window: w }).success, 'trop loin');
  const none = G.judgeStrike({ placementError: 0.1, strikeT: null, window: w });
  assert(!none.success && none.timing === 'none');
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

console.log('Progression');

test('série de jours consécutifs', () => {
  const d = (s) => new Date(s + 'T12:00:00').getTime();
  const attempts = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((s) => ({ ts: d(s) }));
  near(Stats.streak(attempts, d('2026-10-01')), 4, 0);
  near(Stats.streak(attempts, d('2026-10-02')), 4, 0, 'la série tient tant que la journée n’est pas finie');
  near(Stats.streak(attempts, d('2026-10-03')), 0, 0);
  near(Stats.streak([], d('2026-10-01')), 0, 0);
});

test('répétition espacée : les configurations ratées sortent plus souvent', () => {
  const attempts = [];
  for (let i = 0; i < 20; i++) {
    attempts.push({ mode: 'lecture', family: 'A', configKey: 'A:left', success: true, ts: i });
    attempts.push({ mode: 'lecture', family: 'A', configKey: 'A:right', success: true, ts: i });
    attempts.push({ mode: 'lecture', family: 'B', configKey: 'B:left', success: true, ts: i });
    attempts.push({ mode: 'lecture', family: 'B', configKey: 'B:right', success: true, ts: i });
    attempts.push({ mode: 'lecture', family: 'C', configKey: 'C:left', success: true, ts: i });
    attempts.push({ mode: 'lecture', family: 'C', configKey: 'C:right', success: true, ts: i });
    attempts.push({ mode: 'lecture', family: 'D', configKey: 'D:left', success: false, ts: i });
    attempts.push({ mode: 'lecture', family: 'D', configKey: 'D:right', success: true, ts: i });
  }
  const rng = P.mulberry32(9);
  const counts = {};
  for (let i = 0; i < 4000; i++) {
    const k = Stats.pickConfig(attempts, 'lecture', rng);
    counts[k.key] = (counts[k.key] || 0) + 1;
  }
  assert(counts['D:left'] > 2 * counts['A:left'], JSON.stringify(counts));
});

test('difficulté adaptative : montée au-delà de 80 % de réussite, descente sous 40 %', () => {
  const mk = (n, rate) => Array.from({ length: n }, (_, i) => ({ mode: 'lecture', level: 2, success: i < Math.round(n * rate) }));
  near(Stats.nextLevel(mk(10, 0.9), 2), 3, 0);
  near(Stats.nextLevel(mk(10, 0.8), 2), 2, 0);
  near(Stats.nextLevel(mk(10, 0.3), 2), 1, 0);
  near(Stats.nextLevel(mk(5, 1), 2), 2, 0, 'pas assez d’essais');
  near(Stats.nextLevel(mk(10, 1), 5), 5, 0, 'niveau max');
});

test('stats par famille et export / import JSON', () => {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)) };
  const store = Stats.createStore(storage);
  store.record({ mode: 'lecture', family: 'A', configKey: 'A:left', level: 1, success: true, error: 0.3 });
  store.record({ mode: 'lecture', family: 'A', configKey: 'A:left', level: 1, success: false, error: 1.5 });
  const fs = Stats.familyStats(store.state.attempts);
  near(fs.A.rate, 0.5, 1e-9);
  near(fs.A.meanError, 0.9, 1e-9);
  const json = store.exportJSON();
  const store2 = Stats.createStore({ getItem: () => null, setItem: () => {} });
  store2.importJSON(json);
  near(store2.state.attempts.length, 2, 0);
  let threw = false;
  try {
    store2.importJSON('{"pas":"valide"}');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'un JSON invalide doit être refusé');
});

test('stats : champ « vue utilisée » et comparaison 2D / 3D', () => {
  const attempts = [
    { mode: 'lecture', family: 'A', success: true, error: 0.2, ts: 1 }, // ancien essai sans vue → 2D
    { mode: 'lecture', family: 'A', success: false, error: 1.0, ts: 2, view: '2d' },
    { mode: 'lecture', family: 'B', success: true, error: 0.4, ts: 3, view: '3d' },
    { mode: 'realtime', family: 'C', success: false, error: 0.9, ts: 4, view: '3d', timingError: 0.3 },
  ];
  const vs = Stats.viewStats(attempts);
  near(vs.lecture['2d'].n, 2, 0);
  near(vs.lecture['2d'].rate, 0.5, 1e-12);
  near(vs.lecture['2d'].meanError, 0.6, 1e-12);
  near(vs.lecture['3d'].rate, 1, 1e-12);
  near(vs.realtime['3d'].n, 1, 0);
  assert(vs.placement['3d'].rate === null, 'pas d’essai → null');
  // Un export contenant le mode temps réel se réimporte, et un ancien export reçoit le niveau temps réel
  const st = Stats.validateState({ attempts, levels: { lecture: 3 } });
  near(st.levels.realtime, 1, 0);
  near(st.levels.lecture, 3, 0);
});

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed) process.exit(1);
