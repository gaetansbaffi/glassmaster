/*
 * Glass Lab — sons générés par WebAudio (aucun fichier externe) et vibration.
 * Le contexte audio est créé et débloqué au premier toucher ou à la première touche.
 */

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = true;
  let vibrate = true;

  function init() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      // Bruit blanc réutilisé par tous les sons percussifs
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) {
      ctx = null;
      return false;
    }
  }

  /** À appeler dans un geste de l'utilisateur (toucher, clic, touche). */
  function unlock() {
    if (!init()) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      /* ignoré */
    }
  }

  const ready = () => enabled && ctx && ctx.state === 'running';

  function env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function tone(type, f0, f1, peak, attack, decay, when) {
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + attack + decay);
    env(g, t0, peak, attack, decay);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  }

  function burst(filterType, freq, q, peak, decay) {
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t0, peak, 0.003, decay);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + decay + 0.05);
  }

  const clamp01 = (v) => Math.max(0.05, Math.min(1, v));

  return {
    unlock,
    setEnabled(on) {
      enabled = !!on;
    },
    setVibration(on) {
      vibrate = !!on;
    },
    suspend() {
      try {
        if (ctx && ctx.state === 'running') ctx.suspend();
      } catch (e) {
        /* ignoré */
      }
    },
    /** Rebond au sol : bruit sourd. intensity ∈ [0, 1] (vitesse, distance). */
    floor(intensity) {
      if (!ready()) return;
      const k = clamp01(intensity);
      tone('sine', 150, 70, 0.5 * k, 0.004, 0.11);
      burst('lowpass', 500, 0.7, 0.35 * k, 0.06);
    },
    /** Contact avec une vitre : « tonk » plus clair. */
    glass(intensity) {
      if (!ready()) return;
      const k = clamp01(intensity);
      tone('triangle', 560, 520, 0.35 * k, 0.003, 0.2);
      tone('sine', 1290, 1250, 0.12 * k, 0.002, 0.12);
      burst('highpass', 2500, 0.8, 0.18 * k, 0.04);
    },
    /** Frappe de raquette. */
    hit(intensity) {
      if (!ready()) return;
      const k = clamp01(intensity);
      burst('bandpass', 1800, 1.4, 0.6 * k, 0.05);
      tone('square', 280, 170, 0.12 * k, 0.002, 0.06);
    },
    /** Réussite : deux notes montantes (plus aiguës si la qualité est haute). */
    success(quality) {
      if (!ready()) return;
      const base = quality >= 0.7 ? 784 : 659;
      tone('sine', base, base, 0.18, 0.005, 0.12, 0.05);
      tone('sine', base * 1.5, base * 1.5, 0.16, 0.005, 0.18, 0.13);
    },
    /** Raté : note descendante. */
    miss() {
      if (!ready()) return;
      tone('triangle', 330, 150, 0.22, 0.01, 0.32);
    },
    /** Vibration courte (si disponible et activée). */
    buzz(ms) {
      if (!vibrate) return;
      try {
        if (navigator.vibrate) navigator.vibrate(ms);
      } catch (e) {
        /* ignoré */
      }
    },
  };
}
