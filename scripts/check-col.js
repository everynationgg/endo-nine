import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function checkColPixels() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  const yVals = [];
  for (let y = 0; y < h; y++) {
    const idx = (y * w + 520) * 3;
    if (data[idx] > 15 || data[idx+1] > 15 || data[idx+2] > 15) {
      yVals.push(y);
    }
  }
  console.log(`x=520 non-black y range: ${yVals[0]} to ${yVals[yVals.length - 1]} (total ${yVals.length})`);
  
  // Let's also check wider range x from 450 to 600
  let minCount = 9999, minX = -1;
  for (let x = 450; x < 600; x++) {
    let count = 0;
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 3;
      if (data[idx] > 15 || data[idx+1] > 15 || data[idx+2] > 15) count++;
    }
    if (count < minCount) {
      minCount = count;
      minX = x;
    }
  }
  console.log(`Minimum in [450, 600] is at x=${minX} with count=${minCount}`);
}

checkColPixels();

