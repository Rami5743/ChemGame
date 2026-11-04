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
const out = join(root, 'assets/cards/he');

// Wide enough to stay sharp on a dense screen at the size a card is shown.
const SIZE = '440x600';
const QUALITY = '82';

const jobs = [
  ...Object.entries(MOLECULES).map(([id, m]) => [join(src, 'mols', `${m.art}.png`), `mol-${id}.webp`]),
  ...Object.keys(ELEMENTS).map((el) => [join(src, 'Athoms/v2', `${el}.png`), `atom-${el}.webp`]),
  [join(src, 'Athoms/v2/Fue.png'), `atom-${FUSION}.webp`],
  [join(src, 'Athom_back_v2.png'), 'back-atom.webp'],
  [join(src, 'Mol_back.png'), 'back-molecule.webp'],
];

await mkdir(out, { recursive: true });
let total = 0;
for (const [from, name] of jobs) {
  await run('convert', [from, '-resize', SIZE, '-quality', QUALITY, '-strip', join(out, name)]);
  total += (await stat(join(out, name))).size;
}
console.log(`${jobs.length} cards, ${Math.round(total / 1024)} KiB`);
