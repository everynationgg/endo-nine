import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const uploadDir = 'C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded';
const files = fs.readdirSync(uploadDir).filter(f => f.startsWith('media_1793728'));

async function inspectAll() {
  for (const f of files) {
    const meta = await sharp(path.join(uploadDir, f)).metadata();
    const stats = await sharp(path.join(uploadDir, f)).stats();
    // print stats
    console.log(f, meta.format, meta.width + 'x' + meta.height, 'hasAlpha:', meta.hasAlpha);
  }
}
inspectAll();

