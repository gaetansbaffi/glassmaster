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

## Progression

- **Répétition espacée** : chaque configuration (famille × côté) reçoit un poids `1 + 4 × taux d'échec récent + bonus d'oubli` ; les configurations ratées ou pas vues depuis longtemps reviennent plus souvent.
- **Difficulté adaptative** (niveaux 1 à 5, par mode) : passage au niveau supérieur au-delà de 80 % de réussite sur les 10 derniers essais du niveau (balles plus rapides, angles plus fermés) ; retour en arrière sous 40 %.
- **Statistiques** par famille (essais, taux de réussite, erreur moyenne), courbe d'évolution quotidienne en canvas, **série de jours consécutifs**.
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

Ils vérifient notamment que la balle ne traverse jamais le sol ni les parois, que la même graine donne la même trajectoire, que la réflexion respecte l'angle d'incidence (aux pertes près : `tan(sortie) = 0,95 / 0,8 × tan(incidence)`) et que chaque famille produit la séquence de contacts attendue à tous les niveaux. Pour la 3D (`geometry.js`) : aller-retour monde ↔ scène, rayon vers le sol qui se reprojette sur le pixel touché, champ de vision, lissage du regard, déplacement borné à la moitié de défense, joystick et clavier, remontée de la balle côté adverse et jugement du mode Temps réel. `view3d.js` (rendu Three.js) n'est pas couvert par les tests Node.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Styles mobile-first, thème clair/sombre |
| `app.js` | Interface : canvas 2D, sélecteur Vue 2D / Vue 3D, interactions, animation, écrans |
| `view3d.js` | Vue 3D (module ES, Three.js) : scène, caméra, contrôles, replay |
| `geometry.js` | Géométrie 3D pure (sans DOM ni Three.js) : conversions écran/monde, rayon vers le sol, regard, déplacement |
| `physics.js` | Physique pure (sans DOM) |
| `scenarios.js` | Génération des scénarios, évaluation, explications |
| `stats.js` | Progression : stockage, répétition espacée, difficulté, stats |
| `test.js` | Tests Node |
