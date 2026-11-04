// Prints the sheet about the cards to a file, in both languages. The page is
// the sheet; this only puts it on paper, with its links intact.
import { startStatic } from '../test/support/static.mjs';
import { launchBrowser } from '../test/support/browser.mjs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS = [
  ['facts.html', 'facts.pdf'],
  ['facts.en.html', 'facts.en.pdf'],
];

const site = await startStatic(root, 8321);
const browser = await launchBrowser();
try {
  for (const [page, out] of JOBS) {
    const tab = await browser.newPage();
    await tab.goto(`${site.url}${page}`, { waitUntil: 'networkidle' });
    const pdf = await tab.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '9mm', bottom: '9mm', left: '7mm', right: '7mm' },
    });
    await writeFile(join(root, out), pdf);
    console.log(out, Math.round(pdf.length / 1024) + ' KiB');
    await tab.close();
  }
} finally {
  await browser.close();
  await site.close();
}
