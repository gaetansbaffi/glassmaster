/*
 * Glass Lab — réglages : valeurs par défaut et description des contrôles de l'écran Réglages.
 */

const prefersReducedMotion = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
})();

export const DEFAULT_SETTINGS = {
  speed: 1, // vitesse du jeu : 0,5 / 0,75 / 1
  camera: 'fp', // vue : 'fp' (1re personne) ou 'shoulder' (épaule, 3e personne proche)
  moveFrame: 'court', // déplacements : 'court' (haut = vers le filet) ou 'camera' (haut = là où tu regardes)
  fov: 90, // champ de vision horizontal (°)
  heightLine: true, // trait vertical entre la balle et son ombre
  auto: false, // frappe automatique (débutant)
  showPath: false, // afficher la trajectoire (aide)
  showBest: true, // afficher le meilleur point de frappe après chaque balle
  autoReplay: false, // replay automatique au ralenti après une erreur
  sensitivity: 1, // sensibilité du joystick (0,6 à 1,6)
  lefty: false, // mode gaucher : joystick à droite, Frappe à gauche
  sound: true,
  vibration: true,
  reduceMotion: prefersReducedMotion, // réduire les mouvements de caméra
  quality: 'auto', // qualité graphique : auto / low / normal
};

/** Contrôles affichés dans l'écran Réglages, dans l'ordre. */
export const SETTINGS_UI = [
  { key: 'speed', label: 'Vitesse du jeu', type: 'choice', options: [[0.5, '50 %'], [0.75, '75 %'], [1, '100 %']] },
  { key: 'camera', label: 'Vue', hint: 'Épaule : tu vois ton joueur, ta raquette et ta portée au sol.', type: 'choice', options: [['fp', '1re personne'], ['shoulder', 'Épaule']] },
  { key: 'moveFrame', label: 'Déplacements', hint: 'Court : haut = vers le filet, toujours. Regard : haut = là où tu regardes.', type: 'choice', options: [['court', 'Court'], ['camera', 'Regard']] },
  { key: 'fov', label: 'Champ de vision', type: 'range', min: 70, max: 110, step: 5, unit: '°' },
  { key: 'heightLine', label: 'Trait de hauteur sous la balle', hint: 'Relie la balle à son ombre pour juger hauteur et profondeur.', type: 'toggle' },
  { key: 'auto', label: 'Frappe automatique', hint: 'Pour débuter : la frappe part toute seule.', type: 'toggle' },
  { key: 'showPath', label: 'Afficher la trajectoire', hint: 'Aide : la trajectoire complète est visible.', type: 'toggle' },
  { key: 'showBest', label: 'Afficher le meilleur point de frappe', type: 'toggle' },
  { key: 'autoReplay', label: 'Replay automatique après une erreur', type: 'toggle' },
  { key: 'sensitivity', label: 'Sensibilité du joystick', type: 'range', min: 0.6, max: 1.6, step: 0.1, unit: '×' },
  { key: 'lefty', label: 'Mode gaucher', hint: 'Joystick à droite, Frappe à gauche.', type: 'toggle' },
  { key: 'sound', label: 'Son', type: 'toggle' },
  { key: 'vibration', label: 'Vibration', type: 'toggle' },
  { key: 'reduceMotion', label: 'Réduire les mouvements de caméra', type: 'toggle' },
  { key: 'quality', label: 'Qualité graphique', type: 'choice', options: [['auto', 'Auto'], ['low', 'Basse'], ['normal', 'Normale']] },
];
