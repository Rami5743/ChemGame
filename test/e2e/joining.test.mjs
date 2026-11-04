// What a phone sees when it joins over a connection that takes its time: it
// is told there is no host, and then the host is heard from after all.
import { connected } from '../support/player.mjs';

export default async function run({ check, browser, baseUrl, consoleErrors }) {
  const host = await browser.newContext().then((c) => c.newPage());
  host.on('pageerror', (e) => consoleErrors.push(`[host] ${e.message}`));
  await host.goto(baseUrl);
  await host.fill('#name-input', 'אורי');
  await host.click('#name-go');
  await connected(host);
  const link = await host.inputValue('#share');

  // The guest loads the page and only then loses the network, so it is the
  // broker it cannot reach — exactly the phone's case.
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  guest.on('pageerror', (e) => consoleErrors.push(`[guest] ${e.message}`));
  await guest.goto(link);
  await ctx.setOffline(true);
  await guest.fill('#name-input', 'נועה');
  await guest.click('#name-go');

  await guest.waitForSelector('#lobby-note.error', { timeout: 30000 });
  check('a guest who hears nothing is told no host was found',
    (await guest.textContent('#lobby-note')).includes('מארח'));
  check('and he is still in the waiting room', await guest.isVisible('#view-lobby'));

  // The connection comes back. The host was there the whole time.
  await ctx.setOffline(false);
  await guest.waitForFunction(() => !!window.chemgame.state(), null, { timeout: 40000 });
  await guest.waitForSelector('#lobby-note:not(.error)', { timeout: 20000 });
  check('once the host is heard from, the word about him is taken back',
    (await guest.textContent('#lobby-note')) === 'ממתין שהמארח יתחיל את המשחק.',
    await guest.textContent('#lobby-note'));
  check('and the guest is seated', (await guest.$$('#roster li')).length === 2);
  await host.waitForFunction(() => document.querySelectorAll('#roster li').length === 2,
    null, { timeout: 20000 });
  check('the host sees him too', true);

  for (const p of [host, guest]) await p.context().close();
}
