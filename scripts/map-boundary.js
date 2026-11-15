import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function mapBoundary() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  // Sample every 10 lines from y=50 to 720
  for (let y = 60; y <= 710; y += 20) {
    let rowStr = '';
    for (let x = 490; x <= 560; x += 2) {
      const idx = (y * w + x) * 3;
      const isBright = (data[idx] > 25 || data[idx+1] > 25 || data[idx+2] > 25);
      rowStr += isBright ? '#' : '.';
    }
    console.log(`y=${y.toString().padStart(3, '0')}: ${rowStr}`);
  }
}

mapBoundary();

