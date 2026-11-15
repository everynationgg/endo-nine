import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir = 'public/assets/doctor';
fs.mkdirSync(outDir, { recursive: true });

async function processView(name, sliceInfo, srcData, srcW, srcH) {
  const { xStart, yStart, width, height } = sliceInfo;
  console.log(`Processing ${name}: x=${xStart}, y=${yStart}, w=${width}, h=${height}`);

  const sliceRgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = ((yStart + y) * srcW + (xStart + x)) * 3;
      const dstIdx = (y * width + x) * 3;
      sliceRgb[dstIdx] = srcData[srcIdx];
      sliceRgb[dstIdx + 1] = srcData[srcIdx + 1];
      sliceRgb[dstIdx + 2] = srcData[srcIdx + 2];
    }
  }

  // BFS flood-fill background
  const isBg = new Uint8Array(width * height);
  const queue = [];

  function isBgPixel(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (y * width + x) * 3;
    const r = sliceRgb[idx];
    const g = sliceRgb[idx + 1];
    const b = sliceRgb[idx + 2];

    const maxDiff = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));

    // Floor shadow at feet (bottom 75px): low saturation neutral grey
    if (y > height - 75) {
      if (r > 120 && g > 120 && b > 120 && maxDiff < 14) return true;
    }
    // General background: light neutral off-white/gray
    return r > 200 && g > 200 && b > 200 && maxDiff < 18;
  }

  function pushSeed(x, y) {
    const sIdx = y * width + x;
    if (isBg[sIdx]) return;
    if (isBgPixel(x, y)) {
      isBg[sIdx] = 1;
      queue.push((y << 16) | x);
    }
  }

  for (let x = 0; x < width; x++) {
    pushSeed(x, 0);
    pushSeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushSeed(0, y);
    pushSeed(width - 1, y);
  }

  let head = 0;
  while (head < queue.length) {
    const val = queue[head++];
    const x = val & 0xffff;
    const y = val >> 16;

    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (!isBg[nIdx] && isBgPixel(nx, ny)) {
          isBg[nIdx] = 1;
          queue.push((ny << 16) | nx);
        }
      }
    }
  }

  // Find largest connected component of NON-BACKGROUND pixels to discard stray frame flecks
  const visitedFg = new Uint8Array(width * height);
  let bestComp = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (isBg[idx] || visitedFg[idx]) continue;

      const comp = [];
      const fgQueue = [(y << 16) | x];
      visitedFg[idx] = 1;

      let fgHead = 0;
      while (fgHead < fgQueue.length) {
        const val = fgQueue[fgHead++];
        const cx = val & 0xffff;
        const cy = val >> 16;
        comp.push(val);

        const neighbors = [
          [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (!isBg[nIdx] && !visitedFg[nIdx]) {
              visitedFg[nIdx] = 1;
              fgQueue.push((ny << 16) | nx);
            }
          }
        }
      }

      if (comp.length > bestComp.length) {
        bestComp = comp;
      }
    }
  }

  // Create clean mask where only the main character silhouette is kept
  const charMask = new Uint8Array(width * height);
  for (const val of bestComp) {
    const cx = val & 0xffff;
    const cy = val >> 16;
    charMask[cy * width + cx] = 1;
  }

  // Build RGBA with soft edge feathering
  const outRgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sIdx = idx * 3;
      const dIdx = idx * 4;

      outRgba[dIdx] = sliceRgb[sIdx];
      outRgba[dIdx + 1] = sliceRgb[sIdx + 1];
      outRgba[dIdx + 2] = sliceRgb[sIdx + 2];

      if (charMask[idx]) {
        let isEdge = false;
        for (const [nx, ny] of [[x+1, y], [x-1, y], [x, y+1], [x, y-1]]) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !charMask[ny * width + nx]) {
            isEdge = true;
            break;
          }
        }
        outRgba[dIdx + 3] = isEdge ? 210 : 255;
      } else {
        outRgba[dIdx + 3] = 0;
      }
    }
  }

  // Save trimmed and anchored to bottom at 256x256
  const outPath = path.join(outDir, `${name}.png`);
  await sharp(outRgba, { raw: { width, height, channels: 4 } })
    .trim()
    .resize(256, 256, {
      fit: 'contain',
      position: 'bottom',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(outPath);

  console.log(`Saved ${outPath}`);
}

async function run() {
  const file = 'C:/Users/yoggn/Downloads/Errant Night Roles/doctor 4.png';
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });

  const views = [
    { name: 'doctor_front', xStart: 30, yStart: 135, width: 326, height: 750 },
    { name: 'doctor_back', xStart: 418, yStart: 135, width: 312, height: 750 },
    { name: 'doctor_left', xStart: 800, yStart: 135, width: 320, height: 750 },
    { name: 'doctor_right', xStart: 1180, yStart: 135, width: 320, height: 750 }
  ];

  for (const v of views) {
    await processView(v.name, v, data, info.width, info.height);
  }

  // Also extract official portrait
  const portraitFile = 'C:/Users/yoggn/Downloads/Errant Night Roles/doctor.png';
  await sharp(portraitFile)
    .resize(512, 512, { fit: 'cover' })
    .png()
    .toFile(path.join(outDir, 'doctor_portrait.png'));
  console.log('Saved doctor_portrait.png');
}

run().catch(console.error);
