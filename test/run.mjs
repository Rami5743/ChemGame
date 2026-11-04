// Runs every suite under test/unit and test/e2e.
//   node test/run.mjs            both
//   node test/run.mjs --unit     rules only, no browser and no broker
//   node test/run.mjs --e2e      browser only
//   node test/run.mjs --only lobby
import { readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startBroker } from './support/broker.mjs';
import { startStatic } from './support/static.mjs';
import { launchBrowser } from './support/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const wantUnit = !args.includes('--e2e');
const wantE2e = !args.includes('--unit');

const STATIC_PORT = Number(process.env.CHEMGAME_STATIC_PORT || 8123);
const BROKER_PORT = Number(process.env.CHEMGAME_BROKER_PORT || 9123);

const results = [];
let current = '';
const check = (name, cond, extra = '') =>
  results.push({ suite: current, name, ok: !!cond, extra: cond ? '' : String(extra) });

async function suitesIn(dir) {
  try {
    const files = (await readdir(join(here, dir))).filter((f) => f.endsWith('.test.mjs')).sort();
    return files.filter((f) => !only || f.includes(only)).map((f) => ({ dir, file: f }));
  } catch {
    return [];
  }
}

const unitSuites = wantUnit ? await suitesIn('unit') : [];
const e2eSuites = wantE2e ? await suitesIn('e2e') : [];

for (const s of unitSuites) {
  current = s.file.replace('.test.mjs', '');
  const mod = await import(join(here, s.dir, s.file));
  await mod.default({ check });
}

if (e2eSuites.length) {
  const site = await startStatic(root, STATIC_PORT);
  const broker = await startBroker(BROKER_PORT);
  const browser = await launchBrowser();
  const baseUrl = `${site.url}?broker=${broker.url}`;
  const consoleErrors = [];
  try {
    for (const s of e2eSuites) {
      current = s.file.replace('.test.mjs', '');
      const mod = await import(join(here, s.dir, s.file));
      await mod.default({ check, browser, baseUrl, consoleErrors });
    }
  } finally {
    await browser.close();
    await broker.close();
    await site.close();
  }
  if (consoleErrors.length) {
    console.log('\nbrowser console errors:');
    for (const e of new Set(consoleErrors)) console.log('  ! ' + e);
  }
}

const failed = results.filter((r) => !r.ok);
let last = '';
for (const r of results) {
  if (r.suite !== last) {
    console.log(`\n${r.suite}`);
    last = r.suite;
  }
  console.log(`  ${r.ok ? 'v' : 'x'} ${r.name}${r.ok ? '' : '  <<< ' + r.extra}`);
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
