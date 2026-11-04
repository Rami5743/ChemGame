// The printed deck, as a catalogue. Counts are the physical game's:
// 72 atom cards of 5 kinds, 36 molecule cards of 19 kinds.

export const ELEMENTS = {
  H: { symbol: 'H', z: 1, name: 'מימן' },
  C: { symbol: 'C', z: 6, name: 'פחמן' },
  N: { symbol: 'N', z: 7, name: 'חנקן' },
  O: { symbol: 'O', z: 8, name: 'חמצן' },
};

export const FUSION = 'FUSION';
export const FUSION_CARD = { symbol: 'Fue', name: 'היתוך גרעיני' };

export const ATOM_COUNTS = { H: 38, C: 12, N: 3, O: 16, [FUSION]: 3 };

export const Z_TO_ELEMENT = { 1: 'H', 6: 'C', 7: 'N', 8: 'O' };

// An alkane is declared, not printed: the player says how many carbons.
export const ALKANE_MIN = 1;
export const ALKANE_MAX = 8;
export const alkaneFormula = (n) => ({ C: n, H: 2 * n + 2 });

export const MOLECULES = {
  ethanol: { name: 'אתנול', art: '1', formula: { C: 2, H: 6, O: 1 } },
  urea: { name: 'שתנן', art: '2', formula: { C: 1, H: 4, N: 2, O: 1 } },
  ammonia: { name: 'אמוניה', art: '3', formula: { N: 1, H: 3 } },
  acetone: { name: 'אצטון', art: '4', formula: { C: 3, H: 6, O: 1 } },
  oxygen: { name: 'חמצן', art: '5', formula: { O: 2 } },
  propane: { name: 'פרופאן', art: '6', formula: { C: 3, H: 8 } },
  methane: { name: 'מתאן', art: '7', formula: { C: 1, H: 4 } },
  alkanes: { name: 'אלקאנים', art: '8', special: 'alkanes' },
  nitrogen: { name: 'חנקן', art: '9', formula: { N: 2 } },
  water: { name: 'מים', art: '10', formula: { H: 2, O: 1 } },
  aceticAcid: { name: 'חומצה אצטית', art: '11', formula: { C: 2, H: 4, O: 2 } },
  hydrogen: { name: 'מימן', art: '12', formula: { H: 2 } },
  hydrazine: { name: 'הידרזין', art: '13', formula: { N: 2, H: 4 } },
  glycine: { name: 'גליצין', art: '14', formula: { C: 2, H: 5, N: 1, O: 2 } },
  butane: { name: 'בוטאן', art: '15', formula: { C: 4, H: 10 } },
  carbonDioxide: { name: 'פחמן דו־חמצני', art: '16', formula: { C: 1, O: 2 } },
  ethane: { name: 'אתאן', art: '17', formula: { C: 2, H: 6 } },
  methanol: { name: 'מתנול', art: '18', formula: { C: 1, H: 4, O: 1 } },
  glucose: { name: 'גלוקוז', art: 'Glucose', formula: { C: 6, H: 12, O: 6 } },
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
