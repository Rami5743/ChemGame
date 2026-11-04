// Opens one browser context on the site and joins, as one person would.
export async function openPlayer({ browser, url, name, consoleErrors, label }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const tag = label || name || 'anon';
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${tag}] ${e.message}`));
  await page.goto(url);
  if (name) await page.fill('#name-input', name);
  await page.click('#name-go');
  await page.waitForSelector('#view-lobby:not(.hidden)');
  return page;
}

export const connected = (page) =>
  page.waitForFunction(() => document.getElementById('status').dataset.state === 'on', null, { timeout: 20000 });

export const rosterOf = (page) => page.$$eval('#roster .who', (n) => n.map((x) => x.textContent));
export const seatsOf = (page) => page.$$eval('#players .who', (n) => n.map((x) => x.textContent));
