import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function checkValley() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  for (let x = 480; x < 530; x++) {
    let count = 0;
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 3;
      if (data[idx] > 10 || data[idx+1] > 10 || data[idx+2] > 10) count++;
    }
    console.log(`x=${x}: non-black=${count}`);
  }
}

checkValley();

