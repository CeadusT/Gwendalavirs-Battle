'use strict';
/* ==========================================================================
   Données de référence du jeu.
   C'est le seul endroit où sont définis les Types, raretés, couleurs et sets :
   l'interface (listes déroulantes, filtres, règles) est générée à partir d'ici.
   ========================================================================== */

const APP_VERSION = '2.9';

const TYPES = ['Dessin de base', 'Dessin avancé', 'Personnage', 'Objet', 'Dessin légendaire', 'Héros', 'Jeton', 'Dessin de base jeton'];
const HERO_TYPE = 'Héros';
const RARITIES = ['Commun', 'Rare', 'Légendaire'];
const SETS = ["D'un monde à l'autre", 'Le pacte des Marchombre', "La revanche des Ts'lich"];

const MIN_SPIRE = 0;
const MAX_SPIRE = 6;
const DEFAULT_LIMIT = 3;

/* Couleur = élément de la carte (charte graphique v2).
   element : nom affiché · hex : teinte de l'élément (cartes, PDF, filtres)
   icon : tracé SVG (trait) utilisé sur les cartes, dans les filtres et le PDF */
const COLORS = {
  Rouge: { element: 'Feu', hex: '#b5452f', icon: 'M12 3c.5 3.5-3.5 5-3.5 9a3.5 3.5 0 0 0 7 0c0-1.6-.8-2.8-1.5-3.6 2.2.7 4 2.9 4 5.6a6 6 0 0 1-12 0c0-5.2 5.4-6.8 6-11Z' },
  Bleu: { element: 'Eau', hex: '#2f6f9f', icon: 'M12 3s-6 6.8-6 11a6 6 0 0 0 12 0c0-4.2-6-11-6-11Z' },
  Vert: { element: 'Plante', hex: '#4f8a5b', icon: 'M20 4C11 4 6 8 5 17c7 1 12-3 15-13ZM5 19c3-5 7-8 12-11' },
  Violet: { element: 'Ombre', hex: '#6a4c93', icon: 'M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10Z' },
  Marron: { element: 'Terre', hex: '#8a6240', icon: 'M3 19 9 9l4 6 2-3 6 7H3Z' },
  Jaune: { element: 'Foudre', hex: '#c9a227', icon: 'M13 2 5 14h6l-1 8 8-12h-6l1-8Z' },
  Gris: { element: 'Neutre', hex: '#7d8288', icon: 'M12 4l7 8-7 8-7-8 7-8Z' },
};
const COLOR_NAMES = Object.keys(COLORS);
const FALLBACK_COLOR = 'Gris';

/* Repère de rareté (losange sur la ligne de Type). */
const RARITY_COLORS = { Commun: '#b9bec4', Rare: '#d8b25a', 'Légendaire': '#e07a3a' };

/* Charte graphique des cartes : couleurs fixes et polices (voir css/styles.css, section Cartes). */
const CARD_THEME = {
  ink: '#15110c',
  parchment: '#efe6d2',
  parchmentShade: '#e8ddc5',
  text: '#241c13',
  gold: '#c9a45c',
  goldLight: '#e8d49c',
  fontTitle: "'Cinzel', Georgia, serif",
  fontText: "'Alegreya', Georgia, serif",
  fontCaps: "'Alegreya Sans SC', 'Alegreya', sans-serif",
};

/* Types dont la Volonté est masquée par défaut sur une nouvelle carte. */
const AUTO_HIDE_SPIRE_TYPES = new Set(['Personnage', 'Objet', 'Jeton', 'Dessin de base jeton']);

/* Mise en forme par défaut (taille en px pour une carte de 360 px de large). */
const DEFAULT_TEXT_STYLE = { fontSize: 13, bold: false, italic: false, underline: false };
const DEFAULT_TYPE_STYLE = { fontSize: 11, bold: true, italic: false, underline: false };
const DEFAULT_SUBTYPE_STYLE = { fontSize: 10, bold: false, italic: false, underline: false };

/* Palette proposée dans l'éditeur de texte du Card Studio. */
const DEFAULT_TEXT_COLOR = '#202428';
const TEXT_COLORS = [
  { hex: '#202428', name: 'Sombre' },
  { hex: '#b4232d', name: 'Rouge' },
  { hex: '#c65f20', name: 'Orange' },
  { hex: '#a87913', name: 'Or' },
  { hex: '#247044', name: 'Vert' },
  { hex: '#2563a6', name: 'Bleu' },
  { hex: '#7443a3', name: 'Violet' },
  { hex: '#6b7280', name: 'Gris' },
];

/* Cartes fournies avec le site. Elles peuvent être modifiées (« base modifiée »)
   ou supprimées depuis l'interface sans toucher à cette liste. */
const BASE_CARDS = [
  { id: 'base-0', name: 'Aelya, Passeuse des Mondes', spire: 0, type: 'Héros', color: 'Bleu', rarity: 'Légendaire', text: 'Traverse les frontières entre les mondes.', set: "D'un monde à l'autre" },
  { id: 'base-1', name: 'Myr, l’Archiviste Voilée', spire: 0, type: 'Héros', color: 'Violet', rarity: 'Légendaire', text: 'Conserve ce qui devrait être oublié.', set: "D'un monde à l'autre" },
  { id: 'base-2', name: 'Croquis vagabond', spire: 1, type: 'Dessin de base', color: 'Marron', rarity: 'Commun', text: 'Un trait simple qui ouvre la voie.', set: "D'un monde à l'autre" },
  { id: 'base-3', name: 'Sentinelle des lisières', spire: 2, type: 'Personnage', color: 'Vert', rarity: 'Commun', text: 'Garde les passages du monde vivant.', set: "D'un monde à l'autre" },
  { id: 'base-4', name: 'Trait azur', spire: 2, type: 'Dessin avancé', color: 'Bleu', rarity: 'Rare', text: 'Une ligne précise chargée de puissance.', set: "D'un monde à l'autre" },
  { id: 'base-5', name: 'Braise calligraphiée', spire: 1, type: 'Objet', color: 'Rouge', rarity: 'Rare', text: 'L’encre brûle encore après avoir séché.', set: "D'un monde à l'autre" },
  { id: 'base-6', name: 'Portrait de l’ombre', spire: 3, type: 'Personnage', color: 'Violet', rarity: 'Commun', text: 'Son regard semble suivre le dessinateur.', set: "D'un monde à l'autre" },
  { id: 'base-7', name: 'Encre des fondations', spire: 0, type: 'Dessin de base', color: 'Marron', rarity: 'Commun', text: 'Tout commence par une première marque.', set: "D'un monde à l'autre" },
  { id: 'base-8', name: 'Jardin suspendu', spire: 4, type: 'Objet', color: 'Vert', rarity: 'Rare', text: 'Une parcelle de vie arrachée au vide.', set: "D'un monde à l'autre" },
  { id: 'base-9', name: 'Fracture vermillon', spire: 4, type: 'Dessin avancé', color: 'Rouge', rarity: 'Rare', text: 'Déchire la composition avant qu’elle ne se referme.', set: "D'un monde à l'autre" },
  { id: 'base-10', name: 'Constellation impossible', spire: 5, type: 'Dessin légendaire', color: 'Bleu', rarity: 'Légendaire', text: 'Les étoiles refusent ici leur ordre habituel.', set: "D'un monde à l'autre" },
  { id: 'base-11', name: 'Monolithe de l’entre-monde', spire: 6, type: 'Dessin légendaire', color: 'Violet', rarity: 'Légendaire', text: 'Il se tient là où deux réalités se touchent.', set: "D'un monde à l'autre" },
];
