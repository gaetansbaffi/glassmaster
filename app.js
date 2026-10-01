/*
 * Glass Lab — interface (canvas, interactions, écrans).
 */
(function () {
  'use strict';

  const P = window.GlassPhysics;
  const S = window.GlassScenarios;
  const Stats = window.GlassStats;
  const G = window.GlassGeometry;
  const { COURT } = P;

  const MARGIN = 0.55; // marge autour du court, en mètres (épaisseur des parois)
  const INTRO_SPEED = 0.8;
  const REPLAY_SPEED = 0.55;
  const COL = {
    turf: '#1d4f8a',
    turfOut: '#173f6e',
    line: 'rgba(255,255,255,0.92)',
    glass: 'rgba(190,236,255,0.95)',
    glassLow: 'rgba(190,236,255,0.6)',
    mesh: 'rgba(255,255,255,0.45)',
    ball: '#e9ff3b',
    ballEdge: '#6b7a00',
    shadow: 'rgba(0,0,0,0.35)',
    track: 'rgba(255,255,255,0.75)',
    future: 'rgba(233,255,59,0.7)',
    answer: '#ff9f1c',
    truth: '#3ef08f',
    player: '#ffffff',
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n, d) => n.toFixed(d == null ? 1 : d).replace('.', ',');
  const SIDE_NAMES = { left: 'côté gauche', right: 'côté droit' };
  const MODE_PROMPTS = {
    lecture: 'Touche le terrain là où la balle passera.',
    placement: 'Glisse ton joueur là où tu frapperais la balle.',
    decision: 'Que fais-tu ?',
    realtime: 'Place-toi et appuie sur « Frappe » (ou Espace) au moment de frapper.',
    match: 'Déplace-toi et frappe au bon moment : volée, demi-volée, avant ou après la vitre.',
  };
  const MODE_PROMPTS_3D = {
    placement: 'Déplace-toi (joystick, flèches ou ZQSD) jusqu’à ta position de frappe.',
  };

  const store = Stats.createStore(safeStorage());
  const app = {
    mode: 'lecture',
    sc: null,
    samples: [],
    question: null,
    phase: 'idle', // intro | answer | playing | result
    t: 0,
    freezeT: 0,
    answer: null,
    player: null,
    result: null,
    anim: null,
    dragging: false,
    view: { s: 20, w: 0, h: 0 },
    tStart: 0, // début de l'animation (négatif quand la balle part du côté adverse)
    /** État exact de la balle à l'instant t (t < 0 : vol côté adverse, avant le filet). */
    ballAt(t) {
      if (!app.sc) return null;
      const r = app.matchRet; // match : renvoi vers le camp adverse après la frappe
      if (r && t > r.t0) return G.ballistic(r.init, Math.min(t - r.t0, r.T), app.sc.sim.params.g);
      if (t < 0) return G.ballistic(app.sc.init, t, app.sc.sim.params.g);
      return P.stateAt(app.sc.sim, t);
    },
  };

  /* Vue 3D : chargée en module ES (view3d.js) ; repli sur la 2D si WebGL ou le CDN manquent. */
  const three = { status: 'loading', ctrl: null, timer: null };
  const is3D = () => store.state.settings.view === '3d' && three.status === 'ready';

  function safeStorage() {
    try {
      const k = '__glasslab_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Géométrie écran ---------- */

  const court = $('court');
  const gauge = $('gauge');
  const ctx = court.getContext('2d');
  const gctx = gauge.getContext('2d');

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const show3D = is3D();
    court.hidden = show3D;
    $('view3d').hidden = !show3D;
    if (show3D) {
      const el = $('view3d');
      const w = el.clientWidth;
      // Décision : 3 gros boutons sous la scène, on réduit un peu sa hauteur
      const hMax = app.mode === 'decision' ? w : w * 1.25;
      const h = Math.round(Math.max(w * 0.8, Math.min(hMax, window.innerHeight - 340)));
      el.style.height = h + 'px';
      three.ctrl.resize(w, h);
      sizeGauge(h, dpr);
      app.view = { s: app.view.s, w, h };
      draw();
      if (!$('statsView').hidden) renderStats();
      return;
    }
    const w = court.clientWidth;
    const s = w / (COURT.width + 2 * MARGIN);
    const h = s * (COURT.depth + 2 * MARGIN);
    court.style.height = h + 'px';
    court.width = Math.round(w * dpr);
    court.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeGauge(h, dpr);
    app.view = { s, w, h };
    draw();
    if (!$('statsView').hidden) renderStats();
  }

  function sizeGauge(h, dpr) {
    gauge.style.height = h + 'px';
    gauge.width = Math.round(gauge.clientWidth * dpr);
    gauge.height = Math.round(h * dpr);
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const sx = (x) => (MARGIN + x) * app.view.s;
  const sy = (y) => (MARGIN + COURT.depth - y) * app.view.s;
  const m2px = (m) => m * app.view.s;

  function toWorld(evt) {
    const r = court.getBoundingClientRect();
    const x = (evt.clientX - r.left) / app.view.s - MARGIN;
    const y = COURT.depth - ((evt.clientY - r.top) / app.view.s - MARGIN);
    return { x: Math.max(0, Math.min(COURT.width, x)), y: Math.max(0, Math.min(COURT.depth, y)) };
  }

  /* ---------- Dessin du court ---------- */

  function drawCourt() {
    const { w, h } = app.view;
    ctx.fillStyle = COL.turfOut;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COL.turf;
    ctx.fillRect(sx(0), sy(COURT.depth), m2px(COURT.width), m2px(COURT.depth));

    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(COURT.serviceLine));
    ctx.lineTo(sx(COURT.width), sy(COURT.serviceLine));
    ctx.moveTo(sx(COURT.width / 2), sy(COURT.serviceLine));
    ctx.lineTo(sx(COURT.width / 2), sy(COURT.depth));
    ctx.stroke();

    // Filet
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f5f5f5';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(sx(-0.3), sy(COURT.depth));
    ctx.lineTo(sx(COURT.width + 0.3), sy(COURT.depth));
    ctx.stroke();
    ctx.setLineDash([]);

    // Vitre de fond
    const glassW = Math.max(5, m2px(0.28));
    ctx.lineCap = 'butt';
    ctx.strokeStyle = COL.glass;
    ctx.lineWidth = glassW;
    ctx.beginPath();
    ctx.moveTo(sx(0) - glassW / 2, sy(0) + glassW / 2);
    ctx.lineTo(sx(COURT.width) + glassW / 2, sy(0) + glassW / 2);
    ctx.stroke();
    // Vitres latérales (3 m puis 2 m de haut), puis grillage
    for (const x of [0, COURT.width]) {
      const off = x === 0 ? -glassW / 2 : glassW / 2;
      for (const p of COURT.sideGlass) {
        ctx.strokeStyle = p.height >= 3 ? COL.glass : COL.glassLow;
        ctx.lineWidth = p.height >= 3 ? glassW : glassW * 0.6;
        ctx.beginPath();
        ctx.moveTo(sx(x) + off, sy(p.from));
        ctx.lineTo(sx(x) + off, sy(p.to));
        ctx.stroke();
      }
      ctx.strokeStyle = COL.mesh;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(x) + off, sy(6));
      ctx.lineTo(sx(x) + off, sy(COURT.depth));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FILET', sx(COURT.width / 2), sy(COURT.depth) - 6);
  }

  function pathOf(points, transform) {
    ctx.beginPath();
    points.forEach((p, i) => {
      const X = sx(p.x);
      const Y = sy(p.y);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    if (transform) transform();
  }

  function drawTrack(t0, t1, style, dash, width) {
    const pts = app.samples.filter((p) => p.t >= t0 && p.t <= t1);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = width || 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash || []);
    pathOf(pts);
    ctx.stroke();
    ctx.restore();
  }

  function drawContacts(tMax) {
    for (const c of app.sc.sim.contacts) {
      if (c.t > tMax) continue;
      const X = sx(c.pos.x);
      const Y = sy(c.pos.y);
      ctx.save();
      if (c.type === 'floor') {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X, Y, 6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = COL.ball;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        star(X, Y, 8, 4);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function star(x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r : R;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function drawBall(st) {
    const X = sx(st.x);
    const Y = sy(st.y);
    // Ombre portée (soleil en haut à gauche) : décalée proportionnellement à la hauteur
    const off = m2px(st.z * 0.22);
    ctx.fillStyle = COL.shadow;
    ctx.beginPath();
    ctx.ellipse(X + off, Y + off * 0.6, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const r = 5 + Math.min(st.z, 4) * 1.6;
    ctx.fillStyle = COL.ball;
    ctx.strokeStyle = COL.ballEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawPlayer(p, color, ghost, reach) {
    const X = sx(p.x);
    const Y = sy(p.y);
    ctx.save();
    if (reach) {
      // Zone à distance de bras (0,3 – 1,1 m)
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.arc(X, Y, m2px(1.1), 0, Math.PI * 2);
      ctx.arc(X, Y, m2px(0.3), 0, Math.PI * 2, true);
      ctx.fill();
    }
    ctx.globalAlpha = ghost ? 0.85 : 1;
    ctx.setLineDash(ghost ? [4, 3] : []);
    ctx.strokeStyle = color;
    ctx.fillStyle = ghost ? 'transparent' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    const r = Math.max(12, m2px(0.35));
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    if (!ghost) ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X, Y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCross(p, color) {
    const X = sx(p.x);
    const Y = sy(p.y);
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    const d = 9;
    for (const [c, w] of [['rgba(0,0,0,0.5)', 6], [color, 3]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(X - d, Y - d);
      ctx.lineTo(X + d, Y + d);
      ctx.moveTo(X + d, Y - d);
      ctx.lineTo(X - d, Y + d);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRing(p, color, label) {
    const X = sx(p.x);
    const Y = sy(p.y);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(X, Y, 10, 0, Math.PI * 2);
    ctx.stroke();
    if (label) labelAt(X, Y - 16, label, color);
    ctx.restore();
  }

  function labelAt(X, Y, text, color) {
    ctx.save();
    ctx.font = '700 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    const x = Math.max(2, Math.min(app.view.w - w - 2, X - w / 2));
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, Y - 10, w, 18, 6);
    else ctx.rect(x, Y - 10, w, 18);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 5, Y);
    ctx.restore();
  }

  function drawDepthLine(d) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,159,28,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(d));
    ctx.lineTo(sx(COURT.width), sy(d));
    ctx.stroke();
    ctx.restore();
    labelAt(sx(COURT.width) - 40, sy(d) - 12, fmt(d) + ' m', COL.answer);
  }

  function draw() {
    if (!app.view.w) return;
    if (app.mode === 'match' && !is3D()) return drawMatch2D();
    if (is3D()) {
      // La scène 3D a sa propre boucle de rendu ; ici on ne met à jour que la jauge.
      return drawGauge(app.sc ? app.ballAt(app.t) : null);
    }
    drawCourt();
    const sc = app.sc;
    if (!sc) return drawGauge(null);
    const showAll = app.phase === 'playing' || app.phase === 'result';
    const reveal = store.state.settings.reveal && app.phase === 'answer';

    if (app.mode === 'lecture' && app.question && app.question.type === 'depth') drawDepthLine(app.question.depth);

    // Trajectoire future (mode révéler)
    if (reveal) drawTrack(app.freezeT, sc.endT, COL.future, [6, 5], 2);
    if (app.phase === 'result' && app.mode === 'placement') drawIdealZone();

    drawTrack(0, app.t, COL.track, [], 2);
    drawContacts(reveal ? sc.endT : app.t);

    if (app.mode === 'decision') drawDecisionOverlay();
    if (app.mode === 'placement' && app.player) {
      if (app.phase === 'result' && app.result) drawPlayer(app.result.ideal, COL.truth, true, false);
      drawPlayer(app.player, app.phase === 'result' ? COL.answer : COL.player, false, app.phase !== 'intro');
    }
    if (app.mode === 'lecture') {
      if (app.phase === 'result') {
        const tgt = app.question.target;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx(tgt.x), sy(tgt.y));
        ctx.lineTo(sx(app.answer.x), sy(app.answer.y));
        ctx.stroke();
        ctx.restore();
        drawRing(tgt, COL.truth, 'réel');
      }
      if (app.answer) drawCross(app.answer, COL.answer);
    }

    const st = P.stateAt(sc.sim, app.t);
    drawBall(st);
    drawGauge(st);
  }

  function drawIdealZone() {
    const pts = app.result.zone.points;
    if (!pts.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(62,240,143,0.85)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    pathOf(pts);
    ctx.stroke();
    ctx.restore();
    drawRing(app.result.hitPoint, COL.truth, 'frappe idéale');
  }

  function drawDecisionOverlay() {
    if (app.player) drawPlayer(app.player, COL.player, false, false);
    // Ligne du joueur
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(S.PLAYER_DEPTH));
    ctx.lineTo(sx(COURT.width), sy(S.PLAYER_DEPTH));
    ctx.stroke();
    ctx.restore();
    if (app.phase !== 'result' || !app.result) return;
    const o = app.result.options;
    const marks = [
      ['volley', 'Volée'],
      ['glass', 'Sortie 1re vitre'],
      ['second', 'Après 2e vitre'],
    ];
    for (const [k, label] of marks) {
      const pt = o[k].pt;
      if (!pt || o[k].q <= 0) continue;
      const color = k === app.result.best ? COL.truth : o[k].q >= 0.6 ? '#ffe066' : COL.answer;
      drawRing(pt, color, label);
    }
  }

  /* ---------- Jauge de hauteur (profil latéral) ---------- */

  function drawGauge(st) {
    const w = gauge.clientWidth;
    const h = app.view.h;
    if (!w || !h) return;
    const css = getComputedStyle(document.documentElement);
    const text2 = css.getPropertyValue('--text-2').trim() || '#555';
    const grid = css.getPropertyValue('--grid').trim() || '#ddd';
    const surface = css.getPropertyValue('--surface').trim() || '#fff';
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = surface;
    gctx.fillRect(0, 0, w, h);
    const top = 30;
    const bottom = h - 22;
    const zMax = 4;
    const zy = (z) => bottom - (Math.min(z, zMax) / zMax) * (bottom - top);

    // Zone de frappe idéale 0,8 – 1,3 m
    gctx.fillStyle = 'rgba(27,175,122,0.28)';
    gctx.fillRect(0, zy(1.3), w, zy(0.8) - zy(1.3));
    gctx.strokeStyle = grid;
    gctx.lineWidth = 1;
    gctx.font = '10px system-ui, sans-serif';
    gctx.fillStyle = text2;
    gctx.textAlign = 'left';
    for (let z = 0; z <= zMax; z++) {
      gctx.beginPath();
      gctx.moveTo(0, zy(z));
      gctx.lineTo(w, zy(z));
      gctx.stroke();
      gctx.fillText(z + ' m', 3, zy(z) - 2);
    }
    // Haut de la vitre (3 m)
    gctx.strokeStyle = 'rgba(120,200,240,0.9)';
    gctx.lineWidth = 2;
    gctx.beginPath();
    gctx.moveTo(0, zy(3));
    gctx.lineTo(w, zy(3));
    gctx.stroke();
    gctx.fillStyle = text2;
    gctx.textAlign = 'center';
    gctx.fillText('Hauteur', w / 2, 11);
    if (!st || !app.sc) return;

    // Profil : hauteur sur la dernière seconde (le temps défile de gauche à droite)
    const span = 1.2;
    const xr = w - 12;
    const pts = app.samples.filter((p) => p.t <= app.t && p.t >= app.t - span);
    gctx.strokeStyle = 'rgba(160,160,0,0.9)';
    gctx.lineWidth = 2;
    gctx.beginPath();
    pts.forEach((p, i) => {
      const X = xr - ((app.t - p.t) / span) * (xr - 6);
      if (i === 0) gctx.moveTo(X, zy(p.z));
      else gctx.lineTo(X, zy(p.z));
    });
    gctx.stroke();
    gctx.fillStyle = COL.ball;
    gctx.strokeStyle = COL.ballEdge;
    gctx.lineWidth = 1.5;
    gctx.beginPath();
    gctx.arc(xr, zy(st.z), 6, 0, Math.PI * 2);
    gctx.fill();
    gctx.stroke();
    gctx.fillStyle = css.getPropertyValue('--text').trim() || '#000';
    gctx.font = '700 12px system-ui, sans-serif';
    gctx.fillText(fmt(st.z, 2), w / 2, h - 7);
  }

  /* ---------- Animation ---------- */

  function play(from, to, speed, done) {
    app.anim = { from, to, speed, start: performance.now(), done };
    requestAnimationFrame(tick);
  }

  function tick(now) {
    const a = app.anim;
    if (!a) return;
    const t = a.from + ((now - a.start) / 1000) * a.speed;
    if (t >= a.to) {
      app.t = a.to;
      app.anim = null;
      draw();
      if (a.done) a.done();
      return;
    }
    app.t = t;
    draw();
    requestAnimationFrame(tick);
  }

  /* ---------- Déroulé d'un exercice ---------- */

  function newRound() {
    if (app.mode === 'match') return startMatch();
    const mode = app.mode;
    const level = store.state.levels[mode];
    const cfg = Stats.pickConfig(store.state.attempts, mode, Math.random);
    const seed = (Math.random() * 4294967296) >>> 0;
    const sc = S.generate({ family: cfg.family, side: cfg.side, level, seed });
    app.sc = sc;
    app.round = (app.round || 0) + 1;
    app.strike = null;
    app.tStart = mode === 'realtime' ? -G.preNetDuration(sc.init, sc.sim.params.g) : 0;
    app.t = app.tStart;
    if (three.ctrl) three.ctrl.newScenario();
    app.samples = P.sample(sc.sim, 1 / 120);
    app.result = null;
    app.answer = null;
    app.question = mode === 'lecture' ? S.readingQuestion(sc, P.mulberry32(seed ^ 0x5bd1e995)) : null;
    app.freezeT = mode === 'decision' ? sc.decisionFreezeT : sc.freezeT;
    app.player = null;
    if (mode === 'placement' || mode === 'realtime') app.player = { x: COURT.width / 2, y: S.PLAYER_DEPTH };
    if (mode === 'decision') {
      const s = P.stateAt(sc.sim, app.freezeT);
      const x = s.x + (s.vx * (S.PLAYER_DEPTH - s.y)) / s.vy;
      app.player = { x: Math.max(0.6, Math.min(COURT.width - 0.6, x + (x < 5 ? 0.6 : -0.6))), y: S.PLAYER_DEPTH };
    }
    $('seedInfo').textContent = `Niveau ${level} · graine ${seed}`;
    $('familyTag').hidden = true;
    app.phase = 'intro';
    updateUI();
    if (mode === 'realtime') return startLive(app.round);
    play(0, app.freezeT, INTRO_SPEED, () => {
      app.phase = 'answer';
      updateUI();
      draw();
    });
  }

  /** Temps réel : courte pause sur la frappe adverse, puis la balle part à vitesse réelle. */
  function startLive(round) {
    draw();
    setTimeout(() => {
      if (app.round !== round || app.mode !== 'realtime') return;
      app.phase = 'live';
      updateUI();
      play(app.tStart, app.sc.endT, 1, () => strike(true));
    }, 900);
  }

  function strike(timeout) {
    if (app.phase !== 'live') return;
    app.anim = null;
    app.strike = timeout ? null : { t: app.t, player: Object.assign({}, app.player) };
    app.phase = 'answer';
    submit();
  }

  /** Évaluation du mode temps réel : distance à la zone de frappe idéale + timing. */
  function evaluateRealtime(sc) {
    const st = app.strike;
    const pos = st ? st.player : app.player;
    const pl = S.evaluatePlacement(sc, pos);
    const pts = pl.zone.points;
    const win = { t0: pts[0].t, t1: pts[pts.length - 1].t };
    const j = G.judgeStrike({ placementError: pl.error, strikeT: st ? st.t : null, window: win, reachTol: S.PLACEMENT_SUCCESS_M });
    return Object.assign({}, pl, j, { error: pl.error, window: win, strikeT: st ? st.t : null, player: pos });
  }

  function submit(choice) {
    if (app.phase !== 'answer') return;
    const sc = app.sc;
    let res;
    if (app.mode === 'realtime') {
      res = evaluateRealtime(sc);
    } else if (app.mode === 'lecture') {
      if (!app.answer) return;
      res = S.evaluateReading(app.question, app.answer);
    } else if (app.mode === 'placement') {
      res = S.evaluatePlacement(sc, app.player);
    } else {
      res = S.evaluateDecision(sc, choice);
    }
    app.result = res;
    const rec = store.record({
      mode: app.mode,
      family: sc.family,
      configKey: sc.configKey,
      level: sc.level,
      seed: sc.seed,
      success: res.success,
      error: typeof res.error === 'number' ? Math.round(res.error * 100) / 100 : null,
      choice: choice || undefined,
      revealed: !!store.state.settings.reveal,
      view: is3D() ? '3d' : '2d',
      timingError: app.mode === 'realtime' && res.timingError != null ? Math.round(res.timingError * 1000) / 1000 : undefined,
    });
    if (rec.levelChange > 0) toast(`Niveau ${rec.level} débloqué : balles plus rapides et angles plus fermés`);
    if (rec.levelChange < 0) toast(`Retour au niveau ${rec.level} pour consolider`);
    app.phase = 'playing';
    updateUI();
    play(replayFrom(), sc.endT, REPLAY_SPEED, () => {
      app.phase = 'result';
      showFeedback();
      updateUI();
      draw();
    });
  }

  const replayFrom = () => (app.mode === 'realtime' ? app.tStart : app.freezeT);

  function showFeedback() {
    const sc = app.sc;
    const res = app.result;
    const ex = S.explain(sc);
    const fam = S.FAMILIES[sc.family];
    const resultEl = $('result');
    resultEl.className = 'result ' + (res.success ? 'good' : 'bad');
    let head = '';
    let sub = '';
    if (app.mode === 'lecture') {
      head = (res.success ? '✓ Bien lu' : '✗ À revoir') + ` — ${fmt(res.error, 2)} m d'erreur`;
      sub = `Réussi sous ${fmt(S.READING_SUCCESS_M)} m.`;
    } else if (app.mode === 'placement') {
      head = res.success ? '✓ Bien placé' : `✗ ${fmt(res.error, 2)} m de trop`;
      sub = `Tu étais à ${fmt(res.distance, 2)} m du point de frappe idéal (cible : 0,3 à 1,1 m, à distance de bras ; tolérance ${fmt(S.PLACEMENT_SUCCESS_M)} m)` +
        (res.zone.relaxed ? ' — fenêtre élargie : la balle ne redescend pas proprement entre 0,8 et 1,3 m.' : '.');
    } else if (app.mode === 'realtime') {
      if (res.success) head = '✓ Bien placé, bon timing';
      else if (res.timing === 'none') head = '✗ Pas de frappe';
      else if (res.timing === 'early') head = `✗ Trop tôt de ${fmt(res.timingError, 2)} s`;
      else if (res.timing === 'late') head = `✗ Trop tard de ${fmt(res.timingError, 2)} s`;
      else head = `✗ Mal placé : ${fmt(res.error, 2)} m de trop`;
      sub = `Écart à la zone de frappe : ${fmt(res.error, 2)} m (tolérance ${fmt(S.PLACEMENT_SUCCESS_M)} m)` +
        (res.timingError != null ? ` · timing : ${res.timingError ? fmt(res.timingError, 2) + ' s hors fenêtre' : 'dans la fenêtre'} (tolérance 0,15 s).` : '.');
    } else {
      head = res.success ? '✓ Bonne décision' : '✗ Pas le meilleur choix';
      sub = `Meilleure option : ${S.DECISIONS[res.best]}.`;
    }
    resultEl.innerHTML = '';
    resultEl.append(head);
    const small = document.createElement('small');
    small.textContent = sub;
    resultEl.append(small);

    const ul = $('explain');
    ul.innerHTML = '';
    const lines = ex.lines.slice();
    if (app.mode === 'decision') {
      const labels = { volley: 'Volée', glass: 'Sortie de 1re vitre', second: 'Après la 2e vitre' };
      for (const k of ['volley', 'glass', 'second']) {
        const o = res.options[k];
        lines.push(`${labels[k]} : ${Math.round(o.q * 100)} % — ${o.why}.`);
      }
    }
    for (const l of lines) {
      const li = document.createElement('li');
      li.textContent = l;
      ul.append(li);
    }
    $('rule').textContent = ex.rule;
    $('feedback').hidden = false;
    const tag = $('familyTag');
    tag.textContent = `${sc.family} · ${fam.name}${sc.family === 'A' ? '' : ' · ' + SIDE_NAMES[sc.side]}`;
    tag.hidden = false;
    if (app.mode === 'decision') {
      document.querySelectorAll('.choice').forEach((b) => {
        const k = b.dataset.choice;
        b.classList.toggle('right', k === res.best);
        b.classList.toggle('wrong', k === res.choice && !res.success);
      });
    }
    refreshHeader();
  }

  function updateUI() {
    const mode = app.mode;
    const phase = app.phase;
    const main = $('mainBtn');
    $('matchPanel').hidden = mode !== 'match';
    $('revealToggle').parentElement.hidden = mode === 'match';
    if (mode === 'match') return updateMatchUI();
    $('decisionButtons').hidden = mode !== 'decision';
    if (phase !== 'result') $('feedback').hidden = true;
    document.querySelectorAll('.choice').forEach((b) => {
      b.disabled = phase !== 'answer';
      if (phase !== 'result') b.classList.remove('right', 'wrong', 'picked');
    });

    let prompt = '';
    if (phase === 'intro') prompt = mode === 'realtime' ? 'Attention, la balle part…' : 'Observe la balle…';
    else if (phase === 'live') prompt = MODE_PROMPTS.realtime;
    else if (phase === 'answer') prompt = mode === 'lecture' ? app.question.label : is3D() && MODE_PROMPTS_3D[mode] ? MODE_PROMPTS_3D[mode] : MODE_PROMPTS[mode];
    else if (phase === 'playing') prompt = is3D() ? 'Trajectoire réelle (ralenti) — change de vue en bas de la scène.' : 'Trajectoire réelle (ralenti)…';
    else if (phase === 'result') prompt = mode === 'lecture' ? app.question.label : is3D() && MODE_PROMPTS_3D[mode] ? MODE_PROMPTS_3D[mode] : MODE_PROMPTS[mode];
    if (phase === 'answer' && mode === 'lecture' && !app.answer) prompt += is3D() ? ' Touche le sol de la scène.' : ' Touche le terrain.';
    $('prompt').textContent = prompt;

    if (phase === 'result') {
      main.textContent = 'Suivant →';
      main.disabled = false;
      main.hidden = false;
    } else if (mode === 'decision') {
      main.hidden = true;
    } else if (mode === 'realtime') {
      main.hidden = false;
      main.textContent = 'Frappe !';
      main.disabled = phase !== 'live';
    } else {
      main.hidden = false;
      main.textContent = 'Valider';
      main.disabled = phase !== 'answer' || (mode === 'lecture' && !app.answer);
    }
    const camSel = $('camSel');
    camSel.hidden = !(is3D() && (phase === 'playing' || phase === 'result'));
    if (three.ctrl) {
      const cm = three.ctrl.cameraMode;
      camSel.querySelectorAll('.cam-btn').forEach((b) => b.classList.toggle('active', b.dataset.cam === cm));
    }
    $('replayBtn').disabled = phase === 'intro' || phase === 'playing' || phase === 'live' || (mode === 'realtime' && phase !== 'result');
    refreshHeader();
  }

  function refreshHeader() {
    $('streakVal').textContent = Stats.streak(store.state.attempts.concat(store.state.match.balls), Date.now());
    const lvl = app.mode === 'stats' ? null : store.state.levels[app.mode];
    $('levelChip').hidden = lvl == null;
    if (lvl != null) $('levelVal').textContent = lvl;
  }

  function replay() {
    if (!app.sc || app.anim) return;
    if (app.phase === 'answer') {
      const keep = app.phase;
      app.phase = 'intro';
      updateUI();
      play(0, app.freezeT, INTRO_SPEED, () => {
        app.phase = keep;
        updateUI();
        draw();
      });
    } else if (app.phase === 'result') {
      app.phase = 'playing';
      updateUI();
      play(replayFrom(), app.sc.endT, REPLAY_SPEED, () => {
        app.phase = 'result';
        $('feedback').hidden = false;
        updateUI();
        draw();
      });
    }
  }

  /* ---------- Interactions terrain ---------- */

  function onPointer(evt) {
    if (app.mode === 'match') {
      // Match en 2D : le doigt indique où courir
      if (match.running) match.target = toWorld(evt);
      return;
    }
    if (app.phase !== 'answer') return;
    if (app.mode === 'decision') return;
    const p = toWorld(evt);
    if (app.mode === 'lecture') app.answer = p;
    if (app.mode === 'placement') app.player = p;
    updateUI();
    draw();
  }

  court.addEventListener('pointerdown', (e) => {
    if (app.phase !== 'answer' && !(app.mode === 'match' && match.running)) return;
    app.dragging = true;
    try {
      court.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignoré */
    }
    onPointer(e);
  });
  court.addEventListener('pointermove', (e) => {
    if (app.dragging) onPointer(e);
  });
  const stopDrag = () => (app.dragging = false);
  court.addEventListener('pointerup', stopDrag);
  court.addEventListener('pointercancel', stopDrag);

  $('mainBtn').addEventListener('click', () => {
    if (app.mode === 'match') return app.phase === 'result' ? resumeMatch() : (match.press = true);
    if (app.phase === 'result') newRound();
    else if (app.mode === 'realtime') strike(false);
    else submit();
  });
  window.addEventListener('keydown', (e) => {
    if (app.mode === 'match') return matchKey(e, true);
    if (e.code !== 'Space' || app.mode !== 'realtime' || !is3D()) return;
    e.preventDefault();
    if (app.phase === 'live') strike(false);
  });
  window.addEventListener('keyup', (e) => matchKey(e, false));
  $('replayBtn').addEventListener('click', () => (app.mode === 'match' ? openDetail() : replay()));
  document.querySelectorAll('.choice').forEach((b) =>
    b.addEventListener('click', () => {
      b.classList.add('picked');
      submit(b.dataset.choice);
    })
  );

  const reveal = $('revealToggle');
  reveal.checked = !!store.state.settings.reveal;
  reveal.addEventListener('change', () => {
    store.setSetting('reveal', reveal.checked);
    draw();
  });

  /* ---------- Mode Match infini ---------- */

  const R = window.GlassRally;
  const SG = window.GlassShotGen;
  const Q = window.GlassQuality;
  const CFG = window.GlassConfig;
  const match = { state: null, running: false, last: 0, press: false, keys: new Set(), target: null, detail: null, fbTimer: null, session: 0 };

  function matchSettings() {
    return Object.assign({ speed: 1, auto: false, showPath: false, showBest: true }, store.state.settings.match);
  }

  function setMatchSetting(key, value) {
    store.setSetting('match', Object.assign(matchSettings(), { [key]: value }));
    if (key === 'auto' && match.state) match.state = R.withSettings(match.state, { auto: value });
    syncMatchSettingsUI();
    updateUI();
  }

  function syncMatchSettingsUI() {
    const ms = matchSettings();
    document.querySelectorAll('.speed-btn').forEach((b) => b.classList.toggle('active', +b.dataset.speed === ms.speed));
    $('autoToggle').checked = ms.auto;
    $('pathToggle').checked = ms.showPath;
    $('bestToggle').checked = ms.showBest;
  }

  /** Graine de la partie : ?seed=123 dans l'URL pour rejouer exactement la même suite de balles. */
  function matchSeed() {
    const m = /[?&]seed=(\d+)/.exec(location.search);
    return m ? Number(m[1]) >>> 0 : (Math.random() * 4294967296) >>> 0;
  }

  function startMatch() {
    match.session = Date.now();
    const seed = matchSeed();
    match.state = R.createRally({
      seed,
      auto: matchSettings().auto,
      player: CFG.player.start,
      level: store.state.levels.match || 1,
      weights: Stats.matchFamilyWeights(store.state.match.balls),
    });
    match.detail = null;
    match.target = null;
    $('seedInfo').textContent = `Graine ${seed}`;
    $('familyTag').hidden = true;
    hideMatchFeedback();
    onMatchEvents(match.state.events);
    app.phase = 'match';
    syncMatchApp();
    updateUI();
    match.running = true;
    match.last = 0;
    requestAnimationFrame(matchFrame);
  }

  /** Recopie l'état de l'échange dans `app`, lu par les vues 2D et 3D. */
  function syncMatchApp() {
    const s = match.state;
    const ms = matchSettings();
    app.sc = s.shot;
    app.tStart = s.shot.tStart;
    app.player = s.player;
    app.matchRet = s.phase === 'return' ? { init: s.ret.init, t0: s.t, T: s.ret.T } : null;
    app.t = s.phase === 'return' ? s.t + s.ret.t : s.t;
    app.showPath = ms.showPath && s.phase === 'incoming';
    app.overlayAlways = ms.showBest && (s.phase === 'return' || s.phase === 'miss');
  }

  function matchMoveInput() {
    if (is3D() && three.ctrl) return three.ctrl.moveVector();
    const kv = G.keyboardVector(match.keys);
    if (kv.x || kv.y) {
      match.target = null;
      return kv;
    }
    const tg = match.target;
    if (!tg) return null;
    const p = match.state.player;
    const d = Math.hypot(tg.x - p.x, tg.y - p.y);
    if (d < 0.05) {
      match.target = null;
      return null;
    }
    return { x: (tg.x - p.x) / d, y: (tg.y - p.y) / d };
  }

  function matchFrame(now) {
    if (!match.running || app.mode !== 'match') return;
    const dtReal = match.last ? Math.min(0.05, (now - match.last) / 1000) : 0;
    match.last = now;
    const dt = dtReal * matchSettings().speed;
    const strike = match.press && !match.state.auto;
    match.press = false;
    match.state = R.step(match.state, dt, { move: matchMoveInput(), strike });
    onMatchEvents(match.state.events);
    syncMatchApp();
    draw();
    updateMatchHud();
    requestAnimationFrame(matchFrame);
  }

  function onMatchEvents(events) {
    for (const e of events) {
      if (e.type === 'newBall') {
        const s = match.state;
        app.sc = s.shot;
        app.samples = P.sample(s.shot.sim, 1 / 120);
        app.result = null;
        if (three.ctrl) three.ctrl.newScenario();
        updateMatchUI();
      } else {
        const result = Object.assign({}, e.result, { shot: match.state.shot });
        app.result = result;
        match.detail = { shot: match.state.shot, result };
        recordMatchBall(result);
        showMatchFeedback(result);
      }
    }
  }

  /** Enregistre la balle, puis ajuste la pondération des familles et le niveau de l'échange. */
  function recordMatchBall(r) {
    const ms = matchSettings();
    const rec = store.recordMatch(
      {
        session: match.session,
        family: r.family,
        outcome: r.outcome,
        reason: r.reason,
        type: r.type,
        quality: typeof r.quality === 'number' ? Math.round(r.quality * 1000) / 1000 : undefined,
        bestType: r.bestType,
        bestQuality: Math.round(r.bestQuality * 1000) / 1000,
        decisionOk: r.outcome === 'hit' ? r.decisionOk : undefined,
        placementError: typeof r.placementError === 'number' ? Math.round(r.placementError * 100) / 100 : undefined,
        level: r.level,
        view: is3D() ? '3d' : '2d',
        speed: ms.speed,
        auto: ms.auto,
      },
      match.state.streak,
      CFG.difficulty
    );
    match.state = R.withSettings(match.state, { weights: Stats.matchFamilyWeights(store.state.match.balls), level: rec.level });
    if (rec.levelChange > 0) toast(`Match : niveau ${rec.level}, balles plus rapides et angles plus fermés`);
    if (rec.levelChange < 0) toast(`Match : retour au niveau ${rec.level}`);
  }

  function showMatchFeedback(r) {
    const fb = Q.feedback(r, SG.FAMILIES[r.family].name, CFG);
    const el = $('matchFb');
    el.className = 'mfb ' + fb.level;
    $('matchFbText').textContent = fb.text;
    el.hidden = false;
    clearTimeout(match.fbTimer);
    match.fbTimer = setTimeout(hideMatchFeedback, CFG.game.feedbackMs);
  }

  function hideMatchFeedback() {
    clearTimeout(match.fbTimer);
    $('matchFb').hidden = true;
  }

  /** Détail : pause, replay au ralenti de la dernière balle, meilleur point et règle à retenir. */
  function openDetail() {
    const d = match.detail;
    if (!d) return;
    match.running = false;
    hideMatchFeedback();
    app.matchRet = null;
    app.showPath = false;
    app.overlayAlways = false;
    app.sc = d.shot;
    app.samples = P.sample(d.shot.sim, 1 / 120);
    app.tStart = d.shot.tStart;
    app.player = d.result.player;
    app.result = d.result;
    app.phase = 'playing';
    updateUI();
    play(d.shot.tStart, d.shot.endT, REPLAY_SPEED * 0.75, () => {
      app.phase = 'result';
      showMatchDetail(d);
      updateUI();
      draw();
    });
  }

  function showMatchDetail(d) {
    const r = d.result;
    const fb = Q.feedback(r, SG.FAMILIES[r.family].name, CFG);
    const ex = Q.explainBall(d.shot, r);
    const resultEl = $('result');
    resultEl.className = 'result ' + (fb.level === 'good' ? 'good' : fb.level === 'bad' ? 'bad' : 'warn');
    resultEl.textContent = fb.text;
    const ul = $('explain');
    ul.innerHTML = '';
    for (const l of ex.lines) {
      const li = document.createElement('li');
      li.textContent = l;
      ul.append(li);
    }
    $('rule').textContent = ex.rule;
    $('feedback').hidden = false;
    const tag = $('familyTag');
    tag.textContent = SG.FAMILIES[r.family].name;
    tag.hidden = false;
  }

  function resumeMatch() {
    app.anim = null;
    $('feedback').hidden = true;
    $('familyTag').hidden = true;
    hideMatchFeedback();
    if (three.ctrl) three.ctrl.setCameraMode('fp');
    app.phase = 'match';
    app.result = match.state.last && match.state.phase !== 'incoming' ? app.result : null;
    syncMatchApp();
    updateUI();
    match.running = true;
    match.last = 0;
    requestAnimationFrame(matchFrame);
  }

  function matchKey(e, down) {
    if (app.mode !== 'match') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (down && match.running && !e.repeat) match.press = true;
      return;
    }
    if (!/^(Arrow|Key[WASD])/.test(e.code)) return;
    if (down) {
      match.keys.add(e.code);
      e.preventDefault();
    } else match.keys.delete(e.code);
  }

  function updateMatchHud() {
    const s = match.state;
    if (!s) return;
    $('matchScore').textContent = `Série ${s.streak} · Meilleure ${s.bestStreak} · Balles ${s.balls} · Niv. ${s.level}`;
    const main = $('mainBtn');
    if (app.phase === 'match') main.disabled = s.auto || s.phase !== 'incoming';
  }

  function updateMatchUI() {
    const main = $('mainBtn');
    $('decisionButtons').hidden = true;
    const detail = app.phase === 'playing' || app.phase === 'result';
    if (!detail) $('feedback').hidden = true;
    $('prompt').textContent = detail ? 'Détail de la balle (ralenti) — meilleur point en vert, ta frappe en orange.' : MODE_PROMPTS.match;
    main.hidden = false;
    if (app.phase === 'result') {
      main.textContent = 'Reprendre ▶';
      main.disabled = false;
    } else {
      main.textContent = matchSettings().auto ? 'Frappe auto' : 'Frappe !';
      main.disabled = detail || !match.state || match.state.auto || match.state.phase !== 'incoming';
    }
    const rb = $('replayBtn');
    rb.textContent = detail ? '↺ Rejouer' : 'Détail';
    rb.disabled = app.phase === 'playing' || !match.detail;
    const camSel = $('camSel');
    camSel.hidden = !(is3D() && detail);
    if (three.ctrl) camSel.querySelectorAll('.cam-btn').forEach((b) => b.classList.toggle('active', b.dataset.cam === three.ctrl.cameraMode));
    updateMatchHud();
    refreshHeader();
  }

  $('matchDetailBtn').addEventListener('click', openDetail);
  document.querySelectorAll('.speed-btn').forEach((b) => b.addEventListener('click', () => setMatchSetting('speed', +b.dataset.speed)));
  for (const [id, key] of [['autoToggle', 'auto'], ['pathToggle', 'showPath'], ['bestToggle', 'showBest']]) {
    $(id).addEventListener('change', () => setMatchSetting(key, $(id).checked));
  }
  syncMatchSettingsUI();

  /** Vue 2D du match : court, balle, joueur, trajectoire (aide) et meilleur point. */
  function drawMatch2D() {
    drawCourt();
    const sc = app.sc;
    if (!sc) return drawGauge(null);
    const replay = app.phase === 'playing' || app.phase === 'result';
    if (app.showPath || replay) drawTrack(0, sc.endT, COL.future, [6, 5], 2);
    drawTrack(0, Math.min(app.t, sc.endT), COL.track, [], 2);
    drawContacts(Math.min(app.t, sc.endT));
    const res = replay || app.overlayAlways ? app.result : null;
    if (res) {
      const best = res.shot && res.shot.best.best;
      if (best) {
        drawPlayer(best.pos, COL.truth, true, false);
        drawRing(best.ball, COL.truth, 'meilleur');
      }
      if (res.ball) drawCross(res.ball, COL.answer);
    }
    if (match.target && match.running) drawRing(match.target, 'rgba(255,255,255,0.6)');
    drawPlayer(app.player, COL.player, false, true);
    const st = app.ballAt(app.t);
    if (st && st.y <= COURT.depth + 0.3) drawBall(st);
    drawGauge(st);
  }

  // Débogage / tests automatisés : ?debug expose l'état (aucun effet sinon)
  if (/[?&]debug\b/.test(location.search)) window.GlassDebug = { app, match };

  /* ---------- Navigation ---------- */

  function setMode(mode) {
    if (mode === 'realtime' && !is3D()) {
      if (three.status !== 'ready') {
        toast(three.status === 'loading' ? 'Vue 3D en cours de chargement…' : 'Le mode Temps réel nécessite la vue 3D, indisponible ici.');
        return;
      }
      store.setSetting('view', '3d');
      toast('Le mode Temps réel se joue en vue 3D');
    }
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    const isStats = mode === 'stats';
    $('trainView').hidden = isStats;
    $('statsView').hidden = !isStats;
    const prev = app.mode;
    app.mode = mode;
    if (prev === 'match' && mode !== 'match') {
      match.running = false;
      hideMatchFeedback();
      app.matchRet = null;
      app.showPath = false;
      app.overlayAlways = false;
    }
    if (isStats) {
      app.anim = null;
      if (three.ctrl) three.ctrl.stop();
      refreshHeader();
      renderStats();
      return;
    }
    if (prev !== mode || !app.sc) {
      app.anim = null;
      app.sc = null;
      app.result = null;
      app.phase = 'idle';
      requestAnimationFrame(() => {
        syncView();
        newRound();
      });
    }
  }

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

  /* ---------- Statistiques ---------- */

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function renderStats() {
    const st = store.state;
    const atts = st.attempts;
    const n = atts.length;
    const ok = atts.filter((a) => a.success).length;
    const kpis = [
      [Stats.streak(atts.concat(st.match.balls), Date.now()) + ' j', 'Série de jours'],
      [n, 'Exercices'],
      [n ? Math.round((ok / n) * 100) + ' %' : '—', 'Réussite globale'],
      [Stats.MODES.map((m) => st.levels[m]).join('·'), 'Niveaux L · P · D · T'],
    ];
    $('kpis').innerHTML = kpis.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');

    const fs = Stats.familyStats(atts);
    let html = '<thead><tr><th>Famille</th><th class="num">Essais</th><th class="num">Réussite</th><th class="num">Erreur moy.</th></tr></thead><tbody>';
    for (const f of S.FAMILY_IDS) {
      const s = fs[f];
      html += `<tr><td><span class="swatch" style="background:var(--series-${f})"></span>${f} · ${S.FAMILIES[f].name}</td>` +
        `<td class="num">${s.n}</td><td class="num">${s.rate == null ? '—' : Math.round(s.rate * 100) + ' %'}</td>` +
        `<td class="num">${s.meanError == null ? '—' : fmt(s.meanError, 2) + ' m'}</td></tr>`;
    }
    $('familyTable').innerHTML = html + '</tbody>';

    const vs = Stats.viewStats(atts);
    const cell = (c) => (c.n ? `${Math.round(c.rate * 100)} %${c.meanError == null ? '' : ' · ' + fmt(c.meanError, 2) + ' m'}<br><small>${c.n} essai${c.n > 1 ? 's' : ''}</small>` : '—');
    const names = { lecture: 'Lecture', placement: 'Placement', decision: 'Décision', realtime: 'Temps réel' };
    let vh = '<thead><tr><th>Mode</th><th class="num">Vue 2D</th><th class="num">Vue 3D</th></tr></thead><tbody>';
    for (const m of Stats.MODES) vh += `<tr><td>${names[m]}</td><td class="num">${cell(vs[m]['2d'])}</td><td class="num">${cell(vs[m]['3d'])}</td></tr>`;
    $('viewTable').innerHTML = vh + '</tbody>';
    renderMatchStats();
    $('chartLegend').innerHTML = S.FAMILY_IDS.map((f) => `<span><span class="swatch" style="background:var(--series-${f})"></span>${f} · ${S.FAMILIES[f].short}</span>`).join('');
    drawChart();
  }

  const SHOT_NAMES = window.GlassQuality.SHOT_NAMES;
  const pct = (v) => (v == null ? '—' : Math.round(v * 100) + ' %');

  function renderMatchStats() {
    const m = store.state.match;
    const balls = m.balls;
    const hits = balls.filter((b) => b.outcome === 'hit').length;
    const ss = Stats.sessionStats(balls);
    const ds = Stats.decisionStats(balls);
    const kpis = [
      [balls.length, 'Balles jouées'],
      [pct(balls.length ? hits / balls.length : null), 'Balles renvoyées'],
      [m.bestStreak, 'Meilleure série'],
      [ss.sessions ? `${ss.last} · ${Math.round(ss.average)}` : '—', 'Balles / session (dern. · moy.)'],
      [pct(ds.accuracy), 'Précision de décision'],
      [store.state.levels.match || 1, 'Niveau du match'],
    ];
    $('matchKpis').innerHTML = kpis.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');
    const fs = Stats.matchFamilyStats(balls);
    let html = '<thead><tr><th>Famille</th><th class="num">Réussite</th><th class="num">Qualité</th><th class="num">Placement</th></tr></thead><tbody>';
    for (const f of Stats.MATCH_FAMILIES) {
      const x = fs[f];
      html += `<tr><td>${SG.FAMILIES[f].short}<br><small>${x.n} balle${x.n > 1 ? 's' : ''}</small></td><td class="num">${pct(x.rate)}</td>` +
        `<td class="num">${x.meanQuality == null ? '—' : fmt(x.meanQuality, 2)}</td><td class="num">${x.meanPlacementError == null ? '—' : fmt(x.meanPlacementError, 2) + ' m'}</td></tr>`;
    }
    $('matchFamilyTable').innerHTML = html + '</tbody>';
    const ul = $('decisionList');
    ul.innerHTML = '';
    for (const t of Q.SHOT_TYPES) {
      const c = ds.byChosen[t];
      if (!c.n) continue;
      const li = document.createElement('li');
      li.textContent = `${SHOT_NAMES[t]} (${c.n}) : bon choix ${pct(c.accuracy)}` +
        (c.topBetter ? ` — tu choisis ${SHOT_NAMES[t].toLowerCase()} alors qu’une ${SHOT_NAMES[c.topBetter].toLowerCase()} était meilleure ${pct(c.topBetterRate)} du temps.` : '.');
      ul.append(li);
    }
    if (!ul.children.length) ul.innerHTML = '<li>Pas encore de frappe en match.</li>';
  }

  let chartGeom = null;

  function drawChart() {
    const canvas = $('chart');
    const c = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const text2 = cssVar('--text-2');
    const muted = cssVar('--muted');
    const grid = cssVar('--grid');
    const surface = cssVar('--surface');
    const series = Stats.dailySeries(store.state.attempts, 14);
    const pad = { l: 44, r: 30, t: 10, b: 26 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const X = (i) => pad.l + (series.length <= 1 ? pw / 2 : (i / (series.length - 1)) * pw);
    const Y = (v) => pad.t + (1 - v) * ph;
    chartGeom = { series, X, pad, w };

    c.font = '11px system-ui, sans-serif';
    c.lineWidth = 1;
    for (const v of [0, 0.5, 1]) {
      c.strokeStyle = grid;
      c.beginPath();
      c.moveTo(pad.l, Y(v));
      c.lineTo(w - pad.r, Y(v));
      c.stroke();
      c.fillStyle = muted;
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillText(Math.round(v * 100) + ' %', pad.l - 6, Y(v));
    }
    if (!series.length) {
      c.fillStyle = text2;
      c.textAlign = 'center';
      c.fillText('Pas encore de données : lance un exercice !', w / 2, h / 2);
      return;
    }
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = muted;
    const idxs = series.length <= 3 ? series.map((_, i) => i) : [0, Math.floor((series.length - 1) / 2), series.length - 1];
    for (const i of idxs) {
      const [, m, d] = series[i].day.split('-');
      c.fillText(`${d}/${m}`, X(i), h - 8);
    }

    const ends = [];
    for (const f of S.FAMILY_IDS) {
      const color = cssVar('--series-' + f);
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.lineJoin = 'round';
      c.beginPath();
      let started = false;
      let last = null;
      series.forEach((row, i) => {
        if (row[f] == null) {
          started = false;
          return;
        }
        if (!started) c.moveTo(X(i), Y(row[f]));
        else c.lineTo(X(i), Y(row[f]));
        started = true;
        last = { i, v: row[f] };
      });
      c.stroke();
      series.forEach((row, i) => {
        if (row[f] == null) return;
        c.fillStyle = color;
        c.strokeStyle = surface;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(X(i), Y(row[f]), 4, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      });
      if (last) ends.push({ f, x: X(last.i), y: Y(last.v) });
    }
    // Étiquettes directes en fin de courbe, écartées pour éviter les collisions
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    c.font = '700 11px system-ui, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = text2;
    for (const e of ends) c.fillText(e.f, Math.min(e.x + 8, w - 12), e.y);
  }

  function chartTip(evt) {
    const tip = $('chartTip');
    if (!chartGeom || !chartGeom.series.length) return;
    const r = $('chart').getBoundingClientRect();
    const x = evt.clientX - r.left;
    let best = 0;
    chartGeom.series.forEach((_, i) => {
      if (Math.abs(chartGeom.X(i) - x) < Math.abs(chartGeom.X(best) - x)) best = i;
    });
    const row = chartGeom.series[best];
    const [, m, d] = row.day.split('-');
    tip.innerHTML = `<b>${d}/${m}</b> · ${row.n} essai${row.n > 1 ? 's' : ''}<br>` +
      S.FAMILY_IDS.map((f) => `<span class="swatch" style="background:var(--series-${f})"></span>${f} : ${row[f] == null ? '—' : Math.round(row[f] * 100) + ' %'}`).join('<br>');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(chartGeom.w - tw, chartGeom.X(best) - tw / 2)) + 'px';
  }
  $('chart').addEventListener('pointermove', chartTip);
  $('chart').addEventListener('pointerdown', chartTip);
  $('chart').addEventListener('pointerleave', () => ($('chartTip').hidden = true));

  /* ---------- Données ---------- */

  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `glasslab-${Stats.dayKey(Date.now())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('dataMsg').textContent = 'Export téléchargé.';
  });
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        store.importJSON(String(reader.result));
        reveal.checked = !!store.state.settings.reveal;
        $('dataMsg').textContent = `Import réussi : ${store.state.attempts.length} essais.`;
        renderStats();
        refreshHeader();
      } catch (err) {
        $('dataMsg').textContent = 'Import impossible : ' + err.message;
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });
  $('resetBtn').addEventListener('click', () => {
    if (!window.confirm('Effacer toute la progression ? (pense à exporter avant)')) return;
    store.reset();
    reveal.checked = false;
    $('dataMsg').textContent = 'Progression effacée.';
    renderStats();
    refreshHeader();
  });

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  /* ---------- Sélecteur Vue 2D / Vue 3D ---------- */

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      return false;
    }
  }

  function notice(msg) {
    const n = $('notice');
    n.textContent = msg || '';
    n.hidden = !msg;
  }

  function fail3D(status, msg) {
    three.status = status;
    document.querySelector('.tab[data-mode="realtime"]').disabled = true;
    if (app.mode === 'realtime') setMode('lecture');
    clearTimeout(three.timer);
    if (three.ctrl) three.ctrl.stop();
    document.querySelector('.seg-btn[data-view="3d"]').disabled = true;
    if (store.state.settings.view === '3d') notice(msg);
    syncView();
  }

  function init3D() {
    if (three.ctrl || three.status !== 'loading' || !window.GlassView3D) return;
    try {
      three.ctrl = window.GlassView3D.create({
        container: $('view3d'),
        getApp: () => app,
        getSettings: () => store.state.settings,
        canMove: () => is3D() && ((app.phase === 'answer' && app.mode === 'placement') || (app.phase === 'live' && app.mode === 'realtime')),
        joystickOn: () => app.mode === 'match' && match.running,
        onPlayerMove: (p) => {
          app.player = p;
        },
        onGroundTap: (p) => {
          if (app.mode !== 'lecture' || app.phase !== 'answer') return;
          app.answer = p;
          updateUI();
        },
      });
      three.status = 'ready';
      clearTimeout(three.timer);
      syncView();
    } catch (e) {
      fail3D('error', 'La vue 3D n’a pas pu démarrer (' + e.message + '). Retour à la vue 2D.');
    }
  }

  /** Applique la vue choisie (si disponible) : boutons, boucle de rendu, tailles. */
  function syncView() {
    const want3D = store.state.settings.view === '3d';
    document.querySelectorAll('.seg-btn').forEach((b) => {
      const on = (b.dataset.view === '3d') === (want3D && three.status === 'ready');
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (three.ctrl) {
      if (is3D() && $('statsView').hidden) three.ctrl.start();
      else three.ctrl.stop();
    }
    if (want3D && three.status === 'loading') notice('Chargement de la vue 3D…');
    else if (three.status === 'ready' || !want3D) notice('');
    resize();
  }

  for (const [id, key] of [['freeLookToggle', 'freeLook'], ['trailToggle', 'trail']]) {
    const el = $(id);
    el.checked = !!store.state.settings[key];
    el.addEventListener('change', () => store.setSetting(key, el.checked));
  }

  document.querySelectorAll('.cam-btn').forEach((b) =>
    b.addEventListener('click', () => {
      if (!three.ctrl) return;
      three.ctrl.setCameraMode(b.dataset.cam);
      updateUI();
    })
  );

  function setView(view) {
    if (view === '3d' && three.status !== 'ready' && three.status !== 'loading') return;
    store.setSetting('view', view);
    if (view === '2d' && app.mode === 'realtime') return setMode('lecture');
    syncView();
  }

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  if (!webglAvailable()) {
    document.querySelector('.tab[data-mode="realtime"]').disabled = true;
    fail3D('nowebgl', 'WebGL n’est pas disponible sur cet appareil ou ce navigateur : la vue 3D est désactivée, la vue 2D reste utilisable.');
  } else {
    document.addEventListener('glass3d-ready', init3D);
    document.addEventListener('glass3d-error', () =>
      fail3D(
        'error',
        location.protocol === 'file:'
          ? 'La vue 3D nécessite d’ouvrir Glass Lab via un serveur web (les modules ES ne se chargent pas en file://). Voir le README. Retour à la vue 2D.'
          : 'La vue 3D n’a pas pu être chargée (Three.js inaccessible : connexion au CDN impossible ?). Retour à la vue 2D.'
      )
    );
    three.timer = setTimeout(() => {
      if (three.status === 'loading') fail3D('error', 'La vue 3D met trop de temps à se charger. Retour à la vue 2D.');
    }, 12000);
    init3D();
  }

  window.addEventListener('resize', resize);
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => resize());

  syncView();
  newRound();
})();
