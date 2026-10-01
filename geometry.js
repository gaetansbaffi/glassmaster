/*
 * Glass Lab — géométrie de la vue 3D, en fonctions pures (ni DOM, ni Three.js).
 *
 * Toutes les fonctions travaillent dans le repère « monde » de physics.js :
 *   x : largeur (0 = paroi gauche, 10 = paroi droite)
 *   y : profondeur (0 = vitre de fond de la défense, 10 = filet, 20 = fond adverse)
 *   z : hauteur
 * Le repère « scène » de Three.js (y vers le haut) s'en déduit par worldToScene :
 * c'est une rotation (déterminant +1), donc les produits vectoriels sont conservés.
 */
(function (root) {
  'use strict';

  const COURT_W = 10;
  const NET_Y = 10;
  const DEG = Math.PI / 180;

  /* ---------- Vecteurs ---------- */

  const v = (x, y, z) => ({ x, y, z });
  const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
  const scale = (a, k) => v(a.x * k, a.y * k, a.z * k);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => {
    const l = len(a);
    return l > 0 ? scale(a, 1 / l) : v(0, 0, 0);
  };

  /* ---------- Conversions de repères ---------- */

  /** Monde (physique, z vers le haut) → scène Three.js (y vers le haut, filet en z = 0, défense en z > 0). */
  function worldToScene(p) {
    return { x: p.x - COURT_W / 2, y: p.z, z: NET_Y - p.y };
  }

  function sceneToWorld(s) {
    return { x: s.x + COURT_W / 2, y: NET_Y - s.z, z: s.y };
  }

  /** Pixel (origine en haut à gauche) → coordonnées normalisées [-1, 1] (y vers le haut). */
  function screenToNDC(px, py, width, height) {
    return { x: (px / width) * 2 - 1, y: 1 - (py / height) * 2 };
  }

  function ndcToScreen(nx, ny, width, height) {
    return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height };
  }

  /* ---------- Caméra ---------- */

  /**
   * Champ de vision vertical (degrés) donnant un champ horizontal voulu pour un rapport largeur / hauteur,
   * borné pour rester lisible en portrait comme en paysage.
   */
  function verticalFov(hFovDeg, aspect, minDeg, maxDeg) {
    const vf = (2 * Math.atan(Math.tan((hFovDeg * DEG) / 2) / aspect)) / DEG;
    return Math.max(minDeg == null ? 45 : minDeg, Math.min(maxDeg == null ? 95 : maxDeg, vf));
  }

  /** Base orthonormée de la caméra : avant, droite, haut (convention Three.js lookAt). */
  function cameraBasis(cam) {
    const up = cam.up || v(0, 0, 1);
    const f = norm(sub(cam.target, cam.position));
    let r = cross(f, up);
    if (len(r) < 1e-9) r = cross(f, v(0, 1, 0)); // regard vertical : axe de secours
    r = norm(r);
    const u = cross(r, f);
    return { f, r, u };
  }

  /**
   * Rayon partant de la caméra à travers un point NDC.
   * cam = { position, target, up?, fovDeg (vertical), aspect }
   */
  function rayFromCamera(cam, ndc) {
    const { f, r, u } = cameraBasis(cam);
    const t = Math.tan((cam.fovDeg * DEG) / 2);
    const dir = norm(add(f, add(scale(r, ndc.x * t * cam.aspect), scale(u, ndc.y * t))));
    return { origin: Object.assign({}, cam.position), dir };
  }

  /** Projection d'un point monde en NDC (null s'il est derrière la caméra). */
  function projectToNDC(cam, p) {
    const { f, r, u } = cameraBasis(cam);
    const d = sub(p, cam.position);
    const zc = dot(d, f);
    if (zc <= 1e-9) return null;
    const t = Math.tan((cam.fovDeg * DEG) / 2);
    return { x: dot(d, r) / (zc * t * cam.aspect), y: dot(d, u) / (zc * t), depth: zc };
  }

  /** Intersection d'un rayon avec le plan horizontal z = h (null si parallèle ou derrière). */
  function intersectGround(ray, h) {
    h = h || 0;
    if (Math.abs(ray.dir.z) < 1e-9) return null;
    const t = (h - ray.origin.z) / ray.dir.z;
    if (t <= 0) return null;
    return add(ray.origin, scale(ray.dir, t));
  }

  /** Pixel écran → point du sol touché (monde), ou null si on vise le ciel. */
  function screenToGround(cam, px, py, width, height) {
    return intersectGround(rayFromCamera(cam, screenToNDC(px, py, width, height)), 0);
  }

  /** Point monde → pixel écran (null s'il est derrière la caméra). */
  function worldToScreen(cam, p, width, height) {
    const n = projectToNDC(cam, p);
    if (!n) return null;
    return Object.assign(ndcToScreen(n.x, n.y, width, height), { depth: n.depth });
  }

  /* ---------- Regard ---------- */

  /**
   * Angles de visée de `from` vers `to` : lacet (0 = vers le filet, positif vers la droite)
   * et tangage (positif vers le haut), en radians.
   */
  function lookAngles(from, to) {
    const d = sub(to, from);
    return { yaw: Math.atan2(d.x, d.y), pitch: Math.atan2(d.z, Math.hypot(d.x, d.y)) };
  }

  function dirFromAngles(yaw, pitch) {
    const c = Math.cos(pitch);
    return v(Math.sin(yaw) * c, Math.cos(yaw) * c, Math.sin(pitch));
  }

  /** Angle ramené dans ]-π, π]. */
  function wrapAngle(a) {
    return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
  }

  /** Lissage exponentiel indépendant de la fréquence d'images (demi-vie en secondes). */
  function damp(current, target, dt, halfLife) {
    if (halfLife <= 0) return target;
    const k = 1 - Math.pow(0.5, dt / halfLife);
    return current + (target - current) * k;
  }

  /** Lissage d'un angle par le plus court chemin. */
  function dampAngle(current, target, dt, halfLife) {
    return wrapAngle(current + wrapAngle(target - current) * (1 - Math.pow(0.5, dt / Math.max(halfLife, 1e-9))));
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  /* ---------- Déplacement du joueur ---------- */

  /** Zone de jeu : moitié de défense, à distance des parois et du filet. */
  const DEFENSE_BOUNDS = { xMin: 0.3, xMax: COURT_W - 0.3, yMin: 0.3, yMax: NET_Y - 0.5 };

  function clampToBounds(p, b) {
    b = b || DEFENSE_BOUNDS;
    return { x: clamp(p.x, b.xMin, b.xMax), y: clamp(p.y, b.yMin, b.yMax) };
  }

  /**
   * Joystick virtuel : décalage du doigt (pixels) → vecteur d'entrée de norme ≤ 1.
   * y écran vers le bas = reculer, donc on inverse. Zone morte proportionnelle au rayon.
   */
  function joystickVector(dx, dy, radius, deadZone) {
    deadZone = deadZone == null ? 0.12 : deadZone;
    const l = Math.hypot(dx, dy);
    if (l < radius * deadZone || radius <= 0) return { x: 0, y: 0 };
    const m = Math.min(1, (l - radius * deadZone) / (radius * (1 - deadZone)));
    return { x: (dx / l) * m, y: (-dy / l) * m };
  }

  /**
   * Entrée clavier → vecteur d'entrée. `keys` contient des KeyboardEvent.code (position physique) :
   * KeyW/KeyA/KeyS/KeyD correspondent à ZQSD sur AZERTY et à WASD sur QWERTY.
   */
  function keyboardVector(keys) {
    const has = (k) => keys.has(k);
    let x = 0;
    let y = 0;
    if (has('ArrowUp') || has('KeyW')) y += 1;
    if (has('ArrowDown') || has('KeyS')) y -= 1;
    if (has('ArrowLeft') || has('KeyA')) x -= 1;
    if (has('ArrowRight') || has('KeyD')) x += 1;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  /**
   * Déplacement relatif au regard : input.y = avancer dans la direction du lacet, input.x = pas de côté.
   * Résultat borné à la zone de jeu.
   */
  function moveOnCourt(pos, input, yaw, speed, dt, bounds) {
    const fx = Math.sin(yaw);
    const fy = Math.cos(yaw);
    // vecteur « droite » au sol = avant tourné de −90° (vu de dessus, x à droite, y vers le filet)
    const rx = fy;
    const ry = -fx;
    const step = speed * dt;
    return clampToBounds({ x: pos.x + (fx * input.y + rx * input.x) * step, y: pos.y + (fy * input.y + ry * input.x) * step }, bounds);
  }

  /** Position de la caméra « à hauteur d'yeux, derrière le joueur », sans sortir du court. */
  function eyePosition(player, yaw, eyeHeight, back) {
    eyeHeight = eyeHeight == null ? 1.7 : eyeHeight;
    back = back == null ? 0.35 : back;
    return {
      x: clamp(player.x - Math.sin(yaw) * back, 0.15, COURT_W - 0.15),
      y: clamp(player.y - Math.cos(yaw) * back, 0.15, 2 * NET_Y - 0.15),
      z: eyeHeight,
    };
  }

  /* ---------- Balle avant le filet (côté adverse) ---------- */

  /** État balistique exact après dt secondes (dt peut être négatif : remonter le temps). */
  function ballistic(s, dt, g) {
    return {
      x: s.x + s.vx * dt,
      y: s.y + s.vy * dt,
      z: s.z + s.vz * dt - 0.5 * g * dt * dt,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz - g * dt,
    };
  }

  /**
   * Durée de vol avant le filet pour faire partir la balle de la raquette adverse :
   * on remonte la trajectoire jusqu'à y = yStart, en s'arrêtant plus tôt si la balle
   * passerait sous zMin (frappe trop basse) ou au-dessus de zMax.
   */
  function preNetDuration(init, g, opts) {
    opts = opts || {};
    const yStart = opts.yStart == null ? 16.5 : opts.yStart;
    const zMin = opts.zMin == null ? 0.4 : opts.zMin;
    const zMax = opts.zMax == null ? 3.2 : opts.zMax;
    if (init.vy >= 0) return 0;
    const tauY = (yStart - init.y) / -init.vy;
    const ok = (tau) => {
      const s = ballistic(init, -tau, g);
      return s.z >= zMin && s.z <= zMax;
    };
    if (ok(tauY)) return tauY;
    let lo = 0;
    let hi = tauY;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /* ---------- Mode temps réel ---------- */

  /**
   * Jugement d'une frappe en temps réel.
   * placementError : écart (m) à la zone de frappe idéale, tenant compte de la longueur de bras ;
   * strikeT : instant de la frappe (null = pas de frappe) ; window : { t0, t1 } fenêtre idéale.
   */
  function judgeStrike(o) {
    const reachTol = o.reachTol == null ? 0.4 : o.reachTol;
    const timingTol = o.timingTol == null ? 0.15 : o.timingTol;
    if (o.strikeT == null) {
      return { success: false, timing: 'none', timingError: null, placementError: o.placementError };
    }
    const w = o.window;
    const early = w.t0 - o.strikeT;
    const late = o.strikeT - w.t1;
    const timingError = Math.max(0, early, late);
    const timing = timingError <= timingTol ? 'ok' : early > 0 ? 'early' : 'late';
    return {
      success: o.placementError <= reachTol && timingError <= timingTol,
      timing,
      timingError,
      placementError: o.placementError,
    };
  }

  const Geometry = {
    DEFENSE_BOUNDS,
    vec: { v, add, sub, scale, dot, cross, len, norm },
    worldToScene,
    sceneToWorld,
    screenToNDC,
    ndcToScreen,
    verticalFov,
    cameraBasis,
    rayFromCamera,
    projectToNDC,
    intersectGround,
    screenToGround,
    worldToScreen,
    lookAngles,
    dirFromAngles,
    wrapAngle,
    damp,
    dampAngle,
    clamp,
    clampToBounds,
    joystickVector,
    keyboardVector,
    moveOnCourt,
    eyePosition,
    ballistic,
    preNetDuration,
    judgeStrike,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Geometry;
  else root.GlassGeometry = Geometry;
})(typeof self !== 'undefined' ? self : this);
