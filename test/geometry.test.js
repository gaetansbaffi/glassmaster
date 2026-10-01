/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import G from '../src/core/geometry.js';
import SG from '../src/core/shotgen.js';
import { SEEDS, START } from './helpers.js';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => {
  const l = Math.sqrt(dot(a, a));
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

section('Géométrie, caméra et contrôles');

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
  const ex = sub(G.worldToScene({ x: 1, y: 0, z: 0 }), s0);
  const ey = sub(G.worldToScene({ x: 0, y: 1, z: 0 }), s0);
  const ez = sub(G.worldToScene({ x: 0, y: 0, z: 1 }), s0);
  near(dot(cross(ex, ey), ez), 1, 1e-12, 'orientation conservée');
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
  const exp = norm({ x: 2, y: -2, z: 1 });
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

test('caméra à hauteur d’yeux derrière le joueur, jamais derrière la vitre', () => {
  const e = G.eyePosition({ x: 5, y: 3 }, 0);
  near(e.z, 1.7, 0);
  near(e.y, 3 - 0.35, 1e-12);
  const glass = G.eyePosition({ x: 5, y: 0.3 }, 0, 1.7, 1);
  assert(glass.y >= 0.15, 'reste devant la vitre de fond');
});

test('balle côté adverse : la remontée dans le temps reste sur la trajectoire et au-dessus du sol', () => {
  for (const f of SG.FAMILY_IDS) {
    for (const seed of SEEDS.slice(0, 15)) {
      const sc = SG.generateShot({ family: f, level: 3, seed, player: START });
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

test('joystick : zone morte, normalisation, courbe de réponse, sensibilité', () => {
  const R = 60;
  // Zone morte (15 % du rayon par défaut) : aucune réponse
  assert(G.joystickVector(0, -8.9, R).y === 0 && G.joystickVector(6, 6, R).x === 0, 'zone morte');
  assert(G.joystickVector(0, -9.5, R).y > 0, 'juste après la zone morte');
  // Normalisation : norme ≤ 1 partout, = 1 au bord et au-delà
  const rng = P.mulberry32(3);
  for (let i = 0; i < 500; i++) {
    const v = G.joystickVector((rng() - 0.5) * 300, (rng() - 0.5) * 300, R, { sensitivity: 0.5 + rng() });
    assert(Math.hypot(v.x, v.y) <= 1 + 1e-12, 'norme > 1');
  }
  near(G.joystickVector(0, -R, R).y, 1, 1e-12, 'bord = vitesse max');
  near(Math.hypot(G.joystickVector(200, 200, R).x, G.joystickVector(200, 200, R).y), 1, 1e-12, 'saturé au-delà du bord');
  // Direction : doigt vers le haut = avancer, vers la droite = droite
  assert(G.joystickVector(0, -40, R).y > 0 && G.joystickVector(40, 0, R).x > 0);
  // Courbe : réponse croissante et plus douce au centre que linéaire
  let prev = 0;
  for (let d = 10; d <= 60; d += 5) {
    const m = G.joystickVector(0, -d, R).y;
    assert(m >= prev, 'réponse non monotone');
    prev = m;
  }
  const mid = G.joystickVector(0, -35, R, { curve: 1.5 }).y;
  const lin = G.joystickVector(0, -35, R, { curve: 1 }).y;
  assert(mid < lin, 'courbe plus douce que linéaire au centre');
  // Sensibilité : plus forte = plus rapide, plafonnée à 1
  assert(G.joystickVector(0, -30, R, { sensitivity: 1.4 }).y > G.joystickVector(0, -30, R).y);
  near(G.joystickVector(0, -55, R, { sensitivity: 2 }).y, 1, 1e-12);
});

test('clavier : ZQSD (AZERTY) = WASD (QWERTY) = flèches, diagonale normalisée', () => {
  const k = G.keyboardVector(new Set(['KeyW', 'KeyD']));
  near(Math.hypot(k.x, k.y), 1, 1e-12, 'diagonale normalisée');
  assert(k.x > 0 && k.y > 0);
  const a = G.keyboardVector(new Set(['ArrowLeft']));
  assert(a.x === -1 && a.y === 0);
  const none = G.keyboardVector(new Set(['KeyW', 'KeyS']));
  assert(none.x === 0 && none.y === 0, 'touches opposées');
});

test('déplacement relatif au regard', () => {
  const f = G.cameraRelativeMove({ x: 0, y: 1 }, 0);
  near(f.x, 0, 1e-12);
  near(f.y, 1, 1e-12, 'regard vers le filet : avancer = vers le filet');
  const r = G.cameraRelativeMove({ x: 1, y: 0 }, 0);
  near(r.x, 1, 1e-12, 'pas chassé à droite');
  const b = G.cameraRelativeMove({ x: 0, y: 1 }, Math.PI);
  near(b.y, -1, 1e-12, 'regard vers la vitre : avancer = vers la vitre');
});

test('caméra : suit la cible en douceur, amplitude et vitesse bornées, horizon stable', () => {
  const opts = { halfLife: 0.15, maxYaw: 2.4, pitchMin: -0.5, pitchMax: 0.6, maxSpeed: 3 };
  let look = { yaw: 0, pitch: 0 };
  const target = { yaw: 1.2, pitch: 0.3 };
  const first = G.cameraStep(look, target, 1 / 60, opts);
  assert(first.yaw > 0 && first.yaw < 1.2 && first.pitch > 0 && first.pitch < 0.3, 'lissé, pas instantané');
  assert(Math.abs(first.yaw) <= opts.maxSpeed / 60 + 1e-12, 'vitesse angulaire bornée');
  for (let i = 0; i < 240; i++) look = G.cameraStep(look, target, 1 / 60, opts);
  near(look.yaw, 1.2, 1e-3, 'converge');
  // Amplitude bornée, même pour une cible derrière
  for (let i = 0; i < 600; i++) look = G.cameraStep(look, { yaw: 3.1, pitch: 1.5 }, 1 / 60, opts);
  assert(look.yaw <= opts.maxYaw + 1e-12 && look.pitch <= opts.pitchMax + 1e-12, 'amplitude');
  for (let i = 0; i < 600; i++) look = G.cameraStep(look, { yaw: -3.1, pitch: -1.5 }, 1 / 60, opts);
  assert(look.yaw >= -opts.maxYaw - 1e-12 && look.pitch >= opts.pitchMin - 1e-12, 'amplitude (autre côté)');
  // Le résultat n'a que lacet et tangage : aucun roulis possible
  assert(Object.keys(look).sort().join() === 'pitch,yaw');
});

test('caméra calme : zone morte en lacet, suivi partiel de la hauteur', () => {
  const opts = { deadYaw: 0.25, basePitch: -0.15, pitchFollow: 0.5 };
  const look = { yaw: 0, pitch: -0.15 };
  // Balle dans la fenêtre centrale : le regard ne tourne pas
  near(G.cameraTarget(look, { yaw: 0.2, pitch: -0.15 }, opts).yaw, 0, 1e-12);
  near(G.cameraTarget(look, { yaw: -0.24, pitch: -0.15 }, opts).yaw, 0, 1e-12);
  // Balle hors fenêtre : on tourne juste assez pour la garder au bord de la fenêtre
  near(G.cameraTarget(look, { yaw: 0.9, pitch: -0.15 }, opts).yaw, 0.65, 1e-12);
  near(G.cameraTarget(look, { yaw: -0.9, pitch: -0.15 }, opts).yaw, -0.65, 1e-12);
  // Passage par ±π : chemin le plus court
  // 3,0 → −3,0 : écart réel de 0,28 rad en passant par π, on avance de 0,03 rad (et non d'un demi-tour)
  near(G.cameraTarget({ yaw: 3.0, pitch: 0 }, { yaw: -3.0, pitch: 0 }, opts).yaw, 2 * Math.PI - 3.25, 1e-9, 'pas de demi-tour');
  // Hauteur : la moitié de l'écart au tangage de base
  near(G.cameraTarget(look, { yaw: 0, pitch: 0.45 }, opts).pitch, 0.15, 1e-12);
});

test('position de caméra : 1re personne aux yeux, vue épaule derrière et au-dessus, toujours dans le court', () => {
  const p = { x: 5, y: 3 };
  const look = { yaw: 0, pitch: -0.1 };
  const fp = G.cameraRig(p, look, 'fp');
  near(fp.pz, 1.7, 1e-12);
  near(fp.py, 3 - 0.35, 1e-12);
  const sh = G.cameraRig(p, look, 'shoulder');
  assert(sh.py < fp.py - 1 && sh.pz > 2, 'épaule : en arrière et au-dessus');
  // La visée suit le regard
  const d = { x: sh.tx - sh.px, y: sh.ty - sh.py, z: sh.tz - sh.pz };
  const a = G.lookAngles({ x: 0, y: 0, z: 0 }, d);
  near(a.yaw, 0, 1e-12);
  near(a.pitch, -0.1, 1e-12);
  // Joueur collé à la vitre de fond ou dans un coin : la caméra reste dans le court
  const rng = P.mulberry32(8);
  for (let i = 0; i < 300; i++) {
    const c = G.cameraRig({ x: 0.3 + rng() * 9.4, y: 0.3 + rng() * 9.2 }, { yaw: (rng() - 0.5) * 6, pitch: -0.2 }, rng() < 0.5 ? 'fp' : 'shoulder');
    assert(c.px >= 0.2 && c.px <= 9.8 && c.py >= 0.2 && c.py <= 19.8, 'caméra hors du court');
  }
});

test('raquette : tête à distance de bras du côté de la balle, geste de l’arrière vers l’avant', () => {
  const p = { x: 5, y: 3 };
  for (const yaw of [0, 1, Math.PI, -2]) {
    for (const side of [1, -1]) {
      const r = G.racketPose(p, yaw, side, 0);
      near(Math.hypot(r.head.x - p.x, r.head.y - p.y), Math.hypot(0.65, 0.2), 1e-9, 'distance de bras');
      // Côté : produit vectoriel regard × (tête − joueur) du signe attendu
      const lateral = (r.head.x - p.x) * Math.cos(yaw) - (r.head.y - p.y) * Math.sin(yaw);
      assert(Math.sign(lateral) === side, 'mauvais côté');
      assert(r.head.z > 0.8 && r.head.z < 1.3 && r.shoulder.z > r.hand.z, 'hauteurs plausibles');
    }
  }
  // Pendant la frappe, la tête passe de derrière à devant le joueur (regard vers le filet)
  const back = G.racketPose(p, 0, 1, 0.01).head.y - p.y;
  const front = G.racketPose(p, 0, 1, 1).head.y - p.y;
  assert(back < 0 && front > 0.5, `geste : ${back} → ${front}`);
});

test('coup droit / revers : côté de la balle avec hystérésis', () => {
  const p = { x: 5, y: 3 };
  assert(G.pickSide(1, p, 0, { x: 4, y: 5 }) === -1, 'balle à gauche → revers');
  assert(G.pickSide(-1, p, 0, { x: 6, y: 5 }) === 1, 'balle à droite → coup droit');
  assert(G.pickSide(1, p, 0, { x: 4.9, y: 5 }) === 1, 'balle presque en face : on garde le côté');
  assert(G.pickSide(-1, p, Math.PI, { x: 4, y: 1 }) === 1, 'regard vers la vitre : gauche et droite inversées');
});
