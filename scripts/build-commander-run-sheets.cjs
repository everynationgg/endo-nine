const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const RAW_DIR = path.join(__dirname, '..', 'public', 'assets', 'commander', 'run_raw');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'commander');
const CELL_SIZE = 256;
const FRAME_COUNT = 8;
const TARGET_CHAR_HEIGHT = 248; // Matches the 256x256 idle sprites (head near y=6, boots at y=254)
const GROUND_Y = 254;

/**
 * Clean Right GIF frame:
 * Removes baked-in gray/white checkerboard via border flood-fill + enclosed lower-leg hole cleanup,
 * while preserving 100% of Commander's white coat interior.
 */
function cleanRightFrame(buf, w, h) {
  const visited = new Uint8Array(w * h);
  const q = [];
  for (let x = 0; x < w; x++) {
    q.push(x, 0);
    q.push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    q.push(0, y);
    q.push(w - 1, y);
  }
  let head = 0;
  while (head < q.length) {
    const x = q[head++];
    const y = q[head++];
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const idx = y * w + x;
    if (visited[idx]) continue;
    const p = idx * 4;
    const r = buf[p], g = buf[p + 1], b = buf[p + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (minC >= 180 && (maxC - minC) <= 18) {
      visited[idx] = 1;
      buf[p + 3] = 0;
      q.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }

  // Clear tiny enclosed checkerboard triangle between front shin and dangling strap (x >= 285, y >= 245)
  for (let y = 245; y < h - 1; y++) {
    for (let x = 285; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (buf[p + 3] === 0) continue;
      const r = buf[p], g = buf[p + 1], b = buf[p + 2];
      if (Math.min(r, g, b) >= 230 && (Math.max(r, g, b) - Math.min(r, g, b)) <= 8) {
        buf[p + 3] = 0;
      }
    }
  }

  // De-fringe 1px outer boundary touching transparency
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (buf[p + 3] === 0) continue;
      const touchesTrans =
        buf[((y - 1) * w + x) * 4 + 3] === 0 ||
        buf[((y + 1) * w + x) * 4 + 3] === 0 ||
        buf[(y * w + x - 1) * 4 + 3] === 0 ||
        buf[(y * w + x + 1) * 4 + 3] === 0;
      if (touchesTrans) {
        const r = buf[p], g = buf[p + 1], b = buf[p + 2];
        if (Math.min(r, g, b) >= 135 && (Math.max(r, g, b) - Math.min(r, g, b)) <= 24) {
          buf[p + 3] = 0;
        }
      }
    }
  }
}

/**
 * Clean Left GIF frame:
 * Removes solid black background (including enclosed pockets between legs/coat)
 * and strips the 1-2px white GIF dither fringe while keeping the white coat 100% intact.
 */
function cleanLeftFrame(buf, w, h) {
  // 1. Connected-component removal of pure black background (maxC <= 14, size >= 5 or border-connected)
  const visited = new Uint8Array(w * h);
  for (let startY = 0; startY < h; startY++) {
    for (let startX = 0; startX < w; startX++) {
      const startIdx = startY * w + startX;
      if (visited[startIdx]) continue;
      const sp = startIdx * 4;
      if (Math.max(buf[sp], buf[sp + 1], buf[sp + 2]) > 14) continue;

      const comp = [startIdx];
      visited[startIdx] = 1;
      let head = 0;
      let touchesBorder = false;
      while (head < comp.length) {
        const idx = comp[head++];
        const x = idx % w;
        const y = (idx - x) / w;
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touchesBorder = true;
        const neighbors = [
          x > 0 ? idx - 1 : -1,
          x < w - 1 ? idx + 1 : -1,
          y > 0 ? idx - w : -1,
          y < h - 1 ? idx + w : -1
        ];
        for (const n of neighbors) {
          if (n < 0 || visited[n]) continue;
          const np = n * 4;
          if (Math.max(buf[np], buf[np + 1], buf[np + 2]) <= 14) {
            visited[n] = 1;
            comp.push(n);
          }
        }
      }
      if (touchesBorder || comp.length >= 5) {
        for (const idx of comp) buf[idx * 4 + 3] = 0;
      }
    }
  }

  // 2. Strip GIF white/gray dither fringe bordering transparent background
  for (let pass = 0; pass < 4; pass++) {
    const toClear = [];
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        if (buf[p + 3] === 0) continue;
        let transCount = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (buf[((y + dy) * w + (x + dx)) * 4 + 3] === 0) transCount++;
          }
        }
        if (transCount === 0) continue;
        const r = buf[p], g = buf[p + 1], b = buf[p + 2];
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        const isLightHalo = minC >= 85 && (maxC - minC) <= 42;
        if (!isLightHalo) continue;

        let hasDarkInward = false;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const np = ((y + dy) * w + (x + dx)) * 4;
            if (buf[np + 3] > 0 && Math.max(buf[np], buf[np + 1], buf[np + 2]) <= 75) {
              hasDarkInward = true;
              break;
            }
          }
          if (hasDarkInward) break;
        }
        const inOutsideCoatZone = (y < 165) || (x < 185) || (y > 355 && x < 318) || (x < 250 && y > 250);
        if (inOutsideCoatZone || hasDarkInward || transCount >= 5) {
          toClear.push(idx);
        }
      }
    }
    for (const idx of toClear) buf[idx * 4 + 3] = 0;
  }

  // 3. Final 1px edge matte pass: darken any remaining bright outer boundary pixel so the dark ink outline is crisp
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (buf[p + 3] === 0) continue;
      const touchesTrans =
        buf[((y - 1) * w + x) * 4 + 3] === 0 ||
        buf[((y + 1) * w + x) * 4 + 3] === 0 ||
        buf[(y * w + x - 1) * 4 + 3] === 0 ||
        buf[(y * w + x + 1) * 4 + 3] === 0;
      if (touchesTrans && Math.min(buf[p], buf[p + 1], buf[p + 2]) >= 95) {
        buf[p] = Math.round(buf[p] * 0.28);
        buf[p + 1] = Math.round(buf[p + 1] * 0.25);
        buf[p + 2] = Math.round(buf[p + 2] * 0.24);
      }
    }
  }
}

/**
 * Computes tight bounding box and upper-body horizontal center of mass for a cleaned RGBA frame.
 */
function analyzeFrame(buf, w, h) {
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const charW = Math.max(1, maxX - minX + 1);
  const charH = Math.max(1, maxY - minY + 1);

  // Measure horizontal center of the head & upper torso (top 15% to 55% of character height)
  // This avoids horizontal wobble caused by swaying coat tails or extended feet.
  const yStart = Math.floor(minY + charH * 0.15);
  const yEnd = Math.floor(minY + charH * 0.55);
  let sumX = 0;
  let countX = 0;
  for (let y = yStart; y <= yEnd; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a > 128) {
        sumX += x;
        countX++;
      }
    }
  }
  const torsoCenterX = countX > 0 ? sumX / countX : (minX + maxX) / 2;

  return { minX, maxX, minY, maxY, charW, charH, torsoCenterX };
}

async function processDirection(dir, filename, cleanerFn, normalizePerFrameHeight) {
  const fullPath = path.join(RAW_DIR, filename);
  const meta = await sharp(fullPath, { animated: true }).metadata();
  const w = meta.width;
  const h = meta.pageHeight;
  const { data } = await sharp(fullPath, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const frames = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const slice = Buffer.from(data.subarray(f * w * h * 4, (f + 1) * w * h * 4));
    if (cleanerFn) cleanerFn(slice, w, h);
    const stats = analyzeFrame(slice, w, h);
    frames.push({ raw: slice, stats });
  }

  // Reference height across the 8 frames (median/stance height)
  const heights = frames.map(f => f.stats.charH).sort((a, b) => a - b);
  const refHeight = heights[Math.floor(heights.length * 0.65)];
  const maxBottomY = Math.max(...frames.map(f => f.stats.maxY));

  const stripComposites = [];

  for (let f = 0; f < FRAME_COUNT; f++) {
    const { raw, stats } = frames[f];
    // Crop tightly around character
    const cropped = await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
      .extract({
        left: stats.minX,
        top: stats.minY,
        width: stats.charW,
        height: stats.charH
      })
      .png()
      .toBuffer();

    // Scale height:
    // For front/back (where raw frames had slight generator scale variance), normalize each frame to TARGET_CHAR_HEIGHT
    // For left/right (where stride extension naturally changes height by 1-3%), preserve relative stride ratio
    const scale = normalizePerFrameHeight
      ? TARGET_CHAR_HEIGHT / stats.charH
      : TARGET_CHAR_HEIGHT / refHeight;

    const scaledW = Math.min(CELL_SIZE - 4, Math.max(1, Math.round(stats.charW * scale)));
    const scaledH = Math.min(CELL_SIZE - 2, Math.max(1, Math.round(stats.charH * scale)));

    const resizedBuf = await sharp(cropped)
      .resize(scaledW, scaledH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();

    // Horizontal alignment: place torsoCenterX at CELL_SIZE / 2 (128)
    const relTorsoX = (stats.torsoCenterX - stats.minX) * (scaledW / stats.charW);
    let destX = Math.round(CELL_SIZE / 2 - relTorsoX);
    destX = Math.max(2, Math.min(CELL_SIZE - scaledW - 2, destX));

    // Vertical alignment: lock boots to GROUND_Y (254)
    // For side views, preserve tiny natural airborne lift (clamped to <= 3px) so feet don't float
    const rawLift = normalizePerFrameHeight ? 0 : Math.max(0, Math.min(3, Math.round((maxBottomY - stats.maxY) * scale * 0.4)));
    const destY = Math.max(0, GROUND_Y - scaledH - rawLift);

    stripComposites.push({
      input: resizedBuf,
      left: f * CELL_SIZE + destX,
      top: destY
    });
  }

  const outFile = path.join(OUT_DIR, `commander_run_${dir}.png`);
  await sharp({
    create: {
      width: CELL_SIZE * FRAME_COUNT,
      height: CELL_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(stripComposites)
    .png()
    .toFile(outFile);

  console.log(`Generated ${outFile} (${CELL_SIZE * FRAME_COUNT}x${CELL_SIZE})`);
  return outFile;
}

(async () => {
  const fFront = await processDirection('front', 'commander run front.gif', null, true);
  const fBack  = await processDirection('back',  'commander run back.gif',  null, true);
  const fLeft  = await processDirection('left',  'commander run left.gif',  cleanLeftFrame, false);
  const fRight = await processDirection('right', 'commander run right.gif', cleanRightFrame, false);

  // Also generate a 4-row visual inspection contact sheet over dark slate background with ground lines
  const sheetW = CELL_SIZE * FRAME_COUNT;
  const sheetH = CELL_SIZE * 4;
  const bg = Buffer.alloc(sheetW * sheetH * 4);
  for (let y = 0; y < sheetH; y++) {
    const isGroundLine = (y % CELL_SIZE) === GROUND_Y;
    for (let x = 0; x < sheetW; x++) {
      const isCellBorder = (x % CELL_SIZE) === 0;
      const p = (y * sheetW + x) * 4;
      bg[p]     = isGroundLine ? 56  : isCellBorder ? 45 : 30;
      bg[p + 1] = isGroundLine ? 189 : isCellBorder ? 55 : 41;
      bg[p + 2] = isGroundLine ? 248 : isCellBorder ? 72 : 59;
      bg[p + 3] = 255;
    }
  }

  const previewPath = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/commander_run_contact_sheet.png';
  await sharp(bg, { raw: { width: sheetW, height: sheetH, channels: 4 } })
    .composite([
      { input: fFront, left: 0, top: 0 },
      { input: fBack,  left: 0, top: CELL_SIZE },
      { input: fLeft,  left: 0, top: CELL_SIZE * 2 },
      { input: fRight, left: 0, top: CELL_SIZE * 3 }
    ])
    .png()
    .toFile(previewPath);
  console.log('Saved contact sheet:', previewPath);
})();

