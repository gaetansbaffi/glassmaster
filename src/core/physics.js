/*
 * Glass Lab — physique pure (aucun accès au DOM).
 *
 * Repère (mètres) — demi-court de défense :
 *   x : largeur, 0 = paroi gauche, 10 = paroi droite
 *   y : profondeur, 0 = vitre de fond, 10 = filet
 *   z : hauteur, 0 = sol
 *
 * Sans frottement de l'air ni effet, les mouvements en x et y sont rectilignes
 * et z est parabolique : chaque contact est calculé analytiquement (pas
 * d'intégration numérique), ce qui rend la simulation exacte et déterministe.
 */

const COURT = {
  width: 10,
  depth: 10,
  serviceLine: 3.05, // depuis la vitre de fond (6,95 m depuis le filet)
  backGlassHeight: 3,
  sideGlass: [ // panneaux de vitre latérale : jusqu'à y = 4 m (3 m de haut), puis 4–6 m (2 m de haut)
    { from: 0, to: 4, height: 3 },
    { from: 4, to: 6, height: 2 },
  ],
  netHeight: 0.88,
};

const DEFAULT_PARAMS = {
  g: 9.81,
  radius: 0.033,
  eFloor: 0.75, // restitution normale au sol
  floorTangent: 0.9, // conservation de la vitesse horizontale au sol
  eWall: 0.8, // restitution normale sur les parois
  wallTangent: 0.95, // légère perte de vitesse tangentielle sur les parois
  minBounceVz: 0.3, // en dessous, la balle « roule » : fin de simulation
};

const EPS = 1e-9;

/** Générateur pseudo-aléatoire déterministe (mulberry32). Retourne une fonction () => [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withParams(p) {
  return Object.assign({}, DEFAULT_PARAMS, p || {});
}

/** État après une durée tau en vol libre (exact). */
function advance(s, tau, g) {
  return {
    x: s.x + s.vx * tau,
    y: s.y + s.vy * tau,
    z: s.z + s.vz * tau - 0.5 * g * tau * tau,
    vx: s.vx,
    vy: s.vy,
    vz: s.vz - g * tau,
  };
}

/** Temps avant le prochain contact avec chaque surface (Infinity si aucun). */
function nextEventTimes(s, P) {
  const r = P.radius;
  const W = COURT.width;
  const t = { floor: Infinity, back: Infinity, left: Infinity, right: Infinity, net: Infinity };
  // Sol : z + vz τ − ½gτ² = r  → racine positive
  const h = s.z - r;
  const disc = s.vz * s.vz + 2 * P.g * h;
  if (disc >= 0) {
    const tau = (s.vz + Math.sqrt(disc)) / P.g;
    if (tau > EPS) t.floor = tau;
  }
  if (s.vy < 0) t.back = Math.max(0, (r - s.y) / s.vy);
  if (s.vy > 0) t.net = Math.max(0, (COURT.depth - s.y) / s.vy);
  if (s.vx < 0) t.left = Math.max(0, (r - s.x) / s.vx);
  if (s.vx > 0) t.right = Math.max(0, (W - r - s.x) / s.vx);
  // Un contact à τ = 0 sur une paroi qu'on vient de quitter est impossible
  // car la vitesse normale a été inversée ; on garde donc τ ≥ 0.
  return t;
}

/** Réflexion sur une surface. Retourne le nouvel état (copie). */
function reflect(s, type, P) {
  const o = Object.assign({}, s);
  const r = P.radius;
  if (type === 'floor') {
    o.z = r;
    o.vz = -s.vz * P.eFloor;
    o.vx = s.vx * P.floorTangent;
    o.vy = s.vy * P.floorTangent;
  } else if (type === 'back') {
    o.y = r;
    o.vy = -s.vy * P.eWall;
    o.vx = s.vx * P.wallTangent;
    o.vz = s.vz * P.wallTangent;
  } else if (type === 'left' || type === 'right') {
    o.x = type === 'left' ? r : COURT.width - r;
    o.vx = -s.vx * P.eWall;
    o.vy = s.vy * P.wallTangent;
    o.vz = s.vz * P.wallTangent;
  }
  return o;
}

/**
 * Simule une trajectoire.
 * @param {{x,y,z,vx,vy,vz}} init état initial
 * @param {object} [opts] { params, tMax, maxFloorBounces }
 * @returns {{ segments: Array<{t0:number, s:object}>, contacts: Array, endT:number, endReason:string, params:object }}
 */
function simulate(init, opts) {
  opts = opts || {};
  const P = withParams(opts.params);
  const tMax = opts.tMax != null ? opts.tMax : 6;
  const maxFloor = opts.maxFloorBounces != null ? opts.maxFloorBounces : 2;

  let s = Object.assign({}, init);
  let t = 0;
  const segments = [{ t0: 0, s: Object.assign({}, s) }];
  const contacts = [];
  let floorCount = 0;
  let endReason = 'tMax';

  for (let guard = 0; guard < 200; guard++) {
    const times = nextEventTimes(s, P);
    let tau = Infinity;
    for (const k in times) tau = Math.min(tau, times[k]);
    if (t + tau >= tMax) {
      s = advance(s, tMax - t, P.g);
      t = tMax;
      endReason = 'tMax';
      break;
    }
    s = advance(s, tau, P.g);
    t += tau;
    if (times.net <= tau + EPS) {
      endReason = 'net';
      break;
    }
    // Toutes les surfaces touchées au même instant (coin) sont traitées dans l'ordre.
    const hits = ['floor', 'back', 'left', 'right'].filter((k) => times[k] <= tau + EPS);
    let stop = false;
    for (const type of hits) {
      const vIn = { vx: s.vx, vy: s.vy, vz: s.vz };
      s = reflect(s, type, P);
      contacts.push({
        type,
        t,
        pos: { x: s.x, y: s.y, z: s.z },
        vIn,
        vOut: { vx: s.vx, vy: s.vy, vz: s.vz },
      });
      if (type === 'floor') {
        floorCount++;
        if (floorCount >= maxFloor) { endReason = 'floor'; stop = true; }
        else if (s.vz < P.minBounceVz) { endReason = 'rolling'; stop = true; }
      }
    }
    segments.push({ t0: t, s: Object.assign({}, s) });
    if (stop) break;
  }
  return { segments, contacts, endT: t, endReason, params: P };
}

/** État exact à l'instant t (borné à [0, endT]). */
function stateAt(sim, t) {
  t = Math.max(0, Math.min(sim.endT, t));
  let seg = sim.segments[0];
  for (let i = 1; i < sim.segments.length; i++) {
    if (sim.segments[i].t0 <= t) seg = sim.segments[i];
    else break;
  }
  return advance(seg.s, t - seg.t0, sim.params.g);
}

/** Échantillonne la trajectoire à pas fixe (les contacts sont ajoutés exactement). */
function sample(sim, dt, t0, t1) {
  dt = dt || 1 / 60;
  t0 = t0 == null ? 0 : t0;
  t1 = t1 == null ? sim.endT : Math.min(t1, sim.endT);
  const times = [];
  for (let t = t0; t < t1; t += dt) times.push(t);
  for (const c of sim.contacts) if (c.t > t0 && c.t < t1) times.push(c.t);
  times.push(t1);
  times.sort((a, b) => a - b);
  return times.map((t) => Object.assign({ t }, stateAt(sim, t)));
}

function isSide(type) {
  return type === 'left' || type === 'right';
}

/** Contacts entre le 1er et le 2e rebond au sol (inclus) sous forme de types. */
function contactSequence(sim) {
  return sim.contacts.map((c) => c.type);
}

/**
 * Famille de la trajectoire :
 *   A : sol → fond
 *   B : sol → fond → latérale
 *   C : sol → latérale → fond
 *   D : sol → latérale
 * Retourne null si la séquence ne correspond à aucune famille.
 */
function classify(sim) {
  const seq = contactSequence(sim);
  if (seq[0] !== 'floor') return null;
  const walls = [];
  let i = 1;
  for (; i < seq.length && seq[i] !== 'floor'; i++) walls.push(seq[i]);
  if (i >= seq.length) return null; // pas de 2e rebond au sol
  const key = walls.map((w) => (isSide(w) ? 'S' : 'F')).join('');
  return { F: 'A', FS: 'B', SF: 'C', S: 'D' }[key] || null;
}

/** Vitesse initiale pour qu'une balle partie de `from` touche le sol en `to` après T secondes. */
function launchToBounce(from, to, T, params) {
  const P = withParams(params);
  const r = P.radius;
  return {
    x: from.x,
    y: from.y,
    z: from.z,
    vx: (to.x - from.x) / T,
    vy: (to.y - from.y) / T,
    vz: (r - from.z + 0.5 * P.g * T * T) / T,
  };
}

/**
 * Angle d'incidence (en degrés, par rapport à la normale) dans le plan horizontal
 * pour un contact paroi, avant et après.
 */
function wallAngles(contact) {
  const n = contact.type === 'back' ? 'vy' : 'vx';
  const tKey = contact.type === 'back' ? 'vx' : 'vy';
  const ang = (v) => (Math.atan2(Math.abs(v[tKey]), Math.abs(v[n])) * 180) / Math.PI;
  return { inDeg: ang(contact.vIn), outDeg: ang(contact.vOut) };
}

function speed(v) {
  return Math.hypot(v.vx, v.vy, v.vz);
}

function hSpeed(v) {
  return Math.hypot(v.vx, v.vy);
}

/** Vrai si le contact paroi a lieu sur une partie vitrée (sinon grillage / au-dessus). */
function onGlass(contact) {
  const z = contact.pos.z;
  if (contact.type === 'back') return z <= COURT.backGlassHeight;
  if (isSide(contact.type)) {
    const y = contact.pos.y;
    return COURT.sideGlass.some((p) => y >= p.from && y <= p.to && z <= p.height);
  }
  return true;
}

const Physics = {
  COURT,
  DEFAULT_PARAMS,
  mulberry32,
  simulate,
  stateAt,
  sample,
  advance,
  reflect,
  classify,
  contactSequence,
  launchToBounce,
  wallAngles,
  speed,
  hSpeed,
  onGlass,
  isSide,
};

export default Physics;
