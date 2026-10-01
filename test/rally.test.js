/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import G from '../src/core/geometry.js';
import CFG from '../src/core/config.js';
import Q from '../src/core/quality.js';
import SG from '../src/core/shotgen.js';
import R from '../src/core/rally.js';
import { botInput, runRally } from './helpers.js';

section('Échange (rally)');

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

test('échange continu : la balle suivante part exactement de l’endroit où l’adversaire frappe ton renvoi', () => {
  let st = R.createRally({ seed: 2024 });
  let checked = 0;
  for (let i = 0; i < 60 * 90 && checked < 15; i++) {
    const before = st;
    st = R.step(st, 1 / 60, botInput(st, 1 / 60));
    if (before.phase === 'return' && st.phase === 'incoming') {
      const origin = G.ballistic(st.shot.init, st.shot.tStart, st.shot.sim.params.g);
      const hit = before.ret.hit.point;
      near(Math.hypot(origin.x - hit.x, origin.y - hit.y, origin.z - hit.z), 0, 1e-9, 'origine ≠ point de frappe adverse');
      // Pas de saut de la balle à l'écran : position avant / après le changement de balle
      const a = R.ballPosition(before);
      const b = R.ballPosition(st);
      assert(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.35, 'la balle saute au changement : ' + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      // L'adversaire frappe dans son camp, à une hauteur jouable, et il est arrivé près de la balle
      assert(hit.y > 10 && hit.y <= 19.6 && hit.x > 0 && hit.x < 10 && hit.z >= 0.3, 'point de frappe adverse hors camp');
      assert(Math.hypot(before.opponent.x - hit.x, before.opponent.y - hit.y) < 2.5, 'adversaire loin de la balle qu’il frappe');
      checked++;
    }
  }
  assert(checked >= 10, 'trop peu d’enchaînements observés : ' + checked);
});

test('renvoi court = l’adversaire attaque depuis près du filet, avec des balles plus rapides', () => {
  const contact = { x: 5, y: 3, z: 1 };
  const short = R.computeReturn(contact, CFG.quality.minReturn, P.mulberry32(1), CFG).hit.point;
  const deep = R.computeReturn(contact, 1, P.mulberry32(1), CFG).hit.point;
  assert(short.y < deep.y - 3, `court ${short.y.toFixed(1)} vs profond ${deep.y.toFixed(1)}`);
  const speed = (origin) => {
    let v = 0;
    let n = 0;
    for (let i = 0; i < 25; i++) {
      const sh = SG.generateShot({ seed: 50 + i, family: 'A', level: 3, player: { x: 5, y: 3 }, origin });
      if (sh) {
        v += P.hSpeed(sh.init);
        n++;
      }
    }
    return v / n;
  };
  assert(speed(short) > speed(deep) * 0.9, 'attaque pas plus rapide');
});

test('après une faute : nouveau point servi du fond, le joueur n’est pas téléporté', () => {
  let st = R.createRally({ seed: 55 });
  const away = { x: 1, y: 1 };
  let atMiss = null;
  for (let i = 0; i < 60 * 8; i++) {
    const before = st;
    const d = Math.hypot(away.x - st.player.x, away.y - st.player.y);
    st = R.step(st, 1 / 60, { move: d > 0.05 ? { x: (away.x - st.player.x) / d, y: (away.y - st.player.y) / d } : null });
    if (st.phase === 'miss' && !atMiss) atMiss = Object.assign({}, st.player);
    if (before.phase === 'miss' && st.phase === 'incoming') {
      assert(Math.hypot(st.player.x - before.player.x, st.player.y - before.player.y) < 0.1, 'joueur téléporté');
      const origin = G.ballistic(st.shot.init, st.shot.tStart, st.shot.sim.params.g);
      assert(origin.y >= CFG.rally.serve.y[0] - 1e-9, 'service depuis le fond');
      return;
    }
  }
  throw new Error('pas de nouveau point observé');
});
