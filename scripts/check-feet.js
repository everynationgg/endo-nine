import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function checkFeet() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  // Look at row y=670 to 705 (feet area)
  console.log('--- Non-black columns at y=680 ---');
  let feetCols = [];
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 660; y <= 700; y++) {
      const idx = (y * w + x) * 3;
      if (data[idx] > 20 || data[idx+1] > 20 || data[idx+2] > 20) count++;
    }
    if (count > 5) feetCols.push(x);
  }
  
  // Group consecutive feet cols
  let groups = [];
  let cur = [feetCols[0]];
  for (let i = 1; i < feetCols.length; i++) {
    if (feetCols[i] === feetCols[i-1] + 1) {
      cur.push(feetCols[i]);
    } else {
      groups.push({ start: cur[0], end: cur[cur.length-1], center: Math.round((cur[0] + cur[cur.length-1])/2) });
      cur = [feetCols[i]];
    }
  }
  if (cur.length) groups.push({ start: cur[0], end: cur[cur.length-1], center: Math.round((cur[0] + cur[cur.length-1])/2) });
  
  console.log('Feet groups:', groups);
}

checkFeet();

