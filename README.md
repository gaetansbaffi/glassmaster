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

## Progression

- **Répétition espacée** : chaque configuration (famille × côté) reçoit un poids `1 + 4 × taux d'échec récent + bonus d'oubli` ; les configurations ratées ou pas vues depuis longtemps reviennent plus souvent.
- **Difficulté adaptative** (niveaux 1 à 5, par mode) : passage au niveau supérieur au-delà de 80 % de réussite sur les 10 derniers essais du niveau (balles plus rapides, angles plus fermés) ; retour en arrière sous 40 %.
- **Statistiques** par famille (essais, taux de réussite, erreur moyenne), courbe d'évolution quotidienne en canvas, **série de jours consécutifs**.
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

Aucune dépendance, aucun build.

```bash
# ouvrir directement le fichier
open index.html            # macOS (ou double-clic)

# ou servir le dossier (recommandé sur mobile, même réseau)
python3 -m http.server 8000
# puis http://localhost:8000
```

Tests (Node ≥ 18, sans librairie) :

```bash
node test.js
```

Ils vérifient notamment que la balle ne traverse jamais le sol ni les parois, que la même graine donne la même trajectoire, que la réflexion respecte l'angle d'incidence (aux pertes près : `tan(sortie) = 0,95 / 0,8 × tan(incidence)`) et que chaque famille produit la séquence de contacts attendue à tous les niveaux.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Styles mobile-first, thème clair/sombre |
| `app.js` | Interface : canvas, interactions, animation, écrans |
| `physics.js` | Physique pure (sans DOM) |
| `scenarios.js` | Génération des scénarios, évaluation, explications |
| `stats.js` | Progression : stockage, répétition espacée, difficulté, stats |
| `test.js` | Tests Node |
