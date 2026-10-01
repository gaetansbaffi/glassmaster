/*
 * Glass Lab — sauvegarde locale (localStorage), tolérante au mode privé et aux données corrompues.
 * Le schéma et la migration sont des fonctions pures de src/core/stats.js.
 */
import Stats from './core/stats.js';
import { DEFAULT_SETTINGS } from './settings.js';

const KEY = 'glasslab.v2';
const OLD_KEYS = ['glasslab.v1']; // application multi-modes d'origine

function store() {
  try {
    const s = window.localStorage;
    const k = '__glasslab__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch (e) {
    return null; // mode privé ou stockage bloqué : on joue sans sauvegarde
  }
}

const ls = store();

function read(key) {
  try {
    const raw = ls && ls.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Charge la sauvegarde courante, ou migre l'ancienne ; ne lève jamais d'exception. */
export function loadState() {
  const cur = read(KEY);
  if (cur) return Stats.migrate(cur, DEFAULT_SETTINGS).state;
  for (const k of OLD_KEYS) {
    const old = read(k);
    if (!old) continue;
    const r = Stats.migrate(old, DEFAULT_SETTINGS);
    if (r.from) {
      saveState(r.state);
      return r.state;
    }
  }
  return Stats.createState(DEFAULT_SETTINGS);
}

export function saveState(state) {
  try {
    if (ls) ls.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* quota dépassé ou stockage indisponible : on continue en mémoire */
  }
}

export const storageAvailable = !!ls;

/** Export : déclenche le téléchargement d'un fichier JSON. */
export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  a.download = `glasslab-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Import : lit un fichier choisi par l'utilisateur ; rejette si ce n'est pas une sauvegarde Glass Lab. */
export function importStateFile(file) {
  return file.text().then((text) => Stats.importState(text, DEFAULT_SETTINGS));
}
