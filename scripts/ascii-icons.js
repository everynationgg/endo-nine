import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const uploadDir = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded';
const iconFiles = [
  'media_1793728540013_4353c21e.jpg',
  'media_1793728540015_a78165e4.jpg',
  'media_1793728540018_d6e741af.jpg',
  'media_1793728540022_b70b4094.jpg',
  'media_1793728540028_7a80c93f.jpg',
  'media_1793728547155_a2419efe.jpg',
  'media_1793728547160_4749d600.jpg',
  'media_1793728547174_b2b08b47.jpg',
  'media_1793728547183_05e30816.jpg',
  'media_1793728547185_baa75b40.jpg',
  'media_1793728556592_b2ff8f4d.jpg',
  'media_1793728556597_9a1b0fad.jpg',
  'media_1793728556609_24e6f01e.jpg'
];

async function inspectIcons() {
  for (const f of iconFiles) {
    // Generate an ascii art representation of the center 32x32 of each icon
    const img = sharp(path.join(uploadDir, f));
    const buf = await img.resize(32, 32).grayscale().raw().toBuffer();
    console.log(`\n=== ${f} ===`);
    for (let y = 0; y < 32; y += 2) {
      let line = '';
      for (let x = 0; x < 32; x++) {
        const v = buf[y * 32 + x];
        line += v > 200 ? '#' : v > 130 ? '*' : v > 70 ? '.' : ' ';
      }
      console.log(line);
    }
  }
}
inspectIcons();

