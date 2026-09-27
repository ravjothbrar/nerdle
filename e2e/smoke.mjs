// End-to-end smoke test: builds nothing, serves dist/ with `vite preview`,
// then drives the real game in Chromium — plays correctly for a while using
// the keyboard, deliberately steers into a FALSE lane, and checks the
// game-over screen explains the mistake. Screenshots land in e2e/out/.
//
//   npm run build && npm run e2e
//
// Set CHROMIUM_PATH if Chromium isn't at the default Playwright location.

import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const server = await preview({ preview: { port: 4173, strictPort: false }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function run(name, viewport, theme, isMobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  await ctx.addInitScript((t) => {
    localStorage.setItem('nerdle-rush:theme', JSON.stringify(t));
    localStorage.setItem('nerdle-rush:tutorialDone', 'true');
  }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${url}?e2e`);
  await page.waitForSelector('[data-testid="play"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}${name}-1-start.png` });

  await page.click('[data-testid="play"]');
  await page.waitForFunction(() => window.__rush && window.__rush.gates.length > 0);

  // Play properly for ~12 seconds using real key presses.
  const steerKey = async () => {
    const want = await page.evaluate(() => {
      const g = window.__rush;
      const gate = g.gates.filter((x) => !x.resolved).sort((a, b) => a.d - b.d)[0];
      const ob = g.obstacles.filter((x) => !x.resolved).sort((a, b) => a.d - b.d)[0];
      let key = null;
      if (gate && gate.trueLane !== g.player.lane) key = gate.trueLane < g.player.lane ? 'ArrowLeft' : 'ArrowRight';
      let action = null;
      if (ob && ob.d / g.speed < 0.25 && ob.d > 0) action = ob.kind === 'barrier' ? 'ArrowUp' : 'ArrowDown';
      return { key, action };
    });
    if (want.key) await page.keyboard.press(want.key);
    if (want.action) await page.keyboard.press(want.action);
  };
  const t0 = Date.now();
  let shot = false;
  let obShot = false;
  while (Date.now() - t0 < 12000) {
    await steerKey();
    if (!obShot) {
      const near = await page.evaluate(() => window.__rush.obstacles.some((o) => o.d > 12 && o.d < 30));
      if (near) {
        await page.screenshot({ path: `${OUT}${name}-2b-obstacle.png` });
        obShot = true;
      }
    }
    if (!shot && Date.now() - t0 > 5200) {
      await page.screenshot({ path: `${OUT}${name}-2-running.png` });
      shot = true;
    }
    await page.waitForTimeout(40);
  }
  const mid = await page.evaluate(() => ({ coins: window.__rush.coins, status: window.__rush.status, score: window.__rush.score }));
  assert.equal(mid.status, 'running', `${name}: should survive while playing correctly`);
  assert.ok(mid.coins >= 3, `${name}: should have collected coins (got ${mid.coins})`);
  const hudScore = await page.textContent('[data-testid="score"]');
  assert.equal(hudScore.replace(/,/g, ''), String(mid.score), `${name}: HUD shows score`);

  // Now deliberately steer into a FALSE lane.
  for (;;) {
    const s = await page.evaluate(() => {
      const g = window.__rush;
      const gate = g.gates.filter((x) => !x.resolved).sort((a, b) => a.d - b.d)[0];
      if (!gate) return { status: g.status };
      const wrong = [0, 1, 2].find((l) => l !== gate.trueLane);
      return { status: g.status, wrong, lane: g.player.lane, eta: gate.d / g.speed };
    });
    if (s.status !== 'running') break;
    if (s.wrong != null && s.lane !== s.wrong) await page.keyboard.press(s.wrong < s.lane ? 'ArrowLeft' : 'ArrowRight');
    if (s.eta != null && s.eta < 0.6 && s.eta > 0.3 && !shot) break;
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}${name}-3-caught.png` });
  await page.waitForSelector('[data-testid="game-over"]', { timeout: 5000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}${name}-4-gameover.png` });
  const sentence = await page.textContent('[data-testid="death-sentence"]');
  assert.match(sentence, /You picked \d+[+−×÷]\d+=\d+ — it's actually \d+/, `${name}: death sentence`);

  // Verify the sentence is mathematically honest.
  const [, a, op, b, shown, actual] = sentence.match(/(\d+)([+−×÷])(\d+)=(\d+) — it's actually (\d+)/);
  const calc = { '+': (x, y) => x + y, '−': (x, y) => x - y, '×': (x, y) => x * y, '÷': (x, y) => x / y }[op](+a, +b);
  assert.equal(calc, +actual, `${name}: "actually" value is correct`);
  assert.notEqual(+shown, calc, `${name}: picked equation really was false`);
  console.log(`✓ ${name}: ${mid.coins} coins, then caught out by "${sentence}"`);

  // Play again works.
  await page.click('[data-testid="again"]');
  await page.waitForFunction(() => window.__rush && window.__rush.status === 'running' && window.__rush.coins === 0);
  await ctx.close();
}

// First-time player: PLAY → tutorial, completed with real key presses by
// reading the on-screen coach card, then straight into a real run.
async function tutorial(name, viewport, isMobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${url}?e2e`);
  await page.waitForSelector('[data-testid="play"]');
  await page.click('[data-testid="play"]');
  await page.waitForSelector('.lesson');
  const seen = new Set();
  let shots = 0;
  const t0 = Date.now();
  while (!(await page.$('[data-testid="tutorial-done"]'))) {
    assert.ok(Date.now() - t0 < 60000, `${name}: tutorial should finish`);
    const state = await page.evaluate(() => {
      const g = window.__rush;
      const title = document.querySelector('.lesson__title')?.textContent;
      const gate = g.gates.find((x) => !x.resolved);
      return { hold: g.hold, title, lane: g.player.lane, trueLane: gate?.trueLane, status: g.status };
    });
    assert.equal(state.status, 'running', `${name}: nobody dies in the tutorial`);
    if (state.title && !seen.has(state.title)) {
      seen.add(state.title);
      if (state.hold && shots < 3) await page.screenshot({ path: `${OUT}${name}-tutorial-${++shots}.png` });
    }
    if (state.hold) {
      if (state.title === 'Jump!') await page.keyboard.press('ArrowUp');
      else if (state.title === 'Duck!') await page.keyboard.press('ArrowDown');
      else if (state.trueLane != null) await page.keyboard.press(state.trueLane < state.lane ? 'ArrowLeft' : 'ArrowRight');
    }
    await page.waitForTimeout(60);
  }
  for (const m of ['Steer into the TRUE equation', 'Jump!', 'Duck!', 'You’re ready!']) {
    assert.ok(seen.has(m), `${name}: tutorial showed "${m}" (saw ${[...seen].join(' | ')})`);
  }
  await page.screenshot({ path: `${OUT}${name}-tutorial-done.png` });
  await page.click('[data-testid="start-run"]');
  await page.waitForFunction(() => window.__rush && !window.__rush.scripted && window.__rush.status === 'running');
  assert.equal(await page.evaluate(() => localStorage.getItem('nerdle-rush:tutorialDone')), 'true');
  console.log(`✓ ${name}: tutorial completed (${seen.size} coach messages), real run started`);
  await ctx.close();
}

try {
  await tutorial('tutorial-desktop', { width: 1280, height: 800 });
  await tutorial('tutorial-mobile', { width: 390, height: 844 }, true);
  await run('desktop-classic', { width: 1280, height: 800 }, 'classic');
  await run('desktop-mathlete', { width: 1280, height: 800 }, 'mathlete');
  await run('mobile-classic', { width: 390, height: 844 }, 'classic', true);
  assert.deepEqual(errors, [], 'no console errors');
  console.log(`\nAll e2e checks passed. Screenshots in ${OUT}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
