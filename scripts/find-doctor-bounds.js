import sharp from 'sharp';

async function findBounds() {
  const file = 'C:/Users/yoggn/Downloads/Errant Night Roles/doctor 4.png';
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Let's inspect each quadrant roughly:
  // Col 0: Front
  // Col 1: Back
  // Col 2: Left
  // Col 3: Right
  const cols = [
    { name: 'front', xStart: 25, xEnd: 360 },
    { name: 'back', xStart: 410, xEnd: 745 },
    { name: 'left', xStart: 795, xEnd: 1130 },
    { name: 'right', xStart: 1180, xEnd: 1510 }
  ];

  for (const c of cols) {
    let minX = w, maxX = 0, minY = h, maxY = 0;
    // Check pixels inside
    for (let y = 140; y < 880; y++) {
      for (let x = c.xStart; x < c.xEnd; x++) {
        const idx = (y * w + x) * 3;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // Background in this region is typically light grayish (r > 218 && g > 215 && b > 215 && abs(r-g) < 12 && abs(r-b) < 12)
        // If it's noticeably different or darker, it's character
        const isBg = (r > 215 && g > 212 && b > 212 && Math.abs(r - g) < 12 && Math.abs(r - b) < 15);
        if (!isBg) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    console.log(`${c.name}: X=[${minX}, ${maxX}] (w=${maxX - minX}), Y=[${minY}, ${maxY}] (h=${maxY - minY})`);
  }
}

findBounds().catch(console.error);

