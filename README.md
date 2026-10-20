# Gwendalavir's Battle — Deckbuilder

Deckbuilder web de **Gwendalavir's Battle** (version 2.10) : bibliothèque de cartes, construction de decks, Card Studio, corbeille, imports JSON / Excel et exports PDF / Tabletop Simulator / logiciel de jeu.

Le site est **100 % statique** (HTML, CSS, JavaScript) : aucune installation, aucun serveur, aucune dépendance.

## Lancer le site

- **Le plus simple** : ouvrir `index.html` dans le navigateur (double-clic).
- **Avec un petit serveur local** (recommandé pour tester comme en ligne) :
  ```bash
  python3 -m http.server 8000
  ```
  puis ouvrir <http://localhost:8000>.

## Mettre le site en ligne

N'importe quel hébergement de fichiers statiques convient, par exemple **GitHub Pages** :
*Settings → Pages → Deploy from a branch →* choisir la branche et le dossier `/ (root)`.

> ⚠️ Les cartes, decks et réglages sont enregistrés **dans le navigateur**, pour l'adresse du site.
> En changeant d'adresse, la bibliothèque repart de zéro : exporte-la d'abord en JSON
> (Card Studio → *Exporter JSON*) puis réimporte-la sur la nouvelle adresse.

## Structure

```
index.html            Structure de la page (aucun style ni script en ligne)
css/styles.css        Feuille de style unique, rangée par sections
js/
  data.js             Données du jeu : Types, raretés, couleurs/éléments, sets, cartes de base
  utils.js            Outils communs : sélection DOM, échappement HTML, texte riche, fichiers
  storage.js          Stockage navigateur (localStorage + IndexedDB) et reprise des anciennes données
  cards.js            Normalisation des cartes, limites d'exemplaires, Types, rendu d'une carte
  library.js          Panneau de filtres et grille de la bibliothèque
  deck.js             Deck en cours, panneau du deck, fenêtre « Mes decks »
  studio.js           Card Studio : formulaire, aperçu, éditeur de texte, illustration
  trash.js            Corbeille
  transfer.js         Import / export JSON et import Excel
  print.js            Dessin des cartes, export PDF et Tabletop Simulator
  share.js            Onglet Partage : sélection de cartes et export JSON ciblé
  layout.js           Onglets, panneaux masquables, séparateurs, zoom Ctrl + molette
  main.js             Démarrage
assets/               Icône, modèle Excel d'import et polices des cartes (assets/fonts, licence SIL OFL)
```

Les scripts sont chargés dans cet ordre par `index.html` ; chaque fichier peut utiliser ce que définissent les précédents.

**Ajouter un set, une couleur, un Type ou une rareté** : tout se fait dans `js/data.js`. Les listes déroulantes, les filtres et les règles de limites sont générés automatiquement.

## Stockage

| Où | Quoi |
|---|---|
| `localStorage` (clés `gwb.*`) | deck en cours, favoris, ordre, réglages d'affichage |
| IndexedDB (`gwendalavirs-battle`) | cartes créées / modifiées, corbeille (avec leurs images) et decks enregistrés — pas de limite pratique |

Les données des versions ≤ 1.8 (clés `deckforge.*`, corbeille dans le `localStorage`) sont reprises automatiquement au premier chargement.

## Design des cartes (version 2.0)

Deux styles, définis par la charte graphique (css/styles.css, section « Cartes ») :

- **Normal (« Enluminure »)** : cadre d'encre et filet d'or, illustration en haut, texte sur parchemin, statistiques dans leur propre bande ; cadre doré pour les Héros.
- **Full art** : l'illustration couvre toute la carte, le texte clair se pose sur un fondu sombre. Se choisit carte par carte dans le Card Studio (bouton *Normal / Full art* au-dessus de l'aperçu) ou par la colonne `Full art (1/0)` de l'import Excel.

Polices : Cinzel (noms, coût, statistiques), Alegreya (texte), Alegreya Sans SC (ligne de Type, set). Les exports PDF et Tabletop Simulator reproduisent exactement le même rendu (js/print.js).

## Changements de la version 1.9 (nettoyage)

- Le site est devenu entièrement statique : l'enveloppe Next.js / Cloudflare, jamais utilisée, est retirée.
- Le fichier unique de 196 Ko est découpé en fichiers lisibles, et le code mort est supprimé.
- Le CSS est fusionné : 8 couches successives (V0.5 → V1.5) deviennent une seule feuille. Environ 150 déclarations écrasées et 38 sélecteurs inutilisés sont retirés, sans changement visuel.
- **Sécurité** : un fichier JSON ou Excel piégé ne peut plus exécuter de code. Le texte riche est analysé dans un `<template>` inerte, et toutes les valeurs sont échappées.
- **Corbeille** : elle est désormais stockée dans IndexedDB, ce qui supprime le risque de saturer le stockage avec les images.
- **Decks** : une confirmation apparaît avant d'ouvrir un autre deck ou d'en créer un nouveau quand des modifications ne sont pas enregistrées.
- **Ordre de la bibliothèque** : il n'est plus mélangé au rechargement de la page.
- **Exports PDF / TTS** : ils suivent l'ordre du deck affiché à l'écran.
- **Export « Logiciel de jeu (.json) »** : fichier deck (format `gwendalavirs-battle-deck`) à importer dans le logiciel de jeu ; chaque carte y est copiée en entier.
- **Dessins et Dessins légendaires** : un Dessin a un coût en losange et une plume sur un bandeau, à l’encre de son élément (couleur de l’élément, foncée) ; un Dessin légendaire a un cadre prismatique (reflet animé, nom nacré), une plaque de type sertie d’un liseré irisé en style normal, un type irisé en full art. Même rendu dans les exports PDF et TTS.
- **Onglet Partage** : rassemble des cartes (glisser-déposer, clic, glisser une carte de la bibliothèque sur l’onglet, ou bouton « Envoyer vers Partage » du Card Studio ; glisser une carte de la droite vers la gauche la retire) et les exporte en JSON au format bibliothèque ; l’autre joueur les importe avec « Importer JSON ». La sélection est conservée (`gwb.shareList`).
- **Carte unique** : case dans le Card Studio (et colonne `Unique (1/0)` de l’import Excel). Le logiciel de jeu interdit alors d’avoir deux exemplaires de la carte en même temps sur le terrain.
- **Import Excel** : il accepte les variantes de saisie (« Commune », apostrophe typographique ’…). Les exemples du modèle fourni sont désormais acceptés.
- **Éléments** : un seul jeu de noms partout (Rouge = Feu, Bleu = Eau, Vert = Plante, Violet = Ombre, Marron = Terre, Jaune = Foudre, Gris = Neutre).
- **Limites d'exemplaires** : les Types créés à la main ont maintenant leur propre ligne.
- **Card Studio** : une carte enregistrée sans texte n'hérite plus du texte d'exemple. L'aperçu n'affiche plus de curseur « main ».
- **Recherche** : elle est plus rapide (le texte de chaque carte est indexé une seule fois).
