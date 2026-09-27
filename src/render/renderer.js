// Canvas renderer. Reads game state, never mutates it (apart from its own
// particle/effect bookkeeping). Two canvases are used so the DOM/SVG mascot
// can sit *between* them: everything still ahead of the runner is drawn on the
// back canvas, everything that has passed it (plus particles) on the front.
//
// Performance model (it has to hold 60fps on a mid-range phone):
//  - Everything static (sky, glow, track bed, lane gaps, rails) is painted
//    once per resize/theme into a cached canvas and blitted each frame.
//  - Every equation sign and obstacle is rasterised ONCE into a sprite (tiles,
//    text, glow and all) and then just scaled with drawImage — no per-frame
//    text layout, paths or shadow blurs.
//  - The scrolling tile seams of the track are a single batched fill.
//  - The front canvas is only cleared when something was drawn on it.
//  - Resolution is capped by pixel budget, and GameView can lower it further
//    at runtime (adaptive quality) if frames run long.

import { SPAWN_D } from '../game/engine.js';
import { displayToken } from '../game/equations.js';
import { createView, scaleAt, groundYAt, laneXAt, project, CAM } from './projection.js';

const FONT = '"Nunito", "Quicksand", system-ui, sans-serif';
const TILE_GAP = 0.12; // gap between tiles, as a fraction of tile size
const SIGN_LIFT = 2.5; // world units between the ground and a sign's bottom edge
const ROW_LEN = 4.5; // world length of one row of track tiles
const SEAM_FAR_D = 220; // seams further than this blend into the bed anyway
const NEAR_D = -CAM * 0.85; // nearest depth drawn (just behind the camera plane)
const MAX_PIXELS = 2.6e6; // per-canvas pixel budget before resolution is capped
const MAX_SPRITES = 48; // ~a dozen are on screen at once

export function createRenderer(backCanvas, frontCanvas) {
  const backCtx = backCanvas?.getContext?.('2d', { alpha: false }) ?? null;
  const frontCtx = frontCanvas?.getContext?.('2d') ?? null;
  let view = createView(800, 600);
  let dpr = 1;
  let deviceRatio = 1;
  let quality = 1; // 0..1 multiplier applied on top of the capped DPR
  let size = { w: 800, h: 600 };
  let staticLayer = null; // { canvas, key }
  let sprites = new Map();
  let frontDirty = true;
  // New sprites rasterised per frame. Gates spawn at the horizon almost
  // transparent, so deferring a sign by a frame is invisible, while
  // rasterising three at once can cause a long frame on a slow phone.
  const SPRITE_BUDGET = 1;
  let spriteBudget = SPRITE_BUDGET;
  const particles = [];
  const flashes = new Map(); // gate id -> seconds since resolve
  let time = 0;

  function computeDpr() {
    const budget = Math.sqrt(MAX_PIXELS / Math.max(1, size.w * size.h));
    return Math.max(0.75, Math.min(deviceRatio, 2, budget) * quality);
  }

  function resize(width, height, pixelRatio = 1) {
    size = { w: width, h: height };
    deviceRatio = pixelRatio;
    dpr = computeDpr();
    view = createView(width, height);
    for (const c of [backCanvas, frontCanvas]) {
      if (!c) continue;
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }
    staticLayer = null;
    sprites = new Map();
    frontDirty = true;
    return view;
  }

  /** Lower (or restore) rendering resolution at runtime. */
  function setQuality(q) {
    const next = Math.max(0.5, Math.min(1, q));
    if (Math.abs(next - quality) < 0.01) return;
    quality = next;
    resize(size.w, size.h, deviceRatio);
  }

  /** React to engine events with particles / flashes. */
  function onEvents(g, events, theme) {
    for (const e of events) {
      if (e.type === 'coin') {
        flashes.set(e.gateId, 0);
        // Everything celebratory happens down at the runner's level, below
        // the band where the next equations are being read.
        const mx = laneXAt(view, e.lane, 0);
        const my = view.groundY - view.ppu * 1.1;
        burst(mx, my, theme.correct, 14, 0.55);
        particles.push({ kind: 'coin', x0: mx, y0: my, life: 0, max: 0.55 });
        particles.push({
          kind: 'text',
          text: `+${e.points}`,
          x: mx + view.laneW * 0.32,
          y: view.groundY - view.ppu * 1.6,
          vx: 0,
          vy: -45,
          life: 0,
          max: 0.75,
          color: '#ffffff',
        });
      } else if (e.type === 'shield') {
        burst(laneXAt(view, g.player.lane, 0), view.groundY - view.ppu * 1.2, '#8fd3ff', 24);
      } else if (e.type === 'death' && e.cause === 'equation') {
        burst(laneXAt(view, e.lane, 0), view.groundY - view.ppu * 3.2, theme.wrong, 32);
      } else if (e.type === 'cleared') {
        burst(laneXAt(view, g.player.lane, 0), view.groundY - view.ppu * 0.4, '#ffffff', 8);
      }
    }
  }

  function burst(x, y, color, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (120 + Math.random() * 320) * power;
      particles.push({
        kind: 'square',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 140 * power,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: 4 + Math.random() * 6,
        color,
        spin: (Math.random() - 0.5) * 10,
      });
    }
  }

  function draw(g, theme, dt, { worldOffset = g.distance * 2 } = {}) {
    time += dt;
    spriteBudget = SPRITE_BUDGET;
    for (const [id, t] of flashes) {
      if (t > 2) flashes.delete(id);
      else flashes.set(id, t + dt);
    }
    if (backCtx) {
      // Static layer, blitted 1:1 in device pixels.
      backCtx.setTransform(1, 0, 0, 1, 0, 0);
      backCtx.drawImage(getStaticLayer(theme), 0, 0);
      backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSeams(backCtx, theme, worldOffset);
      if (g.speedLevel > 0) drawSpeedStreaks(backCtx, g.speedLevel);
      drawShadow(backCtx, g, theme);
      drawEntities(backCtx, g, theme, (d) => d >= 0);
    }
    if (frontCtx) {
      const needed = particles.length > 0 || g.gates.some((x) => x.d < 0) || g.obstacles.some((x) => x.d < 0);
      if (needed || frontDirty) {
        frontCtx.setTransform(1, 0, 0, 1, 0, 0);
        frontCtx.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
        frontCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawEntities(frontCtx, g, theme, (d) => d < 0);
        drawParticles(frontCtx, dt);
      }
      frontDirty = needed;
    }
  }

  // ---------------------------------------------------------------- static

  function getStaticLayer(theme) {
    const key = `${theme.name}|${size.w}x${size.h}@${dpr}`;
    if (staticLayer?.key === key) return staticLayer.canvas;
    const c = makeCanvas(Math.round(size.w * dpr), Math.round(size.h * dpr));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStatic(ctx, theme);
    staticLayer = { canvas: c, key };
    return c;
  }

  function paintStatic(ctx, theme) {
    const v = view;
    const { width: W, height: H, horizonY } = v;

    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY);
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    const glow = ctx.createRadialGradient(W / 2, horizonY, 0, W / 2, horizonY, W * 0.6);
    glow.addColorStop(0, theme.horizonGlow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Maths symbols scattered across the sky.
    ctx.fillStyle = theme.floaters;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyphs = ['+', '−', '×', '÷', '=', '7', '3', '9', '4'];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const count = Math.round(12 + W / 60);
    for (let i = 0; i < count; i++) {
      ctx.font = `800 ${14 + rnd() * 26}px ${FONT}`;
      ctx.fillText(glyphs[i % glyphs.length], rnd() * W, (0.08 + rnd() * 0.8) * horizonY);
    }

    // Track bed, running all the way to the vanishing point.
    const nearY = groundYAt(v, NEAR_D);
    const nearHalf = 1.5 * v.laneW * scaleAt(NEAR_D);
    const bed = ctx.createLinearGradient(0, horizonY, 0, v.groundY);
    bed.addColorStop(0, theme.skyBottom);
    bed.addColorStop(0.3, theme.trackTile);
    bed.addColorStop(1, theme.trackTile);
    ctx.fillStyle = bed;
    ctx.beginPath();
    ctx.moveTo(v.cx, horizonY);
    ctx.lineTo(v.cx + nearHalf, nearY);
    ctx.lineTo(v.cx - nearHalf, nearY);
    ctx.closePath();
    ctx.fill();

    // Gaps between the lanes' tile columns.
    ctx.fillStyle = theme.ground;
    const nearS = scaleAt(NEAR_D);
    for (const b of [-0.5, 0.5]) {
      const hw = 0.06;
      ctx.beginPath();
      ctx.moveTo(v.cx, horizonY);
      ctx.lineTo(v.cx + (b + hw) * v.laneW * nearS, nearY);
      ctx.lineTo(v.cx + (b - hw) * v.laneW * nearS, nearY);
      ctx.closePath();
      ctx.fill();
    }

    // Rails.
    ctx.strokeStyle = theme.rail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const edge of [-1.5, 1.5]) {
      ctx.moveTo(v.cx, horizonY);
      ctx.lineTo(v.cx + edge * v.laneW * nearS, nearY);
    }
    ctx.stroke();
  }

  // ---------------------------------------------------------------- track

  function drawSeams(ctx, theme, worldOffset) {
    // The track is a board of Nerdle tiles rushing towards you; the moving
    // part is just the dark seams between rows, batched into one fill.
    const v = view;
    const phase = worldOffset % ROW_LEN;
    ctx.fillStyle = theme.ground;
    ctx.beginPath();
    for (let d = NEAR_D - phase + ROW_LEN; d < SEAM_FAR_D; d += ROW_LEN) {
      const d1 = d + ROW_LEN * 0.1;
      const y0 = groundYAt(v, d);
      const y1 = groundYAt(v, d1);
      const h0 = 1.5 * v.laneW * scaleAt(d);
      const h1 = 1.5 * v.laneW * scaleAt(d1);
      ctx.moveTo(v.cx - h0, y0);
      ctx.lineTo(v.cx + h0, y0);
      ctx.lineTo(v.cx + h1, y1 - 0.5);
      ctx.lineTo(v.cx - h1, y1 - 0.5);
      ctx.closePath();
    }
    ctx.fill();
  }

  /** Overdrive: streaks rushing out from the vanishing point, one batch. */
  function drawSpeedStreaks(ctx, level) {
    const v = view;
    const n = 8 + level * 5;
    const reach = Math.hypot(v.width, v.height);
    ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.28, 0.1 + level * 0.05)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      // Deterministic per-streak angle (upper-side fan, avoiding the track).
      const side = i % 2 ? 1 : -1;
      const ang = side * (0.35 + ((i * 0.618) % 1) * 1.1) - Math.PI / 2;
      const k = (time * (1.4 + (i % 3) * 0.3) + i * 0.37) % 1;
      const r0 = reach * (0.12 + k * 0.6);
      const r1 = r0 + reach * (0.05 + k * 0.12);
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      ctx.moveTo(v.cx + dx * r0, v.horizonY + dy * r0 * 0.6);
      ctx.lineTo(v.cx + dx * r1, v.horizonY + dy * r1 * 0.6);
    }
    ctx.stroke();
  }

  function drawShadow(ctx, g, theme) {
    const p = g.player;
    const h = p.jumpT >= 0 ? 4 * p.jumpT * (1 - p.jumpT) : 0;
    const x = laneXAt(view, p.laneVisual, 0);
    const w = view.laneW * 0.26 * (1 - h * 0.35);
    ctx.fillStyle = theme.shadow;
    ctx.beginPath();
    ctx.ellipse(x, view.groundY, w, w * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------------------------------------------------------- entities

  function drawEntities(ctx, g, theme, filter) {
    const items = [];
    for (const x of g.gates) if (filter(x.d)) items.push({ d: x.d, gate: x });
    for (const x of g.obstacles) if (filter(x.d)) items.push({ d: x.d, ob: x });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.gate) drawGate(ctx, g, it.gate, theme);
      else drawObstacle(ctx, it.ob, theme);
    }
    ctx.globalAlpha = 1;
  }

  function entityAlpha(d) {
    // Fade in from the horizon, and out as things sweep past the camera.
    const fadeIn = Math.min(1, (SPAWN_D - d) / 8 + 0.15);
    const fadeOut = d < 0 ? Math.max(0, 1 + d / 7) : 1;
    return Math.max(0, Math.min(fadeIn, fadeOut));
  }

  function drawGate(ctx, g, gate, theme) {
    const v = view;
    const s = scaleAt(gate.d);
    // Passed signs clear out fast so they never cover the next equations.
    const alpha = gate.d < 0 ? Math.max(0, 1 + gate.d / 3.5) : entityAlpha(gate.d);
    if (alpha <= 0) return;

    const dying = g.status !== 'running' && g.death?.gateId === gate.id;
    const flashT = flashes.get(gate.id);
    // Once past the runner, signs swoosh up and away overhead instead of
    // sinking across the runner (they sit below the camera's eye line).
    const lift = gate.d < 0 ? -gate.d * Math.max(v.ppu * 1.4, v.height * 0.035) : 0;

    // Posts between lanes.
    ctx.globalAlpha = alpha;
    const postTop = project(v, 0, SIGN_LIFT + signHeightUnits(), gate.d).y - lift;
    const gy = groundYAt(v, gate.d) - lift;
    ctx.fillStyle = theme.post;
    const pw = Math.max(2, 0.18 * v.ppu * s);
    for (const edge of [-0.5, 0.5, 1.5, 2.5]) {
      ctx.fillRect(laneXAt(v, edge, gate.d) - pw / 2, postTop, pw, gy - postTop);
    }

    const tile = signTileSize(signCols(gate));
    for (let lane = 0; lane < 3; lane++) {
      const eq = gate.lanes[lane];
      let state = 'idle';
      if (gate.result === 'correct' && lane === gate.chosen) state = 'correct';
      if (dying) state = eq.isTrue ? 'correct' : lane === gate.chosen ? 'wrong' : 'idle';
      const sprite = signSprite(eq.text, state, tile, theme, gate.d < SPAWN_D - 12);
      if (!sprite) continue; // deferred to a later frame (still far away)
      let shake = 0;
      if (dying && state === 'wrong') shake = Math.sin(time * 60) * 4 * Math.max(0, 1 - g.deathTimer * 1.5);
      let pop = 1;
      if (state === 'correct' && flashT != null) pop = 1 + 0.12 * Math.max(0, 1 - flashT * 4);
      const sc = s * pop;
      const cx = laneXAt(v, lane, gate.d) + shake;
      const bottom = project(v, lane, SIGN_LIFT, gate.d).y - lift;
      ctx.globalAlpha = dying && state === 'idle' ? alpha * 0.45 : alpha;
      ctx.drawImage(
        sprite.canvas,
        cx - (sprite.w / 2 + sprite.pad) * sc,
        bottom - (sprite.h + sprite.pad) * sc,
        (sprite.w + sprite.pad * 2) * sc,
        (sprite.h + sprite.pad * 2) * sc,
      );
    }
  }

  function signCols(gate) {
    if (gate._cols && gate._colsFor === view.twoRows) return gate._cols;
    const cols = view.twoRows
      ? Math.max(...gate.lanes.map((e) => Math.max(e.tokens.indexOf('='), e.tokens.length - e.tokens.indexOf('='))))
      : Math.max(...gate.lanes.map((e) => e.tokens.length));
    // Memoised on the gate object: purely a render-side cache.
    gate._cols = cols;
    gate._colsFor = view.twoRows;
    return cols;
  }

  function signTileSize(cols) {
    return view.signW / (cols + (cols - 1) * TILE_GAP + 0.5);
  }

  function signHeightUnits() {
    const rows = view.twoRows ? 2 : 1;
    const t = signTileSize(view.twoRows ? 5 : 8) / view.ppu;
    return rows * t * 1.2 + t * 0.5;
  }

  /** Rasterise a whole sign (board + tiles + text + glow) once, at s = 1. */
  function signSprite(text, state, tile, theme, urgent) {
    const key = `s|${text}|${state}|${tile.toFixed(2)}|${view.twoRows}|${theme.name}`;
    const hit = sprites.get(key);
    if (hit) return hit;
    // Near/visible signs (and state changes like turning teal) always render
    // immediately; far ones wait for budget.
    if (!urgent && state === 'idle' && spriteBudget <= 0) return null;
    spriteBudget--;

    const tokens = [...text];
    const gap = tile * TILE_GAP;
    const rows = view.twoRows ? splitAtEquals(tokens) : [tokens];
    const inner = tile * 0.25;
    const rowW = (r) => r.length * tile + (r.length - 1) * gap;
    const w = Math.max(...rows.map(rowW)) + inner * 2;
    const h = rows.length * tile + (rows.length - 1) * gap + inner * 2;
    const pad = state === 'correct' ? tile * 0.9 : 2;
    const scale = dpr * 1.15; // a little headroom for the "pop" when collected
    const c = makeCanvas(Math.ceil((w + pad * 2) * scale), Math.ceil((h + pad * 2) * scale));
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(pad, pad);

    if (state === 'correct') {
      ctx.save();
      ctx.shadowColor = theme.correct;
      ctx.shadowBlur = tile * 1.1;
      ctx.fillStyle = hexA(theme.correct, 0.45);
      roundRect(ctx, 0, 0, w, h, tile * 0.3);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = theme.signBoard;
      roundRect(ctx, 0, 0, w, h, tile * 0.3);
      ctx.fill();
    }

    let fill = theme.signTile;
    let edge = theme.signTileEdge;
    let ink = theme.signText;
    if (state === 'correct') [fill, edge, ink] = [theme.correct, theme.correct, '#ffffff'];
    if (state === 'wrong') [fill, edge, ink] = [theme.wrong, theme.wrong, '#ffffff'];

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${tile * 0.62}px ${FONT}`;
    ctx.lineWidth = Math.max(1, tile * 0.06);
    rows.forEach((row, ri) => {
      const y = inner + ri * (tile + gap);
      let x = (w - rowW(row)) / 2;
      for (const ch of row) {
        ctx.fillStyle = fill;
        roundRect(ctx, x, y, tile, tile, tile * 0.16);
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.fillText(displayToken(ch), x + tile / 2, y + tile * 0.54);
        x += tile + gap;
      }
    });

    const sprite = { canvas: c, w, h, pad };
    remember(key, sprite);
    return sprite;
  }

  function drawObstacle(ctx, ob, theme) {
    const v = view;
    const s = scaleAt(ob.d);
    const alpha = entityAlpha(ob.d);
    if (alpha <= 0) return;
    ctx.globalAlpha = ob.hit ? alpha * 0.4 : alpha;
    const sprite = obstacleSprite(ob.kind, theme);
    const left = laneXAt(v, -0.5, ob.d);
    const gy = groundYAt(v, ob.d);
    const th = sprite.th * s;
    const width = sprite.w * s;

    let y;
    if (ob.kind === 'barrier') {
      y = gy - th; // a low wall of black tiles: jump it
    } else {
      // An overhead beam: duck under it. Kept low (its bottom edge sits at
      // head height) so it never hides the equation signs further back.
      y = gy - 1.35 * v.ppu * s - th;
      ctx.fillStyle = theme.post;
      const pw = Math.max(2, 0.16 * v.ppu * s);
      ctx.fillRect(left - pw, y, pw, gy - y);
      ctx.fillRect(left + width, y, pw, gy - y);
    }
    ctx.drawImage(sprite.canvas, left, y, width, th);
  }

  /** A row of nine black hazard tiles (↑ for barriers, ↓ for beams), at s = 1. */
  function obstacleSprite(kind, theme) {
    const key = `o|${kind}|${theme.name}`;
    const hit = sprites.get(key);
    if (hit) return hit;
    const v = view;
    const w = 3 * v.laneW;
    const tiles = 9;
    const tw = w / tiles;
    const th = Math.min(tw, 0.85 * v.ppu);
    const c = makeCanvas(Math.ceil(w * dpr), Math.ceil(th * dpr));
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${th * 0.62}px ${FONT}`;
    ctx.lineWidth = Math.max(1, th * 0.06);
    for (let i = 0; i < tiles; i++) {
      const x = i * tw + tw * 0.05;
      ctx.fillStyle = theme.obstacle;
      roundRect(ctx, x, ctx.lineWidth / 2, tw * 0.9, th - ctx.lineWidth, th * 0.18);
      ctx.fill();
      ctx.strokeStyle = theme.obstacleEdge;
      ctx.stroke();
      ctx.fillStyle = i % 2 ? theme.hazard : theme.obstacleText;
      ctx.fillText(kind === 'barrier' ? '↑' : '↓', x + tw * 0.45, th * 0.55);
    }
    const sprite = { canvas: c, w, th };
    remember(key, sprite);
    return sprite;
  }

  function remember(key, sprite) {
    if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value);
    sprites.set(key, sprite);
  }

  // ---------------------------------------------------------------- particles

  function drawParticles(ctx, dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        particles.splice(i, 1);
        continue;
      }
      if (p.kind !== 'coin') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind !== 'text') p.vy += 700 * dt;
      }
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      if (p.kind === 'coin') {
        // A little teal ✓ tile that flies up into the HUD coin counter.
        const k = p.life / p.max;
        const e = k * k * (3 - 2 * k);
        const x = p.x0 + (view.width - 64 - p.x0) * e;
        const y = p.y0 + (30 - p.y0) * e - Math.sin(k * Math.PI) * 60;
        const sz = 26 * (1 - 0.35 * k);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#4E9E8E';
        roundRect(ctx, x - sz / 2, y - sz / 2, sz, sz, sz * 0.22);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `900 ${sz * 0.7}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', x, y + sz * 0.04);
      } else if (p.kind === 'text') {
        ctx.font = `900 ${Math.max(20, view.ppu * 0.75)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        const r = p.life * p.spin;
        const c = Math.cos(r);
        const sn = Math.sin(r);
        ctx.setTransform(c * dpr, sn * dpr, -sn * dpr, c * dpr, p.x * dpr, p.y * dpr);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    resize,
    draw,
    onEvents,
    setQuality,
    get view() {
      return view;
    },
    get pixelRatio() {
      return dpr;
    },
    get quality() {
      return quality;
    },
    /** Drop cached layers/sprites (e.g. once the web font has loaded). */
    invalidate() {
      staticLayer = null;
      sprites = new Map();
    },
    reset() {
      particles.length = 0;
      flashes.clear();
      frontDirty = true;
    },
  };
}

export function splitAtEquals(tokens) {
  const i = tokens.indexOf('=');
  return i < 0 ? [tokens] : [tokens.slice(0, i), tokens.slice(i)];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
