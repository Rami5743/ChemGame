// Turns the printed card art under materials/ into the screen-sized images the
// page serves. Run it after changing the art:  node tools/build-cards.mjs
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { MOLECULES, ELEMENTS, FUSION } from '../js/cards.js';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'materials');

// Wide enough to stay sharp on a dense screen at the size a card is shown.
const SIZE = '440x600';
const QUALITY = '82';

// The printed game has both languages; the folders mirror them.
const SETS = {
  he: {
    molecule: (m) => join(src, 'mols', `${m.art}.png`),
    atom: (el) => join(src, 'Athoms/v2', `${el}.png`),
    atomBack: join(src, 'Athom_back_v2.png'),
    moleculeBack: join(src, 'Mol_back.png'),
  },
  en: {
    molecule: (m) => join(src, 'mols_eng', m.art === 'Glucose' ? 'Glucose_eng.png' : `${m.art}.png`),
    atom: (el) => join(src, 'Athoms/v2', `${el}_eng.png`),
    atomBack: join(src, 'Athom_back_v2_eng.png'),
    moleculeBack: join(src, 'Mol_back_en.png'),
  },
};

let cards = 0;
let total = 0;
for (const [lang, set] of Object.entries(SETS)) {
  const out = join(root, 'assets/cards', lang);
  await mkdir(out, { recursive: true });
  const jobs = [
    ...Object.entries(MOLECULES).map(([id, m]) => [set.molecule(m), `mol-${id}.webp`]),
    ...Object.keys(ELEMENTS).map((el) => [set.atom(el), `atom-${el}.webp`]),
    [set.atom('Fue'), `atom-${FUSION}.webp`],
    [set.atomBack, 'back-atom.webp'],
    [set.moleculeBack, 'back-molecule.webp'],
  ];
  for (const [from, name] of jobs) {
    await run('convert', [from, '-resize', SIZE, '-quality', QUALITY, '-strip', join(out, name)]);
    total += (await stat(join(out, name))).size;
  }
  cards += jobs.length;
}
console.log(`${cards} cards in ${Object.keys(SETS).length} languages, ${Math.round(total / 1024)} KiB`);
