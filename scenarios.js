/*
 * Glass Lab — génération des scénarios et évaluation des réponses (sans DOM).
 */
(function (root) {
  'use strict';

  const P = typeof module !== 'undefined' && module.exports ? require('./physics.js') : root.GlassPhysics;
  const { COURT } = P;

  const FAMILIES = {
    A: {
      id: 'A',
      name: 'Vitre de fond',
      short: 'Fond',
      rule: 'Vitre de fond : la balle ressort dans le même couloir. Plus elle frappe la vitre haut et vite, plus elle revient loin — laisse-la venir devant toi, ne recule pas avec elle.',
    },
    B: {
      id: 'B',
      name: 'Fond puis latérale',
      short: 'Fond → lat.',
      rule: 'Double vitre fond → latérale : après le fond, la balle file vers le côté et revient vers le centre. Place-toi côté centre et joue après la 2e vitre.',
    },
    C: {
      id: 'C',
      name: 'Latérale puis fond',
      short: 'Lat. → fond',
      rule: 'Double vitre latérale → fond : la latérale change le côté de la balle, puis le fond la renvoie vers l’avant. Ne te colle pas dans le coin : attends-la un pas devant, vers le centre.',
    },
    D: {
      id: 'D',
      name: 'Latérale seule',
      short: 'Latérale',
      rule: 'Vitre latérale seule : la balle ressort en miroir et traverse vers le centre, un peu plus « à plat » qu’elle n’est arrivée. Anticipe vers le centre, pas vers la vitre.',
    },
  };
  const FAMILY_IDS = ['A', 'B', 'C', 'D'];

  const DECISIONS = {
    volley: 'Volée',
    glass: 'Laisser rebondir et jouer la sortie de vitre',
    second: 'Reculer et attendre le 2e rebond (2e vitre)',
  };

  /** Profondeur de la position de défense du joueur (m depuis la vitre de fond). */
  const PLAYER_DEPTH = 3.0;

  const lerp = (a, b, k) => a + (b - a) * k;
  const fmt = (n, d) => n.toFixed(d == null ? 1 : d).replace('.', ',');
  const deg = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;

  /**
   * Plages de tirage par famille, pour une balle qui arrive vers la paroi DROITE
   * (le côté gauche est obtenu par symétrie). k ∈ [0, 1] = difficulté.
   * angle : angle de la trajectoire par rapport à l'axe du court (0 = droit vers le fond).
   */
  function familyRanges(family, k) {
    const T = [lerp(0.95, 0.6, k), lerp(1.25, 0.8, k)]; // temps de vol filet → rebond (plus court = plus rapide)
    switch (family) {
      case 'A':
        return { xb: [2.5, 7.5], yb: [0.4, 3.2], angle: [-lerp(6, 14, k), lerp(6, 14, k)], T, z0: [0.95, 1.9] };
      case 'B':
        return { xb: [6.3, 9.3], yb: [0.4, 2.8], angle: [lerp(10, 18, k), lerp(26, 36, k)], T, z0: [0.95, 1.7] };
      case 'C':
        return { xb: [7.4, 9.6], yb: [1.6, 4.5], angle: [lerp(22, 30, k), lerp(38, 48, k)], T, z0: [0.95, 1.6] };
      case 'D':
        return { xb: [7.6, 9.6], yb: [3.6, 6.5], angle: [lerp(26, 34, k), lerp(42, 52, k)], T, z0: [0.95, 1.5] };
      default:
        throw new Error('Famille inconnue : ' + family);
    }
  }

  function wallContacts(sim) {
    return sim.contacts.filter((c) => c.type !== 'floor');
  }

  function floorContacts(sim) {
    return sim.contacts.filter((c) => c.type === 'floor');
  }

  /** Contrôles de vraisemblance d'un scénario de jeu de vitre. */
  function isValidScenario(sim, family) {
    if (sim.endReason !== 'floor') return false;
    if (P.classify(sim) !== family) return false;
    const walls = wallContacts(sim);
    if (!walls.every(P.onGlass)) return false;
    const floors = floorContacts(sim);
    // Au moins 0,6 m de hauteur après la dernière paroi pour que la balle soit jouable
    const lastWall = walls[walls.length - 1];
    const after = P.sample(sim, 1 / 60, lastWall.t, floors[1].t);
    const maxZ = Math.max.apply(null, after.map((s) => s.z));
    if (maxZ < 0.6) return false;
    // La balle doit retomber dans le court, à au moins 0,5 m du fond
    if (floors[1].pos.y < 0.5) return false;
    // Pas de chandelle irréaliste au départ
    const apex = P.sample(sim, 1 / 30, 0, floors[0].t).reduce((m, s) => Math.max(m, s.z), 0);
    return apex < 3.5;
  }

  /**
   * Génère un scénario déterministe.
   * @param {{family:string, level?:number, seed:number, side?:'left'|'right'}} o
   */
  function generate(o) {
    const family = o.family;
    const level = Math.max(1, Math.min(5, o.level || 1));
    const k = (level - 1) / 4;
    const rng = P.mulberry32(o.seed);
    const rnd = (a) => lerp(a[0], a[1], rng());
    const ranges = familyRanges(family, k);

    for (let attempt = 0; attempt < 2000; attempt++) {
      const side = o.side || (rng() < 0.5 ? 'left' : 'right');
      const T = rnd(ranges.T);
      let xb = rnd(ranges.xb);
      const yb = rnd(ranges.yb);
      let angle = rad(rnd(ranges.angle));
      const z0 = rnd(ranges.z0);
      let x0 = xb - (COURT.depth - yb) * Math.tan(angle);
      if (side === 'left') {
        xb = COURT.width - xb;
        x0 = COURT.width - x0;
        angle = -angle;
      }
      if (x0 < 0.3 || x0 > COURT.width - 0.3) continue;
      // Famille A : le « côté » est la moitié du court où tombe la balle
      if (family === 'A' && o.side && (xb < COURT.width / 2) !== (o.side === 'left')) continue;
      const init = P.launchToBounce({ x: x0, y: COURT.depth, z: z0 }, { x: xb, y: yb }, T);
      const sim = P.simulate(init, { maxFloorBounces: 2, tMax: 6 });
      if (!isValidScenario(sim, family)) continue;
      return buildScenario({ seed: o.seed, family, level, side: family === 'A' ? (xb < 5 ? 'left' : 'right') : side, init, sim, attempt });
    }
    throw new Error('Aucun scénario valide pour ' + family + ' (graine ' + o.seed + ')');
  }

  function buildScenario(sc) {
    const sim = sc.sim;
    const walls = wallContacts(sim);
    const floors = floorContacts(sim);
    sc.walls = walls;
    sc.floors = floors;
    sc.firstWallT = walls[0].t;
    sc.lastWallT = walls[walls.length - 1].t;
    sc.landing = floors[1].pos;
    sc.endT = sim.endT;
    // Lecture / placement : figée juste avant le premier contact paroi
    sc.freezeT = Math.max(floors[0].t + 0.02, sc.firstWallT - 0.08);
    // Décision : figée quand la balle arrive vers le joueur (2,5 m devant sa ligne, avant le rebond)
    const incoming = P.crossDepthIncoming(sim, PLAYER_DEPTH + 2.5, 0, floors[0].t);
    sc.decisionFreezeT = incoming ? incoming.t : floors[0].t * 0.6;
    sc.configKey = sc.family + ':' + sc.side;
    return sc;
  }

  /** Question du mode Lecture : point de retombée, ou point de passage à une profondeur donnée. */
  function readingQuestion(sc, rng) {
    const r = rng ? rng() : 0.5;
    if (r < 0.5) {
      const d = 2 + Math.round((rng ? rng() : 0.5) * 4) * 0.5; // 2,0 à 4,0 m
      const c = P.crossDepth(sc.sim, d, sc.lastWallT, sc.floors[1].t);
      if (c) {
        return { type: 'depth', depth: d, target: { x: c.x, y: d }, height: c.z, label: `Où la balle passera-t-elle à ${d.toFixed(1).replace('.', ',')} m de la vitre de fond ?` };
      }
    }
    return { type: 'landing', target: { x: sc.landing.x, y: sc.landing.y }, label: 'Où la balle retombera-t-elle après les vitres ?' };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const READING_SUCCESS_M = 0.8;
  const PLACEMENT_SUCCESS_M = 0.4;

  function evaluateReading(question, answer) {
    const error = distance(question.target, answer);
    return { error, success: error <= READING_SUCCESS_M };
  }

  /** Zone de frappe idéale après la dernière paroi (balle descendante entre 0,8 et 1,3 m). */
  function idealZone(sc) {
    const from = sc.lastWallT;
    const to = sc.floors[1].t;
    let pts = P.hitWindow(sc.sim, from, to, 0.8, 1.3);
    let relaxed = false;
    if (!pts.length) {
      pts = P.hitWindow(sc.sim, from, to, 0.5, 1.6);
      relaxed = true;
    }
    if (!pts.length) {
      pts = P.sample(sc.sim, 1 / 120, from, to).filter((s) => s.vz < 0).slice(0, 1);
      relaxed = true;
    }
    return { points: pts, relaxed };
  }

  const ARM_MIN = 0.3;
  const ARM_MAX = 1.1;

  /** Placement : distance à la zone de frappe, en tenant compte de la longueur de bras. */
  function evaluatePlacement(sc, player) {
    const zone = idealZone(sc);
    let best = null;
    for (const p of zone.points) {
      const d = distance(p, player);
      if (!best || Math.abs(d - (ARM_MIN + ARM_MAX) / 2) < Math.abs(best.d - (ARM_MIN + ARM_MAX) / 2)) best = { d, p };
    }
    const d = best.d;
    const error = d < ARM_MIN ? ARM_MIN - d : d > ARM_MAX ? d - ARM_MAX : 0;
    // Position idéale : à distance de bras (0,7 m) du point de frappe, côté centre / avant
    const p = best.p;
    const toCenter = { x: COURT.width / 2 - p.x, y: PLAYER_DEPTH + 1 - p.y };
    const n = Math.hypot(toCenter.x, toCenter.y) || 1;
    const ideal = { x: p.x + (toCenter.x / n) * 0.7, y: p.y + (toCenter.y / n) * 0.7 };
    return { error, success: error <= PLACEMENT_SUCCESS_M, distance: d, hitPoint: p, ideal, zone };
  }

  /** Qualité (0–1) d'une fenêtre de frappe entre deux instants. */
  function windowQuality(sim, from, to) {
    const strict = P.hitWindow(sim, from, to, 0.8, 1.3);
    const roomy = strict.filter((s) => P.distToWalls(s) >= 0.7);
    if (roomy.length) return { q: 1, pt: roomy[0], why: 'balle descendante entre 0,8 et 1,3 m avec de la place pour armer' };
    if (strict.length) return { q: 0.6, pt: strict[0], why: 'bonne hauteur mais trop près de la vitre pour armer' };
    const loose = P.hitWindow(sim, from, to, 0.5, 1.6);
    if (loose.length) return { q: 0.4, pt: loose[0], why: 'hauteur de frappe inconfortable' };
    return { q: 0, pt: null, why: 'aucune hauteur jouable' };
  }

  /** Évalue les trois options du mode Décision à partir de la trajectoire. */
  function evaluateDecisionOptions(sc) {
    const sim = sc.sim;
    const f0 = sc.floors[0];
    const opts = {};
    // Volée : la balle doit passer la ligne du joueur avant de rebondir, à hauteur confortable
    const cross = P.crossDepthIncoming(sim, PLAYER_DEPTH, 0, f0.t);
    if (!cross) {
      opts.volley = { q: 0, why: `la balle rebondit avant ta ligne (rebond à ${fmt(f0.pos.y)} m du fond)` };
    } else {
      const h = cross.z;
      const v = P.speed(cross);
      let q = h >= 0.9 && h <= 1.5 ? 1 : h < 0.6 || h > 1.9 ? 0 : h < 0.9 ? (h - 0.6) / 0.3 : (1.9 - h) / 0.4;
      if (v > 20) q *= 0.7;
      opts.volley = { q, pt: cross, why: `balle à ${fmt(h, 2)} m au passage de ta ligne, ${fmt(v * 3.6, 0)} km/h` };
    }
    const w = sc.walls;
    const nextAfterFirst = sim.contacts.find((c) => c.t > w[0].t).t;
    opts.glass = windowQuality(sim, w[0].t, nextAfterFirst);
    if (w.length > 1) opts.second = windowQuality(sim, w[1].t, sc.floors[1].t);
    else opts.second = { q: 0, why: 'pas de 2e vitre sur cette balle' };
    const order = ['glass', 'second', 'volley'];
    let best = order[0];
    for (const k of order) if (opts[k].q > opts[best].q + 1e-9) best = k;
    return { options: opts, best };
  }

  function evaluateDecision(sc, choice) {
    const ev = evaluateDecisionOptions(sc);
    const q = ev.options[choice].q;
    const success = q > 0 && q >= ev.options[ev.best].q - 0.2;
    return Object.assign({ success, choice, error: null }, ev);
  }

  const WALL_NAMES = { back: 'vitre de fond', left: 'vitre latérale gauche', right: 'vitre latérale droite' };

  /** Explication courte générée à partir des données du scénario. */
  function explain(sc) {
    const lines = [];
    const f0 = sc.floors[0];
    const vIn = P.speed(f0.vIn);
    lines.push(`Rebond au sol à ${fmt(f0.pos.y)} m du fond, balle à ${fmt(vIn * 3.6, 0)} km/h.`);
    for (const c of sc.walls) {
      const a = P.wallAngles(c);
      const vi = P.hSpeed(c.vIn);
      const vo = P.hSpeed(c.vOut);
      lines.push(
        `${WALL_NAMES[c.type][0].toUpperCase() + WALL_NAMES[c.type].slice(1)} à ${fmt(c.pos.z, 2)} m de haut : ` +
          `incidence ${fmt(a.inDeg, 0)}° → sortie ${fmt(a.outDeg, 0)}°, ${fmt(vi * 3.6, 0)} → ${fmt(vo * 3.6, 0)} km/h.`
      );
    }
    const first = sc.walls[0];
    const a = P.wallAngles(first);
    if (a.inDeg > 3) {
      lines.push(
        'Pourquoi là ? La vitre absorbe davantage la vitesse perpendiculaire (×0,8) que la vitesse le long de la vitre (×0,95) : ' +
          `la balle ressort plus « à plat » (${fmt(a.outDeg, 0)}° au lieu de ${fmt(a.inDeg, 0)}°).`
      );
    } else {
      lines.push('Pourquoi là ? Arrivée presque perpendiculaire : la balle revient dans le même couloir, avec 20 % de vitesse en moins.');
    }
    const top = P.sample(sc.sim, 1 / 120, sc.lastWallT, sc.floors[1].t).reduce((m, s) => (s.z > m.z ? s : m));
    lines.push(`Après la dernière vitre, hauteur max ${fmt(top.z, 2)} m à ${fmt(top.y)} m du fond ; retombée à ${fmt(sc.landing.y)} m du fond.`);
    return { lines, rule: FAMILIES[sc.family].rule };
  }

  const Scenarios = {
    FAMILIES,
    FAMILY_IDS,
    DECISIONS,
    PLAYER_DEPTH,
    READING_SUCCESS_M,
    PLACEMENT_SUCCESS_M,
    familyRanges,
    generate,
    isValidScenario,
    readingQuestion,
    evaluateReading,
    idealZone,
    evaluatePlacement,
    evaluateDecisionOptions,
    evaluateDecision,
    explain,
    deg,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Scenarios;
  else root.GlassScenarios = Scenarios;
})(typeof self !== 'undefined' ? self : this);
