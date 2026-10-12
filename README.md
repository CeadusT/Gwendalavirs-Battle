# Gwendalavir's Battle — Deckbuilder

Deckbuilder web de **Gwendalavir's Battle** (version 1.9) : bibliothèque de cartes, construction de decks, Card Studio, corbeille, imports JSON / Excel et exports PDF / Tabletop Simulator.

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
  layout.js           Onglets, panneaux masquables, séparateurs, zoom Ctrl + molette
  main.js             Démarrage
assets/               Icône et modèle Excel d'import
```

Les scripts sont chargés dans cet ordre par `index.html` ; chaque fichier peut utiliser ce que définissent les précédents.

**Ajouter un set, une couleur, un Type ou une rareté** : tout se fait dans `js/data.js`. Les listes déroulantes, les filtres et les règles de limites sont générés automatiquement.

## Stockage

| Où | Quoi |
|---|---|
| `localStorage` (clés `gwb.*`) | deck en cours, decks enregistrés, favoris, ordre, réglages d'affichage |
| IndexedDB (`gwendalavirs-battle`) | cartes créées / modifiées et corbeille (avec leurs images) |

Les données des versions ≤ 1.8 (clés `deckforge.*`, corbeille dans le `localStorage`) sont reprises automatiquement au premier chargement.

## Changements de la version 1.9 (nettoyage)

- Le site est devenu entièrement statique : l'enveloppe Next.js / Cloudflare, jamais utilisée, est retirée.
- Le fichier unique de 196 Ko est découpé en fichiers lisibles, et le code mort est supprimé.
- Le CSS est fusionné : 8 couches successives (V0.5 → V1.5) deviennent une seule feuille. Environ 150 déclarations écrasées et 38 sélecteurs inutilisés sont retirés, sans changement visuel.
- **Sécurité** : un fichier JSON ou Excel piégé ne peut plus exécuter de code. Le texte riche est analysé dans un `<template>` inerte, et toutes les valeurs sont échappées.
- **Corbeille** : elle est désormais stockée dans IndexedDB, ce qui supprime le risque de saturer le stockage avec les images.
- **Decks** : une confirmation apparaît avant d'ouvrir un autre deck ou d'en créer un nouveau quand des modifications ne sont pas enregistrées.
- **Ordre de la bibliothèque** : il n'est plus mélangé au rechargement de la page.
- **Exports PDF / TTS** : ils suivent l'ordre du deck affiché à l'écran.
- **Import Excel** : il accepte les variantes de saisie (« Commune », apostrophe typographique ’…). Les exemples du modèle fourni sont désormais acceptés.
- **Éléments** : un seul jeu de noms partout (Rouge = Feu, Bleu = Eau, Vert = Vent, Violet = Ombre, Marron = Terre, Jaune = Foudre, Gris = Neutre).
- **Limites d'exemplaires** : les Types créés à la main ont maintenant leur propre ligne.
- **Card Studio** : une carte enregistrée sans texte n'hérite plus du texte d'exemple. L'aperçu n'affiche plus de curseur « main ».
- **Recherche** : elle est plus rapide (le texte de chaque carte est indexé une seule fois).
