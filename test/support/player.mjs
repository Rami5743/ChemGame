// Opens one browser context on the site and joins, as one person would.
export async function openPlayer({ browser, url, name, consoleErrors, label, viewport }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const tag = label || name || 'anon';
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${tag}] ${e.message}`));
  await page.goto(url);
  if (name) await page.fill('#name-input', name);
  await page.click('#name-go');
  // A latecomer to a locked room is moved on to the game screen the moment
  // the host is heard from, which can be before this is even asked.
  await page.waitForSelector('#view-lobby:not(.hidden), #view-game:not(.hidden)');
  return page;
}

export const connected = (page) =>
  page.waitForFunction(() => document.getElementById('status').dataset.state === 'on', null, { timeout: 20000 });

export const rosterOf = (page) => page.$$eval('#roster .who', (n) => n.map((x) => x.textContent));
export const seatsOf = (page) => page.$$eval('#players .who', (n) => n.map((x) => x.textContent));
