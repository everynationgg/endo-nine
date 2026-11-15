import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function verifySeam() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  // For each y from 60 to 710, find:
  // rightmost pixel of figure 1 (starting scan from x=400 going right)
  // leftmost pixel of figure 2 (starting scan from x=600 going left)
  let overlapFound = false;
  for (let y = 60; y <= 710; y++) {
    let right1 = 400;
    while (right1 < w) {
      const idx = (y * w + right1) * 3;
      if (data[idx] <= 20 && data[idx+1] <= 20 && data[idx+2] <= 20) {
        // check if next 15 pixels are also black
        let allBlack = true;
        for (let k = 1; k <= 15 && right1 + k < w; k++) {
          const ki = (y * w + right1 + k) * 3;
          if (data[ki] > 20 || data[ki+1] > 20 || data[ki+2] > 20) {
            allBlack = false;
            break;
          }
        }
        if (allBlack) break;
      }
      right1++;
    }
    
    // Now from right1, find start of figure 2
    let left2 = right1;
    while (left2 < 750) {
      const idx = (y * w + left2) * 3;
      if (data[idx] > 20 || data[idx+1] > 20 || data[idx+2] > 20) break;
      left2++;
    }
    
    if (right1 > 400 && left2 < 750) {
      const gap = left2 - right1;
      if (gap < 5) {
        console.log(`Small gap at y=${y}: right1=${right1}, left2=${left2}, gap=${gap}`);
        overlapFound = true;
      }
    }
  }
  if (!overlapFound) {
    console.log('No overlaps found between Figure 1 and Figure 2! Clean vertical seam path exists.');
  }
}

verifySeam();

