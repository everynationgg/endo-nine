const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COMMANDER_DIR = path.join(__dirname, '..', 'public', 'assets', 'commander');
const JUMP_RAW_DIR = path.join(COMMANDER_DIR, 'jump_raw');
const GLIDE_RAW_DIR = path.join(COMMANDER_DIR, 'jetpack_raw');
const UPLOADED_PORTRAIT = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1794074461590_5198eb92.jpg';
const ART_DIR = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82';

const CELL_SIZE = 256;
const TARGET_HEIGHT = 248;
const GROUND_Y = 254;
const HEAD_TOP_Y = 6;

function getBoundingBox(buf, w, h, alphaThreshold = 24) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { minX: 0, maxX: w - 1, minY: 0, maxY: h - 1, width: w, height: h, centerX: w / 2 };

  // Upper-body horizontal center of mass (15%..55% height) so cape/leg swing doesn't sway torso
  const bandY0 = Math.floor(minY + (maxY - minY) * 0.15);
  const bandY1 = Math.ceil(minY + (maxY - minY) * 0.55);
  let sumX = 0, count = 0;
  for (let y = bandY0; y <= bandY1; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (buf[(y * w + x) * 4 + 3] >= 128) {
        sumX += x;
        count++;
      }
    }
  }
  const centerX = count > 0 ? sumX / count : (minX + maxX) / 2;
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX
  };
}

/**
 * Softens 1-bit GIF white/gray dither rim around the blue boot flames (lower region of glide frames)
 * into smooth semi-transparent cyan glow while keeping the dark boots and bright cyan flame core intact.
 */
function refineGlideFlameHalo(buf, w, h) {
  const flameZoneStartY = Math.floor(h * 0.72); // Below knees/shins where blue boot flames emerge
  for (let y = flameZoneStartY; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const a = buf[p + 3];
      if (a === 0) continue;
      const r = buf[p], g = buf[p + 1], b = buf[p + 2];
      // Pale low-saturation white/gray outer rim from GIF thresholding
      const minC = Math.min(r, g, b);
      const cyanExcess = b - r;
      if (minC >= 195 && cyanExcess < 42) {
        // Convert chalky white rim into soft cyan glow with reduced alpha
        const glowStrength = Math.max(0, Math.min(1, cyanExcess / 42));
        buf[p] = Math.round(r * 0.4 + 56 * 0.6);
        buf[p + 1] = Math.round(g * 0.7 + 189 * 0.3);
        buf[p + 2] = 255;
        buf[p + 3] = Math.round(a * glowStrength * 0.55);
      }
    }
  }
}

async function buildPortraitAndStandingIdle() {
  console.log('1. Updating Commander Portrait & Standing Idle Sprites...');
  if (fs.existsSync(UPLOADED_PORTRAIT)) {
    const portraitOut = path.join(COMMANDER_DIR, 'commander_portrait.png');
    await sharp(UPLOADED_PORTRAIT)
      .png()
      .toFile(portraitOut);
    console.log('  -> Wrote new Commander portrait to', portraitOut);
  } else {
    console.warn('  ! Uploaded portrait not found at', UPLOADED_PORTRAIT);
  }

  const standingBackRaw = path.join(JUMP_RAW_DIR, 'commander standing back.png');
  const { data, info } = await sharp(standingBackRaw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = getBoundingBox(data, info.width, info.height);
  const scale = TARGET_HEIGHT / bbox.height;
  const scaledW = Math.max(1, Math.round(bbox.width * scale));
  const scaledH = Math.max(1, Math.round(bbox.height * scale));

  const cropped = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: bbox.minX, top: bbox.minY, width: bbox.width, height: bbox.height })
    .resize(scaledW, scaledH, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  const relCenterX = (bbox.centerX - bbox.minX) * scale;
  const leftOffset = Math.max(0, Math.min(CELL_SIZE - scaledW, Math.round(CELL_SIZE / 2 - relCenterX)));
  const topOffset = Math.max(0, Math.min(CELL_SIZE - scaledH, GROUND_Y - scaledH));

  const idlePng = await sharp({
    create: { width: CELL_SIZE, height: CELL_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: cropped, left: leftOffset, top: topOffset }])
    .png()
    .toBuffer();

  for (const dir of ['back', 'front', 'left', 'right']) {
    const outPath = path.join(COMMANDER_DIR, `commander_${dir}.png`);
    fs.writeFileSync(outPath, idlePng);
  }
  console.log('  -> Replaced commander_{back,front,left,right}.png with normalized 256x256 standing back sprite');
}

async function buildJumpSheets() {
  console.log('2. Building 4-Directional Jump Sprite Sheets (4 frames each, 1024x256)...');
  const dirs = ['front', 'back', 'left', 'right'];

  for (const dir of dirs) {
    const gifPath = path.join(JUMP_RAW_DIR, `commander_${dir}_jump_4frames.gif`);
    const meta = await sharp(gifPath, { animated: true }).metadata();
    const { data, info } = await sharp(gifPath, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = meta.width;
    const h = meta.pageHeight || (info.height / 4);
    const pages = meta.pages || 4;

    const frames = [];
    let maxFrameHeight = 0;
    for (let p = 0; p < pages; p++) {
      const frameBuf = Buffer.from(data.subarray(p * w * h * 4, (p + 1) * w * h * 4));
      const bbox = getBoundingBox(frameBuf, w, h);
      if (bbox.height > maxFrameHeight) maxFrameHeight = bbox.height;
      frames.push({ frameBuf, bbox });
    }

    // Use a single uniform scale per direction so Commander's head/torso never changes size between crouch & airborne frames
    const uniformScale = (TARGET_HEIGHT - 2) / maxFrameHeight;
    const sheetComposites = [];

    for (let p = 0; p < pages; p++) {
      const { frameBuf, bbox } = frames[p];
      const scaledW = Math.max(1, Math.round(bbox.width * uniformScale));
      const scaledH = Math.max(1, Math.round(bbox.height * uniformScale));

      const resizedFrame = await sharp(frameBuf, { raw: { width: w, height: h, channels: 4 } })
        .extract({ left: bbox.minX, top: bbox.minY, width: bbox.width, height: bbox.height })
        .resize(scaledW, scaledH, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();

      const relCenterX = (bbox.centerX - bbox.minX) * uniformScale;
      const leftInCell = Math.max(0, Math.min(CELL_SIZE - scaledW, Math.round(CELL_SIZE / 2 - relCenterX)));

      // Anchor around torso/head trajectory so transitioning between Jump Ascent, Glide, and Jump Descent
      // in mid-air never pops Commander's body vertically by 30+ pixels.
      const topOffsetsByFrame = [14, 6, 6, 12];
      const topInCell = Math.max(0, Math.min(CELL_SIZE - scaledH, topOffsetsByFrame[p] ?? HEAD_TOP_Y));

      sheetComposites.push({
        input: resizedFrame,
        left: p * CELL_SIZE + leftInCell,
        top: topInCell
      });
    }

    const outPath = path.join(COMMANDER_DIR, `commander_jump_${dir}.png`);
    await sharp({
      create: { width: CELL_SIZE * pages, height: CELL_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(sheetComposites)
      .png()
      .toFile(outPath);

    console.log(`  -> Wrote ${outPath} (${CELL_SIZE * pages}x${CELL_SIZE}, uniformScale=${uniformScale.toFixed(3)})`);
  }
}

async function buildGlideSheets() {
  console.log('3. Building 4-Directional Jet-Boot Glide Sprite Sheets (8 frames each, 2048x256)...');
  const dirs = ['front', 'back', 'left', 'right'];

  for (const dir of dirs) {
    const gifPath = path.join(GLIDE_RAW_DIR, `commander_${dir}_glide_8frames.gif`);
    const meta = await sharp(gifPath, { animated: true }).metadata();
    const { data, info } = await sharp(gifPath, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = meta.width;
    const h = meta.pageHeight || (info.height / 8);
    const pages = meta.pages || 8;

    const frames = [];
    let maxFrameHeight = 0;
    for (let p = 0; p < pages; p++) {
      const frameBuf = Buffer.from(data.subarray(p * w * h * 4, (p + 1) * w * h * 4));
      refineGlideFlameHalo(frameBuf, w, h);
      const bbox = getBoundingBox(frameBuf, w, h, 24);
      if (bbox.height > maxFrameHeight) maxFrameHeight = bbox.height;
      frames.push({ frameBuf, bbox });
    }

    // Use a single uniform scale per direction and lock head top to HEAD_TOP_Y (6)
    // so Commander's airborne posture stays 100% rock-stable while blue boot flames pulsate underneath
    const uniformScale = TARGET_HEIGHT / maxFrameHeight;
    const sheetComposites = [];

    // Use Frame 0's horizontal torso center relative to its minX so there is zero horizontal micro-jitter across the 8 frames
    const refCenterOffset = frames[0].bbox.centerX - frames[0].bbox.minX;

    for (let p = 0; p < pages; p++) {
      const { frameBuf, bbox } = frames[p];
      const scaledW = Math.max(1, Math.round(bbox.width * uniformScale));
      const scaledH = Math.max(1, Math.round(bbox.height * uniformScale));

      const resizedFrame = await sharp(frameBuf, { raw: { width: w, height: h, channels: 4 } })
        .extract({ left: bbox.minX, top: bbox.minY, width: bbox.width, height: bbox.height })
        .resize(scaledW, scaledH, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();

      const relCenterX = refCenterOffset * uniformScale;
      const leftInCell = Math.max(0, Math.min(CELL_SIZE - scaledW, Math.round(CELL_SIZE / 2 - relCenterX)));
      const topInCell = HEAD_TOP_Y;

      sheetComposites.push({
        input: resizedFrame,
        left: p * CELL_SIZE + leftInCell,
        top: topInCell
      });
    }

    const outPath = path.join(COMMANDER_DIR, `commander_glide_${dir}.png`);
    await sharp({
      create: { width: CELL_SIZE * pages, height: CELL_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(sheetComposites)
      .png()
      .toFile(outPath);

    console.log(`  -> Wrote ${outPath} (${CELL_SIZE * pages}x${CELL_SIZE}, uniformScale=${uniformScale.toFixed(3)})`);
  }
}

async function buildVerificationContactSheet() {
  const dirs = ['front', 'back', 'left', 'right'];
  const composites = [];
  for (let i = 0; i < 4; i++) {
    const jumpPath = path.join(COMMANDER_DIR, `commander_jump_${dirs[i]}.png`);
    const glidePath = path.join(COMMANDER_DIR, `commander_glide_${dirs[i]}.png`);
    composites.push({ input: jumpPath, left: 0, top: i * 256 });
    composites.push({ input: glidePath, left: 0, top: (4 + i) * 256 });
  }
  const out = path.join(ART_DIR, 'normalized_jump_glide_contact_sheet.png');
  await sharp({
    create: { width: 2048, height: 2048, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } }
  })
    .composite(composites)
    .png()
    .toFile(out);
  console.log('4. Wrote normalized verification contact sheet to', out);
}

(async () => {
  await buildPortraitAndStandingIdle();
  await buildJumpSheets();
  await buildGlideSheets();
  await buildVerificationContactSheet();
})();
