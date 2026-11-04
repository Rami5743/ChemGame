import { stat, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MOLECULES, ELEMENTS, FUSION, cardArt } from '../../js/cards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sizeOf = async (rel) => (await stat(join(root, rel))).size;

export default async function run({ check }) {
  let total = 0;
  let biggest = 0;

  for (const id of Object.keys(MOLECULES)) {
    const path = cardArt.molecule(id);
    let size = -1;
    try { size = await sizeOf(path); } catch {}
    check(`the ${id} card has a picture`, size > 0, path);
    total += Math.max(size, 0);
    biggest = Math.max(biggest, size);
  }

  for (const el of [...Object.keys(ELEMENTS), FUSION]) {
    const path = cardArt.atom(el);
    let size = -1;
    try { size = await sizeOf(path); } catch {}
    check(`the ${el} card has a picture`, size > 0, path);
    total += Math.max(size, 0);
    biggest = Math.max(biggest, size);
  }

  for (const [what, path] of [['atom', cardArt.atomBack()], ['molecule', cardArt.moleculeBack()]]) {
    let size = -1;
    try { size = await sizeOf(path); } catch {}
    check(`the ${what} back has a picture`, size > 0, path);
    total += Math.max(size, 0);
  }

  check('no single card is heavier than 60 KiB', biggest < 60 * 1024, biggest);
  check('the whole deck is under half a megabyte', total < 512 * 1024, total);

  let rules = -1;
  try { rules = await sizeOf('materials/inst/Hebrew-instructions.pdf'); } catch {}
  check('the rules the page links to are there', rules > 0);

  const files = await readdir(join(root, 'assets/cards/he'));
  check('the folder holds exactly the cards of the catalogue',
    files.length === Object.keys(MOLECULES).length + Object.keys(ELEMENTS).length + 3, files.length);
}
