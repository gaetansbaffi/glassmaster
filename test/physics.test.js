/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import { randomLaunches } from './helpers.js';

section('Physique');

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

test('générateur pseudo-aléatoire : même graine → même suite, graines différentes → suites différentes', () => {
  const r1 = P.mulberry32(42);
  const r2 = P.mulberry32(42);
  const r3 = P.mulberry32(43);
  let diff = 0;
  for (let i = 0; i < 100; i++) {
    const a = r1();
    assert(a === r2(), 'générateur non déterministe');
    if (a !== r3()) diff++;
  }
  assert(diff > 90);
});

test('même état initial → trajectoire identique', () => {
  for (const init of randomLaunches(50, 4)) {
    const a = P.sample(P.simulate(init), 1 / 100);
    const b = P.sample(P.simulate(Object.assign({}, init)), 1 / 100);
    assert(JSON.stringify(a) === JSON.stringify(b));
  }
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
