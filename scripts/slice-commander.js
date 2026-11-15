import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function sliceCommander() {
  const file = 'C:/Users/yoggn/Downloads/Ender Nine/Characters/Commander Female Sprite.png';
  const outDir = 'public/assets/commander';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const meta = await sharp(file).metadata();
  console.log('Commander Sprite dimensions:', meta.width, 'x', meta.height);

  const w = meta.width;
  const h = meta.height;
  const quadW = Math.floor(w / 4);

  const directions = [
    { name: 'commander_front.png', index: 0 },
    { name: 'commander_back.png', index: 1 },
    { name: 'commander_right.png', index: 2 }, // Column 2 faces right
    { name: 'commander_left.png', index: 3 }   // Column 3 faces left
  ];

  for (const dir of directions) {
    const left = dir.index * quadW;
    const width = Math.min(quadW, w - left);
    const outPath = path.join(outDir, dir.name);

    const buf = await sharp(file)
      .extract({ left, top: 0, width, height: h })
      .png()
      .toBuffer();

    await sharp(buf)
      .trim()
      .resize(256, 256, {
        fit: 'contain',
        position: 'bottom', // Anchor feet to bottom
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outPath);

    console.log(`Extracted quadrant ${dir.index} (${dir.name}): ${left} to ${left + width} -> ${outPath}`);
  }
}

sliceCommander().catch(console.error);
