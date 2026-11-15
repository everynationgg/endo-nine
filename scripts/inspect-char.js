import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function inspectCharacterPixels() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  // Sample inside character 0 torso (x=120 to 160, y=300 to 450)
  let pitchBlackCount = 0;
  let minLum = 255;
  for (let x = 120; x < 160; x++) {
    for (let y = 300; y < 450; y++) {
      const idx = (y * w + x) * 3;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const maxC = Math.max(r, g, b);
      if (maxC < minLum) minLum = maxC;
      if (maxC <= 5) pitchBlackCount++;
    }
  }
  console.log(`Torso sample: minLum=${minLum}, pitchBlackCount=${pitchBlackCount}`);
}

inspectCharacterPixels();

