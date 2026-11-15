import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function analyze() {
  const file = 'C:/Users/yoggn/Downloads/Errant Night Roles/doctor 4.png';
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  console.log('Image dimensions:', info.width, 'x', info.height);

  const quadW = Math.floor(info.width / 4); // 384
  const w = info.width;
  const h = info.height;

  for (let c = 0; c < 4; c++) {
    const xMin = c * quadW;
    const xMax = (c + 1) * quadW;
    console.log(`\n--- Column ${c} (${xMin} to ${xMax}) ---`);

    // Let's sample the background at (xMin + 30, 100), (xMin + quadW/2, 100), (xMax - 30, 100)
    for (const testX of [xMin + 30, xMin + Math.floor(quadW/2), xMax - 30]) {
      const idx = (120 * w + testX) * 3;
      console.log(`  Sample at (${testX}, 120):`, data[idx], data[idx+1], data[idx+2]);
    }
  }
}

analyze().catch(console.error);

