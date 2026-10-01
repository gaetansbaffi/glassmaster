/*
 * Glass Lab — constantes ajustables du mode « Match infini ».
 * Toutes les valeurs sont en unités SI (mètres, secondes, m/s) sauf mention contraire.
 * Aucune logique ici : rally.js, shotgen.js et quality.js lisent ces valeurs.
 */

const CONFIG = {
  player: {
    speed: 4.0, // vitesse max de déplacement du joueur (m/s, en temps de jeu)
    reactionTime: 0.25, // délai de réaction après la frappe adverse (s)
    start: { x: 5, y: 3 }, // position de départ (m) : centre, un peu devant la ligne de service
    bounds: { xMin: 0.3, xMax: 9.7, yMin: 0.3, yMax: 9.5 }, // zone de jeu (moitié de défense)
  },

  strike: {
    timingTolerance: 0.25, // ± tolérance entre l'appui sur « Frappe » et le passage dans la zone (s)
    sampleDt: 1 / 120, // pas d'échantillonnage de la trajectoire (s)
  },

  /**
   * Zone de frappe par type de coup :
   *   zMin / zMax   : hauteur de contact acceptée (m)
   *   ideal         : fenêtre de hauteur idéale (m) — qualité de hauteur maximale
   *   reach         : distance horizontale max joueur ↔ balle (m)
   */
  zones: {
    volley: { zMin: 0.5, zMax: 2.0, ideal: [0.9, 1.5], reach: 1.3 },
    halfVolley: { zMin: 0.03, zMax: 0.4, ideal: [0.12, 0.35], reach: 1.2 },
    beforeGlass: { zMin: 0.35, zMax: 1.8, ideal: [0.8, 1.3], reach: 1.3 },
    afterGlass: { zMin: 0.35, zMax: 1.8, ideal: [0.8, 1.3], reach: 1.3 },
  },

  classify: {
    halfVolleyWindow: 0.15, // demi-volée : contact dans les X s après le rebond au sol
    halfVolleyMaxZ: 0.4, // … balle sous cette hauteur, et montante
  },

  quality: {
    // Poids des composantes (somme = 1)
    weights: { height: 0.35, placement: 0.3, ease: 0.15, clearance: 0.2 },
    playable: 0.45, // qualité minimale atteignable pour qu'une balle soit générée
    minReturn: 0.2, // en dessous, la frappe part dans le filet (échange perdu)
    streak: 0.6, // seuil de qualité pour prolonger la série
    good: 0.7, // ≥ : feedback vert
    ok: 0.45, // ≥ : feedback orange, sinon rouge
    decisionTolerance: 0.1, // choix « juste » si sa qualité est à moins de 0,1 du meilleur
  },

  placement: {
    // Le joueur doit être derrière la ligne de la balle (la balle devant lui, côté filet)
    ahead: [0, 0.6], // avance idéale de la balle sur le joueur, en profondeur (m)
    aheadZero: [-0.5, 1.5], // qualité nulle au-delà
    lateral: [0.45, 0.85], // distance latérale idéale (bras + raquette) (m)
    lateralZero: 0.1, // en dessous : le joueur est sous la balle
    idealOffset: { lateral: 0.65, ahead: 0.3 }, // position idéale utilisée par le « meilleur choix »
  },

  ease: {
    marginFull: 0.6, // marge de temps donnant l'aisance maximale (s)
    speedEasy: 6, // vitesse de balle confortable (m/s)
    speedHard: 22, // vitesse de balle très difficile (m/s)
  },

  clearance: {
    min: 0.2, // dégagement nul (m)
    full: 1.0, // dégagement confortable (m)
    cornerPenalty: 0.6, // facteur si la balle est à moins de `full` de deux parois
  },

  returnShot: {
    shortY: 12.5, // retombée d'un renvoi de qualité minimale (m, camp adverse : 10 → 20)
    deepY: 18.5, // retombée d'un renvoi parfait
    netMargin: 0.25, // marge au-dessus du filet (0,88 m)
    xSpread: 3.5, // dispersion latérale de la retombée autour du centre (± m)
    flightTime: [1.4, 0.9], // durée de vol : qualité faible → lente, haute qualité → rapide (s)
  },

  shotgen: {
    maxAttempts: 300, // tirages max par balle (échantillonnage par rejet)
    levels: 5,
    // Famille « directe » : rebond puis 2e rebond avant toute vitre (balle courte)
    direct: { yb: [4.5, 8.5], angle: [-12, 12], T: [[1.15, 1.5], [0.75, 1.0]], z0: [0.9, 1.6] },
    /*
     * Familles à vitres (balle qui arrive vers la paroi droite ; la gauche s'obtient par symétrie).
     * Pour chaque plage [niveau 1, niveau 5] : xb / yb = point de rebond (m), angle = angle de la
     * trajectoire par rapport à l'axe du court (°), z0 = hauteur au filet (m), T = durée filet → rebond (s).
     */
    glassT: [[0.95, 1.25], [0.6, 0.8]],
    glass: {
      A: { xb: [2.5, 7.5], yb: [0.4, 3.2], angle: [[-6, 6], [-14, 14]], z0: [0.95, 1.9] },
      B: { xb: [6.3, 9.3], yb: [0.4, 2.8], angle: [[10, 26], [18, 36]], z0: [0.95, 1.7] },
      C: { xb: [7.4, 9.6], yb: [1.6, 4.5], angle: [[22, 38], [30, 48]], z0: [0.95, 1.6] },
      D: { xb: [7.6, 9.6], yb: [3.6, 6.5], angle: [[26, 42], [34, 52]], z0: [0.95, 1.5] },
    },
  },

  difficulty: {
    window: 10, // nombre de balles récentes considérées
    up: 0.8, // taux de réussite au-delà duquel le niveau monte
    down: 0.5, // en dessous, il descend
  },

  rally: {
    // Échange continu : l'adversaire court jouer ton renvoi et renvoie depuis l'endroit où il le frappe
    oppSpeed: 6, // vitesse max de l'adversaire (m/s)
    oppHitHeight: 1.0, // il frappe ton renvoi quand il redescend à cette hauteur après le rebond (m)
    oppMaxY: 19.2, // … et avant la vitre de fond adverse (m, la vitre est en y = 20)
    oppStepIn: 2.5, // il ne laisse pas la balle filer plus de 2,5 m après le rebond : renvoi court = il avance
    oppReach: 0.6, // décalage latéral entre l'adversaire et la balle qu'il frappe (m)
    serve: { x: [2.5, 7.5], y: [17, 18.5], z: 1.0 }, // départ d'un nouveau point après une faute
    // Hauteur de passage au-dessus du filet, niveau 1 → niveau 5 (m) : plus basse = balle plus tendue et rapide
    netHeight: [[2.2, 3.2], [1.1, 1.8]],
    attackDrop: 0.35, // jusqu'à 0,35 m plus bas quand l'adversaire frappe près du filet (renvoi court = attaque)
    minNetHeight: 0.98, // jamais sous le haut du filet + marge (m)
    hSpeed: [5, 24], // vitesse horizontale admise des balles adverses (m/s)
  },
  game: {
    speeds: [0.5, 0.75, 1], // vitesses de jeu proposées
    missPause: 1.3, // pause après un échange perdu (s de jeu)
    feedbackMs: 1800, // durée d'affichage du feedback (ms, temps réel)
  },
};

export default CONFIG;
