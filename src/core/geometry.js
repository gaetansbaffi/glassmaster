/*
 * Glass Lab — géométrie du jeu, en fonctions pures (ni DOM, ni Three.js).
 *
 * Repère « monde » de physics.js :
 *   x : largeur (0 = paroi gauche, 10 = paroi droite)
 *   y : profondeur (0 = vitre de fond du joueur, 10 = filet, 20 = fond adverse)
 *   z : hauteur
 * Le repère « scène » de Three.js (y vers le haut) s'en déduit par worldToScene :
 * c'est une rotation (déterminant +1), donc les produits vectoriels sont conservés.
 */

const COURT_W = 10;
const NET_Y = 10;
const DEG = Math.PI / 180;

/* ---------- Repères ---------- */

/** Monde (physique, z vers le haut) → scène Three.js (y vers le haut, filet en z = 0, défense en z > 0). */
function worldToScene(p) {
  return { x: p.x - COURT_W / 2, y: p.z, z: NET_Y - p.y };
}

/** Variante sans allocation : écrit dans `out` (objet avec x, y, z, par exemple un THREE.Vector3). */
function worldToSceneInto(out, x, y, z) {
  out.x = x - COURT_W / 2;
  out.y = z;
  out.z = NET_Y - y;
  return out;
}

function sceneToWorld(s) {
  return { x: s.x + COURT_W / 2, y: NET_Y - s.z, z: s.y };
}

/* ---------- Caméra ---------- */

/**
 * Champ de vision vertical (degrés) donnant un champ horizontal voulu pour un rapport largeur / hauteur,
 * borné pour rester lisible en paysage comme en portrait.
 */
function verticalFov(hFovDeg, aspect, minDeg, maxDeg) {
  const vf = (2 * Math.atan(Math.tan((hFovDeg * DEG) / 2) / aspect)) / DEG;
  return Math.max(minDeg == null ? 45 : minDeg, Math.min(maxDeg == null ? 95 : maxDeg, vf));
}

/**
 * Angles de visée de `from` vers `to` : lacet (0 = vers le filet, positif vers la droite)
 * et tangage (positif vers le haut), en radians.
 */
function lookAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { yaw: Math.atan2(dx, dy), pitch: Math.atan2(to.z - from.z, Math.hypot(dx, dy)) };
}

function dirFromAngles(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.cos(yaw) * c, z: Math.sin(pitch) };
}

/** Angle ramené dans ]-π, π]. */
function wrapAngle(a) {
  return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/** Lissage exponentiel indépendant de la fréquence d'images (demi-vie en secondes). */
function damp(current, target, dt, halfLife) {
  if (halfLife <= 0) return target;
  return current + (target - current) * (1 - Math.pow(0.5, dt / halfLife));
}

/** Lissage d'un angle par le plus court chemin. */
function dampAngle(current, target, dt, halfLife) {
  return wrapAngle(current + wrapAngle(target - current) * (1 - Math.pow(0.5, dt / Math.max(halfLife, 1e-9))));
}

/**
 * Pas de caméra « suit la balle » : lissage, horizon stable (aucun roulis), amplitude et vitesse bornées.
 * look = { yaw, pitch } courant ; target = { yaw, pitch } visé ;
 * opts = { halfLife, maxYaw, pitchMin, pitchMax, maxSpeed (rad/s) }.
 * Retourne un nouvel objet { yaw, pitch }.
 */
function cameraStep(look, target, dt, opts) {
  const ty = clamp(wrapAngle(target.yaw), -opts.maxYaw, opts.maxYaw);
  const tp = clamp(target.pitch, opts.pitchMin, opts.pitchMax);
  let yaw = damp(look.yaw, ty, dt, opts.halfLife); // amplitude bornée : pas de passage par ±π
  let pitch = damp(look.pitch, tp, dt, opts.halfLife);
  const maxStep = opts.maxSpeed * dt;
  yaw = look.yaw + clamp(yaw - look.yaw, -maxStep, maxStep);
  pitch = look.pitch + clamp(pitch - look.pitch, -maxStep, maxStep);
  return { yaw: clamp(yaw, -opts.maxYaw, opts.maxYaw), pitch: clamp(pitch, opts.pitchMin, opts.pitchMax) };
}

/** Position de la caméra « à hauteur d'yeux, juste derrière le joueur », sans sortir du court. */
function eyePosition(player, yaw, eyeHeight, back) {
  eyeHeight = eyeHeight == null ? 1.7 : eyeHeight;
  back = back == null ? 0.35 : back;
  return {
    x: clamp(player.x - Math.sin(yaw) * back, 0.15, COURT_W - 0.15),
    y: clamp(player.y - Math.cos(yaw) * back, 0.15, 2 * NET_Y - 0.15),
    z: eyeHeight,
  };
}

/**
 * Cible de caméra « calme » : le regard ne tourne que si la balle sort d'une fenêtre centrale
 * (zone morte en lacet), et ne suit la hauteur de la balle que partiellement autour d'un
 * tangage de base légèrement plongeant. Le court reste ainsi stable à l'écran.
 * look = regard courant, want = angles vers la balle ;
 * opts = { deadYaw (rad), basePitch (rad), pitchFollow (0–1) }. Retourne { yaw, pitch } visé.
 */
function cameraTarget(look, want, opts) {
  const d = wrapAngle(want.yaw - look.yaw);
  let yaw = look.yaw;
  if (d > opts.deadYaw) yaw = want.yaw - opts.deadYaw;
  else if (d < -opts.deadYaw) yaw = want.yaw + opts.deadYaw;
  const pitch = opts.basePitch + (want.pitch - opts.basePitch) * opts.pitchFollow;
  return { yaw: wrapAngle(yaw), pitch };
}

/**
 * Position et visée de la caméra pour un regard donné.
 *   mode 'fp'       : yeux du joueur (1,7 m), juste derrière lui ;
 *   mode 'shoulder' : au-dessus et en arrière de l'épaule (vue « épaule »), pour voir son corps,
 *                     sa raquette et sa portée au sol. Toujours à l'intérieur du court.
 * Retourne { px, py, pz, tx, ty, tz } (repère monde).
 */
function cameraRig(player, look, mode) {
  const fx = Math.sin(look.yaw);
  const fy = Math.cos(look.yaw);
  let px;
  let py;
  let pz;
  if (mode === 'shoulder') {
    const back = 2.3;
    const side = -0.45; // légèrement à gauche : la raquette (côté droit) reste dégagée
    px = player.x - fx * back + fy * side;
    py = player.y - fy * back - fx * side;
    pz = 2.35;
  } else {
    const e = eyePosition(player, look.yaw);
    px = e.x;
    py = e.y;
    pz = e.z;
  }
  px = clamp(px, 0.2, COURT_W - 0.2);
  py = clamp(py, 0.2, 2 * NET_Y - 0.2);
  const dir = dirFromAngles(look.yaw, look.pitch);
  return { px, py, pz, tx: px + dir.x, ty: py + dir.y, tz: pz + dir.z };
}

/**
 * Côté de frappe (1 = droite / coup droit d'un droitier, −1 = gauche) selon la position de la balle
 * par rapport au regard du joueur, avec hystérésis pour éviter les changements incessants.
 */
function pickSide(prevSide, player, yaw, ball, hysteresis) {
  const lateral = (ball.x - player.x) * Math.cos(yaw) - (ball.y - player.y) * Math.sin(yaw);
  const h = hysteresis == null ? 0.25 : hysteresis;
  if (lateral > h) return 1;
  if (lateral < -h) return -1;
  return prevSide;
}

/**
 * Pose de la raquette, attachée au corps du joueur (et non à l'écran) : la tête de raquette est
 * à distance de bras sur le côté, un peu devant, à hauteur de hanche — la balle qui passe dessus
 * est « dans la portée ». swing ∈ [0, 1] : avancement du geste de frappe (balayage vers l'avant).
 * Retourne { shoulder, hand, head } (points monde) et la longueur de bras utilisée.
 */
function racketPose(player, yaw, side, swing, reach) {
  reach = reach == null ? 0.65 : reach;
  const fx = Math.sin(yaw);
  const fy = Math.cos(yaw);
  const rx = fy * side;
  const ry = -fx * side;
  // Pendant la frappe, la tête balaie de l'arrière vers l'avant du joueur
  const sweep = swing > 0 ? Math.sin(Math.PI * swing) : 0;
  const ahead = swing > 0 ? -0.25 + Math.min(1, swing) : 0.2; // armé derrière, puis accompagné devant
  const lat = reach - 0.15 * sweep;
  const at = (lateral, forward, z) => ({ x: player.x + rx * lateral + fx * forward, y: player.y + ry * lateral + fy * forward, z });
  return {
    shoulder: at(0.2, 0, 1.42),
    hand: at(lat * 0.55, ahead * 0.6, 1.08),
    head: at(lat, ahead, 1.0),
    reach,
  };
}

/* ---------- Contrôles ---------- */

/**
 * Joystick virtuel : décalage du doigt (pixels, y écran vers le bas) → vecteur d'entrée de norme ≤ 1
 * (x = droite, y = avant).
 * opts = { deadZone (fraction du rayon, défaut 0,15), curve (exposant de la courbe de réponse, défaut 1,5),
 *          sensitivity (multiplicateur, défaut 1) }.
 * Zone morte : aucune réponse ; au-delà, la norme suit ((d − zm) / (1 − zm))^curve × sensibilité, plafonnée à 1.
 */
function joystickVector(dx, dy, radius, opts) {
  opts = opts || {};
  const dead = opts.deadZone == null ? 0.15 : opts.deadZone;
  const curve = opts.curve == null ? 1.5 : opts.curve;
  const sens = opts.sensitivity == null ? 1 : opts.sensitivity;
  const l = Math.hypot(dx, dy);
  if (radius <= 0 || l <= radius * dead) return { x: 0, y: 0 };
  const lin = Math.min(1, (l - radius * dead) / (radius * (1 - dead)));
  const m = Math.min(1, Math.pow(lin, curve) * sens);
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

/** Entrée relative au regard (x = pas de côté, y = avancer) → direction dans le repère monde. */
function cameraRelativeMove(input, yaw) {
  const fx = Math.sin(yaw);
  const fy = Math.cos(yaw);
  return { x: fx * input.y + fy * input.x, y: fy * input.y - fx * input.x };
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

const Geometry = {
  worldToScene,
  worldToSceneInto,
  sceneToWorld,
  verticalFov,
  lookAngles,
  dirFromAngles,
  wrapAngle,
  clamp,
  damp,
  dampAngle,
  cameraStep,
  cameraTarget,
  cameraRig,
  pickSide,
  racketPose,
  eyePosition,
  joystickVector,
  keyboardVector,
  cameraRelativeMove,
  ballistic,
  preNetDuration,
};

export default Geometry;
