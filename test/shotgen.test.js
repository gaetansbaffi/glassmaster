/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import CFG from '../src/core/config.js';
import Q from '../src/core/quality.js';
import SG from '../src/core/shotgen.js';
import { SEEDS, START } from './helpers.js';

section('Génération des balles adverses');

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

test('familles à vitres : classification cohérente, contacts sur vitre, deux côtés, tous niveaux', () => {
  for (const f of ['A', 'B', 'C', 'D']) {
    const sides = new Set();
    for (let level = 1; level <= 5; level++) {
      for (const seed of SEEDS.slice(0, 12)) {
        const shot = SG.generateShot({ family: f, level, seed, player: START });
        assert(P.classify(shot.sim) === f, 'classification incohérente');
        for (const c of shot.sim.contacts) {
          if (c.type === 'floor') continue;
          assert(P.onGlass(c), 'contact hors vitre');
          if (c.type !== 'back') sides.add(c.type);
        }
        if (f === 'A') sides.add(shot.sim.contacts[0].pos.x < 5 ? 'left' : 'right');
      }
    }
    assert(sides.has('left') && sides.has('right'), f + ' : un seul côté généré');
  }
});

test('même graine → même balle, graine différente → balle différente', () => {
  for (const f of SG.FAMILY_IDS) {
    const a = SG.generateShot({ family: f, level: 3, seed: 12345, player: START });
    const b = SG.generateShot({ family: f, level: 3, seed: 12345, player: START });
    assert(JSON.stringify(a.init) === JSON.stringify(b.init), 'états initiaux différents');
    const c = SG.generateShot({ family: f, level: 3, seed: 12346, player: START });
    assert(JSON.stringify(a.init) !== JSON.stringify(c.init));
  }
});

test('difficulté : balles plus rapides aux niveaux élevés', () => {
  for (const f of SG.FAMILY_IDS) {
    const avg = (level) => {
      let sum = 0;
      for (const seed of SEEDS) sum += P.hSpeed(SG.generateShot({ family: f, level, seed, player: START }).init);
      return sum / SEEDS.length;
    };
    assert(avg(5) > avg(1) * 1.15, f + ' : le niveau 5 devrait être nettement plus rapide');
  }
});
