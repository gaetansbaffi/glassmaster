/*
 * Glass Lab — progression du Match infini : schéma de sauvegarde versionné, migration,
 * enregistrement des balles, répétition espacée, difficulté adaptative et statistiques.
 * Fonctions pures : la lecture / écriture du localStorage est faite par src/storage.js.
 */

export const SCHEMA_VERSION = 2;
export const MATCH_FAMILIES = ['direct', 'A', 'B', 'C', 'D'];
export const SHOT_TYPES = ['volley', 'halfVolley', 'beforeGlass', 'afterGlass'];
const MAX_BALLS = 5000;

/** État vierge. `settings` reçoit les valeurs par défaut fournies par l'interface. */
function createState(defaultSettings) {
  return {
    version: SCHEMA_VERSION,
    level: 1,
    levelSince: 0,
    bestStreak: 0,
    guideDone: false,
    settings: Object.assign({}, defaultSettings),
    balls: [],
  };
}

const isNum = (v) => typeof v === 'number' && isFinite(v);

/** Une balle enregistrée est-elle exploitable ? (les autres sont ignorées à la migration) */
function validBall(b) {
  return !!b && isNum(b.ts) && MATCH_FAMILIES.indexOf(b.family) >= 0 && (b.outcome === 'hit' || b.outcome === 'miss');
}

/** Garde uniquement les réglages connus, du bon type. */
function cleanSettings(raw, defaults) {
  const out = Object.assign({}, defaults);
  if (!raw || typeof raw !== 'object') return out;
  for (const k in defaults) if (raw[k] != null && typeof raw[k] === typeof defaults[k]) out[k] = raw[k];
  return out;
}

/**
 * Migration tolérante d'une sauvegarde quelconque vers le schéma courant. Ne lève jamais d'exception :
 * les données inconnues ou corrompues sont ignorées.
 * Retourne { state, from } où from = version d'origine (0 = rien d'exploitable).
 */
function migrate(raw, defaultSettings) {
  const fresh = createState(defaultSettings);
  if (!raw || typeof raw !== 'object') return { state: fresh, from: 0 };
  try {
    if (raw.version === SCHEMA_VERSION) {
      const balls = Array.isArray(raw.balls) ? raw.balls.filter(validBall).slice(-MAX_BALLS) : [];
      return {
        state: {
          version: SCHEMA_VERSION,
          level: Math.min(5, Math.max(1, Math.round(+raw.level) || 1)),
          levelSince: Math.min(balls.length, Math.max(0, Math.round(+raw.levelSince) || 0)),
          bestStreak: Math.max(0, Math.round(+raw.bestStreak) || 0),
          guideDone: !!raw.guideDone,
          settings: cleanSettings(raw.settings, defaultSettings),
          balls,
        },
        from: SCHEMA_VERSION,
      };
    }
    if (raw.version === 1 || Array.isArray(raw.attempts)) {
      // Version 1 (application multi-modes) : on garde le Match infini, le reste est abandonné
      const m = raw.match && typeof raw.match === 'object' ? raw.match : {};
      const balls = Array.isArray(m.balls) ? m.balls.filter(validBall).slice(-MAX_BALLS) : [];
      const old = (raw.settings && raw.settings.match) || {};
      return {
        state: Object.assign(fresh, {
          level: Math.min(5, Math.max(1, Math.round(+(raw.levels && raw.levels.match)) || 1)),
          levelSince: balls.length,
          bestStreak: Math.max(0, Math.round(+m.bestStreak) || 0),
          guideDone: balls.length > 0,
          settings: cleanSettings(old, defaultSettings),
          balls,
        }),
        from: 1,
      };
    }
  } catch (e) {
    /* données illisibles : on repart de zéro */
  }
  return { state: fresh, from: 0 };
}

/** Import JSON explicite : refuse un fichier qui n'est pas une sauvegarde Glass Lab. */
function importState(text, defaultSettings) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('fichier JSON illisible');
  }
  const r = migrate(raw, defaultSettings);
  if (!r.from) throw new Error('ce fichier n’est pas une sauvegarde Glass Lab');
  return r.state;
}

/* ---------- Enregistrement ---------- */

/** Balle « réussie » : renvoyée dans le camp adverse. */
const isOk = (b) => b.outcome === 'hit';

/** Difficulté : +1 au-delà de `up` de réussite sur `window` balles, −1 sous `down`. */
function nextLevel(ballsAtLevel, level, d) {
  d = d || { window: 10, up: 0.8, down: 0.5 };
  const last = ballsAtLevel.slice(-d.window);
  if (!last.length) return level;
  const rate = last.filter(isOk).length / last.length;
  if (last.length >= d.window && rate > d.up) return Math.min(5, level + 1);
  if (last.length >= Math.ceil(d.window * 0.6) && rate < d.down) return Math.max(1, level - 1);
  return level;
}

/**
 * Ajoute une balle (copie de l'état, l'original n'est pas modifié) et ajuste le niveau.
 * Retourne { state, levelChange }.
 */
function recordBall(state, ball, difficulty) {
  const balls = state.balls.concat([ball]);
  let levelSince = state.levelSince;
  if (balls.length > MAX_BALLS) {
    const drop = balls.length - MAX_BALLS;
    balls.splice(0, drop);
    levelSince = Math.max(0, levelSince - drop);
  }
  const atLevel = balls.slice(levelSince).filter((b) => b.level === state.level);
  const level = nextLevel(atLevel, state.level, difficulty);
  if (level !== state.level) levelSince = balls.length;
  const next = Object.assign({}, state, {
    balls,
    level,
    levelSince,
    bestStreak: Math.max(state.bestStreak, ball.streak || 0),
  });
  return { state: next, levelChange: level - state.level };
}

/* ---------- Répétition espacée et statistiques ---------- */

/** Poids par famille = 1 + 4 × taux d'échec récent (8 dernières, a priori 50 %) + bonus d'oubli. */
function familyWeights(balls) {
  const out = {};
  for (const f of MATCH_FAMILIES) {
    let lastIdx = -1;
    const recent = [];
    for (let i = balls.length - 1; i >= 0 && recent.length < 8; i--) {
      if (balls[i].family !== f) continue;
      if (lastIdx < 0) lastIdx = i;
      recent.push(balls[i]);
    }
    const fails = recent.filter((b) => !isOk(b)).length;
    const failRate = (fails + 1) / (recent.length + 2);
    const since = lastIdx < 0 ? 24 : balls.length - 1 - lastIdx;
    out[f] = 1 + 4 * failRate + Math.min(2, since / 12);
  }
  return out;
}

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/** Par famille : nombre de balles, taux de réussite, qualité moyenne et erreur de placement moyenne. */
function familyStats(balls) {
  const out = {};
  for (const f of MATCH_FAMILIES) {
    const list = balls.filter((b) => b.family === f);
    const hits = list.filter((b) => isNum(b.quality));
    out[f] = {
      n: list.length,
      rate: list.length ? list.filter(isOk).length / list.length : null,
      meanQuality: mean(hits.map((b) => b.quality)),
      meanPlacementError: mean(hits.filter((b) => isNum(b.placementError)).map((b) => b.placementError)),
    };
  }
  return out;
}

/**
 * Précision de décision sur les balles frappées : part des coups dont le type était (quasi) le meilleur,
 * et, par type choisi, quel autre type était le plus souvent meilleur.
 */
function decisionStats(balls) {
  const hits = balls.filter((b) => b.type && b.bestType);
  const byChosen = {};
  for (const t of SHOT_TYPES) {
    const list = hits.filter((b) => b.type === t);
    const wrong = list.filter((b) => !b.decisionOk);
    const better = {};
    for (const b of wrong) better[b.bestType] = (better[b.bestType] || 0) + 1;
    let top = null;
    for (const k in better) if (!top || better[k] > better[top]) top = k;
    byChosen[t] = {
      n: list.length,
      accuracy: list.length ? (list.length - wrong.length) / list.length : null,
      topBetter: top,
      topBetterRate: top ? better[top] / list.length : 0,
    };
  }
  return { n: hits.length, accuracy: hits.length ? hits.filter((b) => b.decisionOk).length / hits.length : null, byChosen };
}

/** Résumé d'une session (balles jouées, qualité moyenne, meilleure série, précision de décision). */
function sessionSummary(balls, session) {
  const list = balls.filter((b) => b.session === session);
  const q = list.filter((b) => isNum(b.quality)).map((b) => b.quality);
  return {
    balls: list.length,
    returned: list.filter(isOk).length,
    meanQuality: mean(q),
    bestStreak: list.reduce((m, b) => Math.max(m, b.streak || 0), 0),
    decision: decisionStats(list).accuracy,
  };
}

const Stats = {
  SCHEMA_VERSION,
  MATCH_FAMILIES,
  SHOT_TYPES,
  createState,
  validBall,
  migrate,
  importState,
  nextLevel,
  recordBall,
  familyWeights,
  familyStats,
  decisionStats,
  sessionSummary,
};

export default Stats;
