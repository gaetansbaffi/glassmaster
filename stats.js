/*
 * Glass Lab — progression : stockage, répétition espacée, difficulté adaptative, statistiques.
 * Fonctions pures + un petit store injectable (localStorage dans le navigateur).
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'glasslab.v1';
  const MODES = ['lecture', 'placement', 'decision', 'realtime'];
  const VIEWS = ['2d', '3d'];
  const FAMILY_IDS = ['A', 'B', 'C', 'D'];
  const SIDES = ['left', 'right'];
  const MAX_ATTEMPTS = 5000;

  function defaultState() {
    return {
      version: 1,
      attempts: [],
      levels: { lecture: 1, placement: 1, decision: 1, realtime: 1 },
      levelSince: { lecture: 0, placement: 0, decision: 0, realtime: 0 },
      settings: { reveal: false, view: '2d', freeLook: false, trail: true },
    };
  }

  /** Clé de jour local AAAA-MM-JJ. */
  function dayKey(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function prevDay(ts) {
    const d = new Date(ts);
    d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  /** Nombre de jours consécutifs d'entraînement, se terminant aujourd'hui ou hier. */
  function streak(attempts, now) {
    const days = new Set(attempts.map((a) => dayKey(a.ts)));
    let t = now;
    if (!days.has(dayKey(t))) t = prevDay(t);
    let n = 0;
    while (days.has(dayKey(t))) {
      n++;
      t = prevDay(t);
    }
    return n;
  }

  /**
   * Répétition espacée : choisit une configuration (famille + côté).
   * Poids = 1 + 4 × taux d'échec estimé (8 derniers essais, a priori 50 %) + bonus d'oubli.
   */
  function configWeights(attempts, mode) {
    const list = attempts.filter((a) => a.mode === mode);
    const out = [];
    for (const f of FAMILY_IDS) {
      for (const side of SIDES) {
        const key = f + ':' + side;
        let lastIdx = -1;
        const recent = [];
        for (let i = list.length - 1; i >= 0 && recent.length < 8; i--) {
          if (list[i].configKey === key) {
            if (lastIdx < 0) lastIdx = i;
            recent.push(list[i]);
          }
        }
        const fails = recent.filter((a) => !a.success).length;
        const failRate = (fails + 1) / (recent.length + 2);
        const since = lastIdx < 0 ? 24 : list.length - 1 - lastIdx;
        const overdue = Math.min(2, since / 12);
        out.push({ key, family: f, side, weight: 1 + 4 * failRate + overdue, failRate });
      }
    }
    return out;
  }

  function pickConfig(attempts, mode, rng) {
    const w = configWeights(attempts, mode);
    const total = w.reduce((s, c) => s + c.weight, 0);
    let r = (rng ? rng() : Math.random()) * total;
    for (const c of w) {
      r -= c.weight;
      if (r <= 0) return c;
    }
    return w[w.length - 1];
  }

  /**
   * Difficulté adaptative à partir des essais du mode au niveau courant (depuis le dernier changement).
   * +1 si > 80 % de réussite sur les 10 derniers, −1 si < 40 % sur au moins 6.
   */
  function nextLevel(attemptsAtLevel, level) {
    const last = attemptsAtLevel.slice(-10);
    if (!last.length) return level;
    const rate = last.filter((a) => a.success).length / last.length;
    if (last.length >= 10 && rate > 0.8) return Math.min(5, level + 1);
    if (last.length >= 6 && rate < 0.4) return Math.max(1, level - 1);
    return level;
  }

  function familyStats(attempts) {
    const out = {};
    for (const f of FAMILY_IDS) {
      const list = attempts.filter((a) => a.family === f);
      const errs = list.filter((a) => typeof a.error === 'number' && isFinite(a.error));
      out[f] = {
        n: list.length,
        rate: list.length ? list.filter((a) => a.success).length / list.length : null,
        meanError: errs.length ? errs.reduce((s, a) => s + a.error, 0) / errs.length : null,
      };
    }
    return out;
  }

  /** Vue utilisée pour un essai (les essais antérieurs à la 3D sont en 2D). */
  function viewOf(a) {
    return a.view === '3d' ? '3d' : '2d';
  }

  /** Comparaison 2D / 3D : réussite et erreur moyenne par mode et par vue. */
  function viewStats(attempts) {
    const out = {};
    for (const m of MODES) {
      out[m] = {};
      for (const v of VIEWS) {
        const list = attempts.filter((a) => a.mode === m && viewOf(a) === v);
        const errs = list.filter((a) => typeof a.error === 'number' && isFinite(a.error));
        out[m][v] = {
          n: list.length,
          rate: list.length ? list.filter((a) => a.success).length / list.length : null,
          meanError: errs.length ? errs.reduce((s, a) => s + a.error, 0) / errs.length : null,
        };
      }
    }
    return out;
  }

  /** Taux de réussite par jour et par famille (jours avec au moins un essai), du plus ancien au plus récent. */
  function dailySeries(attempts, maxDays) {
    const byDay = new Map();
    for (const a of attempts) {
      const k = dayKey(a.ts);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(a);
    }
    const days = Array.from(byDay.keys()).sort().slice(-(maxDays || 14));
    return days.map((day) => {
      const list = byDay.get(day);
      const row = { day, n: list.length };
      for (const f of FAMILY_IDS) {
        const l = list.filter((a) => a.family === f);
        row[f] = l.length ? l.filter((a) => a.success).length / l.length : null;
      }
      return row;
    });
  }

  function validateState(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.attempts)) throw new Error('Fichier invalide : liste « attempts » absente');
    for (const a of s.attempts) {
      if (typeof a.ts !== 'number' || FAMILY_IDS.indexOf(a.family) < 0 || MODES.indexOf(a.mode) < 0) {
        throw new Error('Fichier invalide : essai mal formé');
      }
    }
    const d = defaultState();
    return {
      version: 1,
      attempts: s.attempts.slice(-MAX_ATTEMPTS),
      levels: Object.assign(d.levels, s.levels),
      levelSince: Object.assign(d.levelSince, s.levelSince),
      settings: Object.assign(d.settings, s.settings),
    };
  }

  function createStore(storage) {
    let state = defaultState();
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      if (raw) state = validateState(JSON.parse(raw));
    } catch (e) {
      state = defaultState();
    }

    const store = {
      get state() {
        return state;
      },
      save() {
        try {
          if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
          /* stockage indisponible (navigation privée) : on continue en mémoire */
        }
      },
      record(a) {
        const attempt = Object.assign({ ts: Date.now() }, a);
        state.attempts.push(attempt);
        if (state.attempts.length > MAX_ATTEMPTS) {
          const drop = state.attempts.length - MAX_ATTEMPTS;
          state.attempts.splice(0, drop);
          for (const m of MODES) state.levelSince[m] = Math.max(0, state.levelSince[m] - drop);
        }
        const mode = attempt.mode;
        const since = state.attempts.slice(state.levelSince[mode]).filter((x) => x.mode === mode && x.level === state.levels[mode]);
        const lvl = nextLevel(since, state.levels[mode]);
        const changed = lvl !== state.levels[mode] ? lvl - state.levels[mode] : 0;
        if (changed) {
          state.levels[mode] = lvl;
          state.levelSince[mode] = state.attempts.length;
        }
        store.save();
        return { attempt, levelChange: changed, level: state.levels[mode] };
      },
      setSetting(k, v) {
        state.settings[k] = v;
        store.save();
      },
      exportJSON() {
        return JSON.stringify(state, null, 2);
      },
      importJSON(text) {
        state = validateState(JSON.parse(text));
        store.save();
      },
      reset() {
        state = defaultState();
        store.save();
      },
    };
    return store;
  }

  const Stats = {
    STORAGE_KEY,
    MODES,
    VIEWS,
    dayKey,
    streak,
    configWeights,
    pickConfig,
    nextLevel,
    familyStats,
    dailySeries,
    viewOf,
    viewStats,
    validateState,
    createStore,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Stats;
  else root.GlassStats = Stats;
})(typeof self !== 'undefined' ? self : this);
