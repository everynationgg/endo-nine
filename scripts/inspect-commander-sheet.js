import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function checkLayout() {
  const file = 'C:/Users/yoggn/Downloads/Ender Nine/Characters/Commander Female Sprite.png';
  const img = sharp(file);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  console.log(`Info: ${info.width}x${info.height}, channels: ${info.channels}`);

  // Downsample to 40x30 to see ASCII density layout
  const preview = await sharp(file).resize(60, 45).raw().toBuffer();
  for (let y = 0; y < 45; y += 2) {
    let line = '';
    for (let x = 0; x < 60; x++) {
      const a = preview[(y * 60 + x) * 4 + 3];
      line += a > 128 ? '#' : a > 30 ? '.' : ' ';
    }
    console.log(line);
  }
}
checkLayout();

