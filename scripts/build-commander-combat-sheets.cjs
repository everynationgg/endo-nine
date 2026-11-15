const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COMMANDER_DIR = path.join(__dirname, '..', 'public', 'assets', 'commander');
const LMB_RAW_DIR = path.join(COMMANDER_DIR, 'LMB_raw');
const ULT_RAW_DIR = path.join(COMMANDER_DIR, 'ultimate_raw');
const ART_DIR = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82';

const CELL_SIZE = 256;
const TARGET_CHAR_HEIGHT = 244;
const GROUND_Y = 252;

/**
 * Clean LMB Attack GIF Frame:
 * 1. Connected-component removal of pure black background (including enclosed gaps between legs/arms).
 * 2. Strips 1-2px dark red/orange GIF palette dither halo on outer boundary touching transparency.
 * 3. Preserves white coat, dark armor, and golden-orange muzzle flash.
 */
function cleanLmbFrame(buf, w, h) {
  const visited = new Uint8Array(w * h);
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const sIdx = sy * w + sx;
      if (visited[sIdx]) continue;
      const sp = sIdx * 4;
      if (Math.max(buf[sp], buf[sp + 1], buf[sp + 2]) > 15) continue;

      const comp = [sIdx];
      visited[sIdx] = 1;
      let head = 0;
      let touchesBorder = false;
      while (head < comp.length) {
        const idx = comp[head++];
        const x = idx % w;
        const y = (idx - x) / w;
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touchesBorder = true;
        const nbs = [
          x > 0 ? idx - 1 : -1,
          x < w - 1 ? idx + 1 : -1,
          y > 0 ? idx - w : -1,
          y < h - 1 ? idx + w : -1
        ];
        for (const nb of nbs) {
          if (nb >= 0 && !visited[nb]) {
            const np = nb * 4;
            if (Math.max(buf[np], buf[np + 1], buf[np + 2]) <= 15) {
              visited[nb] = 1;
              comp.push(nb);
            }
          }
        }
      }

      if (touchesBorder || comp.length >= 20) {
        for (const idx of comp) {
          buf[idx * 4 + 3] = 0;
        }
      }
    }
  }

  // 2 passes of outer-edge GIF dither de-fringing (strips dark red/brown/black GIF border artifacts without touching bright muzzle flash)
  for (let pass = 0; pass < 2; pass++) {
    const toClear = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        if (buf[p + 3] === 0) continue;

        const touchesTrans =
          buf[(idx - 1) * 4 + 3] === 0 ||
          buf[(idx + 1) * 4 + 3] === 0 ||
          buf[(idx - w) * 4 + 3] === 0 ||
          buf[(idx + w) * 4 + 3] === 0;
        if (!touchesTrans) continue;

        const r = buf[p], g = buf[p + 1], b = buf[p + 2];
        // Muzzle flash is bright yellow-orange (r > 200 && g > 120).
        // The unwanted GIF dither fringe on the coat edge is a saturated dark-red/crimson (r > 90, g < 55, b < 45) or near-black (max < 28).
        const isRedFringe = (r > 70 && g < 55 && b < 45 && (r - g) > 45);
        const isDarkSpeck = Math.max(r, g, b) < 26;
        if (isRedFringe || isDarkSpeck) {
          toClear.push(idx);
        }
      }
    }
    for (const idx of toClear) {
      buf[idx * 4 + 3] = 0;
    }
  }
}

/**
 * Computes LMB bounding box and spine/boot horizontal center (ignoring outstretched gun/muzzle flash at chest level).
 */
function getLmbMetrics(buf, w, h) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const height = Math.max(1, maxY - minY + 1);
  // Sample horizontal center strictly from Head (10%..24% Y) and Lower Legs/Boots (70%..95% Y)
  // so the extended pistol & muzzle flash at chest height (30%..60% Y) never shift Commander's body!
  const headY0 = Math.floor(minY + height * 0.10);
  const headY1 = Math.ceil(minY + height * 0.24);
  const legY0 = Math.floor(minY + height * 0.70);
  const legY1 = Math.ceil(minY + height * 0.95);

  let sumX = 0, count = 0;
  for (let y = headY0; y <= headY1; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (buf[(y * w + x) * 4 + 3] > 128) {
        sumX += x;
        count++;
      }
    }
  }
  for (let y = legY0; y <= legY1; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (buf[(y * w + x) * 4 + 3] > 128) {
        sumX += x;
        count++;
      }
    }
  }
  const bodyCenterX = count > 0 ? sumX / count : (minX + maxX) / 2;
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height, bodyCenterX };
}

/**
 * Clean Ultimate Cast GIF Frame:
 * Removes opaque dark slate/charcoal/stone-tile background and detached Frame-5 side beam
 * while preserving Commander's body and golden holographic wristwatch/sigil/command slash VFX.
 */
function cleanUltimateFrame(buf, w, h, dir, frameIdx) {
  // 1. Mask out detached side-beam / rock impacts in Frame 5 and outer tile corners
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maskOut = false;
      // Outer canvas margins where Commander & his sigil never reach
      if (x < 45 || x > w - 45 || y > 455) maskOut = true;
      if (dir === 'back' && (x < 145 || x > 395 || y > 418)) maskOut = true;
      if (frameIdx === 5) {
        if (dir === 'left' && x < 244) maskOut = true;
        if (dir === 'right' && x > 261) maskOut = true;
        if (dir === 'back') {
          // Mask out overhead sigil & right-hand slash arc from Frame 4 clone to create a spotless wide-stance recovery frame
          if (y < 154 || x > 286) maskOut = true;
        }
        if (dir === 'front') {
          // In Front[5] Commander is crouching low (hair top is at y=166); mask out vertical beam shaft above y=164
          if (y < 164 || x < 125 || x > 380) maskOut = true;
          const p = (y * w + x) * 4;
          const r = buf[p], g = buf[p + 1], b = buf[p + 2];
          if (y < 330 && (x < 176 || x > 332) && r < 195 && g < 135) maskOut = true;
        }
      }
      if (maskOut) {
        buf[(y * w + x) * 4 + 3] = 0;
      }
    }
  }

  // Sample interior background color at (20, 20) as well as corner (0, 0)
  const c0R = buf[0], c0G = buf[1], c0B = buf[2];
  const inIdx = (20 * w + 20) * 4;
  const bgR = buf[inIdx], bgG = buf[inIdx + 1], bgB = buf[inIdx + 2];

  const isBgPixel = (r, g, b, x, y) => {
    // Golden / warm holographic VFX or skin/coat/gold trim is NEVER background
    const isGoldenVfx = (r > 135 && g > 75 && (r - b) > 35);
    const isWhiteCoat = (r > 155 && g > 145 && b > 135);
    const isWarmSkinOrGold = (r > 95 && (r - b) > 25);
    if (isGoldenVfx || isWhiteCoat || isWarmSkinOrGold) return false;

    const distToInBg = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
    const distToCornerBg = Math.abs(r - c0R) + Math.abs(g - c0G) + Math.abs(b - c0B);
    if (distToInBg <= 38 || distToCornerBg <= 38) return true;

    if (dir === 'back') {
      // Back ultimate has a blue-gray stone tile floor (r=34..96, g=36..98, b=46..112) + muted green grass tufts
      const isCoolSlateTile = (b >= r - 4 && Math.abs(r - g) <= 16 && r >= 30 && r <= 98 && b <= 115);
      const isMutedGrass = (g >= r + 3 && g >= b - 5 && g < 125 && r < 105);
      const isFloorShadow = (y > 405 && Math.max(r, g, b) < 62);
      return isCoolSlateTile || isMutedGrass || isFloorShadow;
    } else {
      // Front, Left, Right have uniform dark purple-slate/navy background + dark floor shadow oval
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC - minC;
      // Purple-slate in front_ultimate is around (49, 44, 54) -> maxC=54, minC=44, sat=10, b >= r
      if (sat <= 22 && maxC <= 76 && b >= r - 8) return true;
      // Floor shadow oval under boots
      if (y > 395 && maxC <= 58 && sat <= 20) return true;
      return false;
    }
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (buf[p + 3] === 0) continue;
      if (isBgPixel(buf[p], buf[p + 1], buf[p + 2], x, y)) {
        buf[p + 3] = 0;
      }
    }
  }

  // Remove isolated background specks/grass (< 95 pixels) not connected to Commander or main sigil
  const visited = new Uint8Array(w * h);
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const sIdx = sy * w + sx;
      if (visited[sIdx] || buf[sIdx * 4 + 3] === 0) continue;
      const comp = [sIdx];
      visited[sIdx] = 1;
      let head = 0;
      while (head < comp.length) {
        const idx = comp[head++];
        const x = idx % w;
        const y = (idx - x) / w;
        const nbs = [
          x > 0 ? idx - 1 : -1,
          x < w - 1 ? idx + 1 : -1,
          y > 0 ? idx - w : -1,
          y < h - 1 ? idx + w : -1
        ];
        for (const nb of nbs) {
          if (nb >= 0 && !visited[nb] && buf[nb * 4 + 3] > 0) {
            visited[nb] = 1;
            comp.push(nb);
          }
        }
      }
      if (comp.length < 95) {
        for (const idx of comp) {
          buf[idx * 4 + 3] = 0;
        }
      }
    }
  }

  // Soften 1px outer boundary where dark background met golden glow or coat outline
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const p = idx * 4;
      if (buf[p + 3] === 0) continue;
      const touchesTrans =
        buf[(idx - 1) * 4 + 3] === 0 ||
        buf[(idx + 1) * 4 + 3] === 0 ||
        buf[(idx - w) * 4 + 3] === 0 ||
        buf[(idx + w) * 4 + 3] === 0;
      if (touchesTrans) {
        const r = buf[p], g = buf[p + 1], b = buf[p + 2];
        if (r > b && r < 120 && (r - b) < 35 && Math.max(r, g, b) < 95) {
          buf[p + 3] = 110;
        }
      }
    }
  }
}

async function buildLmbSheets() {
  console.log('1. Building 4-Directional LMB Pistol Attack Sprite Sheets (4 frames each, 1024x256)...');
  const dirs = ['front', 'back', 'left', 'right'];

  for (const dir of dirs) {
    const gifPath = path.join(LMB_RAW_DIR, `commander_${dir}_attack_4frames.gif`);
    const meta = await sharp(gifPath, { animated: true }).metadata();
    const { data, info } = await sharp(gifPath, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = meta.width;
    const h = meta.pageHeight || (info.height / 4);
    const pages = meta.pages || 4;

    const frames = [];
    for (let p = 0; p < pages; p++) {
      const frameBuf = Buffer.from(data.subarray(p * w * h * 4, (p + 1) * w * h * 4));
      cleanLmbFrame(frameBuf, w, h);
      const metrics = getLmbMetrics(frameBuf, w, h);
      frames.push({ frameBuf, metrics });
    }

    // Use Frame 0's character height for uniform scaling across all 4 frames, capped so widest muzzle-flash frame fits in 256x256
    let maxW = 0, maxH = 0;
    for (const f of frames) {
      if (f.metrics.width > maxW) maxW = f.metrics.width;
      if (f.metrics.height > maxH) maxH = f.metrics.height;
    }
    const uniformScale = Math.min(
      TARGET_CHAR_HEIGHT / frames[0].metrics.height,
      (CELL_SIZE - 4) / maxW,
      (CELL_SIZE - 4) / maxH
    );
    const sheetComposites = [];

    for (let p = 0; p < pages; p++) {
      const { frameBuf, metrics } = frames[p];
      const scaledW = Math.max(1, Math.round(metrics.width * uniformScale));
      const scaledH = Math.max(1, Math.round(metrics.height * uniformScale));

      const resized = await sharp(frameBuf, { raw: { width: w, height: h, channels: 4 } })
        .extract({ left: metrics.minX, top: metrics.minY, width: metrics.width, height: metrics.height })
        .resize(scaledW, scaledH, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();

      const relBodyCenterX = (metrics.bodyCenterX - metrics.minX) * uniformScale;
      const leftInCell = Math.max(0, Math.min(CELL_SIZE - scaledW, Math.round(CELL_SIZE / 2 - relBodyCenterX)));
      const topInCell = Math.max(0, Math.min(CELL_SIZE - scaledH, GROUND_Y - scaledH));

      sheetComposites.push({
        input: resized,
        left: p * CELL_SIZE + leftInCell,
        top: topInCell
      });
    }

    const outPath = path.join(COMMANDER_DIR, `commander_attack_${dir}.png`);
    await sharp({
      create: { width: CELL_SIZE * pages, height: CELL_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(sheetComposites)
      .png()
      .toFile(outPath);

    console.log(`  -> Wrote ${outPath} (1024x256, scale=${uniformScale.toFixed(3)})`);
  }
}

async function buildUltimateSheets() {
  console.log('2. Building 4-Directional Ultimate Orbital Strike Sprite Sheets (6 frames each, 1536x256)...');
  const dirs = ['front', 'back', 'left', 'right'];

  for (const dir of dirs) {
    const gifPath = path.join(ULT_RAW_DIR, `commander_${dir}_ultimate_cast_6frames.gif`);
    const meta = await sharp(gifPath, { animated: true }).metadata();
    const { data, info } = await sharp(gifPath, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = meta.width;
    const h = meta.pageHeight || (info.height / 6);
    const pages = meta.pages || 6;

    const frames = [];
    for (let p = 0; p < pages; p++) {
      // For 'back' Frame 5 (where raw GIF drew an explosion directly over Commander's head/back),
      // derive the clean wide-stance recovery pose from Frame 4 with the overhead sigil & slash arc removed
      const srcPage = (dir === 'back' && p === 5) ? 4 : p;
      const frameBuf = Buffer.from(data.subarray(srcPage * w * h * 4, (srcPage + 1) * w * h * 4));
      cleanUltimateFrame(frameBuf, w, h, dir, p);
      const metrics = getLmbMetrics(frameBuf, w, h);
      frames.push({ frameBuf, metrics });
    }

    // Measure Frame 0 (pure standing pose without overhead sigil) so Commander's body matches his standard height,
    // while capping uniformScale so the tallest overhead sigil frame (Frame 3) fits cleanly inside 256x256!
    let maxW = 0, maxH = 0;
    for (const f of frames) {
      if (f.metrics.width > maxW) maxW = f.metrics.width;
      if (f.metrics.height > maxH) maxH = f.metrics.height;
    }
    const f0 = frames[0].metrics;
    const targetBodyHeight = 206;
    const uniformScale = Math.min(
      targetBodyHeight / f0.height,
      (CELL_SIZE - 4) / maxW,
      (CELL_SIZE - 4) / maxH
    );
    const refBodyCenterX = f0.bodyCenterX;
    const refBootBottomY = f0.maxY;

    const sheetComposites = [];

    for (let p = 0; p < pages; p++) {
      const { frameBuf, metrics } = frames[p];
      const scaledW = Math.max(1, Math.round(metrics.width * uniformScale));
      const scaledH = Math.max(1, Math.round(metrics.height * uniformScale));

      const resized = await sharp(frameBuf, { raw: { width: w, height: h, channels: 4 } })
        .extract({ left: metrics.minX, top: metrics.minY, width: metrics.width, height: metrics.height })
        .resize(scaledW, scaledH, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();

      // Anchor horizontally by Frame 0's body center, and anchor boots to GROUND_Y (252)
      const relAnchorX = (refBodyCenterX - metrics.minX) * uniformScale;
      const leftInCell = Math.max(0, Math.min(CELL_SIZE - scaledW, Math.round(CELL_SIZE / 2 - relAnchorX)));
      const topInCell = Math.max(0, Math.min(CELL_SIZE - scaledH, GROUND_Y - scaledH));

      sheetComposites.push({
        input: resized,
        left: p * CELL_SIZE + leftInCell,
        top: topInCell
      });
    }

    const outPath = path.join(COMMANDER_DIR, `commander_ult_${dir}.png`);
    await sharp({
      create: { width: CELL_SIZE * pages, height: CELL_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(sheetComposites)
      .png()
      .toFile(outPath);

    console.log(`  -> Wrote ${outPath} (1536x256, scale=${uniformScale.toFixed(3)})`);
  }
}

async function buildContactSheetPreview() {
  const dirs = ['front', 'back', 'left', 'right'];
  const composites = [];
  for (let i = 0; i < 4; i++) {
    composites.push({ input: path.join(COMMANDER_DIR, `commander_attack_${dirs[i]}.png`), left: 0, top: i * 256 });
    composites.push({ input: path.join(COMMANDER_DIR, `commander_ult_${dirs[i]}.png`), left: 0, top: (4 + i) * 256 });
  }
  const out = path.join(ART_DIR, 'normalized_combat_contact_sheet.png');
  await sharp({
    create: { width: 1536, height: 2048, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } }
  })
    .composite(composites)
    .png()
    .toFile(out);
  console.log('3. Wrote verification contact sheet to', out);
}

(async () => {
  await buildLmbSheets();
  await buildUltimateSheets();
  await buildContactSheetPreview();
})();
