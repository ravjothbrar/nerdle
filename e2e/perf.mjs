// Frame-rate benchmark under emulated low-end hardware.
// Serves dist/, plays a run with an in-page autopilot, and reports FPS and
// frame-time percentiles for a laptop profile and throttled phone profiles.
//
//   npm run build && npm run perf

import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(
  (p) => p && existsSync(p),
);
const SECONDS = Number(process.env.PERF_SECONDS ?? 20);
const profiles = [
  { name: 'laptop 1440×900 @2x', viewport: { width: 1440, height: 900 }, dpr: 2, cpu: 1 },
  { name: 'phone 390×844 @3x, CPU ÷4', viewport: { width: 390, height: 844 }, dpr: 3, cpu: 4, mobile: true },
  { name: 'phone 390×844 @3x, CPU ÷6', viewport: { width: 390, height: 844 }, dpr: 3, cpu: 6, mobile: true },
];

const server = await preview({ preview: { port: 4190 }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath });
const results = [];
try {
  for (const p of profiles) {
    const ctx = await browser.newContext({
      viewport: p.viewport,
      deviceScaleFactor: p.dpr,
      isMobile: !!p.mobile,
      hasTouch: !!p.mobile,
    });
    await ctx.addInitScript(() => localStorage.setItem('nerdle-rush:tutorialDone', 'true'));
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    await page.goto(`${url}?e2e`);
    await page.click('[data-testid="play"]');
    await page.waitForFunction(() => window.__rush && !window.__rush.scripted);
    // Worst case: jump straight into overdrive (fastest world, speed streaks).
    await page.evaluate(() => {
      window.__rush.coins = 60;
      window.__rush.speedLevel = 2;
    });
    const stats = await page.evaluate(async (seconds) => {
      const times = [];
      let last = performance.now();
      const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      await new Promise((resolve) => {
        const end = last + seconds * 1000;
        const loop = (now) => {
          times.push(now - last);
          last = now;
          const g = window.__rush;
          const p = g.player;
          const row = g.rows.filter((r) => !r.resolved).sort((a, b) => a.d - b.d)[0];
          if (row) {
            const score = (s) => (s.type === 'eq' ? (s.eq.isTrue ? 3 : -1) : s.type === 'empty' ? 2 : s.type === 'wall' ? -1 : 1);
            let best = p.lane;
            let bestKey = -1e9;
            row.lanes.forEach((s, l) => {
              const k = score(s) * 10 - Math.abs(l - p.lane);
              if (score(s) >= 0 && k > bestKey) [bestKey, best] = [k, l];
            });
            if (best !== p.lane && g.t - row.spawnedAt > 0.4) key(best < p.lane ? 'ArrowLeft' : 'ArrowRight');
            const mine = row.lanes[p.lane];
            const eta = row.d / g.speed;
            if (mine.type === 'barrier' && eta < 0.2 && p.jumpT < 0) key('ArrowUp');
            if (mine.type === 'beam' && eta < 0.2 && p.duckT < 0) key('ArrowDown');
          }
          if (now < end) requestAnimationFrame(loop);
          else resolve();
        };
        requestAnimationFrame(loop);
      });
      times.shift();
      const sorted = [...times].sort((a, b) => a - b);
      const pct = (q) => sorted[Math.floor(sorted.length * q)];
      return {
        fps: times.length / (times.reduce((a, b) => a + b, 0) / 1000),
        p50: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
        longFrames: times.filter((t) => t > 33).length,
        status: window.__rush.status,
      };
    }, SECONDS);
    results.push({ profile: p.name, ...stats });
    console.log(
      `${p.name.padEnd(30)} ${stats.fps.toFixed(1).padStart(5)} fps  p50 ${stats.p50.toFixed(1)}ms  p95 ${stats.p95.toFixed(1)}ms  p99 ${stats.p99.toFixed(1)}ms  >33ms: ${stats.longFrames}  (${stats.status})`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
