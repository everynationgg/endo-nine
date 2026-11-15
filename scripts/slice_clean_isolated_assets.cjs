const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function extractCleanAssets(filename, prefix, minPixelCount = 2000, alphaThreshold = 35) {
  const filePath = path.join('public/assets/environment', filename);
  const outDir = path.join('public/assets/environment/extracted');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Processing: ${filename}...`);
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Build binary mask based on alpha threshold
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = channels === 4 ? data[i * channels + 3] : 255;
    // Also if rgb is nearly pure white (e.g. background in some sheets)
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    const isWhiteBg = (r > 248 && g > 248 && b > 248);
    if (a >= alphaThreshold && !isWhiteBg) {
      mask[i] = 1;
    }
  }

  // Connected Component Labeling (Union-Find or BFS)
  const labels = new Int32Array(width * height).fill(0);
  let currentLabel = 0;
  const components = [];

  // Downsample grid for fast connected component labeling
  const scale = 2;
  const dw = Math.floor(width / scale);
  const dh = Math.floor(height / scale);
  const dgrid = new Uint8Array(dw * dh);

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let count = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const ox = x * scale + sx;
          const oy = y * scale + sy;
          if (ox < width && oy < height && mask[oy * width + ox] === 1) {
            count++;
          }
        }
      }
      if (count >= 2) dgrid[y * dw + x] = 1;
    }
  }

  const dvisited = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const idx = y * dw + x;
      if (dgrid[idx] === 1 && dvisited[idx] === 0) {
        currentLabel++;
        let minX = x, maxX = x, minY = y, maxY = y;
        let pCount = 0;
        const queue = [idx];
        dvisited[idx] = currentLabel;

        while (queue.length > 0) {
          const curr = queue.pop();
          const cx = curr % dw;
          const cy = Math.floor(curr / dw);
          pCount++;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // 8-neighbor connectivity for smooth grouping
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < dw && ny >= 0 && ny < dh) {
                const nIdx = ny * dw + nx;
                if (dgrid[nIdx] === 1 && dvisited[nIdx] === 0) {
                  dvisited[nIdx] = currentLabel;
                  queue.push(nIdx);
                }
              }
            }
          }
        }

        if (pCount * (scale * scale) >= minPixelCount) {
          components.push({
            id: currentLabel,
            minX: Math.max(0, minX * scale - 4),
            maxX: Math.min(width - 1, (maxX + 1) * scale + 4),
            minY: Math.max(0, minY * scale - 4),
            maxY: Math.min(height - 1, (maxY + 1) * scale + 4),
            area: pCount * (scale * scale)
          });
        }
      }
    }
  }

  // Sort components by size (descending)
  components.sort((a, b) => b.area - a.area);
  console.log(`Found ${components.length} components with area >= ${minPixelCount}`);

  for (let c = 0; c < components.length; c++) {
    const comp = components[c];
    const cw = comp.maxX - comp.minX + 1;
    const ch = comp.maxY - comp.minY + 1;
    const outBuf = Buffer.alloc(cw * ch * 4); // All zeros = fully transparent

    for (let y = comp.minY; y <= comp.maxY; y++) {
      const dy = Math.floor(y / scale);
      for (let x = comp.minX; x <= comp.maxX; x++) {
        const dx = Math.floor(x / scale);
        // Only include pixel if its downsampled cell belongs to this component!
        if (dvisited[dy * dw + dx] === comp.id) {
          const srcIdx = (y * width + x) * channels;
          const dstIdx = ((y - comp.minY) * cw + (x - comp.minX)) * 4;
          outBuf[dstIdx] = data[srcIdx];
          outBuf[dstIdx + 1] = data[srcIdx + 1];
          outBuf[dstIdx + 2] = data[srcIdx + 2];
          outBuf[dstIdx + 3] = channels === 4 ? data[srcIdx + 3] : 255;
        }
      }
    }

    const outName = `${prefix}_${c + 1}.png`;
    const outPath = path.join(outDir, outName);

    await sharp(outBuf, { raw: { width: cw, height: ch, channels: 4 } })
      .trim()
      .png()
      .toFile(outPath);

    const meta = await sharp(outPath).metadata();
    console.log(`   Saved cleanly: ${outName} (${meta.width}x${meta.height})`);
  }
}

async function main() {
  await extractCleanAssets('Alien Rock and Crystal Asset Sheet-1.png', 'rock_crystal_sheet1', 2500, 35);
  await extractCleanAssets('Alien Crystal Rock Asset Sheet-2.png', 'rock_crystal_sheet2', 2500, 35);
  await extractCleanAssets('Sci-Fi Alien Rocks and Crystals Asset Sheet-3.png', 'rock_crystal_sheet3', 2500, 35);
}

main().catch(console.error);
