/*
 * Glass Lab — vue 3D première personne (Three.js, module ES).
 *
 * Réutilise physics.js, scenarios.js et geometry.js (scripts classiques chargés avant).
 * Toutes les positions sont exprimées dans le repère monde de physics.js puis converties
 * par GlassGeometry.worldToScene : x largeur, y profondeur (0 = vitre de fond), z hauteur.
 */
import * as THREE from 'three';

const P = window.GlassPhysics;
const G = window.GlassGeometry;

const COURT_W = 10;
const COURT_L = 20;
const BALL_VISUAL_RADIUS = 0.07; // ≈ 2 × le rayon réel, pour rester visible sur un petit écran

const COLORS = {
  sky: 0xa9d2ef,
  apron: 0x23415c,
  turf: 0x2a6cb5,
  line: 0xffffff,
  glass: 0xc8f1ff,
  frame: 0x2b3037,
  mesh: 0x8e98a3,
  net: 0x1b1f24,
  ball: 0xe9ff3b,
};

const sceneVec = (p) => {
  const s = G.worldToScene(p);
  return new THREE.Vector3(s.x, s.y, s.z);
};

/* ---------- Construction du court (scène statique) ---------- */

/**
 * Panneaux de paroi d'une moitié de court (côté défense, y ∈ [0, 10]).
 * L'autre moitié s'obtient par symétrie y → 20 − y.
 * Approximation : vitres de fond 3 m + grillage 1 m au-dessus ; latérales vitrées 3 m sur 4 m
 * puis 2 m sur 2 m, grillage au-dessus et sur le reste de la longueur (hauteur totale 4 m puis 3 m).
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

/** Les 4 coins (monde) d'un panneau, pour la moitié `half` (0 = défense, 1 = adverse). */
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

function quadGeometry(corners) {
  const g = new THREE.BufferGeometry();
  const pts = corners.map(sceneVec);
  const pos = new Float32Array([
    ...pts[0].toArray(), ...pts[1].toArray(), ...pts[2].toArray(),
    ...pts[0].toArray(), ...pts[2].toArray(), ...pts[3].toArray(),
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Grillage : quadrillage de segments sur le panneau (une seule géométrie pour tous). */
function meshGridSegments(corners, step, out) {
  const [a, b, , d] = corners;
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const w = { x: d.x - a.x, y: d.y - a.y, z: d.z - a.z };
  const lu = Math.hypot(u.x, u.y, u.z);
  const lw = Math.hypot(w.x, w.y, w.z);
  const at = (s, t) => sceneVec({ x: a.x + u.x * s + w.x * t, y: a.y + u.y * s + w.y * t, z: a.z + u.z * s + w.z * t });
  for (let i = 0; i <= Math.round(lu / step); i++) {
    const s = Math.min(1, (i * step) / lu);
    out.push(at(s, 0), at(s, 1));
  }
  for (let j = 0; j <= Math.round(lw / step); j++) {
    const t = Math.min(1, (j * step) / lw);
    out.push(at(0, t), at(1, t));
  }
}

/** Montants et traverses (cadres) : liste de boîtes { centre monde, taille monde }. */
function frameBars() {
  const bars = [];
  const T = 0.07;
  const post = (x, y, h) => bars.push({ c: { x, y, z: h / 2 }, s: { x: T, y: T, z: h } });
  const railX = (y, x0, x1, z) => bars.push({ c: { x: (x0 + x1) / 2, y, z }, s: { x: x1 - x0, y: T, z: T } });
  const railY = (x, y0, y1, z) => bars.push({ c: { x, y: (y0 + y1) / 2, z }, s: { x: T, y: y1 - y0, z: T } });
  for (const half of [0, 1]) {
    const my = (y) => (half ? COURT_L - y : y);
    // Fond : 5 vitres de 2 m, grillage au-dessus jusqu'à 4 m
    for (let x = 0; x <= COURT_W; x += 2) post(x, my(0), 4);
    railX(my(0), 0, COURT_W, 3);
    railX(my(0), 0, COURT_W, 4);
    for (const x of [0, COURT_W]) {
      post(x, my(2), 4);
      post(x, my(4), 4);
      post(x, my(6), 3);
      post(x, my(8), 3);
      railY(x, Math.min(my(0), my(4)), Math.max(my(0), my(4)), 3);
      railY(x, Math.min(my(0), my(4)), Math.max(my(0), my(4)), 4);
      railY(x, Math.min(my(4), my(6)), Math.max(my(4), my(6)), 2);
      railY(x, Math.min(my(4), my(10)), Math.max(my(4), my(10)), 3);
    }
  }
  return bars;
}

function buildCourt() {
  const group = new THREE.Group();
  const lambert = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, extra));

  // Sol : abords + gazon synthétique
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(40, 50), lambert(COLORS.apron));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  group.add(apron);
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_L), lambert(COLORS.turf));
  turf.rotation.x = -Math.PI / 2;
  group.add(turf);

  // Lignes : service à 6,95 m du filet de chaque côté, ligne centrale entre les deux
  const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
  const strip = (x0, y0, x1, y1, w) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(-(y1 - y0), x1 - x0);
    const c = sceneVec({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0.004 });
    m.position.copy(c);
    group.add(m);
  };
  const service = 10 - 6.95;
  strip(0, service, COURT_W, service, 0.05);
  strip(0, COURT_L - service, COURT_W, COURT_L - service, 0.05);
  strip(COURT_W / 2, service, COURT_W / 2, COURT_L - service, 0.05);

  // Filet : toile sombre semi-transparente, bande blanche, poteaux
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT_W, 0.88),
    new THREE.MeshBasicMaterial({ color: COLORS.net, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  net.position.copy(sceneVec({ x: COURT_W / 2, y: 10, z: 0.44 }));
  group.add(net);
  const band = new THREE.Mesh(new THREE.BoxGeometry(COURT_W, 0.05, 0.03), lineMat);
  band.position.copy(sceneVec({ x: COURT_W / 2, y: 10, z: 0.88 }));
  group.add(band);
  for (const x of [-0.05, COURT_W + 0.05]) {
    const postMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), lambert(COLORS.frame));
    postMesh.position.copy(sceneVec({ x, y: 10, z: 0.475 }));
    group.add(postMesh);
  }

  // Vitres : verre semi-transparent
  const glassMat = new THREE.MeshLambertMaterial({
    color: COLORS.glass,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Grillage : quadrillage de segments
  const meshPts = [];
  for (const half of [0, 1]) {
    for (const p of HALF_WALLS.glass) group.add(new THREE.Mesh(quadGeometry(panelCorners(p, half)), glassMat));
    for (const p of HALF_WALLS.mesh) meshGridSegments(panelCorners(p, half), 0.25, meshPts);
  }
  const meshGeo = new THREE.BufferGeometry().setFromPoints(meshPts);
  group.add(new THREE.LineSegments(meshGeo, new THREE.LineBasicMaterial({ color: COLORS.mesh, transparent: true, opacity: 0.55 })));

  // Cadres : une seule InstancedMesh pour tous les montants et traverses
  const bars = frameBars();
  const frames = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lambert(COLORS.frame), bars.length);
  const m4 = new THREE.Matrix4();
  bars.forEach((b, i) => {
    const c = sceneVec(b.c);
    // taille monde (x, y, z) → scène (x, z, y)
    m4.compose(c, new THREE.Quaternion(), new THREE.Vector3(b.s.x, b.s.z, b.s.y));
    frames.setMatrixAt(i, m4);
  });
  group.add(frames);

  return group;
}

/* ---------- Contrôleur de vue ---------- */

function create(opts) {
  const container = opts.container;
  const getApp = opts.getApp;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'view3d-canvas';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 30, 70);
  scene.add(new THREE.HemisphereLight(0xeef6ff, 0x2a3a4a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-6, 14, 8);
  scene.add(sun);
  scene.add(buildCourt());

  // Balle + ombre ronde projetée au sol
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_VISUAL_RADIUS, 14, 10), new THREE.MeshBasicMaterial({ color: COLORS.ball }));
  const outline = new THREE.Mesh(ball.geometry, new THREE.MeshBasicMaterial({ color: 0x3a4200, side: THREE.BackSide }));
  outline.scale.setScalar(1.3);
  ball.add(outline); // contour sombre : la balle reste lisible devant le ciel comme devant le gazon
  scene.add(ball);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 90);
  const size = { w: 1, h: 1 };

  function resize(w, h) {
    size.w = Math.max(1, Math.round(w));
    size.h = Math.max(1, Math.round(h));
    renderer.setSize(size.w, size.h, false);
    renderer.domElement.style.width = size.w + 'px';
    renderer.domElement.style.height = size.h + 'px';
  }

  function ballWorld(app) {
    if (!app.sc) return null;
    return app.ballAt(app.t);
  }

  function updateBall(s) {
    ball.visible = shadow.visible = !!s;
    if (!s) return;
    ball.position.copy(sceneVec(s));
    shadow.position.copy(sceneVec({ x: s.x, y: s.y, z: 0.006 }));
    const k = Math.max(0.25, 1 - s.z / 5);
    shadowMat.opacity = 0.55 * k;
    shadow.scale.setScalar(1 + s.z * 0.25);
  }

  function updateCamera(app, s) {
    const player = app.player || { x: COURT_W / 2, y: 3 };
    const eye = G.eyePosition(player, 0);
    const target = s || { x: COURT_W / 2, y: 10, z: 1 };
    camera.up.set(0, 1, 0);
    camera.position.copy(sceneVec(eye));
    camera.lookAt(sceneVec(target));
    camera.aspect = size.w / size.h;
    camera.fov = G.verticalFov(75, camera.aspect);
    camera.updateProjectionMatrix();
  }

  let running = false;
  function frame() {
    const app = getApp();
    const s = ballWorld(app);
    updateBall(s);
    updateCamera(app, s);
    renderer.render(scene, camera);
  }

  return {
    resize,
    start() {
      if (running) return;
      running = true;
      renderer.setAnimationLoop(frame);
    },
    stop() {
      running = false;
      renderer.setAnimationLoop(null);
    },
    setScenario() {},
    refresh() {},
  };
}

window.GlassView3D = { create, revision: THREE.REVISION };
document.dispatchEvent(new Event('glass3d-ready'));
