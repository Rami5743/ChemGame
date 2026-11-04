// The printed deck, as a catalogue. Counts are the physical game's:
// 72 atom cards of 5 kinds, 36 molecule cards of 19 kinds.

export const ELEMENTS = {
  H: { symbol: 'H', z: 1, name: { he: 'מימן', en: 'Hydrogen' } },
  C: { symbol: 'C', z: 6, name: { he: 'פחמן', en: 'Carbon' } },
  N: { symbol: 'N', z: 7, name: { he: 'חנקן', en: 'Nitrogen' } },
  O: { symbol: 'O', z: 8, name: { he: 'חמצן', en: 'Oxygen' } },
};

export const FUSION = 'FUSION';
export const FUSION_CARD = { symbol: 'Fue', name: { he: 'היתוך גרעיני', en: 'Nuclear fusion' } };

export const ATOM_COUNTS = { H: 38, C: 12, N: 3, O: 16, [FUSION]: 3 };

export const Z_TO_ELEMENT = { 1: 'H', 6: 'C', 7: 'N', 8: 'O' };

// An alkane is declared, not printed: the player says how many carbons.
export const ALKANE_MIN = 1;
export const ALKANE_MAX = 8;
export const alkaneFormula = (n) => ({ C: n, H: 2 * n + 2 });

export const MOLECULES = {
  ethanol: { name: { he: 'אתנול', en: 'Ethanol' }, art: '1', formula: { C: 2, H: 6, O: 1 } },
  urea: { name: { he: 'שתנן', en: 'Urea' }, art: '2', formula: { C: 1, H: 4, N: 2, O: 1 } },
  ammonia: { name: { he: 'אמוניה', en: 'Ammonia' }, art: '3', formula: { N: 1, H: 3 } },
  acetone: { name: { he: 'אצטון', en: 'Acetone' }, art: '4', formula: { C: 3, H: 6, O: 1 } },
  oxygen: { name: { he: 'חמצן', en: 'Oxygen' }, art: '5', formula: { O: 2 } },
  propane: { name: { he: 'פרופאן', en: 'Propane' }, art: '6', formula: { C: 3, H: 8 } },
  methane: { name: { he: 'מתאן', en: 'Methane' }, art: '7', formula: { C: 1, H: 4 } },
  alkanes: { name: { he: 'אלקאנים', en: 'Alkanes' }, art: '8', special: 'alkanes' },
  nitrogen: { name: { he: 'חנקן', en: 'Nitrogen' }, art: '9', formula: { N: 2 } },
  water: { name: { he: 'מים', en: 'Water' }, art: '10', formula: { H: 2, O: 1 } },
  aceticAcid: { name: { he: 'חומצה אצטית', en: 'Acetic acid' }, art: '11', formula: { C: 2, H: 4, O: 2 } },
  hydrogen: { name: { he: 'מימן', en: 'Hydrogen' }, art: '12', formula: { H: 2 } },
  hydrazine: { name: { he: 'הידרזין', en: 'Hydrazine' }, art: '13', formula: { N: 2, H: 4 } },
  glycine: { name: { he: 'גליצין', en: 'Glycine' }, art: '14', formula: { C: 2, H: 5, N: 1, O: 2 } },
  butane: { name: { he: 'בוטאן', en: 'Butane' }, art: '15', formula: { C: 4, H: 10 } },
  carbonDioxide: { name: { he: 'פחמן דו־חמצני', en: 'Carbon dioxide' }, art: '16', formula: { C: 1, O: 2 } },
  ethane: { name: { he: 'אתאן', en: 'Ethane' }, art: '17', formula: { C: 2, H: 6 } },
  methanol: { name: { he: 'מתנול', en: 'Methanol' }, art: '18', formula: { C: 1, H: 4, O: 1 } },
  glucose: { name: { he: 'גלוקוז', en: 'Glucose' }, art: 'Glucose', formula: { C: 6, H: 12, O: 6 } },
};

// Two of each, except the two that were printed once.
export const SINGLE_PRINT = ['alkanes', 'glucose'];
export const MOLECULE_COUNTS = Object.fromEntries(
  Object.keys(MOLECULES).map((id) => [id, SINGLE_PRINT.includes(id) ? 1 : 2])
);

export const DECK_SIZE = {
  atoms: Object.values(ATOM_COUNTS).reduce((a, b) => a + b, 0),
  molecules: Object.values(MOLECULE_COUNTS).reduce((a, b) => a + b, 0),
};

/* ---------- the pictures ---------- */

// Built from materials/ by tools/build-cards.mjs. Hebrew only for now; a
// second language becomes a second folder beside this one.
const ART_DIR = (lang) => `assets/cards/${lang === 'en' ? 'en' : 'he'}`;

export const cardArt = {
  molecule: (id, lang) => `${ART_DIR(lang)}/mol-${id}.webp`,
  atom: (el, lang) => `${ART_DIR(lang)}/atom-${el}.webp`,
  atomBack: (lang) => `${ART_DIR(lang)}/back-atom.webp`,
  moleculeBack: (lang) => `${ART_DIR(lang)}/back-molecule.webp`,
};

// The name a card carries, in the language asked for.
export const nameIn = (named, lang) =>
  typeof named.name === 'string' ? named.name : named.name[lang] || named.name.he;
