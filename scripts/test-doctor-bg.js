import sharp from 'sharp';

async function testFloodFill() {
  const file = 'C:/Users/yoggn/Downloads/Errant Night Roles/doctor 4.png';
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Let's test Front view
  const left = 20;
  const top = 140;
  const width = 360;
  const height = 750;

  // Extract raw RGB for Front view
  const sliceRgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = ((top + y) * w + (left + x)) * 3;
      const dstIdx = (y * width + x) * 3;
      sliceRgb[dstIdx] = data[srcIdx];
      sliceRgb[dstIdx + 1] = data[srcIdx + 1];
      sliceRgb[dstIdx + 2] = data[srcIdx + 2];
    }
  }

  // Flood fill from edges
  // Background pixels are characterized by high lightness and low saturation
  // e.g. r > 210, g > 210, b > 210 and Math.abs(r-g) < 16 && Math.abs(r-b) < 16
  const isBg = new Uint8Array(width * height);
  const queue = [];

  function isBgPixel(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (y * width + x) * 3;
    const r = sliceRgb[idx];
    const g = sliceRgb[idx + 1];
    const b = sliceRgb[idx + 2];

    // Background color: grayish off-white, light shadow near feet
    // Shadow under feet: y > height - 60, r > 180, g > 180, b > 180
    if (y > height - 70) {
      if (r > 175 && g > 175 && b > 175 && Math.abs(r - g) < 15 && Math.abs(r - b) < 15) return true;
    }
    return r > 208 && g > 208 && b > 208 && Math.abs(r - g) < 16 && Math.abs(r - b) < 18;
  }

  function pushSeed(x, y) {
    const sIdx = y * width + x;
    if (isBg[sIdx]) return;
    if (isBgPixel(x, y)) {
      isBg[sIdx] = 1;
      queue.push((y << 16) | x);
    }
  }

  // Border seeds
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

  // Build RGBA output
  const outRgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const sIdx = i * 3;
    const dIdx = i * 4;
    outRgba[dIdx] = sliceRgb[sIdx];
    outRgba[dIdx + 1] = sliceRgb[sIdx + 1];
    outRgba[dIdx + 2] = sliceRgb[sIdx + 2];
    outRgba[dIdx + 3] = isBg[i] ? 0 : 255;
  }

  await sharp(outRgba, { raw: { width, height, channels: 4 } })
    .png()
    .toFile('scratch/test_front_alpha.png');
  console.log('Saved scratch/test_front_alpha.png');
}

testFloodFill().catch(console.error);

