import { stat, readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MOLECULES, ELEMENTS, FUSION, cardArt } from '../../js/cards.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sizeOf = async (rel) => (await stat(join(root, rel))).size;

export default async function run({ check }) {
  let total = 0;
  let biggest = 0;

  // Both printed languages, and nothing left over in either folder.
  for (const lang of ['he', 'en']) {
    const files = await readdir(join(root, 'assets/cards', lang));
    check(`the ${lang} deck holds exactly the cards of the catalogue`,
      files.length === Object.keys(MOLECULES).length + Object.keys(ELEMENTS).length + 3, files.length);
    for (const id of Object.keys(MOLECULES)) {
      let size = -1;
      try { size = await sizeOf(cardArt.molecule(id, lang)); } catch {}
      check(`the ${lang} ${id} card has a picture`, size > 0, cardArt.molecule(id, lang));
    }
    for (const el of [...Object.keys(ELEMENTS), FUSION]) {
      let size = -1;
      try { size = await sizeOf(cardArt.atom(el, lang)); } catch {}
      check(`the ${lang} ${el} card has a picture`, size > 0, cardArt.atom(el, lang));
    }
    for (const [what, path] of [['atom', cardArt.atomBack(lang)], ['molecule', cardArt.moleculeBack(lang)]]) {
      let size = -1;
      try { size = await sizeOf(path); } catch {}
      check(`the ${lang} ${what} back has a picture`, size > 0, path);
    }
  }

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
  try { rules = await sizeOf('rules.html'); } catch {}
  check('the rules page is there', rules > 0);

  const text = rules > 0 ? await readFile(join(root, 'rules.html'), 'utf8') : '';
  for (const heading of ['מטרת המשחק', 'מהלך המשחק', 'קלף היתוך גרעיני', 'קלף אלקאנים', 'טיפ']) {
    check(`the rules page carries the section ${heading}`, text.includes(heading));
  }
  check('the rules page shows the cards it talks about',
    (text.match(/assets\/cards\/he\//g) || []).length >= 10);
  check('the rules page leads back to the game', text.includes("href=\"./?lang=he\""));

  for (const art of ['glycine', 'atom']) {
    let size = -1;
    try { size = await sizeOf(`assets/booklet/${art}.webp`); } catch {}
    check(`the booklet illustration ${art} is there`, size > 0);
    check(`the rules page opens or closes with ${art}`, text.includes(`assets/booklet/${art}.webp`));
  }
  check('the cards in the examples keep their own black frames',
    !/examples\.(ok|bad)[^}]*border-color/.test(await readFile(join(root, 'css/rules.css'), 'utf8')));

  let facts = -1;
  try { facts = await sizeOf('facts.html'); } catch {}
  check('the page about the cards is there', facts > 0);
  const factsText = facts > 0 ? await readFile(join(root, 'facts.html'), 'utf8') : '';

  // It is the printed sheet, so it carries that sheet's own photographs.
  const photos = await readdir(join(root, 'assets/facts'));
  check('all the photographs of the sheet were taken out of it', photos.length === 21, photos.length);
  for (const photo of photos) {
    check(`the card page shows ${photo}`, factsText.includes(`assets/facts/${photo}`));
  }
  for (const heading of ['קלפי האטומים', 'קלפי המולקולות']) {
    check(`the card page carries the section ${heading}`, factsText.includes(heading));
  }
  check('the card page does not borrow the booklet styling',
    factsText.includes('css/facts.css') && !factsText.includes('css/rules.css'));
  check('the card page leads to the game and to the rules',
    factsText.includes('href="./"') && factsText.includes('href="rules.html"'));
  check('the rules page leads to the game and to the sheet',
    text.includes('./?lang=he') && text.includes('facts.pdf'));
  check('the Hebrew sheet links out to Wikipedia',
    (factsText.match(/he\.wikipedia\.org/g) || []).length > 30);

  // --- the same in English ------------------------------------------------
  const inEnglish = {
    'facts.en.html': ['grokipedia.com/page/', 'The atom cards', 'The molecule cards'],
    'rules.en.html': ['assets/cards/en/', 'The aim', 'The nuclear fusion card', 'rules.html'],
  };
  for (const [name, needles] of Object.entries(inEnglish)) {
    let size = -1;
    try { size = await sizeOf(name); } catch {}
    check(`${name} is there`, size > 0);
    const body = size > 0 ? await readFile(join(root, name), 'utf8') : '';
    for (const needle of needles) check(`${name} carries ${needle}`, body.includes(needle));
  }
  check('the English sheet links out to Grokipedia',
    ((await readFile(join(root, 'facts.en.html'), 'utf8')).match(/grokipedia\.com/g) || []).length > 30);
  check('the Hebrew rules link to the English ones', text.includes('rules.en.html'));

  // --- the sheet as a file ------------------------------------------------
  for (const pdf of ['facts.pdf', 'facts.en.pdf']) {
    let size = -1;
    try { size = await sizeOf(pdf); } catch {}
    check(`${pdf} was printed`, size > 100 * 1024, size);
  }
  const entry = await readFile(join(root, 'index.html'), 'utf8');
  check('the game points at the printed sheet, not at the page',
    entry.includes('facts.pdf') && !entry.includes('"facts.html"'));
  check('the entry screen links to the rules and to the sheet',
    entry.includes('rules.html') && entry.includes('facts.pdf'));
  check('the entry screen offers the printed game',
    entry.includes('thegamecrafter.com/games/atoms-and-molecules'));
  check('the header carries a flag for each language',
    (entry.match(/data-lang="(he|en)"/g) || []).length === 2);
}
