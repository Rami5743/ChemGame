// Playwright comes from node_modules when it is installed, and from the
// toolchain of a cloud session when it is not.
const CANDIDATES = ['playwright', '/opt/node-tools/node_modules/playwright/index.js'];

export async function launchBrowser() {
  let last;
  for (const where of CANDIDATES) {
    try {
      const mod = await import(where);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) return chromium.launch({ args: ['--no-sandbox'] });
    } catch (e) {
      last = e;
    }
  }
  throw new Error('playwright not found: ' + (last && last.message));
}
