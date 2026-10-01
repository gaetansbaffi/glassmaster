# Glass Lab — Match infini

Un jeu de padel en **3D, vue première personne**, pour entraîner la **lecture des vitres** et le **choix du coup**. On ouvre, on appuie sur **Jouer**, on joue : l'adversaire envoie des balles sans fin (vitre de fond, doubles vitres, latérales, balles directes). Tu te places et tu frappes au bon moment ; le jeu te dit quel coup tu as joué, avec quelle qualité, et quel était le meilleur choix possible.

Conçu **mobile d'abord** (plein écran, jouable avec deux pouces, paysage conseillé) et utilisable au **clavier sur PC**.

## Concept

1. L'adversaire frappe : la balle traverse le filet et vient vers toi. C'est un **vrai échange** : il renvoie depuis l'endroit où il a joué ta balle précédente (il court la chercher), et attaque plus fort si ton renvoi était court.
2. Tu te déplaces pendant qu'elle vole.
3. Tu appuies sur **Frappe** quand tu estimes que c'est le moment. **C'est le moment choisi qui décide du coup** :
   - **volée** : avant tout rebond ;
   - **demi-volée** : juste après le rebond (≈ 150 ms), balle basse et montante ;
   - **avant vitre** : après le rebond, avant toute vitre ;
   - **après vitre** : après une ou deux vitres.
4. Si la balle est dans ta zone de frappe (à ±250 ms près), elle est renvoyée automatiquement : **on entraîne la décision, pas le geste**. Meilleure est la qualité, plus le renvoi est profond.
5. Un court message indique le coup joué, sa qualité (0 à 1) et le meilleur coup possible pour cette balle. Après une erreur, **Détail** rejoue la balle au ralenti (vue 1re personne, de dessus ou de côté) avec une règle à retenir.

Après une faute, l'adversaire se replace au fond et sert le point suivant ; ton joueur reste où il est. La session est infinie, sans game over. Les familles de balles où tu échoues le plus reviennent plus souvent, et la difficulté s'adapte : balles plus rapides et angles plus fermés au-delà de 80 % de balles renvoyées, plus faciles sous 50 %.

## Commandes

| Action | Mobile | PC |
|---|---|---|
| Se déplacer | joystick : pose le pouce n'importe où dans la moitié gauche de l'écran | ZQSD (AZERTY), WASD (QWERTY) ou flèches |
| Frapper | gros bouton **Frappe** en bas à droite | Espace |
| Pause | bouton en haut à droite | Échap |
| Plein écran | bouton sur l'accueil et dans la pause | F |

**Déplacements par rapport au court** (par défaut) : haut = vers le filet, bas = vers ta vitre de fond, gauche / droite = le long du filet, quelle que soit la direction de la caméra. L'option **Déplacements : Regard** rend le déplacement relatif à la caméra (haut = là où tu regardes) ; comme la caméra suit la balle, la même poussée change alors de direction quand la balle part vers une vitre. Joystick et Frappe s'utilisent en même temps. En **mode gaucher**, le joystick passe à droite et Frappe à gauche. Il n'y a pas de capture de la souris.

### Se situer par rapport à la balle

- **Caméra calme** : elle ne tourne que si la balle sort d'une fenêtre centrale, et reste légèrement plongeante. Le court reste stable à l'écran tant que la balle est loin ; quand elle approche, la caméra la suit plus vite pour la garder à l'écran au moment de frapper.
- **Champ de vision** : 90° en horizontal par défaut (réglable de 70 à 110°), au moins 55° en vertical pour voir le sol proche.
- **Raquette et bras**, attachés à ton corps : la tête de raquette est à distance de bras, du côté de la balle (coup droit ou revers). Si la balle arrive sur la raquette, elle est dans ta portée. La raquette fait le geste à chaque frappe.
- **Trait de hauteur** : un trait relie la balle à son ombre au sol, pour lire sa hauteur et sa profondeur.
- **Portée au sol** : un anneau autour de tes pieds (0,3 à 1,1 m) ; la balle est jouable quand son ombre y entre.
- **Vue « Épaule »** (Réglages → Vue) : caméra au-dessus et en arrière de ton joueur, qui est alors visible avec sa raquette et sa portée. C'est souvent plus facile pour juger son placement ; la vue 1re personne reste la vue par défaut.

**Réglages** : vitesse du jeu (50 / 75 / 100 %), vue (1re personne / épaule), déplacements (court / regard), champ de vision, trait de hauteur sous la balle, frappe automatique (débutant), afficher la trajectoire, afficher le meilleur point de frappe, replay automatique après une erreur (désactivé par défaut), sensibilité du joystick, mode gaucher, son, vibration, réduire les mouvements de caméra (activé par défaut si le système demande moins d'animations), qualité graphique (auto / basse / normale), export / import JSON, réinitialisation.

## Installer comme une application (PWA)

- **Android (Chrome)** : menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil ». Le jeu s'ouvre en plein écran, en paysage.
- **iPhone / iPad (Safari)** : bouton Partager → « Sur l'écran d'accueil ». Safari ne propose pas l'API plein écran : c'est l'application installée qui s'ouvre sans barre d'adresse.
- **PC (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Après le premier chargement, le jeu fonctionne **hors ligne** (service worker, `sw.js`). Pour publier une mise à jour, change `VERSION` dans `sw.js` : l'ancien cache est supprimé à l'activation.

## Lancer en local

Aucune installation ni build. Les modules ES et le service worker exigent un **serveur HTTP** (pas `file://`) :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

Pour tester sur un téléphone du même réseau : `http://<adresse-IP-du-PC>:8000`. Sans HTTPS, le navigateur désactive le service worker, le Wake Lock et parfois le plein écran ; la version publiée sur GitHub Pages (HTTPS) les active.

Paramètres d'URL utiles :

| Paramètre | Effet |
|---|---|
| `?seed=123` | rejoue exactement la même suite de balles |
| `?debug=1` | affiche images/s, résolution, appels de rendu et triangles |
| `?nosw` | n'enregistre pas le service worker (développement) |

## Tests

```bash
node test/run.js
```

Node ≥ 18, sans librairie. Les tests couvrent :
- la physique : aucune traversée du sol ou des parois, angles de réflexion, déterminisme ;
- la géométrie : joystick (zone morte, courbe, normalisation), caméra bornée sans roulis, déplacement relatif au regard ;
- la classification des coups, la qualité et le meilleur choix sur des cas connus ;
- la génération des balles : atteignables, séquence de contacts par famille, même graine = même suite ;
- l'échange : frappe hors zone jamais renvoyée, renvoi dans le camp adverse, motifs de perte ;
- les statistiques et la **migration du stockage** ;
- la vérification qu'**aucun fichier de `src/core` n'utilise le DOM ni Three.js**.

## Architecture

```
index.html, style.css, manifest.webmanifest, sw.js, icons/
vendor/three@0.170.0/    Three.js, copie locale versionnée (licence MIT)
src/main.js              écrans, boucle de jeu (physique à pas fixe 120 Hz + interpolation), caméra, plein écran, PWA
src/render.js            scène Three.js low-poly, sans ombres temps réel ni allocation par image
src/input.js             joystick dynamique multi-touch, bouton Frappe, clavier
src/hud.js               série, toast, bulles de guide, accueil, pause, réglages, stats, Détail
src/audio.js             sons WebAudio générés (aucun fichier) et vibration
src/settings.js          réglages par défaut et écran Réglages
src/storage.js           localStorage en try/catch (mode privé), sauvegarde versionnée
src/core/                fonctions pures, sans DOM ni Three.js :
  physics.js             rebonds sol et parois, calcul exact des contacts
  geometry.js            repères, caméra, joystick, déplacement
  config.js              toutes les constantes ajustables
  quality.js             classifyShot, qualité, meilleur choix, textes de feedback
  shotgen.js             génération des balles adverses (rejet déterministe)
  rally.js               machine d'états de l'échange
  stats.js               schéma de sauvegarde, migration, stats, répétition espacée, difficulté
test/                    tests Node (node test/run.js)
tools/make-icons.js      génère les icônes PWA
```

**Sauvegarde** : clé `glasslab.v2` du localStorage (schéma version 2). Une ancienne sauvegarde de l'application multi-modes (`glasslab.v1`) est migrée automatiquement : balles du mode Match, niveau, meilleure série et réglages compatibles sont repris, le reste est ignoré. Les données corrompues sont ignorées sans plantage.

## Constantes (`src/core/config.js`)

| Constante | Valeur | Rôle |
|---|---|---|
| `player.speed` | 4 m/s | vitesse max du joueur (temps de jeu) |
| `player.reactionTime` | 0,25 s | délai avant de pouvoir réagir à la frappe adverse |
| `strike.timingTolerance` | ±0,25 s | tolérance entre l'appui sur Frappe et le passage dans la zone |
| `zones.*` | voir fichier | hauteur min / idéale / max et portée, par type de coup |
| `classify.halfVolleyWindow` / `halfVolleyMaxZ` | 0,15 s / 0,4 m | définition de la demi-volée |
| `quality.weights` | hauteur 0,35 · placement 0,3 · aisance 0,15 · dégagement 0,2 | poids de la qualité |
| `quality.playable` | 0,45 | qualité atteignable minimale d'une balle générée |
| `quality.minReturn` | 0,2 | en dessous, la frappe part dans le filet |
| `quality.streak` / `good` / `ok` | 0,6 / 0,7 / 0,45 | série ; toast vert ; toast orange |
| `quality.decisionTolerance` | 0,1 | un choix est « juste » s'il vaut le meilleur à 0,1 près |
| `placement.*`, `ease.*`, `clearance.*` | voir fichier | plages idéales de placement, d'aisance et de dégagement |
| `returnShot.*` | retombée à 12,5 → 18,5 m | profondeur du renvoi selon la qualité, marge au-dessus du filet |
| `shotgen.direct`, `shotgen.glass`, `shotgen.glassT` | voir fichier | plages de tirage des balles par famille (niveau 1 → 5) |
| `difficulty` | 10 balles, 80 % / 50 % | difficulté adaptative |
| `rally.oppSpeed`, `oppHitHeight`, `oppStepIn`, `oppMaxY` | 6 m/s, 1 m, 2,5 m, 19,2 m | où et quand l'adversaire frappe ton renvoi |
| `rally.netHeight`, `attackDrop` | 2,2–3,2 m → 1,1–1,8 m ; −0,35 m | hauteur des balles adverses au-dessus du filet (niveau 1 → 5), plus basses quand il attaque |
| `rally.serve` | fond adverse | départ d'un nouveau point après une faute |
| `game.missPause` | 1,3 s | pause après une faute |

## Limites

- **Pas d'effet** : ni slice, ni lift, ni balle coupée qui reste collée à la vitre. C'est l'écart principal avec le jeu réel.
- **Modèle physique simplifié** : pas de frottement de l'air, coefficients de rebond fixes (sol 0,75 ; parois 0,8, avec 95 % de la vitesse conservée le long de la vitre), contact ponctuel instantané.
- **Parois approximées** : vitre de fond de 3 m surmontée de 1 m de grillage, vitres latérales de 3 m sur 4 m puis de 2 m sur 2 m ; le grillage est décoratif.
- **Pas de geste** : direction et puissance de ton renvoi dépendent uniquement de la qualité. L'adversaire frappe toujours après le rebond, sans volée, ni lob, ni smash, et ne joue pas les vitres de son camp.
- **Balles adverses réalistes, donc rapides** : frappées du fond adverse, elles passent environ à 40–45 km/h au niveau 1 (contre ~27 km/h avant l’échange continu, quand elles « partaient » du filet). Utilise la vitesse du jeu à 50 ou 75 % pour débuter.
- La **latérale seule croisée** n'est possible que si l'adversaire frappe assez près du filet (après un de tes renvois courts) ; frappée du fond, elle est remplacée par une autre famille.
- La qualité et le « meilleur choix » sont des **heuristiques pédagogiques**, réglables dans `config.js` mais non calibrées avec des entraîneurs.
- Le joueur est un point qui accélère instantanément ; la balle est affichée environ deux fois plus grosse que la réalité pour rester lisible.
- La raquette affichée est un **repère de portée**, pas une raquette physique : la frappe est jugée sur la position du joueur et le moment d'appui, pas sur le contact avec la raquette dessinée.
- La boucle de jeu crée quelques petits objets par image (états immuables de `src/core`) ; le rendu lui-même n'alloue rien.
- **Non vérifié sur un vrai téléphone** au moment de l'écriture : fluidité, ressenti du joystick, plein écran et verrouillage paysage (impossibles dans Safari sur iOS), Wake Lock, vibration (absente sur iOS) et son.
