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

import { SPAWN_D, WALL_LEN } from '../game/engine.js';
import { displayToken } from '../game/equations.js';
import { createView, scaleAt, groundYAt, laneXAt, project, layoutTokens, CAM, TILE_GAP } from './projection.js';

const FONT = '"Nunito", "Quicksand", system-ui, sans-serif';
// Heights in world units (a lane is 4 wide; the cube is ~2 tall).
const PANEL_LIFT = 0.35; // equation panels stand on short legs
const HURDLE_LIFT = 0.2;
const HURDLE_TOP = 1.25;
// Beams are a tall overhead gantry — big board up high, obvious open gap
// underneath — but the bottom edge sits below the standing cube's head (~2),
// above the ducking cube (~0.9): you must duck.
const BEAM_BOTTOM = 1.6;
const BEAM_TOP = 3.8;
const BEAM_POST_TOP = 4.1;
const WALL_H = 2.4; // taller than the cube (~2), low enough not to hide the row behind
const ROW_LEN = 4.5; // world length of one row of track tiles
const SEAM_FAR_D = 220; // seams further than this blend into the bed anyway
const NEAR_D = -CAM * 0.85; // nearest depth drawn (just behind the camera plane)
const MAX_PIXELS = 2.6e6; // per-canvas pixel budget before resolution is capped
const MAX_SPRITES = 60; // ~a dozen are on screen at once

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
  // Dirty-rect tracking for the front canvas: only the area painted last
  // frame is cleared, instead of the whole layer every frame.
  const FULL = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
  let lastBox = FULL;
  let box = null; // bbox being accumulated while drawing the front layer
  const mark = (x, y, w, h) => {
    if (!box) return;
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x + w);
    box.y1 = Math.max(box.y1, y + h);
  };
  // New sprites rasterised per frame. Gates spawn at the horizon almost
  // transparent, so deferring a sign by a frame is invisible, while
  // rasterising three at once can cause a long frame on a slow phone.
  const SPRITE_BUDGET = 1;
  let spriteBudget = SPRITE_BUDGET;
  const particles = [];
  let time = 0;

  function computeDpr() {
    const budget = Math.sqrt(MAX_PIXELS / Math.max(1, size.w * size.h));
    return Math.max(0.75, Math.min(deviceRatio, 2, budget) * quality);
  }

  function resize(width, height, pixelRatio = 1, keepSprites = false) {
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
    // Sprites are drawn scaled anyway, so a quality change can keep them
    // (re-rasterising everything at once is exactly the spike we're avoiding).
    if (!keepSprites) sprites = new Map();
    lastBox = FULL;
    return view;
  }

  /** Lower (or restore) rendering resolution at runtime. */
  function setQuality(q) {
    const next = Math.max(0.5, Math.min(1, q));
    if (Math.abs(next - quality) < 0.01) return;
    quality = next;
    resize(size.w, size.h, deviceRatio, true);
  }

  /** React to engine events with particles. */
  function onEvents(g, events, theme) {
    const v = view;
    const midY = v.groundY - v.ppu * 1.3; // roughly the middle of a panel at the runner
    for (const e of events) {
      if (e.type === 'coin') {
        // The panel shatters into its tiles and a coin flies to the HUD.
        const mx = laneXAt(v, e.lane, 0);
        burst(mx, midY, theme.correct, 16, 0.6);
        burst(mx, midY, '#ffffff', 8, 0.5);
        particles.push({ kind: 'coin', x0: mx, y0: midY, life: 0, max: 0.55 });
        particles.push({
          kind: 'text',
          text: `+${e.points}`,
          x: mx + v.laneW * 0.34,
          y: v.groundY - v.ppu * 2.2,
          vx: 0,
          vy: -45,
          life: 0,
          max: 0.75,
          color: '#ffffff',
        });
      } else if (e.type === 'shield') {
        burst(laneXAt(v, e.lane ?? g.player.lane, 0), midY, '#8fd3ff', 24);
      } else if (e.type === 'death') {
        burst(laneXAt(v, e.lane ?? g.player.lane, 0), midY, e.cause === 'equation' ? theme.wrong : '#ffffff', 32);
      } else if (e.type === 'cleared') {
        burst(laneXAt(v, g.player.lane, 0), v.groundY - v.ppu * 0.4, '#ffffff', 8);
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
    if (backCtx) {
      // Static layer, blitted 1:1 in device pixels.
      backCtx.setTransform(1, 0, 0, 1, 0, 0);
      backCtx.drawImage(getStaticLayer(theme), 0, 0);
      backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSeams(backCtx, theme, worldOffset);
      if (g.speedLevel > 0) drawSpeedStreaks(backCtx, g.speedLevel);
      drawShadow(backCtx, g, theme);
      drawRows(backCtx, g, theme, 'back');
    }
    if (frontCtx) {
      const needed = particles.length > 0 || g.rows.some((r) => r.d < 0);
      if (needed || lastBox) {
        frontCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (lastBox) {
          const b = lastBox;
          const x0 = Math.max(0, b.x0 - 4);
          const y0 = Math.max(0, b.y0 - 4);
          frontCtx.clearRect(x0, y0, Math.min(view.width, b.x1 + 4) - x0, Math.min(view.height, b.y1 + 4) - y0);
        }
        box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        drawRows(frontCtx, g, theme, 'front');
        drawParticles(frontCtx, dt);
        lastBox = box.x1 > box.x0 ? box : null;
        box = null;
      }
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
      // Deterministic per-streak angle: a fan down the sides of the screen,
      // leaving the middle (where the maths is) clear.
      const side = i % 2 ? 1 : -1;
      const ang = Math.PI / 2 - side * (0.75 + ((i * 0.618) % 1) * 0.75);
      const k = (time * (1.4 + (i % 3) * 0.3) + i * 0.37) % 1;
      const r0 = reach * (0.12 + k * 0.6);
      const r1 = r0 + reach * (0.05 + k * 0.12);
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      ctx.moveTo(v.cx + dx * r0, v.horizonY + dy * r0);
      ctx.lineTo(v.cx + dx * r1, v.horizonY + dy * r1);
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

  // ---------------------------------------------------------------- rows

  /**
   * Draw every row slot that belongs on this canvas, far to near. The back
   * canvas (under the mascot) gets everything still ahead, plus hurdles that
   * are passing under your feet and the row that just ended the run (so the
   * cube is seen bouncing off it). Everything else that has passed you goes
   * on the front canvas.
   */
  function drawRows(ctx, g, theme, layer) {
    const deathRow = g.status !== 'running' ? g.death?.rowId : null;
    const rows = g.rows.slice().sort((a, b) => b.d - a.d);
    let drew = false;
    for (const row of rows) {
      const cols = rowCols(row);
      const alpha = rowAlpha(row);
      if (alpha <= 0) continue;
      // Outer lanes first so a centre wall's faces sit on top of neighbours.
      for (const lane of [0, 2, 1]) {
        const s = row.lanes[lane];
        const back = row.d >= 0 || row.id === deathRow || s.type === 'barrier';
        if ((layer === 'back') !== back) continue;
        drew = true;
        ctx.globalAlpha = s.type === 'wall' ? wallAlpha(row) : alpha;
        switch (s.type) {
          case 'eq':
            drawPanel(ctx, g, row, lane, s, cols, theme, deathRow);
            break;
          case 'wall':
            drawWall(ctx, row.d, lane, s, theme, row.result === 'hit' && row.chosen === lane);
            break;
          case 'barrier':
            drawHurdle(ctx, row.d, lane, theme, row.result === 'hit' && row.chosen === lane);
            break;
          case 'beam':
            drawBeam(ctx, row.d, lane, theme, row.result === 'hit' && row.chosen === lane);
            break;
          default:
        }
      }
    }
    ctx.globalAlpha = 1;
    return drew;
  }

  function rowAlpha(row) {
    // Fade in from the horizon; clear out fast once past the runner.
    const fadeIn = Math.min(1, (SPAWN_D - row.d) / 10 + 0.15);
    const fadeOut = row.d < 0 ? Math.max(0, 1 + row.d / 2) : 1;
    return Math.max(0, Math.min(fadeIn, fadeOut));
  }

  function wallAlpha(row) {
    const fadeIn = Math.min(1, (SPAWN_D - row.d) / 10 + 0.15);
    const back = row.d + WALL_LEN;
    return Math.max(0, Math.min(fadeIn, back < 2 ? back / 2 : 1));
  }

  /** One tile size per row, so all equations in a row look the same. */
  function rowCols(row) {
    if (row._colsFor === view.signLayout) return row._cols;
    let cols = 1;
    for (const s of row.lanes) {
      if (s.type !== 'eq') continue;
      for (const r of layoutTokens(s.eq.tokens, view.signLayout)) cols = Math.max(cols, r.length);
    }
    // A fixed minimum keeps tile size (and so panel height) uniform from row
    // to row: short equations don't get giant tiles whose tall panels would
    // hide the row behind. Memoised on the row object (render-side only).
    const minCols = { row: 8, two: 5, column: 3 }[view.signLayout];
    row._cols = Math.max(cols, minCols);
    row._colsFor = view.signLayout;
    return row._cols;
  }

  // -- equation panels -------------------------------------------------------

  function drawPanel(ctx, g, row, lane, s, cols, theme, deathRow) {
    // A true panel you ran through has shattered into coins.
    if (row.result === 'correct' && row.chosen === lane) return;
    const v = view;
    const sc = scaleAt(row.d);
    const dying = row.id === deathRow;
    let state = 'idle';
    if (dying) state = s.eq.isTrue ? 'correct' : lane === row.chosen ? 'wrong' : 'idle';
    const sprite = panelSprite(s.eq.text, state, v.tileFor(cols), theme, row.d < SPAWN_D - 14);
    if (!sprite) return;

    const cx = laneXAt(v, lane, row.d);
    const gy = groundYAt(v, row.d);
    const bottom = gy - PANEL_LIFT * v.ppu * sc;
    // Little legs.
    ctx.fillStyle = theme.post;
    const legW = Math.max(2, 0.16 * v.ppu * sc);
    const legX = sprite.w * 0.3 * sc;
    ctx.fillRect(cx - legX - legW / 2, bottom - 2, legW, gy - bottom + 2);
    ctx.fillRect(cx + legX - legW / 2, bottom - 2, legW, gy - bottom + 2);

    let shake = 0;
    if (dying && state === 'wrong') shake = Math.sin(time * 60) * 5 * Math.max(0, 1 - g.deathTimer * 1.5);
    if (dying && state === 'idle') ctx.globalAlpha *= 0.4;
    const dx = cx + shake - (sprite.w / 2 + sprite.pad) * sc;
    const dy = bottom - (sprite.h + sprite.pad) * sc;
    const dw = (sprite.w + sprite.pad * 2) * sc;
    ctx.drawImage(sprite.canvas, dx, dy, dw, (sprite.h + sprite.pad * 2) * sc);
    mark(dx, dy, dw, gy - dy);
  }

  /** Rasterise a whole panel (board + tiles + text + glow) once, at s = 1. */
  function panelSprite(text, state, tile, theme, urgent) {
    const key = `p|${text}|${state}|${tile.toFixed(2)}|${view.signLayout}|${theme.name}`;
    const hit = sprites.get(key);
    if (hit) return hit;
    // Near/visible panels (and state changes) always render immediately; far
    // ones wait for this frame's budget.
    if (!urgent && state === 'idle' && spriteBudget <= 0) return null;
    spriteBudget--;

    const tokens = [...text];
    const gap = tile * TILE_GAP;
    const rows = layoutTokens(tokens, view.signLayout);
    const align = view.signLayout === 'column' ? 'right' : 'center';
    const inner = tile * 0.25;
    const rowW = (r) => r.length * tile + (r.length - 1) * gap;
    const w = Math.max(...rows.map(rowW)) + inner * 2;
    const h = rows.length * tile + (rows.length - 1) * gap + inner * 2;
    const pad = state === 'correct' ? tile * 0.9 : 2;
    const scale = dpr;
    const c = makeCanvas(Math.ceil((w + pad * 2) * scale), Math.ceil((h + pad * 2) * scale));
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(pad, pad);

    if (state === 'correct') {
      ctx.save();
      ctx.shadowColor = theme.correct;
      ctx.shadowBlur = tile * 1.1;
      ctx.fillStyle = hexA(theme.correct, 0.5);
      roundRect(ctx, 0, 0, w, h, tile * 0.3);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = theme.signBoard;
      roundRect(ctx, 0, 0, w, h, tile * 0.3);
      ctx.fill();
      ctx.strokeStyle = theme.post;
      ctx.lineWidth = Math.max(1.5, tile * 0.06);
      ctx.stroke();
    }

    let fill = theme.signTile;
    let edge = theme.signTileEdge;
    let ink = theme.signText;
    if (state === 'correct') [fill, edge, ink] = [theme.correct, theme.correct, '#ffffff'];
    if (state === 'wrong') [fill, edge, ink] = [theme.wrong, theme.wrong, '#ffffff'];

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${tile * 0.7}px ${FONT}`;
    ctx.lineWidth = Math.max(1, tile * 0.06);
    const maxW = w - inner * 2;
    rows.forEach((row, ri) => {
      const y = inner + ri * (tile + gap);
      let x = inner + (align === 'right' ? maxW - rowW(row) : (maxW - rowW(row)) / 2);
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

  // -- physical obstacles ----------------------------------------------------

  /** Screen rect of a lane-wide face at depth d between heights h0..h1. */
  function faceRect(d, lane, h0, h1, widthFrac = 0.94) {
    const v = view;
    const sc = scaleAt(d);
    const gy = groundYAt(v, d);
    const w = v.laneW * widthFrac * sc;
    return { x: laneXAt(v, lane, d) - w / 2, y: gy - h1 * v.ppu * sc, w, h: (h1 - h0) * v.ppu * sc };
  }

  function drawHurdle(ctx, d, lane, theme, hit) {
    const v = view;
    const sc = scaleAt(d);
    const r = faceRect(d, lane, HURDLE_LIFT, HURDLE_TOP, 0.9);
    ctx.fillStyle = theme.post;
    const legW = Math.max(2, 0.14 * v.ppu * sc);
    ctx.fillRect(r.x + r.w * 0.08, r.y + r.h, legW, HURDLE_LIFT * v.ppu * sc);
    ctx.fillRect(r.x + r.w * 0.92 - legW, r.y + r.h, legW, HURDLE_LIFT * v.ppu * sc);
    if (hit) ctx.globalAlpha *= 0.45;
    ctx.drawImage(obstacleSprite('hurdle', theme), r.x, r.y, r.w, r.h);
    mark(r.x, r.y, r.w, r.h + HURDLE_LIFT * v.ppu * sc);
  }

  function drawBeam(ctx, d, lane, theme, hit) {
    const v = view;
    const sc = scaleAt(d);
    const r = faceRect(d, lane, BEAM_BOTTOM, BEAM_TOP, 0.98);
    const gy = groundYAt(v, d);
    const postTop = gy - BEAM_POST_TOP * v.ppu * sc;
    ctx.fillStyle = theme.post;
    const pw = Math.max(3, 0.22 * v.ppu * sc);
    ctx.fillRect(r.x - pw * 0.4, postTop, pw, gy - postTop);
    ctx.fillRect(r.x + r.w - pw * 0.6, postTop, pw, gy - postTop);
    if (hit) ctx.globalAlpha *= 0.45;
    ctx.drawImage(obstacleSprite('beam', theme), r.x, r.y, r.w, r.h);
    mark(r.x - pw, postTop, r.w + pw * 2, gy - postTop);
  }

  /** A tall block of tiles that fills its lane for WALL_LEN units: steer round. */
  function drawWall(ctx, d, lane, s, theme, hit) {
    const v = view;
    const dFront = Math.max(d, NEAR_D + 1);
    const dBack = d + WALL_LEN;
    if (dBack <= NEAR_D + 1) return;
    const hw = 0.47; // half-width in lanes
    const P = (lx, h, dd) => project(v, lane + lx, h, dd);
    const fl = P(-hw, 0, dFront);
    const fr = P(hw, 0, dFront);
    const ftl = P(-hw, WALL_H, dFront);
    const ftr = P(hw, WALL_H, dFront);
    const btl = P(-hw, WALL_H, dBack);
    const btr = P(hw, WALL_H, dBack);
    const xs = [fl.x, fr.x, btl.x, btr.x];
    const ys = [fl.y, btl.y, btr.y, ftl.y];
    mark(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

    // Inner side face (the camera sits over the centre lane, so we see the
    // side of outer-lane walls that faces the middle).
    if (lane !== 1) {
      const sx = lane === 0 ? hw : -hw;
      const a = P(sx, 0, dFront);
      const b = P(sx, WALL_H, dFront);
      const c2 = P(sx, WALL_H, dBack);
      const e = P(sx, 0, dBack);
      ctx.fillStyle = theme.wallSide;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.fill();
    }
    // Top face.
    ctx.fillStyle = theme.wallTop;
    ctx.beginPath();
    ctx.moveTo(ftl.x, ftl.y);
    ctx.lineTo(ftr.x, ftr.y);
    ctx.lineTo(btr.x, btr.y);
    ctx.lineTo(btl.x, btl.y);
    ctx.closePath();
    ctx.fill();
    // Front face (only while it's still in front of the camera plane).
    if (d > NEAR_D + 1) {
      if (hit) ctx.globalAlpha *= 0.6;
      ctx.drawImage(obstacleSprite(`wall${s.variant ?? 0}`, theme), ftl.x, ftl.y, fr.x - fl.x, fl.y - ftl.y);
    }
  }

  /**
   * Obstacle faces, rasterised once at a fixed reference size and scaled.
   * All are built from black Nerdle "not in the answer" tiles.
   */
  function obstacleSprite(kind, theme) {
    const key = `o|${kind}|${theme.name}|${view.ppu.toFixed(1)}`;
    const hit = sprites.get(key);
    if (hit) return hit.canvas;
    const v = view;
    let cols;
    let rows;
    let wFrac;
    let hUnits;
    let glyphs;
    if (kind === 'hurdle') [cols, rows, wFrac, hUnits, glyphs] = [3, 1, 0.9, HURDLE_TOP - HURDLE_LIFT, ['↑']];
    else if (kind === 'beam') [cols, rows, wFrac, hUnits, glyphs] = [3, 2, 0.98, BEAM_TOP - BEAM_BOTTOM, ['↓']];
    else {
      const variant = Number(kind.slice(4));
      [cols, rows, wFrac, hUnits] = [3, 4, 0.94, WALL_H];
      glyphs = [['?', '?', '?'], ['#'], ['×', '÷']][variant % 3];
    }
    const w = v.laneW * wFrac;
    const h = hUnits * v.ppu;
    const c = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const isWall = kind.startsWith('wall');
    // Frame.
    ctx.fillStyle = isWall ? theme.wallFront : theme.obstacle;
    roundRect(ctx, 0, 0, w, h, Math.min(w, h) * 0.08);
    ctx.fill();
    ctx.strokeStyle = theme.obstacleEdge;
    ctx.lineWidth = Math.max(2, v.ppu * 0.06);
    ctx.stroke();
    // Tiles.
    const padX = w * 0.05;
    const padY = h * (rows === 1 ? 0.1 : 0.04);
    const bottomBand = kind === 'beam' ? h * 0.16 : 0;
    const tw = (w - padX * 2) / cols;
    const th = (h - padY * 2 - bottomBand) / rows;
    const t = Math.min(tw, th);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${t * 0.62}px ${FONT}`;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const x = padX + k * tw + (tw - t * 0.92) / 2;
        const y = padY + r * th + (th - t * 0.92) / 2;
        ctx.fillStyle = theme.obstacle;
        roundRect(ctx, x, y, t * 0.92, t * 0.92, t * 0.16);
        ctx.fill();
        ctx.strokeStyle = theme.obstacleEdge;
        ctx.lineWidth = Math.max(1, t * 0.05);
        ctx.stroke();
        const i = r * cols + k;
        ctx.fillStyle = (r + k) % 2 ? theme.hazard : theme.obstacleText;
        ctx.fillText(glyphs[i % glyphs.length], x + t * 0.46, y + t * 0.5);
      }
    }
    if (kind === 'beam') {
      // Yellow/black hazard stripes along the underside: "the gap is below".
      const band = h * 0.16;
      ctx.save();
      roundRect(ctx, 0, h - band, w, band, band * 0.3);
      ctx.clip();
      ctx.fillStyle = '#161803';
      ctx.fillRect(0, h - band, w, band);
      ctx.fillStyle = theme.hazard;
      for (let x = -band; x < w + band; x += band * 1.4) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + band * 0.7, h);
        ctx.lineTo(x + band * 1.4, h - band);
        ctx.lineTo(x + band * 0.7, h - band);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    remember(key, { canvas: c });
    return c;
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
        mark(x - sz, y - sz, sz * 2, sz * 2);
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
        const fs = Math.max(20, view.ppu * 0.75);
        mark(p.x - fs * 2, p.y - fs, fs * 4, fs * 2);
        ctx.font = `900 ${fs}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        mark(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
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
      lastBox = FULL;
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
