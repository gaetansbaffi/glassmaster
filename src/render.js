/*
 * Glass Lab — rendu 3D (Three.js) : court, parois, balle, ombre, trajectoire et repères.
 *
 * Les positions arrivent dans le repère monde de src/core (x largeur, y profondeur, z hauteur)
 * et sont converties sans allocation par G.worldToSceneInto. Aucun objet n'est créé dans update() /
 * render() : tout est préparé à la construction ou au changement de balle (setShot).
 */
import * as THREE from 'three';
import G from './core/geometry.js';

const COURT_W = 10;
const COURT_L = 20;
const BALL_VISUAL_RADIUS = 0.07; // ≈ 2 × le rayon réel : la balle reste lisible sur un petit écran
const RADIAL = 6;

const COLORS = {
  sky: 0x9fcdee,
  apron: 0x1d3a55,
  turf: 0x2463b0,
  line: 0xffffff,
  glass: 0xd4f4ff,
  frame: 0x1c2026,
  mesh: 0x9aa6b2,
  net: 0x14181d,
  ball: 0xf2ff1f,
  ballEdge: 0x2e3300,
  opponent: 0xe0483e,
  player: 0xffffff,
  best: 0x2ee88a,
  mine: 0xff9f1c,
  racket: 0x111820,
  racketFace: 0xff5a36,
  skin: 0xf0c8a0,
};

/** Nouveau vecteur scène depuis un point monde (construction uniquement, jamais dans la boucle). */
const sv = (x, y, z) => G.worldToSceneInto(new THREE.Vector3(), x, y, z);

/* ---------- Construction du court ---------- */

/**
 * Panneaux d'une moitié de court (défense, y ∈ [0, 10]) ; l'autre moitié par symétrie y → 20 − y.
 * Approximation : vitre de fond 3 m + 1 m de grillage ; latérales vitrées 3 m sur 4 m puis 2 m sur 2 m,
 * grillage au-dessus et sur le reste de la longueur.
 */
const HALF_WALLS = {
  glass: [
    { wall: 'back', from: 0, to: COURT_W, z0: 0, z1: 3 },
    { wall: 'left', from: 0, to: 4, z0: 0, z1: 3 },
    { wall: 'left', from: 4, to: 6, z0: 0, z1: 2 },
    { wall: 'right', from: 0, to: 4, z0: 0, z1: 3 },
    { wall: 'right', from: 4, to: 6, z0: 0, z1: 2 },
  ],
  mesh: [
    { wall: 'back', from: 0, to: COURT_W, z0: 3, z1: 4 },
    { wall: 'left', from: 0, to: 4, z0: 3, z1: 4 },
    { wall: 'left', from: 4, to: 6, z0: 2, z1: 3 },
    { wall: 'left', from: 6, to: 10, z0: 0, z1: 3 },
    { wall: 'right', from: 0, to: 4, z0: 3, z1: 4 },
    { wall: 'right', from: 4, to: 6, z0: 2, z1: 3 },
    { wall: 'right', from: 6, to: 10, z0: 0, z1: 3 },
  ],
};

function panelCorners(p, half) {
  const my = (y) => (half ? COURT_L - y : y);
  if (p.wall === 'back') {
    const y = my(0);
    return [
      { x: p.from, y, z: p.z0 },
      { x: p.to, y, z: p.z0 },
      { x: p.to, y, z: p.z1 },
      { x: p.from, y, z: p.z1 },
    ];
  }
  const x = p.wall === 'left' ? 0 : COURT_W;
  return [
    { x, y: my(p.from), z: p.z0 },
    { x, y: my(p.to), z: p.z0 },
    { x, y: my(p.to), z: p.z1 },
    { x, y: my(p.from), z: p.z1 },
  ];
}

function quadPositions(corners, out) {
  const pts = corners.map((c) => sv(c.x, c.y, c.z));
  for (const i of [0, 1, 2, 0, 2, 3]) out.push(pts[i].x, pts[i].y, pts[i].z);
}

function meshGridSegments(corners, step, out) {
  const [a, b, , d] = corners;
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const w = { x: d.x - a.x, y: d.y - a.y, z: d.z - a.z };
  const lu = Math.hypot(u.x, u.y, u.z);
  const lw = Math.hypot(w.x, w.y, w.z);
  const at = (s, t) => sv(a.x + u.x * s + w.x * t, a.y + u.y * s + w.y * t, a.z + u.z * s + w.z * t);
  for (let i = 0; i <= Math.round(lu / step); i++) {
    const s = Math.min(1, (i * step) / lu);
    out.push(at(s, 0), at(s, 1));
  }
  for (let j = 0; j <= Math.round(lw / step); j++) {
    const t = Math.min(1, (j * step) / lw);
    out.push(at(0, t), at(1, t));
  }
}

function frameBars() {
  const bars = [];
  const T = 0.07;
  const post = (x, y, h) => bars.push({ c: [x, y, h / 2], s: [T, T, h] });
  const railX = (y, x0, x1, z) => bars.push({ c: [(x0 + x1) / 2, y, z], s: [x1 - x0, T, T] });
  const railY = (x, y0, y1, z) => bars.push({ c: [x, (y0 + y1) / 2, z], s: [T, Math.abs(y1 - y0), T] });
  for (const half of [0, 1]) {
    const my = (y) => (half ? COURT_L - y : y);
    for (let x = 0; x <= COURT_W; x += 2) post(x, my(0), 4);
    railX(my(0), 0, COURT_W, 3);
    railX(my(0), 0, COURT_W, 4);
    for (const x of [0, COURT_W]) {
      post(x, my(2), 4);
      post(x, my(4), 4);
      post(x, my(6), 3);
      post(x, my(8), 3);
      railY(x, my(0), my(4), 3);
      railY(x, my(0), my(4), 4);
      railY(x, my(4), my(6), 2);
      railY(x, my(4), my(10), 3);
    }
  }
  return bars;
}

function buildCourt(disposables) {
  const group = new THREE.Group();
  const track = (o) => (disposables.push(o), o);
  const lambert = (color, extra) => track(new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, extra)));

  const apron = new THREE.Mesh(track(new THREE.PlaneGeometry(40, 50)), lambert(COLORS.apron));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  group.add(apron);
  const turf = new THREE.Mesh(track(new THREE.PlaneGeometry(COURT_W, COURT_L)), lambert(COLORS.turf));
  turf.rotation.x = -Math.PI / 2;
  group.add(turf);

  // Lignes de service (6,95 m du filet) et ligne centrale
  const lineMat = track(new THREE.MeshBasicMaterial({ color: COLORS.line }));
  const service = 10 - 6.95;
  const strips = [
    [0, service, COURT_W, service],
    [0, COURT_L - service, COURT_W, COURT_L - service],
    [COURT_W / 2, service, COURT_W / 2, COURT_L - service],
  ];
  for (const [x0, y0, x1, y1] of strips) {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(Math.hypot(x1 - x0, y1 - y0), 0.06)), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    m.position.copy(sv((x0 + x1) / 2, (y0 + y1) / 2, 0.004));
    group.add(m);
  }

  // Filet
  const net = new THREE.Mesh(
    track(new THREE.PlaneGeometry(COURT_W, 0.88)),
    track(new THREE.MeshBasicMaterial({ color: COLORS.net, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }))
  );
  net.position.copy(sv(COURT_W / 2, 10, 0.44));
  group.add(net);
  const band = new THREE.Mesh(track(new THREE.BoxGeometry(COURT_W, 0.05, 0.03)), lineMat);
  band.position.copy(sv(COURT_W / 2, 10, 0.88));
  group.add(band);

  // Vitres (une seule géométrie) et grillage (une seule géométrie de segments)
  const glassPos = [];
  const meshPts = [];
  for (const half of [0, 1]) {
    for (const p of HALF_WALLS.glass) quadPositions(panelCorners(p, half), glassPos);
    for (const p of HALF_WALLS.mesh) meshGridSegments(panelCorners(p, half), 0.25, meshPts);
  }
  const glassGeo = track(new THREE.BufferGeometry());
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3));
  glassGeo.computeVertexNormals();
  group.add(
    new THREE.Mesh(
      glassGeo,
      track(new THREE.MeshBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }))
    )
  );
  group.add(
    new THREE.LineSegments(
      track(new THREE.BufferGeometry().setFromPoints(meshPts)),
      track(new THREE.LineBasicMaterial({ color: COLORS.mesh, transparent: true, opacity: 0.55 }))
    )
  );

  // Cadres : une seule InstancedMesh
  const bars = frameBars();
  const frames = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1, 1, 1)), lambert(COLORS.frame), bars.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  bars.forEach((b, i) => {
    m4.compose(sv(b.c[0], b.c[1], b.c[2]), q, new THREE.Vector3(b.s[0], b.s[2], b.s[1]));
    frames.setMatrixAt(i, m4);
  });
  group.add(frames);
  return group;
}

/** Silhouette low-poly (corps + tête). */
function figure(color, disposables) {
  const g = new THREE.Group();
  const geoBody = new THREE.CylinderGeometry(0.17, 0.22, 1.3, 7);
  const geoHead = new THREE.IcosahedronGeometry(0.14, 0);
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf0c8a0, flatShading: true });
  disposables.push(geoBody, geoHead, mat, skin);
  const body = new THREE.Mesh(geoBody, mat);
  body.position.y = 0.65;
  const head = new THREE.Mesh(geoHead, skin);
  head.position.y = 1.5;
  g.add(body, head);
  return g;
}

/* ---------- Trajectoire (tube) ---------- */

/** Polyligne paramétrée par l'indice des points : rebonds anguleux, segment j = intervalle de temps j. */
class IndexPolyline extends THREE.Curve {
  constructor(points) {
    super();
    this.points = points;
  }
  getPoint(u, target = new THREE.Vector3()) {
    const n = this.points.length;
    const f = Math.min(Math.max(u, 0), 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    return target.copy(this.points[i]).lerp(this.points[i + 1], f - i);
  }
  getUtoTmapping(u) {
    return u;
  }
}

/* ---------- Rendu ---------- */

/**
 * Crée le rendu dans `canvas`. Lève une exception si WebGL n'est pas disponible.
 * opts = { antialias }
 */
export function createRenderer(canvas, opts) {
  opts = opts || {};
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!opts.antialias, powerPreference: 'high-performance', alpha: false });
  renderer.shadowMap.enabled = false;
  const disposables = [];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 32, 75);
  scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x22303e, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-6, 14, 8);
  scene.add(sun);
  scene.add(buildCourt(disposables));

  // Balle très visible + contour sombre (lisible devant le ciel comme devant le gazon)
  const ballGeo = new THREE.SphereGeometry(BALL_VISUAL_RADIUS, 14, 10);
  const ballMat = new THREE.MeshBasicMaterial({ color: COLORS.ball });
  const edgeMat = new THREE.MeshBasicMaterial({ color: COLORS.ballEdge, side: THREE.BackSide });
  disposables.push(ballGeo, ballMat, edgeMat);
  const ball = new THREE.Mesh(ballGeo, ballMat);
  const edge = new THREE.Mesh(ballGeo, edgeMat);
  edge.scale.setScalar(1.32);
  ball.add(edge);
  scene.add(ball);

  // Ombre ronde au sol, indispensable pour percevoir la profondeur
  const shadowGeo = new THREE.CircleGeometry(0.09, 20);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
  disposables.push(shadowGeo, shadowMat);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const opponent = figure(COLORS.opponent, disposables);
  scene.add(opponent);
  const playerFig = figure(COLORS.player, disposables);
  playerFig.visible = false;
  playerFig.traverse((o) => {
    if (o.material) {
      o.material.transparent = true; // en vue épaule, le corps ne masque pas la balle
      o.material.opacity = 0.6;
    }
  });
  scene.add(playerFig);

  // Bras + raquette, attachés au corps du joueur : la tête de raquette matérialise la portée
  const UP = new THREE.Vector3(0, 1, 0);
  const armGeo = new THREE.CylinderGeometry(0.045, 0.04, 1, 6);
  armGeo.translate(0, 0.5, 0); // origine à l'épaule, longueur 1 le long de +y
  const handleGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.2, 6);
  handleGeo.translate(0, 0.1, 0);
  const headGeo = new THREE.CylinderGeometry(0.135, 0.135, 0.035, 16);
  headGeo.rotateX(Math.PI / 2); // disque dans le plan du manche
  headGeo.scale(1, 1.12, 1); // tête légèrement ovale
  headGeo.translate(0, 0.33, 0);
  const rimGeo = new THREE.TorusGeometry(0.135, 0.012, 6, 20);
  rimGeo.scale(1, 1.12, 1);
  rimGeo.translate(0, 0.33, 0);
  const armMat = new THREE.MeshLambertMaterial({ color: COLORS.skin, flatShading: true });
  const racketMat = new THREE.MeshLambertMaterial({ color: COLORS.racket, flatShading: true });
  const faceMat = new THREE.MeshLambertMaterial({ color: COLORS.racketFace, flatShading: true, transparent: true, opacity: 0.75 });
  disposables.push(armGeo, handleGeo, headGeo, rimGeo, armMat, racketMat, faceMat);
  const arm = new THREE.Mesh(armGeo, armMat);
  const racket = new THREE.Group();
  racket.add(new THREE.Mesh(handleGeo, racketMat), new THREE.Mesh(headGeo, faceMat), new THREE.Mesh(rimGeo, racketMat));
  arm.visible = racket.visible = false;
  scene.add(arm, racket);
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();
  const tDir = new THREE.Vector3();

  /** Oriente `obj` (axe +y local) de a vers b ; échelle en y = longueur si `stretch`. */
  function aim(obj, a, b, stretch) {
    G.worldToSceneInto(tA, a.x, a.y, a.z);
    G.worldToSceneInto(tB, b.x, b.y, b.z);
    tDir.subVectors(tB, tA);
    const len = tDir.length();
    obj.position.copy(tA);
    obj.quaternion.setFromUnitVectors(UP, tDir.multiplyScalar(1 / Math.max(len, 1e-6)));
    if (stretch) obj.scale.set(1, len, 1);
  }

  // Trait vertical balle → sol : relie la balle à son ombre pour lire hauteur et profondeur
  const stemGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 5);
  stemGeo.translate(0, 0.5, 0);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false });
  disposables.push(stemGeo, stemMat);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.visible = false;
  scene.add(stem);

  // Anneau de portée aux pieds du joueur (0,3 à 1,1 m) : la balle est jouable quand son ombre y entre
  const footGeo = new THREE.RingGeometry(0.3, 1.1, 48);
  const footMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  disposables.push(footGeo, footMat);
  const footRing = new THREE.Mesh(footGeo, footMat);
  footRing.rotation.x = -Math.PI / 2;
  footRing.visible = false;
  scene.add(footRing);

  // Repères : meilleur point (vert), ta frappe (orange), anneaux au sol — créés une fois, déplacés ensuite
  const dotGeo = new THREE.SphereGeometry(0.09, 12, 8);
  const ringGeo = new THREE.RingGeometry(0.28, 0.38, 32);
  const reachGeo = new THREE.RingGeometry(0.3, 1.1, 40);
  const bestMat = new THREE.MeshBasicMaterial({ color: COLORS.best });
  const mineMat = new THREE.MeshBasicMaterial({ color: COLORS.mine });
  const bestRingMat = new THREE.MeshBasicMaterial({ color: COLORS.best, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const reachMat = new THREE.MeshBasicMaterial({ color: COLORS.mine, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  disposables.push(dotGeo, ringGeo, reachGeo, bestMat, mineMat, bestRingMat, reachMat);
  const bestDot = new THREE.Mesh(dotGeo, bestMat);
  const mineDot = new THREE.Mesh(dotGeo, mineMat);
  const bestRing = new THREE.Mesh(ringGeo, bestRingMat);
  const reachRing = new THREE.Mesh(reachGeo, reachMat);
  bestRing.rotation.x = reachRing.rotation.x = -Math.PI / 2;
  for (const m of [bestDot, mineDot, bestRing, reachRing]) {
    m.visible = false;
    scene.add(m);
  }

  // Trajectoire de la balle courante : tube reconstruit à chaque nouvelle balle (pas à chaque image)
  const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
  disposables.push(pathMat);
  let path = null;
  let pathTimes = null;

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 90);
  const tmp = new THREE.Vector3();
  const size = { w: 1, h: 1 };

  /**
   * Nouvelle balle : trajectoire échantillonnée (points monde + instants) et position de l'adversaire.
   * samples = [{ t, x, y, z }], hit = point de frappe adverse { x, y }.
   */
  function setShot(samples, hit) {
    if (path) {
      scene.remove(path);
      path.geometry.dispose();
      path = null;
    }
    const pts = [];
    const times = [];
    for (const s of samples) {
      const v = sv(s.x, s.y, s.z);
      if (pts.length && v.distanceToSquared(pts[pts.length - 1]) < 1e-8) continue;
      pts.push(v);
      times.push(s.t);
    }
    if (pts.length > 1) {
      path = new THREE.Mesh(new THREE.TubeGeometry(new IndexPolyline(pts), pts.length - 1, 0.018, RADIAL, false), pathMat);
      path.visible = false;
      scene.add(path);
      pathTimes = times;
    }
    G.worldToSceneInto(opponent.position, G.clamp(hit.x - 0.55, 0.4, COURT_W - 0.4), Math.min(hit.y + 0.3, COURT_L - 0.4), 0);
    opponent.rotation.y = Math.PI;
  }

  /** Nombre d'indices de tube à afficher pour la trajectoire jusqu'à l'instant t (recherche dichotomique). */
  function pathCount(t) {
    let lo = 0;
    let hi = pathTimes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pathTimes[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo * RADIAL * 6;
  }

  /**
   * Met à jour la scène pour l'image courante (aucune allocation).
   * v = {
   *   ball: { x, y, z } | null, player: { x, y },
   *   cam: { px, py, pz, tx, ty, tz, topDown: bool }, fov,
   *   path: 'off' | 'full' | 'upTo', pathT,
   *   best: { bx, by, bz, px, py } | null, mine: { bx, by, bz } | null, reach: { x, y } | null,
   *   opponent: { x, y } | null, showPlayer: bool, racket: { shoulder, hand, head } | null, heightLine: bool, footRing: { x, y } | null,
   *   viewShift / viewShiftY : décalage de l'image en fraction de largeur / hauteur (panneau Détail)
   * }
   */
  function update(v) {
    ball.visible = shadow.visible = !!v.ball;
    if (v.ball) {
      G.worldToSceneInto(ball.position, v.ball.x, v.ball.y, v.ball.z);
      G.worldToSceneInto(shadow.position, v.ball.x, v.ball.y, 0.006);
      shadowMat.opacity = 0.55 * Math.max(0.25, 1 - v.ball.z / 5);
      shadow.scale.setScalar(1 + v.ball.z * 0.25);
    }
    if (path) {
      path.visible = v.path !== 'off';
      if (v.path === 'upTo') path.geometry.setDrawRange(0, pathCount(v.pathT));
      else path.geometry.setDrawRange(0, Infinity);
    }
    bestDot.visible = bestRing.visible = !!v.best;
    if (v.best) {
      G.worldToSceneInto(bestDot.position, v.best.bx, v.best.by, v.best.bz);
      G.worldToSceneInto(bestRing.position, v.best.px, v.best.py, 0.012);
    }
    mineDot.visible = !!v.mine;
    if (v.mine) G.worldToSceneInto(mineDot.position, v.mine.bx, v.mine.by, v.mine.bz);
    reachRing.visible = !!v.reach;
    if (v.reach) G.worldToSceneInto(reachRing.position, v.reach.x, v.reach.y, 0.01);
    // Adversaire : suit l'échange (il court vers ta balle) ; sinon reste où setShot l'a placé
    if (v.opponent) G.worldToSceneInto(opponent.position, v.opponent.x, v.opponent.y, 0);
    playerFig.visible = !!v.showPlayer;
    if (v.showPlayer) G.worldToSceneInto(playerFig.position, v.player.x, v.player.y, 0);
    arm.visible = racket.visible = !!v.racket;
    if (v.racket) {
      aim(arm, v.racket.shoulder, v.racket.hand, true);
      aim(racket, v.racket.hand, v.racket.head, false);
    }
    stem.visible = !!(v.heightLine && v.ball && v.ball.z > 0.05);
    if (stem.visible) {
      G.worldToSceneInto(stem.position, v.ball.x, v.ball.y, 0);
      stem.scale.set(1, v.ball.z, 1);
    }
    footRing.visible = !!v.footRing;
    if (v.footRing) G.worldToSceneInto(footRing.position, v.footRing.x, v.footRing.y, 0.008);

    const c = v.cam;
    camera.fov = v.fov;
    camera.aspect = size.w / size.h;
    if (c.topDown) camera.up.set(0, 0, -1); // vue de dessus : le filet en haut de l'écran
    else camera.up.set(0, 1, 0); // horizon stable, jamais de roulis
    G.worldToSceneInto(camera.position, c.px, c.py, c.pz);
    camera.lookAt(G.worldToSceneInto(tmp, c.tx, c.ty, c.tz));
    // Décalage horizontal de l'image (fraction de largeur) quand un panneau couvre une partie de l'écran
    if (v.viewShift || v.viewShiftY) camera.setViewOffset(size.w, size.h, (v.viewShift || 0) * size.w, (v.viewShiftY || 0) * size.h, size.w, size.h);
    else if (camera.view) camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  return {
    renderer,
    setShot,
    update,
    render() {
      renderer.render(scene, camera);
    },
    resize(w, h) {
      size.w = Math.max(1, Math.round(w));
      size.h = Math.max(1, Math.round(h));
      renderer.setSize(size.w, size.h, false);
    },
    setPixelRatio(pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(size.w, size.h, false);
    },
    get pixelRatio() {
      return renderer.getPixelRatio();
    },
    dispose() {
      if (path) path.geometry.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}

/** WebGL disponible ? (test sans créer la scène) */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}
