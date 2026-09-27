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
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const OUT = new URL('./out/', import.meta.url).pathname;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

// In-page autopilot: the best lane for the next row, and any jump/duck needed.
const BRAIN = `(() => {
  const g = window.__rush;
  const row = g.rows.filter((r) => !r.resolved).sort((a, b) => a.d - b.d)[0];
  if (!row) return { status: g.status };
  const score = (s) => s.type === 'eq' ? (s.eq.isTrue ? 3 : -1) : s.type === 'empty' ? 2 : s.type === 'wall' ? -1 : 1;
  let best = g.player.lane, key = -1e9;
  row.lanes.forEach((s, l) => { const k = score(s) * 10 - Math.abs(l - g.player.lane); if (score(s) >= 0 && k > key) { key = k; best = l; } });
  const mine = row.lanes[g.player.lane];
  const eta = row.d / g.speed;
  let action = null;
  if (mine.type === 'barrier' && eta < 0.25 && eta > 0 && g.player.jumpT < 0) action = 'ArrowUp';
  if (mine.type === 'beam' && eta < 0.22 && eta > 0 && g.player.duckT < 0) action = 'ArrowDown';
  return { status: g.status, lane: g.player.lane, best, action, hold: g.hold };
})()`;

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
  await page.waitForFunction(() => window.__rush && window.__rush.rows.length > 0);

  // Play properly for ~14 seconds using real key presses.
  const steerKey = async () => {
    const want = await page.evaluate(BRAIN);
    if (want.best != null && want.best !== want.lane) await page.keyboard.press(want.best < want.lane ? 'ArrowLeft' : 'ArrowRight');
    if (want.action) await page.keyboard.press(want.action);
  };
  const t0 = Date.now();
  let shot = false;
  let obShot = false;
  while (Date.now() - t0 < 14000) {
    await steerKey();
    if (!obShot) {
      const near = await page.evaluate(() =>
        window.__rush.rows.some((r) => r.d > 15 && r.d < 45 && r.lanes.some((x) => x.type !== 'eq')),
      );
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
  const mid = await page.evaluate(() => ({
    coins: window.__rush.coins,
    status: window.__rush.status,
    score: window.__rush.score,
    shields: window.__rush.shields,
  }));
  assert.equal(mid.status, 'running', `${name}: should survive while playing correctly`);
  assert.equal(mid.shields, 1, `${name}: good play keeps the shield`);
  assert.ok(mid.coins >= 3, `${name}: should have collected coins (got ${mid.coins})`);
  const hudScore = await page.textContent('[data-testid="score"]');
  assert.equal(hudScore.replace(/,/g, ''), String(mid.score), `${name}: HUD shows score`);

  // Now deliberately steer into a FALSE equation.
  for (;;) {
    const st = await page.evaluate(() => {
      const g = window.__rush;
      const row = g.rows
        .filter((r) => !r.resolved && r.lanes.some((x) => x.type === 'eq' && !x.eq.isTrue))
        .sort((a, b) => a.d - b.d)[0];
      if (!row) return { status: g.status };
      const wrong = row.lanes.findIndex((x) => x.type === 'eq' && !x.eq.isTrue);
      const between = g.rows.some((r) => !r.resolved && r.d < row.d);
      return { status: g.status, wrong, lane: g.player.lane, between };
    });
    if (st.status !== 'running') break;
    if (st.wrong != null && !st.between && st.lane !== st.wrong)
      await page.keyboard.press(st.wrong < st.lane ? 'ArrowLeft' : 'ArrowRight');
    else if (st.between) await steerKey();
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
    const state = await page.evaluate(`(() => {
      const b = ${BRAIN};
      return { ...b, title: document.querySelector('.lesson__title')?.textContent };
    })()`);
    assert.equal(state.status, 'running', `${name}: nobody dies in the tutorial`);
    if (state.title && !seen.has(state.title)) {
      seen.add(state.title);
      if (state.hold && shots < 8) await page.screenshot({ path: `${OUT}${name}-tutorial-${++shots}.png` });
    }
    if (state.hold) {
      if (state.title === 'Jump!') await page.keyboard.press('ArrowUp');
      else if (state.title === 'Duck!') await page.keyboard.press('ArrowDown');
      else if (state.best != null && state.best !== state.lane)
        await page.keyboard.press(state.best < state.lane ? 'ArrowLeft' : 'ArrowRight');
    }
    await page.waitForTimeout(60);
  }
  for (const m of ['Steer into the TRUE equation', 'Jump!', 'Duck!', 'Walls block the lane — switch!', 'Is 6+7=12 true?', 'You’re ready!']) {
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
