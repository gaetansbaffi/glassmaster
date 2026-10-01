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

/* ---------- Trajectoires et repères (replay) ---------- */

/**
 * Polyligne paramétrée par l'indice des points (u = i / (n − 1)), sans lissage : les rebonds
 * restent anguleux et le j-ième segment du tube correspond exactement au j-ième intervalle de temps.
 */
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
    return u; // pas de reparamétrage par la longueur
  }
}

const RADIAL = 6;

/**
 * Tube suivant la trajectoire, échantillonné régulièrement dans le temps (contacts inclus).
 * Retourne { mesh, times } : times[j] = instant du j-ième point, pour limiter l'affichage à t.
 */
function trajectoryTube(points, times, radius, material) {
  // Supprime les points confondus (un contact tombant sur un échantillon) : tangente indéfinie sinon
  const P2 = [points[0]];
  const T2 = [times[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceToSquared(P2[P2.length - 1]) < 1e-8) continue;
    P2.push(points[i]);
    T2.push(times[i]);
  }
  const geo = new THREE.TubeGeometry(new IndexPolyline(P2), P2.length - 1, radius, RADIAL, false);
  return { mesh: new THREE.Mesh(geo, material), times: T2 };
}

/** Nombre d'indices de tube à afficher pour montrer la trajectoire jusqu'à l'instant t. */
function tubeCountAt(tube, t) {
  const times = tube.times;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo * RADIAL * 6;
}

/* ---------- Contrôleur de vue ---------- */

/**
 * opts = {
 *   container, getApp, getSettings,
 *   canMove()       → vrai si le joueur peut se déplacer (placement, temps réel),
 *   onPlayerMove(p) → nouvelle position { x, y } du joueur,
 *   onGroundTap(p)  → point du sol touché { x, y } (mode lecture),
 *   joystickOn()    → vrai si le joystick doit s'afficher sans que la vue déplace le joueur
 *                     (match : le déplacement est piloté par rally.js via moveVector()),
 * }
 */
function create(opts) {
  const container = opts.container;
  const getApp = opts.getApp;
  const getSettings = opts.getSettings || (() => ({}));
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

  // Traînée courte : quelques sphères translucides aux positions récentes
  const TRAIL_N = 7;
  const trail = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const m = new THREE.Mesh(ball.geometry, new THREE.MeshBasicMaterial({ color: COLORS.ball, transparent: true, opacity: 0.45 * (1 - i / TRAIL_N), depthWrite: false }));
    m.scale.setScalar(0.85 - i * 0.07);
    scene.add(m);
    trail.push(m);
  }

  // Adversaire stylisé, placé là où la balle a été frappée (avant le filet)
  const opponent = figure(0xd9534f);
  scene.add(opponent);

  // Repère de réponse (mode lecture) : anneau au sol + mât pour le voir de loin
  const answerMarker = markerGroup(0xff9f1c);
  scene.add(answerMarker);
  // Ligne de profondeur (question « où passera la balle à d m de la vitre ? »)
  const depthLine = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT_W, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.9, depthWrite: false })
  );
  depthLine.rotation.x = -Math.PI / 2;
  depthLine.visible = false;
  scene.add(depthLine);

  // Trajectoire réelle (replay) et trajectoire révélée (débutants)
  const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const revealMat = new THREE.MeshBasicMaterial({ color: COLORS.ball, transparent: true, opacity: 0.45, depthWrite: false });
  let path = null;
  let revealPath = null;
  // Repères du résultat, reconstruits à chaque nouvelle réponse
  const overlay = new THREE.Group();
  scene.add(overlay);
  let overlayFor = null;
  const playerFig = figure(0xffffff);
  playerFig.visible = false;
  scene.add(playerFig);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 90);
  const size = { w: 1, h: 1 };
  const look = { yaw: Math.PI, pitch: -0.1, ready: false };
  /** Caméra courante en coordonnées monde (sert aussi au rayon vers le sol). */
  let camWorld = null;

  /* ----- Entrées : clavier, joystick, regard libre, tap au sol ----- */

  const keys = new Set();
  let active = false;
  const typing = (e) => /input|textarea|select/i.test((e.target && e.target.tagName) || '');
  window.addEventListener('keydown', (e) => {
    if (!active || typing(e)) return;
    if (/^(Arrow|Key[WASD])/.test(e.code)) {
      keys.add(e.code);
      if ((opts.canMove && opts.canMove()) || (opts.joystickOn && opts.joystickOn())) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const joy = document.createElement('div');
  joy.className = 'joy';
  joy.innerHTML = '<div class="joy-knob"></div>';
  joy.setAttribute('aria-label', 'Joystick de déplacement');
  container.appendChild(joy);
  const knob = joy.firstChild;
  const joyState = { id: null, cx: 0, cy: 0, vec: { x: 0, y: 0 } };
  const JOY_R = 46;
  joy.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const r = joy.getBoundingClientRect();
    joyState.id = e.pointerId;
    joyState.cx = r.left + r.width / 2;
    joyState.cy = r.top + r.height / 2;
    joy.setPointerCapture(e.pointerId);
    joyMove(e);
  });
  function joyMove(e) {
    if (e.pointerId !== joyState.id) return;
    const dx = e.clientX - joyState.cx;
    const dy = e.clientY - joyState.cy;
    joyState.vec = G.joystickVector(dx, dy, JOY_R);
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, JOY_R / l);
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }
  joy.addEventListener('pointermove', joyMove);
  const joyEnd = (e) => {
    if (e.pointerId !== joyState.id) return;
    joyState.id = null;
    joyState.vec = { x: 0, y: 0 };
    knob.style.transform = '';
  };
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);

  const canvas = renderer.domElement;
  const drag = { id: null, x0: 0, y0: 0, x: 0, y: 0, t0: 0, moved: false };
  canvas.addEventListener('pointerdown', (e) => {
    drag.id = e.pointerId;
    drag.x0 = drag.x = e.clientX;
    drag.y0 = drag.y = e.clientY;
    drag.t0 = performance.now();
    drag.moved = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.moved = true;
    if (drag.moved && getSettings().freeLook && camMode === 'fp') {
      // Regard libre : on « attrape » le décor
      look.yaw = G.wrapAngle(look.yaw - (e.clientX - drag.x) * 0.006);
      look.pitch = G.clamp(look.pitch + (e.clientY - drag.y) * 0.006, -1.2, 1.2);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const dragEnd = (e) => {
    if (e.pointerId !== drag.id) return;
    drag.id = null;
    if (drag.moved || performance.now() - drag.t0 > 600 || !camWorld || !opts.onGroundTap) return;
    const r = canvas.getBoundingClientRect();
    const p = G.screenToGround(camWorld, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (p && p.y >= 0 && p.y <= 10 && p.x >= 0 && p.x <= COURT_W) opts.onGroundTap({ x: p.x, y: p.y });
  };
  canvas.addEventListener('pointerup', dragEnd);
  canvas.addEventListener('pointercancel', () => (drag.id = null));

  /* ----- Mise à jour par image ----- */

  function resize(w, h) {
    size.w = Math.max(1, Math.round(w));
    size.h = Math.max(1, Math.round(h));
    renderer.setSize(size.w, size.h, false);
    canvas.style.width = size.w + 'px';
    canvas.style.height = size.h + 'px';
  }

  function updateBall(app, s, showTrail) {
    ball.visible = shadow.visible = !!s;
    for (const m of trail) m.visible = false;
    if (!s) return;
    ball.position.copy(sceneVec(s));
    shadow.position.copy(sceneVec({ x: s.x, y: s.y, z: 0.006 }));
    const k = Math.max(0.25, 1 - s.z / 5);
    shadowMat.opacity = 0.55 * k;
    shadow.scale.setScalar(1 + s.z * 0.25);
    if (!showTrail) return;
    for (let i = 0; i < TRAIL_N; i++) {
      const t = app.t - (i + 1) * 0.035;
      if (t < app.tStart) break;
      trail[i].position.copy(sceneVec(app.ballAt(t)));
      trail[i].visible = true;
    }
  }

  function movePlayer(app, dt) {
    if (!opts.canMove || !opts.canMove()) return;
    const kv = G.keyboardVector(keys);
    const jv = joyState.vec;
    const input = { x: G.clamp(kv.x + jv.x, -1, 1), y: G.clamp(kv.y + jv.y, -1, 1) };
    if (!input.x && !input.y) return;
    const p = G.moveOnCourt(app.player, input, look.yaw, PLAYER_SPEED, dt);
    opts.onPlayerMove(p);
  }

  let camMode = 'fp';

  function updateFirstPerson(app, s, dt) {
    const player = app.player || { x: COURT_W / 2, y: 3 };
    const eye0 = G.eyePosition(player, look.yaw);
    if (!getSettings().freeLook || !look.ready) {
      // Par défaut, le regard suit la balle en douceur (ou le filet sans balle)
      const target = s ? { x: s.x, y: s.y, z: Math.max(s.z, 0.5) } : { x: COURT_W / 2, y: 10, z: 1 };
      const a = G.lookAngles(eye0, target);
      if (!look.ready) {
        look.yaw = a.yaw;
        look.pitch = a.pitch;
        look.ready = true;
      } else {
        look.yaw = G.dampAngle(look.yaw, a.yaw, dt, 0.12);
        look.pitch = G.damp(look.pitch, G.clamp(a.pitch, -1.2, 1.2), dt, 0.12);
      }
    }
    const eye = G.eyePosition(player, look.yaw);
    const dir = G.dirFromAngles(look.yaw, look.pitch);
    return { position: eye, target: G.vec.add(eye, dir), up: { x: 0, y: 0, z: 1 } };
  }

  /** Vues de replay : dessus (comme la 2D) et côté (profil de la trajectoire). */
  function fixedCamera(mode) {
    const aspect = size.w / size.h;
    if (mode === 'top') {
      const dist = 16;
      const half = 5.9; // demi-court (5 m) + marge
      const vHalf = Math.max(half, half / aspect);
      return {
        cw: { position: { x: COURT_W / 2, y: 5, z: dist }, target: { x: COURT_W / 2, y: 5, z: 0 }, up: { x: 0, y: 1, z: 0 } },
        fov: (2 * Math.atan(vHalf / dist) * 180) / Math.PI,
      };
    }
    const dist = 14;
    return {
      cw: { position: { x: COURT_W + dist - 5, y: 5, z: 1.6 }, target: { x: COURT_W / 2, y: 5, z: 1.4 }, up: { x: 0, y: 0, z: 1 } },
      fov: G.verticalFov(48, aspect, 20, 90),
    };
  }

  function applyCamera(cw, fovDeg) {
    camera.aspect = size.w / size.h;
    camera.fov = fovDeg;
    camera.up.copy(sceneVec(cw.up).sub(sceneVec({ x: 0, y: 0, z: 0 })));
    camera.position.copy(sceneVec(cw.position));
    camera.lookAt(sceneVec(cw.target));
    camera.updateProjectionMatrix();
    camWorld = Object.assign({ fovDeg, aspect: camera.aspect }, cw);
  }

  function updateMarkers(app) {
    const q = app.mode === 'lecture' && app.question;
    depthLine.visible = !!q && q.type === 'depth';
    if (depthLine.visible) depthLine.position.copy(sceneVec({ x: COURT_W / 2, y: q.depth, z: 0.008 }));
    answerMarker.visible = app.mode === 'lecture' && !!app.answer;
    if (answerMarker.visible) answerMarker.position.copy(sceneVec({ x: app.answer.x, y: app.answer.y, z: 0 }));
  }

  function buildPaths(app) {
    for (const p of [path, revealPath]) if (p) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    const times = [];
    const dtS = 1 / 90;
    for (let t = app.tStart; t < app.sc.endT; t += dtS) times.push(t);
    for (const c of app.sc.sim.contacts) times.push(c.t);
    times.push(app.sc.endT);
    times.sort((a, b) => a - b);
    const pts = times.map((t) => sceneVec(app.ballAt(t)));
    path = trajectoryTube(pts, times, 0.016, pathMat);
    revealPath = trajectoryTube(pts, times, 0.022, revealMat);
    scene.add(path.mesh);
    scene.add(revealPath.mesh);
  }

  function addRing(p, color, r0, r1, opacity) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r0, r1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity == null ? 0.9 : opacity, side: THREE.DoubleSide, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(sceneVec({ x: p.x, y: p.y, z: 0.012 }));
    overlay.add(m);
    return m;
  }

  function addMarker(p, color) {
    const m = markerGroup(color);
    m.visible = true;
    m.position.copy(sceneVec({ x: p.x, y: p.y, z: 0 }));
    overlay.add(m);
  }

  function addDot(p, color, r) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r || 0.09, 12, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(sceneVec(p));
    overlay.add(m);
  }

  function addGroundLine(a, b, color) {
    const g = new THREE.BufferGeometry().setFromPoints([sceneVec({ x: a.x, y: a.y, z: 0.02 }), sceneVec({ x: b.x, y: b.y, z: 0.02 })]);
    overlay.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
  }

  /** Superpose la réponse du joueur et la vérité au replay (reconstruit quand la réponse change). */
  function rebuildOverlay(app) {
    for (const o of overlay.children.slice()) {
      overlay.remove(o);
      o.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }
    const res = app.result;
    if (!res) return;
    const GREEN = 0x3ef08f;
    const ORANGE = 0xff9f1c;
    if (app.mode === 'lecture') {
      addMarker(app.question.target, GREEN);
      addGroundLine(app.answer, app.question.target, 0xffffff);
    } else if (app.mode === 'placement' || app.mode === 'realtime') {
      const pts = res.zone.points.map(sceneVec);
      if (pts.length > 1) {
        const tube = trajectoryTube(pts, res.zone.points.map((p) => p.t), 0.05, new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.75 }));
        overlay.add(tube.mesh);
      }
      addDot(res.hitPoint, GREEN, 0.08);
      addRing(res.ideal, GREEN, 0.28, 0.36);
      const pos = res.player || app.player;
      addRing(pos, ORANGE, 0.3, 1.1, 0.22); // zone à distance de bras
      if (app.mode === 'realtime' && res.strikeT != null) addDot(app.ballAt(res.strikeT), ORANGE, 0.08);
    } else if (app.mode === 'match') {
      const best = res.shot && res.shot.best.best;
      if (best) {
        addDot(best.ball, GREEN, 0.09); // meilleur point de frappe
        addRing(best.pos, GREEN, 0.28, 0.36); // position idéale pour le jouer
      }
      if (res.outcome === 'hit' || res.ball) {
        if (res.ball) addDot(res.ball, ORANGE, 0.08); // ta frappe
      }
      if (res.player) addRing(res.player, ORANGE, 0.3, 1.1, 0.22);
    } else if (app.mode === 'decision') {
      for (const k of ['volley', 'glass', 'second']) {
        const o = res.options[k];
        if (!o.pt || o.q <= 0) continue;
        addDot(o.pt, k === res.best ? GREEN : o.q >= 0.6 ? 0xffe066 : ORANGE, 0.09);
      }
    }
  }

  function updateOverlays(app) {
    if (!app.sc) return;
    if (app.sc !== (path && path.sc)) {
      buildPaths(app);
      path.sc = app.sc;
    }
    const replaying = app.phase === 'playing' || app.phase === 'result';
    path.mesh.visible = replaying;
    if (replaying) path.mesh.geometry.setDrawRange(0, tubeCountAt(path, app.t));
    revealPath.mesh.visible = (app.phase === 'answer' && !!getSettings().reveal) || !!app.showPath;
    const key = app.phase === 'result' || app.phase === 'playing' || app.overlayAlways ? app.result : null;
    if (key !== overlayFor) {
      overlayFor = key;
      rebuildOverlay(app);
    }
    overlay.visible = !!key;
    // Avatar du joueur : visible dans les vues de replay (en 1re personne, c'est la caméra)
    const showFig = camMode !== 'fp' && app.player && app.mode !== 'lecture';
    playerFig.visible = !!showFig;
    if (showFig) {
      const pos = (app.result && app.result.player) || app.player;
      playerFig.position.copy(sceneVec({ x: pos.x, y: pos.y, z: 0 }));
    }
  }

  // Compteur d'images optionnel (?fps dans l'URL)
  const fpsEl = /[?&]fps\b/.test(location.search) ? document.createElement('div') : null;
  if (fpsEl) {
    fpsEl.className = 'fps';
    container.appendChild(fpsEl);
  }
  const fps = { n: 0, t: 0 };

  let last = 0;
  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const app = getApp();
    const settings = getSettings();
    const movable = !!(opts.canMove && opts.canMove());
    joy.classList.toggle('on', movable || !!(opts.joystickOn && opts.joystickOn()));
    movePlayer(app, dt);
    const s = app.sc ? app.ballAt(app.t) : null;
    updateBall(app, s, settings.trail);
    updateMarkers(app);
    updateOverlays(app);
    const fpCam = updateFirstPerson(app, s, dt);
    if (camMode === 'fp') applyCamera(fpCam, G.verticalFov(75, size.w / size.h));
    else {
      const f = fixedCamera(camMode);
      applyCamera(f.cw, f.fov);
    }
    renderer.render(scene, camera);
    if (fpsEl) {
      fps.n++;
      if (now - fps.t > 500) {
        fpsEl.textContent = `${Math.round((fps.n * 1000) / (now - fps.t))} i/s · ${renderer.info.render.calls} appels`;
        fps.n = 0;
        fps.t = now;
      }
    }
  }

  return {
    resize,
    start() {
      if (active) return;
      active = true;
      last = 0;
      renderer.setAnimationLoop(frame);
    },
    stop() {
      active = false;
      keys.clear();
      renderer.setAnimationLoop(null);
    },
    /** Entrée de déplacement (clavier + joystick) dans le repère monde, relative au regard. */
    moveVector() {
      const kv = G.keyboardVector(keys);
      const jv = joyState.vec;
      const input = { x: G.clamp(kv.x + jv.x, -1, 1), y: G.clamp(kv.y + jv.y, -1, 1) };
      if (!input.x && !input.y) return { x: 0, y: 0 };
      const fx = Math.sin(look.yaw);
      const fy = Math.cos(look.yaw);
      return { x: fx * input.y + fy * input.x, y: fy * input.y - fx * input.x };
    },
    /** Vue de caméra : 'fp' (première personne), 'top' (dessus) ou 'side' (côté). */
    setCameraMode(mode) {
      camMode = mode;
    },
    get cameraMode() {
      return camMode;
    },
    /** Nouveau scénario : le regard se recale immédiatement, l'adversaire se place sur la frappe. */
    newScenario() {
      look.ready = false;
      camMode = 'fp';
      const app = getApp();
      const tau = G.preNetDuration(app.sc.init, app.sc.sim.params.g);
      const hit = G.ballistic(app.sc.init, -tau, app.sc.sim.params.g);
      // Le joueur frappe à côté de la balle (bras tendu, côté coup droit)
      opponent.position.copy(sceneVec({ x: G.clamp(hit.x - 0.55, 0.4, COURT_W - 0.4), y: Math.min(hit.y + 0.3, COURT_L - 0.4), z: 0 }));
      opponent.rotation.y = Math.PI; // face au filet, donc vers la défense
    },
  };
}

const PLAYER_SPEED = 4.5; // m/s, déplacement de défense réaliste

/** Silhouette low-poly : corps, tête. */
function figure(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 1.3, 7), mat);
  body.position.y = 0.65;
  g.add(body);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshLambertMaterial({ color: 0xf0c8a0, flatShading: true }));
  head.position.y = 1.5;
  g.add(head);
  return g;
}

/** Anneau au sol + mât vertical, pour repérer un point de loin. */
function markerGroup(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false, transparent: true, opacity: 0.95 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  g.add(ring);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), mat);
  pole.position.y = 0.5;
  g.add(pole);
  g.visible = false;
  return g;
}

window.GlassView3D = { create, revision: THREE.REVISION };
document.dispatchEvent(new Event('glass3d-ready'));
