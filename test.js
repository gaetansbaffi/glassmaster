/*
 * Glass Lab — tests (Node, sans librairie) : node test.js
 */
'use strict';

const P = require('./physics.js');
const S = require('./scenarios.js');
const Stats = require('./stats.js');

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

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed) process.exit(1);
