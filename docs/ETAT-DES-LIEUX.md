# Glass Lab — état des lieux et brief de reconstruction

> Document destiné à relancer la création du jeu avec un modèle plus puissant.
> État au 1ᵉʳ octobre 2026, branche `claude/confident-curie-9n5fu8-jeu` (PR #4).
> Statut des informations : **[fait]** vérifié dans le code ou par les tests · **[retour]** ressenti du joueur · **[reco]** recommandation.

---

## 1. En une phrase

Glass Lab est un **jeu de padel en 3D** pour entraîner la **lecture des vitres** et le **choix du coup** : un échange infini contre un adversaire virtuel. Le joueur se place, appuie sur **Frappe** au bon moment, et le jeu compare son coup au meilleur coup possible.

## 2. Objectif de la reconstruction

1. **Une vraie partie de padel en double : 4 joueurs sur le terrain**, avec des déplacements et des vitesses de jeu réalistes [retour] (voir §7).
2. **Une vraie vue première personne, « comme dans un corps humain »** [retour]. Aujourd'hui, la meilleure expérience est la **vue épaule avec le champ de vision au maximum (110°)** [retour] : elle montre son corps, sa raquette et sa portée au sol. La 1re personne doit offrir au moins la même lisibilité, sans voir son personnage de l'extérieur.
3. **Un seul mode par défaut, parfait** : supprimer presque tous les réglages (voir §5).
4. **Garder la logique de jeu existante** qui fonctionne et est testée (§4), en l'**étendant** au court complet et aux 4 joueurs (§7) ; reconstruire le rendu, la caméra, le corps et les contrôles.

## 3. Ce qui existe et fonctionne [fait]

### Boucle de jeu (« Match infini »)
- Accueil → **Jouer** → la première balle arrive (1 appui). Session infinie, sans game over.
- **Échange continu** : ton renvoi rebondit chez l'adversaire, qui court le jouer (6 m/s) et renvoie **depuis ce point exact**. Sur un renvoi court, il avance (au plus 2,5 m après le rebond) et attaque avec des balles plus tendues. Après une faute, il sert le point suivant du fond et ton joueur reste où il est.
- Le joueur se déplace pendant le vol (4 m/s, réaction 250 ms) et appuie sur **Frappe** : **le moment choisi décide du coup**. Si la balle est dans la zone de frappe à ±250 ms, le coup part et la balle est **renvoyée automatiquement**, d'autant plus profond que la qualité est haute (retombée de 12,5 à 18,5 m). Sous une qualité de 0,2, la balle va dans le filet.
- **Motifs de perte** : trop tôt, trop tard, trop loin, pas atteinte, frappe trop faible.

### Classification, qualité, meilleur choix (`src/core/quality.js`)
- **4 types de coups** :
  - volée : aucun rebond ;
  - demi-volée : 150 ms au plus après le rebond, balle sous 0,4 m et montante ;
  - avant vitre : rebond, pas de paroi ;
  - après vitre : au moins une paroi.
- **Qualité 0–1**, somme pondérée de :
  - hauteur au contact (fenêtre idéale par type) : 0,35 ;
  - placement : 0,3 (derrière la ligne de la balle, pas en dessous, distance de bras de 0,45 à 0,85 m) ;
  - aisance : 0,15 (marge de temps et vitesse de la balle) ;
  - dégagement : 0,2 (distance aux parois, coin pénalisé).
- **Meilleur choix** : la trajectoire est échantillonnée. Pour chaque type de coup, on cherche le meilleur point de frappe **atteignable** depuis la position du joueur au moment de la frappe adverse ; le meilleur type est comparé au choix du joueur.
- Textes générés à partir des données : toast court, panneau Détail avec angles d'incidence, vitesses et dégagement, et une « règle à retenir ».

### Balles adverses (`src/core/shotgen.js`)
- **5 familles** : directe, vitre de fond, fond → latérale, latérale → fond, latérale seule croisée.
- **Échantillonnage par rejet déterministe** (graine). Une balle n'est gardée que si :
  - elle suit la séquence de contacts de sa famille ;
  - elle retombe chez le joueur ;
  - elle est atteignable avec une qualité ≥ 0,45.
- Génération depuis un point de frappe adverse imposé. La trajectoire se déduit exactement de la hauteur de passage au filet : 2,2–3,2 m au niveau 1, 1,1–1,8 m au niveau 5, plus basse quand l'adversaire attaque.
- **Répétition espacée** : les familles où le joueur échoue reviennent plus souvent.
- **Difficulté adaptative** : le niveau monte au-delà de 80 % de balles renvoyées sur 10 balles, descend sous 50 %.

### Physique (`src/core/physics.js`)
- Rebonds analytiques exacts (aucune traversée possible) : sol (restitution 0,75, 90 % de la vitesse tangentielle conservée), parois (restitution 0,8, 95 % de la vitesse tangentielle conservée).
- Court 10 × 20 m. Vitres de fond de 3 m ; vitres latérales de 3 m sur 4 m puis de 2 m sur 2 m. Grillage décoratif.
- Pas d'effet, pas de frottement de l'air.

### Interface, appareil, persistance
- Un seul canvas plein écran ; pas de scroll, de zoom ni de menu contextuel ; safe-area respectée ; redimensionnement sans recréer la scène.
- Fullscreen API, verrouillage paysage et Wake Lock (en try/catch). Pause automatique quand l'onglet perd le focus.
- **Contrôles** :
  - mobile : joystick dynamique (moitié gauche), gros bouton Frappe (≥ 96 px), multi-touch simultané ;
  - PC : ZQSD / WASD / flèches, Espace, Échap, F ;
  - mode gaucher.
- **HUD minimal** : série en haut, Pause, toast de 1,5 s (icône, texte, couleur) avec bouton Détail après une erreur. Trois bulles de guide au premier lancement.
- **Écrans** : accueil, pause (résumé de session), réglages, stats (par famille, précision de décision, meilleure série), Détail (replay au ralenti en vue 1re personne, dessus ou côté, avec règle à retenir).
- **Audio WebAudio généré**, sans fichier (rebond, vitre, frappe, réussite, raté). Vibration.
- **Stockage** : localStorage en try/catch, schéma versionné (v2), migration depuis la v1, export / import JSON.
- **PWA** : manifeste fullscreen, service worker cache-first versionné, fonctionne hors ligne. Three.js 0.170.0 en copie locale dans `vendor/`.
- **Performance** : physique à pas fixe 120 Hz avec interpolation, résolution dynamique, `?debug=1` affiche la cadence. Paramètres d'URL `?seed=` et `?nosw`.
- **Publication** : GitHub Actions lance les tests puis publie sur GitHub Pages à chaque push sur `main` ou `claude/**`.

### Tests
`node test/run.js` : **50 tests, 0 échec**, sans librairie. Ils couvrent :
- la physique et le déterminisme ;
- le joystick, la caméra et la pose de la raquette ;
- la classification, la qualité et le meilleur choix ;
- la génération des balles et la continuité de l'échange ;
- les stats et la migration du stockage ;
- la **pureté de `src/core`** : aucun accès au DOM ni à Three.js.

## 4. Architecture actuelle

| Fichier | Lignes | Rôle | Statut **[reco]** |
|---|---|---|---|
| `src/core/physics.js` | 285 | Rebonds exacts, contacts, classification des séquences | **Garder tel quel** |
| `src/core/quality.js` | 307 | Types de coups, qualité, meilleur choix, textes | **Garder** (calibrer ensuite) |
| `src/core/shotgen.js` | 239 | Balles adverses, familles, atteignabilité | **Garder** |
| `src/core/rally.js` | 360 | Machine d'états de l'échange, adversaire, renvoi | **Garder** (enrichir l'adversaire plus tard) |
| `src/core/config.js` | 124 | Toutes les constantes | **Garder** |
| `src/core/stats.js` | 232 | Schéma, migration, stats, répétition espacée, difficulté | **Garder** |
| `src/core/geometry.js` | 302 | Repères, joystick, caméra, raquette | Garder les fonctions de base ; **refaire caméra et corps** |
| `src/render.js` | 517 | Scène Three.js low-poly | **Refaire** (corps, bras, raquette, lisibilité) |
| `src/main.js` | 750 | Boucle, caméra, écrans, réglages : **trop gros** | **Refaire** en modules plus petits |
| `src/input.js` | 180 | Joystick, Frappe, clavier | Garder la base, simplifier |
| `src/hud.js` | 252 | HUD, écrans, réglages, stats, Détail | Simplifier (moins de réglages) |
| `src/audio.js` | 141 | Sons WebAudio | Garder |
| `src/settings.js`, `src/storage.js` | 48 / 77 | Réglages, sauvegarde | Réduire les réglages |

Règle à conserver : **`src/core` reste pur** (aucun DOM, aucun Three.js) et testé ; tout le reste l'utilise.

## 5. Mode par défaut unique [reco]

Aujourd'hui, il y a **15 réglages** : vitesse, vue, repère des déplacements, champ de vision, trait de hauteur, frappe auto, trajectoire, meilleur point, replay auto, sensibilité, gaucher, son, vibration, caméra réduite, qualité graphique. C'est trop. Cible :

| Aspect | Comportement unique par défaut |
|---|---|
| Vue | **1re personne incarnée** (voir §6). Pas de vue épaule, pas de choix |
| Champ de vision | Fixé par le jeu : ~**105–110° horizontal** en paysage (préféré par le joueur), vertical ≥ 60°, adapté automatiquement en portrait |
| Déplacements | **Par rapport au court** (haut = vers le filet), indépendants de la tête |
| Caméra | La tête suit la balle (lissage, zone morte, sans roulis) ; le corps et les déplacements restent orientés vers le filet |
| Aides visuelles | Toujours actives et discrètes : ombre ronde + **trait balle → sol**, anneau de portée au sol. Pas de trajectoire complète en jeu |
| Meilleur point | Montré seulement dans le **Détail** et dans le toast d'erreur (pas pendant le jeu) |
| Difficulté | **Adaptative uniquement** : elle règle aussi la vitesse du jeu au début (le niveau 1 démarre plus lent), au lieu des réglages vitesse et frappe auto |
| Qualité graphique | Automatique (résolution dynamique), aucun réglage |
| Mouvements réduits | Suivent `prefers-reduced-motion` du système, aucun réglage |

**Réglages restants (3 au total)** : Son (avec la vibration), Mode gaucher, Données (export / import / réinitialiser).

## 6. Cible : une vraie 1re personne « dans un corps » [reco]

Problèmes constatés aujourd'hui [retour + fait] :
- On juge mal **sa position sur le court et par rapport à la balle**.
- La tête (caméra) et le corps sont confondus : quand la caméra suit la balle vers la vitre, l'orientation du joueur suit, ce qui désoriente. Avec des déplacements par rapport au court, « avancer » s'inverse à l'écran quand on regarde derrière soi.
- La raquette est un repère flottant à hauteur de hanche : souvent hors champ, et elle ne tient pas vraiment dans une main.
- Aucune perception de son propre corps (pieds, jambes, torse) ni de son ombre.

Ce qu'il faut viser :
1. **Corps complet et cohérent** : torse, bras, jambes, pieds, visibles quand on regarde vers le bas ou sur le côté. Proportions humaines, yeux à ~1,65 m, caméra au niveau des yeux et non derrière le joueur.
2. **Tête et corps séparés** :
   - la **tête** suit la balle, avec des limites de rotation du cou (≈ ±80° sans tourner le corps) ;
   - le **corps** pivote progressivement quand la balle passe derrière, comme un vrai joueur qui se retourne vers la vitre ;
   - les **déplacements** restent liés au court, ou au corps, mais **jamais à la tête**.
3. **Bras et raquette en cinématique inverse** : main droite (ou gauche en mode gaucher) qui tient la raquette, position de garde visible en bas de l'écran, geste de frappe animé vers la balle au moment de l'appui. La tête de raquette matérialise la portée réelle.
4. **Repères de proprioception** : ombre de son corps au sol, pieds visibles, anneau de portée discret. Éventuellement une légère inclinaison de la tête vers la balle basse.
5. **Confort** : pas de roulis, horizon stable, accélérations douces (inertie de quelques centièmes de seconde sur la tête et le corps), aucune nausée en paysage sur téléphone.
6. **Lisibilité de la balle** : balle grossie (~2×) avec contour, ombre et trait vers le sol ; la balle doit rester visible au moment de frapper.

Critère : un joueur doit juger sa position et la balle **au moins aussi bien qu'en vue épaule avec 110° de champ** aujourd'hui.

## 7. Cible : une vraie partie de padel à 4 [reco]

### Ce que le moteur actuel suppose, et qui doit changer [fait]
- **Un seul adversaire**, sans partenaire. Le joueur est seul dans sa moitié de court.
- **La physique ne modélise que la moitié du joueur** : vitre de fond en y = 0, parois latérales. Le **filet** n'est qu'un plan où la simulation s'arrête : la balle ne peut pas le toucher. La **vitre de fond adverse** (y = 20) n'existe pas.
- **L'adversaire frappe toujours après le rebond** dans son camp : pas de volée, de lob, de smash ni de jeu de ses vitres.
- **Pas de service ni de score** : les points s'enchaînent sans compter.
- **Le joueur est un point** qui atteint 4 m/s instantanément ; l'adversaire court à 6 m/s en ligne droite.

### Ce qu'il faut viser
1. **4 joueurs** : toi, ton partenaire (IA) et deux adversaires (IA), avec des silhouettes humaines animées (course, pas chassés, préparation, frappe).
2. **Court complet en physique** : les deux moitiés avec toutes leurs vitres, et le **filet comme obstacle** (balle dans le filet, balle qui passe en frôlant). Les vitres adverses servent aussi au jeu des adversaires.
3. **Positionnement tactique réaliste** :
   - chaque équipe est en **défense** (fond, près des vitres) ou en **attaque** (au filet) ; elle monte au filet après un bon lob ou une balle courte, et recule sur un lob adverse ;
   - les partenaires restent **alignés** et couvrent chacun leur côté (droite / gauche ; le coup droit prend en général la balle au centre) ;
   - **qui prend la balle** : celui de son côté, ou celui le mieux placé pour une balle au centre. Ton partenaire IA joue les balles de son côté, toi les tiennes.
4. **Coups variés pour les IA** : défense après vitre, lob, chiquita (balle basse aux pieds), volée, bandeja, víbora, smash. Le choix du coup dépend de la position et de la balle reçue.
5. **Service et score réels** :
   - service à la cuillère, après un rebond, derrière la ligne de service, en diagonale ;
   - comptage 15-30-40-jeu, avec avantage ou point en or ;
   - jeux et sets affichés discrètement.

   Pour garder l'esprit « session infinie », la partie ne s'arrête jamais : un nouveau set commence à la fin du précédent.
6. **Vitesses et mouvements adaptés**, avec une accélération réaliste (on ne passe pas de 0 à la vitesse maximale instantanément), un pas d'ajustement avant la frappe (split-step) et un temps de réaction humain.

### Ordres de grandeur réalistes (à calibrer)
Ce sont des valeurs indicatives, issues de connaissances générales et non de mesures : à vérifier et ajuster en testant.

| Élément | Ordre de grandeur |
|---|---|
| Balle en échange de fond / défense | ~40–70 km/h |
| Volée | ~50–80 km/h |
| Lob | ~30–50 km/h, très haut (5–8 m) |
| Smash | ~80–120 km/h et plus |
| Joueur : déplacement courant / sprint | ~2–4 m/s / ~5–6 m/s |
| Joueur : accélération | quelques m/s² : environ 0,5 s pour atteindre la pleine vitesse |
| Temps de réaction | ~0,2–0,3 s |
| Temps entre deux frappes | ~1–2 s selon la position (plus court au filet) |

### Tension avec l'objectif pédagogique — décision à prendre
À 4 joueurs, **ton partenaire prend environ la moitié des balles**, et une partie de l'échange se joue au filet, sans vitre. Il y aura donc **moins de situations de lecture des vitres par minute** que dans l'exercice actuel. Deux options :
- **(a) Partie réaliste** : distribution naturelle des balles. Plus immersif, moins d'entraînement ciblé.
- **(b) Partie orientée entraînement** (recommandée par défaut) : mêmes règles, mais les adversaires visent **plus souvent ton côté** (~60–70 % des balles) et jouent plus de balles qui t'obligent à lire les vitres, avec la répétition espacée par famille de balle conservée. Les stats et le feedback ne portent que sur tes coups.

### Impact sur le code existant
- `physics.js` : étendre au court complet (vitres adverses, filet comme obstacle). La sortie actuelle reste un cas particulier.
- `shotgen.js` : génération depuis n'importe quel joueur, vers n'importe quelle zone, avec les nouveaux types de coups des IA.
- `rally.js` : passer d'un duel à **4 agents**, avec service, score, attribution de la balle, positionnement et transitions attaque / défense.
- `quality.js` : conserver l'évaluation de **tes** coups ; ajouter le contexte double (ta position par rapport à ton partenaire, la couverture de ton côté).
- Nouveaux modules purs suggérés : `players.js` (déplacement avec accélération, réaction, split-step) et `tactics.js` (positionnement, qui prend la balle, choix du coup des IA), testés comme le reste de `src/core`.

### Ordre conseillé
1. 1re personne incarnée (§6), en gardant l'échange actuel.
2. Court complet, 4 joueurs, positionnement et attribution de la balle, IA avec quelques coups (défense, lob, volée).
3. Service et score, coups avancés (bandeja, víbora, smash, chiquita), calibrage des vitesses.

## 8. Limites et dette connues [fait]

- **La frappe n'est pas un contact raquette-balle** : elle est jugée sur la position du joueur et le moment d'appui. La raquette dessinée est un indicateur.
- **Adversaire simpliste** : il frappe toujours après le rebond ; pas de volée, de lob, de smash ni de jeu de ses vitres.
- **Balles plus rapides depuis l'échange continu** : environ 43 km/h au niveau 1, contre ~27 km/h avant, car elles partent réellement du fond adverse.
- La **latérale seule croisée** est rare : elle n'est possible qu'après un renvoi court.
- **Heuristiques de qualité non calibrées** : le meilleur point atteint souvent 0,9–1, et le seuil de jouabilité (0,45) laisse passer presque toutes les balles.
- **Physique simplifiée** : pas d'effet ni de frottement de l'air ; grillage décoratif.
- Toast de 1,5 s court pour toucher « Détail » : la dernière erreur reste accessible depuis la Pause.
- `src/core` alloue de petits objets à chaque pas (états immuables) ; le rendu n'alloue rien.
- **Jamais testé sur un vrai téléphone** ; sur iOS, pas d'API plein écran dans Safari ni de vibration.
- Tests navigateur faits seulement en Chromium sans affichage, avec un rendu WebGL logiciel.

## 9. Critères d'acceptation de la nouvelle version

- De l'ouverture à la première balle : **1 appui**.
- Aucun scroll, zoom ou menu involontaire ; joystick et Frappe utilisables en même temps.
- **1re personne incarnée** conforme au §6 ; aucun choix de vue ni de champ de vision proposé.
- **Partie à 4 joueurs** conforme au §7 : partenaire et adversaires visibles et animés, positionnement attaque / défense, attribution de la balle, service et score, vitesses dans les ordres de grandeur du tableau.
- **3 réglages au maximum** (§5).
- Logique de jeu conservée (§3) et étendue (§7) ; `src/core` toujours pur ; `node test/run.js` au vert, avec des tests ajoutés pour la tête, le corps, la cinématique inverse du bras, le déplacement des joueurs, le positionnement, l'attribution de la balle, le service et le score (fonctions pures).
- 60 i/s visés sur un téléphone milieu de gamme ; PWA hors ligne conservée.

## 10. Brief prêt à copier

> Dans le dépôt `gaetansbaffi/glassmaster`, branche `claude/confident-curie-9n5fu8-jeu`, lis `docs/ETAT-DES-LIEUX.md` en entier.
> Reconstruis le jeu « Glass Lab » en **conservant et étendant `src/core/` (physique, échange, génération des balles, qualité, stats, config) et ses tests**, et en refaisant le rendu, la caméra, le corps du joueur, les contrôles et l'interface.
> Objectif : une **vraie partie de padel en double à 4 joueurs** (§7 : court complet en physique avec filet et vitres adverses, partenaire et adversaires IA animés, positionnement attaque / défense, attribution de la balle, service et score, vitesses réalistes), vécue en **1re personne incarnée** (§6). Choisis l'option (b) « orientée entraînement » du §7, sauf indication contraire. Suis l'ordre conseillé du §7 : livre d'abord une version jouable de chaque étape.
> Pour la vue : une **vue 1re personne incarnée** (§6). Corps complet visible, tête et corps séparés, bras et raquette en cinématique inverse, déplacements par rapport au court, champ de vision large fixé par le jeu. Un joueur doit juger sa position et la balle au moins aussi bien qu'avec l'actuelle vue épaule à 110°.
> Un **seul mode par défaut** : 3 réglages au maximum (son, gaucher, données). Tout le reste est fixé (§5).
> Respecte les critères d'acceptation (§9). Mobile d'abord, PC au clavier. JavaScript vanilla + Three.js local, sans bundler.
> Fais des commits par étape et ouvre une pull request. Liste dans la PR ce qui doit être testé à la main sur un vrai téléphone.
