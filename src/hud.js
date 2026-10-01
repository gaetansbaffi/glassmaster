/*
 * Glass Lab — interface superposée : HUD minimal, écrans (accueil, pause, réglages, stats) et détail.
 * Aucun panneau ni texte permanent pendant le jeu : série, Pause, joystick, Frappe et toast.
 */
import Q from './core/quality.js';
import SG from './core/shotgen.js';
import Stats from './core/stats.js';
import { SETTINGS_UI } from './settings.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d) => n.toFixed(d == null ? 2 : d).replace('.', ',');
const pct = (v) => (v == null ? '—' : Math.round(v * 100) + ' %');
const NAMES = Q.SHOT_NAMES;
const lower = (t) => NAMES[t].toLowerCase();

/** Conseil court pour chaque motif de perte. */
const MISS_HINT = {
  early: 'attends que la balle entre dans ta zone',
  late: 'frappe plus tôt, la balle était passée',
  far: 'rapproche-toi de la balle avant de frapper',
  notReached: 'déplace-toi dès la frappe adverse',
  weak: 'mauvaise position : frappe ratée',
};

export function createHud() {
  const toast = { el: $('toast'), timer: 0 };
  const guide = { el: $('guide'), step: -1, timer: 0, onDone: null };
  const screens = ['home', 'pause', 'settings', 'stats'];
  let backTo = null;

  function show(name) {
    for (const s of screens) $(s).hidden = s !== name;
  }

  /* ----- Toast de feedback ----- */

  /** Texte court du feedback (icône + couleur + mots, jamais la couleur seule). */
  function feedbackLine(r, cfg) {
    if (r.outcome === 'miss' && r.reason !== 'weak') {
      return { level: 'bad', icon: '✕', title: `${r.reasonLabel} · mieux : ${lower(r.bestType)}`, sub: MISS_HINT[r.reason] };
    }
    const why = Q.weakness(r, cfg);
    if (r.outcome === 'miss') return { level: 'bad', icon: '✕', title: `${NAMES[r.type]} ${fmt(r.quality)} · dans le filet`, sub: why || MISS_HINT.weak };
    const level = r.quality >= cfg.quality.good ? 'good' : r.quality >= cfg.quality.ok ? 'ok' : 'bad';
    const icon = level === 'good' ? '✓' : level === 'ok' ? '~' : '!';
    if (r.type === r.bestType) return { level, icon, title: `${NAMES[r.type]} ${fmt(r.quality)} · bon choix`, sub: why };
    return { level, icon, title: `${NAMES[r.type]} ${fmt(r.quality)} · mieux : ${lower(r.bestType)} ${fmt(r.bestQuality)}`, sub: why };
  }

  function showToast(r, cfg, ms, withDetail) {
    const f = feedbackLine(r, cfg);
    toast.el.className = 'toast ' + f.level;
    $('toastIcon').textContent = f.icon;
    $('toastTitle').textContent = f.title;
    $('toastSub').textContent = f.sub || '';
    $('toastSub').hidden = !f.sub;
    $('toastDetail').hidden = !withDetail;
    toast.el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(hideToast, ms);
    return f;
  }

  function hideToast() {
    clearTimeout(toast.timer);
    toast.el.hidden = true;
  }

  /* ----- Série ----- */

  let lastStreak = 0;
  function setStreak(n) {
    const el = $('streak');
    $('streakVal').textContent = n;
    if (n > lastStreak) {
      el.classList.remove('bump');
      void el.offsetWidth; // relance l'animation
      el.classList.add('bump');
    }
    lastStreak = n;
  }

  /* ----- Bulles de guide (premier lancement, jamais bloquantes) ----- */

  const GUIDE = [
    { text: 'Déplace-toi', cls: 'at-joy' },
    { text: 'Appuie sur Frappe au bon moment', cls: 'at-strike' },
    { text: 'Lis le conseil', cls: 'at-toast' },
  ];

  function guideShow(i) {
    if (guide.step >= i || guide.step === 99) return;
    guide.step = i;
    const g = GUIDE[i];
    guide.el.textContent = g.text;
    guide.el.className = 'guide ' + g.cls;
    guide.el.hidden = false;
    clearTimeout(guide.timer);
    guide.timer = setTimeout(() => guideHide(i), 6000);
  }

  function guideHide(i) {
    if (guide.step !== i || guide.el.hidden) return;
    guide.el.hidden = true;
    if (i === GUIDE.length - 1) {
      guide.step = 99;
      if (guide.onDone) guide.onDone();
    }
  }

  guide.el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    guideHide(guide.step);
  });

  /* ----- Réglages ----- */

  function renderSettings(settings, onChange) {
    const list = $('settingsList');
    list.innerHTML = '';
    for (const def of SETTINGS_UI) {
      const row = document.createElement('div');
      row.className = 'setting';
      const id = 'set-' + def.key;
      row.innerHTML = `<label class="lbl" for="${id}">${def.label}${def.hint ? `<small>${def.hint}</small>` : ''}</label>`;
      if (def.type === 'toggle') {
        const sw = document.createElement('span');
        sw.className = 'switch';
        sw.innerHTML = `<input type="checkbox" role="switch" id="${id}"><span></span>`;
        const input = sw.firstChild;
        input.checked = !!settings[def.key];
        input.addEventListener('change', () => onChange(def.key, input.checked));
        row.append(sw);
      } else if (def.type === 'choice') {
        const box = document.createElement('div');
        box.className = 'choice';
        box.setAttribute('role', 'group');
        box.id = id;
        for (const [value, label] of def.options) {
          const b = document.createElement('button');
          b.textContent = label;
          b.setAttribute('aria-pressed', String(settings[def.key] === value));
          b.addEventListener('click', () => {
            box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            onChange(def.key, value);
          });
          box.append(b);
        }
        row.append(box);
      } else if (def.type === 'range') {
        const wrap = document.createElement('span');
        wrap.className = 'range';
        const r = document.createElement('input');
        Object.assign(r, { type: 'range', id, min: def.min, max: def.max, step: def.step, value: settings[def.key] });
        const out = document.createElement('output');
        out.htmlFor = id;
        const show = () => (out.textContent = String(r.value).replace('.', ',') + (def.unit || ''));
        show();
        r.addEventListener('input', () => {
          show();
          onChange(def.key, Number(r.value));
        });
        wrap.append(r, out);
        row.append(wrap);
      }
      list.append(row);
    }
  }

  /* ----- Stats (minimalistes) ----- */

  function renderStats(state) {
    const balls = state.balls;
    const fs = Stats.familyStats(balls);
    const ds = Stats.decisionStats(balls);
    let html = `<div class="summary">
      <div class="kpi"><b>${balls.length}</b><span>Balles jouées</span></div>
      <div class="kpi"><b>${pct(ds.accuracy)}</b><span>Précision de décision</span></div>
      <div class="kpi"><b>${state.bestStreak}</b><span>Meilleure série</span></div>
      <div class="kpi"><b>${state.level}</b><span>Niveau</span></div></div>`;
    html += '<table class="stats-table"><thead><tr><th>Famille de balle</th><th class="num">Réussite</th><th class="num">Qualité moy.</th></tr></thead><tbody>';
    for (const f of Stats.MATCH_FAMILIES) {
      const x = fs[f];
      html += `<tr><td>${SG.FAMILIES[f].short} <small>(${x.n})</small></td><td class="num">${pct(x.rate)}</td><td class="num">${x.meanQuality == null ? '—' : fmt(x.meanQuality)}</td></tr>`;
    }
    html += '</tbody></table>';
    const tips = [];
    for (const t of Q.SHOT_TYPES) {
      const c = ds.byChosen[t];
      if (c.n && c.topBetter && c.topBetterRate >= 0.2) tips.push(`Tu choisis ${lower(t)} alors qu’une ${lower(c.topBetter)} était meilleure ${pct(c.topBetterRate)} du temps.`);
    }
    if (tips.length) html += '<h3>À travailler</h3><ul class="detail-lines">' + tips.map((t) => `<li>${t}</li>`).join('') + '</ul>';
    if (!balls.length) html += '<p class="small">Joue quelques balles pour voir tes statistiques.</p>';
    $('statsBody').innerHTML = html;
  }

  function renderSummary(s) {
    $('summary').innerHTML = `
      <div class="kpi"><b>${s.balls}</b><span>Balles jouées</span></div>
      <div class="kpi"><b>${s.meanQuality == null ? '—' : fmt(s.meanQuality)}</b><span>Qualité moyenne</span></div>
      <div class="kpi"><b>${s.bestStreak}</b><span>Meilleure série</span></div>
      <div class="kpi"><b>${pct(s.decision)}</b><span>Précision de décision</span></div>`;
  }

  /* ----- Détail ----- */

  function renderDetail(shot, r, cfg) {
    const fb = Q.feedback(r, SG.FAMILIES[shot.family].name, cfg);
    const ex = Q.explainBall(shot, r);
    $('detailTitle').textContent = fb.text;
    $('detailLines').innerHTML = ex.lines.map((l) => `<li>${l}</li>`).join('');
    $('detailRule').textContent = ex.rule;
  }

  function setCamButtons(mode) {
    document.querySelectorAll('.cam-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === mode)));
  }

  return {
    show,
    showToast,
    hideToast,
    setStreak,
    guideShow,
    guideHide,
    onGuideDone(fn) {
      guide.onDone = fn;
    },
    get guideStep() {
      return guide.step;
    },
    renderSettings,
    renderStats,
    renderSummary,
    renderDetail,
    setCamButtons,
    /** Ouvre un sous-écran (réglages, stats) en mémorisant l'écran de retour. */
    openSub(name, from) {
      backTo = from;
      show(name);
    },
    back() {
      show(backTo);
    },
    setHint(on) {
      $('hint').hidden = !on;
    },
    dataMessage(msg) {
      $('dataMsg').textContent = msg;
    },
  };
}
