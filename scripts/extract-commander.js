import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";
const outputDir = path.resolve('public/assets/commander');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function extractSprites() {
  const image = sharp(inputPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Slices: Front, Back, Right, Left
  const slices = [
    { name: 'front', xStart: 0, xEnd: 268 },
    { name: 'back', xStart: 269, xEnd: 516 },
    { name: 'right', xStart: 517, xEnd: 760 },
    { name: 'left', xStart: 761, xEnd: 1024 }
  ];

  const processedSprites = [];

  for (const slice of slices) {
    const sw = slice.xEnd - slice.xStart;
    const sh = h;
    const rgba = Buffer.alloc(sw * sh * 4);
    const isBg = new Uint8Array(sw * sh); // 1 if exterior background

    // Fill RGBA from original
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        const origX = slice.xStart + sx;
        const origIdx = (sy * w + origX) * 3;
        const sIdx = (sy * sw + sx) * 4;

        rgba[sIdx] = data[origIdx];
        rgba[sIdx + 1] = data[origIdx + 1];
        rgba[sIdx + 2] = data[origIdx + 2];
        rgba[sIdx + 3] = 255;
      }
    }

    // BFS queue for flood fill from edges
    const queue = [];
    const threshold = 18; // Background is 0, allow minor jpeg compression artifacts

    function checkAndPush(sx, sy) {
      if (sx < 0 || sx >= sw || sy < 0 || sy >= sh) return;
      const sIdx = sy * sw + sx;
      if (isBg[sIdx]) return;
      const rIdx = sIdx * 4;
      const maxC = Math.max(rgba[rIdx], rgba[rIdx + 1], rgba[rIdx + 2]);
      if (maxC <= threshold) {
        isBg[sIdx] = 1;
        queue.push((sy << 16) | sx);
      }
    }

    // Push all 4 borders of the slice
    for (let sx = 0; sx < sw; sx++) {
      checkAndPush(sx, 0);
      checkAndPush(sx, sh - 1);
    }
    for (let sy = 0; sy < sh; sy++) {
      checkAndPush(0, sy);
      checkAndPush(sw - 1, sy);
    }

    // Run BFS
    let head = 0;
    while (head < queue.length) {
      const val = queue[head++];
      const sx = val & 0xFFFF;
      const sy = val >> 16;

      // 4-neighborhood
      checkAndPush(sx + 1, sy);
      checkAndPush(sx - 1, sy);
      checkAndPush(sx, sy + 1);
      checkAndPush(sx, sy - 1);
    }

    // Now set alpha = 0 for isBg
    for (let i = 0; i < sw * sh; i++) {
      if (isBg[i]) {
        rgba[i * 4 + 3] = 0;
      }
    }

    // Anti-alias edge fringe: pixels next to bg with low luminance get soft alpha
    for (let sy = 1; sy < sh - 1; sy++) {
      for (let sx = 1; sx < sw - 1; sx++) {
        const sIdx = sy * sw + sx;
        if (isBg[sIdx]) continue;

        // Check if neighboring any bg
        const hasBgNeighbor = isBg[sIdx - 1] || isBg[sIdx + 1] || isBg[sIdx - sw] || isBg[sIdx + sw];
        if (hasBgNeighbor) {
          const rIdx = sIdx * 4;
          const maxC = Math.max(rgba[rIdx], rgba[rIdx + 1], rgba[rIdx + 2]);
          if (maxC < 50) {
            // Feather alpha
            rgba[rIdx + 3] = Math.min(255, Math.max(0, Math.round((maxC / 50) * 255)));
          }
        }
      }
    }

    // Find tight bounding box of visible content
    let minX = sw, maxX = 0, minY = sh, maxY = 0;
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        const sIdx = (sy * sw + sx) * 4;
        if (rgba[sIdx + 3] > 10) {
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
      }
    }

    console.log(`Slice ${slice.name}: bbox [${minX}, ${minY}] to [${maxX}, ${maxY}] (w=${maxX - minX + 1}, h=${maxY - minY + 1})`);

    // Crop to bounding box with 4px padding
    const pad = 4;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(sw - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(sh - cropY, maxY - minY + 1 + pad * 2);

    // Extract cropped buffer
    const croppedRgba = Buffer.alloc(cropW * cropH * 4);
    for (let cy = 0; cy < cropH; cy++) {
      for (let cx = 0; cx < cropW; cx++) {
        const srcIdx = ((cropY + cy) * sw + (cropX + cx)) * 4;
        const dstIdx = (cy * cropW + cx) * 4;
        croppedRgba[dstIdx] = rgba[srcIdx];
        croppedRgba[dstIdx + 1] = rgba[srcIdx + 1];
        croppedRgba[dstIdx + 2] = rgba[srcIdx + 2];
        croppedRgba[dstIdx + 3] = rgba[srcIdx + 3];
      }
    }

    processedSprites.push({
      name: slice.name,
      width: cropW,
      height: cropH,
      rgba: croppedRgba,
      footBaseline: maxY - cropY
    });
  }

  // Find max height among all 4 to normalize canvas height and align feet
  const maxHeight = Math.max(...processedSprites.map(s => s.height));
  const maxWidth = Math.max(...processedSprites.map(s => s.width));
  console.log(`Max width: ${maxWidth}, Max height: ${maxHeight}`);

  // Create unified normalized sprites where bottom anchor is identical
  const targetH = maxHeight + 10;
  const targetW = maxWidth + 10;

  for (const sprite of processedSprites) {
    const finalBuffer = Buffer.alloc(targetW * targetH * 4);
    // Align bottom baseline
    const yOffset = targetH - sprite.height - 5;
    // Align horizontal center
    const xOffset = Math.round((targetW - sprite.width) / 2);

    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        const srcIdx = (y * sprite.width + x) * 4;
        const dstIdx = ((yOffset + y) * targetW + (xOffset + x)) * 4;
        finalBuffer[dstIdx] = sprite.rgba[srcIdx];
        finalBuffer[dstIdx + 1] = sprite.rgba[srcIdx + 1];
        finalBuffer[dstIdx + 2] = sprite.rgba[srcIdx + 2];
        finalBuffer[dstIdx + 3] = sprite.rgba[srcIdx + 3];
      }
    }

    const outPath = path.join(outputDir, `commander_${sprite.name}.png`);
    await sharp(finalBuffer, {
      raw: {
        width: targetW,
        height: targetH,
        channels: 4
      }
    }).png().toFile(outPath);

    console.log(`Saved ${outPath} (${targetW}x${targetH})`);
  }

  // Also create commander portrait for HUD from Front view
  // Head area of front view: y ~ 60 to 380, x ~ 20 to 260
  const portraitSize = 256;
  const frontSprite = processedSprites.find(s => s.name === 'front');
  // Crop the head & shoulders
  const headH = Math.round(frontSprite.height * 0.52);
  const headW = frontSprite.width;
  const headBuffer = Buffer.alloc(headW * headH * 4);
  for (let y = 0; y < headH; y++) {
    for (let x = 0; x < headW; x++) {
      const srcIdx = (y * frontSprite.width + x) * 4;
      const dstIdx = (y * headW + x) * 4;
      headBuffer[dstIdx] = frontSprite.rgba[srcIdx];
      headBuffer[dstIdx + 1] = frontSprite.rgba[srcIdx + 1];
      headBuffer[dstIdx + 2] = frontSprite.rgba[srcIdx + 2];
      headBuffer[dstIdx + 3] = frontSprite.rgba[srcIdx + 3];
    }
  }

  const portraitPath = path.join(outputDir, 'commander_portrait.png');
  await sharp(headBuffer, {
    raw: {
      width: headW,
      height: headH,
      channels: 4
    }
  })
  .resize(portraitSize, portraitSize, { fit: 'cover', position: 'top' })
  .png()
  .toFile(portraitPath);

  console.log(`Saved portrait to ${portraitPath}`);
}

extractSprites().catch(err => {
  console.error('Extraction error:', err);
  process.exit(1);
});

