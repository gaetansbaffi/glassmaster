# Glass Lab

Outil d'entraînement web, statique et mobile-first, pour apprendre à **lire les rebonds sur les parois au padel** : vitre de fond, vitre latérale et doubles vitres.

## But pédagogique

Au padel, le défenseur perd souvent le point non pas sur la frappe mais sur la **lecture** : il se place là où la balle *est*, pas là où elle *sortira* de la vitre. Glass Lab isole cette compétence :

- on fige la balle avant le contact avec la paroi ;
- le joueur anticipe (point de passage, placement ou choix de coup) ;
- la trajectoire réelle est rejouée au ralenti par-dessus sa réponse ;
- une explication chiffrée (angle d'incidence, vitesse avant/après, hauteur de sortie) et une **règle à retenir** concluent chaque exercice.

## Familles de balles

| Famille | Séquence de contacts | Règle clé |
|---|---|---|
| A · Vitre de fond | sol → fond | La balle ressort dans le même couloir |
| B · Fond puis latérale | sol → fond → latérale | Se placer côté centre, jouer après la 2e vitre |
| C · Latérale puis fond | sol → latérale → fond | Ne pas se coller au coin, attendre un pas devant |
| D · Latérale seule | sol → latérale | Sortie en miroir vers le centre |

Dans chaque famille, l'angle, la vitesse, le point de rebond et le côté sont tirés au hasard (graine affichée sous le terrain pour reproduire un exercice).

## Modes

1. **Lecture** — la balle est figée juste avant la première paroi. Touche le terrain là où elle retombera après les vitres, ou là où elle passera à une profondeur donnée (ligne orange). Score : erreur en mètres (réussi sous 0,8 m).
2. **Placement** — même moment de gel. Glisse ton joueur là où tu frapperais. La zone idéale est la portion de trajectoire où la balle **descend entre 0,8 et 1,3 m** après la dernière vitre ; tu dois être à distance de bras (0,3 à 1,1 m) d'un de ces points, avec 0,4 m de tolérance.
3. **Décision** — la balle est figée quand elle arrive vers toi (avant le rebond). Choisis : volée, laisser rebondir et jouer la sortie de vitre, ou reculer et attendre le 2e rebond (interprété comme la sortie de la **2e vitre**). Chaque option reçoit une note de jouabilité calculée sur la trajectoire :
   - volée : hauteur au passage de ta ligne (3 m du fond) entre 0,9 et 1,5 m, pénalisée si la balle dépasse 72 km/h ;
   - sortie de vitre / 2e vitre : existence d'une fenêtre descendante 0,8–1,3 m à au moins 0,7 m des parois.
   La réponse est juste si sa note est à moins de 0,2 de la meilleure.

**Révéler la trajectoire** (case en haut) affiche la trajectoire complète avant la réponse : utile pour débuter, les essais sont alors marqués « révélés » dans l'historique.

L'écran montre la vue de dessus du demi-court de défense (10 m × 10 m, vitre de fond, vitres latérales 3 m puis 2 m de haut, grillage, ligne de service, filet en haut) et, à droite, une **jauge de hauteur** (profil latéral de la balle sur la dernière seconde, zone de frappe 0,8–1,3 m en vert, haut de vitre à 3 m).

## Vue 3D première personne

Le sélecteur **Vue 2D / Vue 3D** (en haut de l'écran d'entraînement) bascule les modes Lecture, Placement et Décision dans une scène 3D vue à hauteur d'yeux. Le choix est mémorisé.

- **Scène** : court complet 10 × 20 m aux dimensions réelles (demi-court de défense au premier plan), lignes de service, filet, parois vitrées semi-transparentes avec cadres, grillage ailleurs, adversaire stylisé à l'endroit de la frappe. Style low-poly, sans ombres temps réel : seule une **ombre ronde sous la balle** est projetée au sol, pour percevoir la profondeur sur un écran plat. La balle est affichée environ 2 × plus grosse que la réalité pour rester visible ; traînée courte en option.
- **Caméra** : 1,7 m de haut, juste derrière le joueur, champ de vision horizontal de 75°. Par défaut, le regard **suit la balle en douceur** ; l'option **Regard libre** permet de tourner la tête en glissant sur la scène.
- **Lecture** : touche le sol de la scène là où la balle passera (le point est calculé par un rayon caméra → sol, `geometry.js`).
- **Placement** : déplace-toi jusqu'à ta position de frappe, puis Valider.
- **Décision** : mêmes trois choix qu'en 2D, vus depuis ta position.
- **Temps réel** (nouveau, 3D uniquement) : la balle part de la raquette adverse et se joue **à vitesse réelle**. Déplace-toi puis appuie sur **Frappe !** (ou Espace) au moment de frapper. Jugement : écart à la zone de frappe idéale (tolérance 0,4 m, comme en Placement) **et** timing par rapport à la fenêtre où la balle descend entre 0,8 et 1,3 m (tolérance 0,15 s). Le résultat précise « trop tôt », « trop tard », « mal placé » ou « pas de frappe ».
- **Replay** : après chaque réponse, la trajectoire réelle est rejouée au ralenti ; trois boutons en bas de la scène basculent entre **1re personne**, **Dessus** et **Côté**. Ta réponse est superposée (point visé et point réel, zone de frappe idéale en vert, position idéale, portée de bras, point de frappe de chaque option en Décision).

### Commandes

| Action | Clavier | Mobile |
|---|---|---|
| Se déplacer (Placement, Temps réel) | flèches ou **ZQSD** (AZERTY) / WASD (QWERTY) — déplacement relatif au regard | joystick virtuel en bas à gauche de la scène |
| Viser un point (Lecture) | — | toucher le sol de la scène |
| Tourner la tête | — | glisser sur la scène (option Regard libre) |
| Frapper (Temps réel) | Espace | bouton **Frappe !** |
| Changer de vue au replay | — | boutons 1re pers. / Dessus / Côté |

La zone de déplacement est limitée à la moitié de défense (à 0,3 m des parois, 0,5 m du filet). Vitesse de déplacement : 4,5 m/s.

### Limites de la vue 3D

- **Parois approximées** : vitre de fond 3 m surmontée de 1 m de grillage ; vitres latérales 3 m de haut sur 4 m puis 2 m de haut sur 2 m, grillage au-dessus et sur le reste de la longueur (hauteur totale 4 m puis 3 m). Les vraies installations varient (portes, poteaux, panneaux de 2 m × 3 m ou 2 m × 2 m selon les fabricants). Le grillage est purement décoratif : la physique ne change pas.
- La **trajectoire avant le filet** (côté adverse) est reconstruite en remontant la parabole depuis le filet ; l'adversaire ne joue pas de vrai coup.
- La balle est **grossie** à l'affichage (≈ 2 ×), l'ombre est une simple pastille dont l'opacité baisse avec la hauteur ; la perception de la profondeur reste plus difficile que sur un vrai court (pas de vision binoculaire).
- En vue de côté, les parois du premier plan restent visibles et peuvent gêner la lecture.
- Performance visée : 60 i/s sur un téléphone récent (géométries simples, environ 20 à 30 appels de rendu par image, pixel ratio plafonné à 2, pas de post-traitement). Ajouter `?fps` à l'URL affiche la cadence et le nombre d'appels. Vérifié uniquement dans Chromium avec un rendu logiciel, **pas encore sur un vrai téléphone**.
- **Repli** : si WebGL n'est pas disponible, si Three.js ne se charge pas (hors ligne, CDN bloqué) ou si la page est ouverte en `file://`, un message s'affiche et l'application reste en vue 2D ; le mode Temps réel est alors désactivé.

## Mode Match infini

Un échange continu pour travailler **le placement et la décision** : volée, demi-volée, avant vitre ou après vitre, y compris sur doubles vitres. Disponible en vue 2D et en vue 3D (onglet **Match**).

### Principe

1. L'adversaire envoie une balle (`shotgen.js`).
2. Tu te déplaces pendant que la balle vole : clavier (flèches / ZQSD), joystick en 3D, doigt sur le terrain en 2D (le joueur court vers le point touché).
3. Tu appuies sur **Frappe !** (ou Espace) quand tu estimes que c'est le bon moment : **le moment choisi décide du type de coup**.
4. Si la balle est dans ta zone de frappe à ±250 ms près, la frappe part ; son type est déduit par `classifyShot` et la balle est **renvoyée automatiquement** : on entraîne la décision, pas le geste.
5. Plus la qualité est haute, plus le renvoi est profond (de 2,5 m à 8,5 m derrière le filet adverse) ; sous 0,2, la frappe part dans le filet.
6. L'adversaire renvoie une nouvelle balle, sans fin.
7. Échange perdu si tu n'atteins pas la balle (2e rebond, balle directe passée derrière toi) ou si tu frappes hors de portée : feedback **trop tôt**, **trop tard**, **trop loin** ou **pas atteinte**, puis nouvelle balle.

**Types de coups** (`classifyShot`, `quality.js`) : volée = aucun rebond ; après vitre = au moins un contact paroi ; demi-volée = dans les 150 ms après le rebond, balle sous 0,4 m et montante ; avant vitre = rebond sans paroi. Chaque type a sa propre zone de frappe (hauteur et portée).

**Qualité** (0 à 1), somme pondérée de :
- **hauteur** au contact (fenêtre idéale selon le type) ;
- **placement** : joueur derrière la ligne de la balle (la balle devant lui, côté filet), pas en dessous, à distance de bras latéralement ;
- **aisance** : marge de temps restante et vitesse de la balle (plus lente = mieux) ;
- **dégagement** : distance aux parois au point de frappe (plus d'1 m = idéal, coin pénalisé).

**Meilleur choix** : pour chaque balle, la trajectoire est échantillonnée ; pour chaque type de coup, on cherche le meilleur point de frappe **atteignable** (vitesse du joueur 4 m/s, réaction 250 ms) et sa qualité. Le meilleur type est comparé à ton choix.

**Balles adverses** : familles directe, vitre de fond, fond puis latérale, latérale puis fond, latérale seule croisée. Échantillonnage par rejet déterministe : une balle n'est gardée que si elle suit la séquence de contacts de sa famille, retombe dans ta moitié et reste atteignable depuis ta position avec une qualité ≥ 0,45. Les familles où tu échoues le plus reviennent plus souvent ; le niveau monte au-delà de 80 % de balles renvoyées sur 10, descend sous 50 %.

**Paramètres** (sous le terrain) : vitesse du jeu 50 / 75 / 100 %, frappe automatique (débutant : renvoi au premier passage dans la zone), afficher la trajectoire, afficher le meilleur point après chaque balle.

**Feedback** : bandeau de 1,8 s, vert / orange / rouge, par exemple « Après vitre (0,45) — Fond puis latérale. Meilleur choix : Demi-volée (0,85), la balle mourait dans le coin. » Le bouton **Détail** met en pause et rejoue la balle au ralenti (trajectoire, ta position, meilleur point en vert, ta frappe en orange, vues 1re personne / dessus / côté en 3D) avec une **règle à retenir** chiffrée (angles d'incidence, vitesses après rebond, dégagement).

**Graine fixable** : ajoute `?seed=123` à l'URL pour rejouer exactement la même suite de balles.

### Constantes (`config.js`)

| Constante | Valeur | Rôle |
|---|---|---|
| `player.speed` | 4 m/s | vitesse max du joueur (temps de jeu) |
| `player.reactionTime` | 0,25 s | délai avant de pouvoir réagir à la frappe adverse |
| `strike.timingTolerance` | ±0,25 s | tolérance entre l'appui et le passage dans la zone |
| `zones.*` | voir fichier | hauteur min / idéale / max et portée par type de coup |
| `classify.halfVolleyWindow` / `halfVolleyMaxZ` | 0,15 s / 0,4 m | définition de la demi-volée |
| `quality.weights` | hauteur 0,35 · placement 0,3 · aisance 0,15 · dégagement 0,2 | pondération de la qualité |
| `quality.playable` | 0,45 | qualité atteignable minimale d'une balle générée |
| `quality.minReturn` | 0,2 | en dessous : frappe dans le filet |
| `quality.streak` / `good` / `ok` | 0,6 / 0,7 / 0,45 | série, feedback vert, feedback orange |
| `quality.decisionTolerance` | 0,1 | un choix est « juste » s'il vaut le meilleur à 0,1 près |
| `placement.*`, `ease.*`, `clearance.*` | voir fichier | plages idéales de placement, d'aisance et de dégagement |
| `returnShot.*` | 12,5 → 18,5 m | profondeur du renvoi selon la qualité, marge au-dessus du filet |
| `difficulty` | 10 balles, 80 % / 50 % | difficulté adaptative |
| `game.speeds`, `feedbackMs`, pauses | 50/75/100 %, 1,8 s | rythme du jeu |

### Limites du mode Match

- **On n'entraîne pas le geste** : direction, effet et puissance du renvoi ne dépendent que de la qualité ; le renvoi suit une parabole simple (pas de vitres côté adverse) et l'adversaire ne « joue » pas réellement la balle suivante.
- La qualité et le « meilleur choix » sont des **heuristiques pédagogiques** (poids et plages dans `config.js`), pas un modèle validé par des entraîneurs ; ajuste-les si un cas te paraît faux.
- Le joueur est un point qui accélère instantanément à 4 m/s ; pas de pas d'ajustement, de replacement automatique ni de coup droit / revers.
- Les balles adverses partent toutes du filet (prolongées en arrière jusqu'à la frappe adverse) ; pas de lobs ni de smashs.
- Même modèle physique que le reste de l'application : pas d'effet, pas de frottement de l'air.
- En frappe automatique, le coup part au **premier** passage dans la zone, souvent une volée, même si ce n'est pas le meilleur choix.

## Progression

- **Répétition espacée** : chaque configuration (famille × côté) reçoit un poids `1 + 4 × taux d'échec récent + bonus d'oubli` ; les configurations ratées ou pas vues depuis longtemps reviennent plus souvent.
- **Difficulté adaptative** (niveaux 1 à 5, par mode) : passage au niveau supérieur au-delà de 80 % de réussite sur les 10 derniers essais du niveau (balles plus rapides, angles plus fermés) ; retour en arrière sous 40 %.
- **Statistiques** par famille (essais, taux de réussite, erreur moyenne), courbe d'évolution quotidienne en canvas, **série de jours consécutifs**.
- **Match infini** : réussite (balles renvoyées), qualité moyenne et erreur de placement par famille ; précision de décision globale et par type choisi (« tu choisis après vitre alors qu'une demi-volée était meilleure X % du temps ») ; meilleure série ; balles par session. Les jours de match comptent dans la série de jours.
- Chaque essai enregistre la **vue utilisée** (`view` : `2d` ou `3d` ; les essais plus anciens comptent comme 2D) ; l'onglet Stats compare réussite et erreur moyenne par mode entre 2D et 3D. Les essais du mode Temps réel enregistrent aussi l'écart de timing (`timingError`, en secondes).
- Tout est stocké dans le `localStorage` du navigateur ; **export / import JSON** depuis l'onglet Stats.

## Modèle physique et limites

Simulation 3D (x, y, z) dans `physics.js`, en fonctions pures et déterministes :

- gravité 9,81 m/s² ; balle de 3,3 cm de rayon ;
- rebond au sol : restitution normale 0,75, vitesse horizontale conservée à 90 % ;
- rebond sur paroi : restitution normale 0,8, vitesse tangentielle conservée à 95 % (la balle ressort donc un peu plus « à plat » qu'elle n'est arrivée) ;
- contacts calculés **analytiquement** (pas d'intégration pas à pas) : aucune balle ne peut traverser une surface et la même graine donne exactement la même trajectoire.

Limites assumées de la v1 :

- **pas d'effet (spin)** : lift, slice et balles « coupées » qui sortent peu de la vitre ne sont pas modélisés ; c'est l'écart principal avec le jeu réel ;
- **pas de frottement de l'air** : les balles rapides sont un peu trop « vivantes » en fin de trajectoire ;
- coefficients de restitution fixes (en réalité ils dépendent de la vitesse, de la pression de la balle, de la température et de la vitre) ;
- le **grillage** est traité comme une paroi rigide ; les scénarios générés ne touchent que les parties vitrées ;
- contact ponctuel instantané (pas de déformation ni de glissement de la balle sur la vitre) ;
- la position de défense en mode Décision est fixe (3 m de la vitre de fond) et les seuils de jouabilité sont des heuristiques pédagogiques, pas une vérité tactique.

## Lancer

Aucun build, aucune installation. La vue 2D n'a aucune dépendance ; la vue 3D charge **Three.js 0.170.0** depuis le CDN jsDelivr (version fixée dans l'`importmap` de `index.html`) : une connexion est donc nécessaire au premier chargement.

```bash
# servir le dossier (nécessaire pour la vue 3D, recommandé sur mobile, même réseau)
python3 -m http.server 8000
# puis http://localhost:8000

# ou ouvrir directement le fichier : la vue 2D fonctionne,
# mais pas la 3D (les modules ES ne se chargent pas en file://)
open index.html
```

Tests (Node ≥ 18, sans librairie) :

```bash
node test.js
```

Ils vérifient notamment que la balle ne traverse jamais le sol ni les parois, que la même graine donne la même trajectoire, que la réflexion respecte l'angle d'incidence (aux pertes près : `tan(sortie) = 0,95 / 0,8 × tan(incidence)`) et que chaque famille produit la séquence de contacts attendue à tous les niveaux. Pour la 3D (`geometry.js`) : aller-retour monde ↔ scène, rayon vers le sol qui se reprojette sur le pixel touché, champ de vision, lissage du regard, déplacement borné à la moitié de défense, joystick et clavier, remontée de la balle côté adverse et jugement du mode Temps réel. Pour le mode Match : toute balle générée est atteignable, même graine = même suite de balles, séquence de contacts par famille, `classifyShot` sur des états de référence, appui hors zone jamais renvoyé, renvoi dans le camp adverse, qualité monotone, meilleur choix sur des cas connus, statistiques. `view3d.js` et `app.js` (interface) ne sont pas couverts par les tests Node.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Styles mobile-first, thème clair/sombre |
| `app.js` | Interface : canvas 2D, sélecteur Vue 2D / Vue 3D, interactions, animation, écrans |
| `view3d.js` | Vue 3D (module ES, Three.js) : scène, caméra, contrôles, replay |
| `config.js` | Match : toutes les constantes ajustables |
| `quality.js` | Match : classification des coups, qualité, meilleur choix, feedback et règle à retenir |
| `shotgen.js` | Match : génération des balles adverses (rejet déterministe, familles, atteignabilité) |
| `rally.js` | Match : machine d'états de l'échange (déplacement, frappe, renvoi, pertes) |
| `geometry.js` | Géométrie 3D pure (sans DOM ni Three.js) : conversions écran/monde, rayon vers le sol, regard, déplacement |
| `physics.js` | Physique pure (sans DOM) |
| `scenarios.js` | Génération des scénarios, évaluation, explications |
| `stats.js` | Progression : stockage, répétition espacée, difficulté, stats |
| `test.js` | Tests Node |
