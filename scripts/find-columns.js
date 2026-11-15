import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function findColumns() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  
  // Calculate column activity (how many non-black pixels in each column)
  const colActivity = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 3;
      if (data[idx] > 10 || data[idx+1] > 10 || data[idx+2] > 10) {
        colActivity[x]++;
      }
    }
  }

  // Find contiguous non-empty spans or valley between figures
  let valleys = [];
  let inFigure = false;
  let spans = [];
  let spanStart = 0;

  for (let x = 0; x < w; x++) {
    if (colActivity[x] > 15) {
      if (!inFigure) {
        inFigure = true;
        spanStart = x;
      }
    } else {
      if (inFigure) {
        inFigure = false;
        spans.push({ start: spanStart, end: x });
      }
    }
  }
  if (inFigure) spans.push({ start: spanStart, end: w });

  console.log('Detected spans:', spans);

  // For each span, find yMin and yMax
  spans.forEach((span, i) => {
    let yMin = h, yMax = 0;
    for (let x = span.start; x < span.end; x++) {
      for (let y = 0; y < h; y++) {
        const idx = (y * w + x) * 3;
        if (data[idx] > 10 || data[idx+1] > 10 || data[idx+2] > 10) {
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
      }
    }
    console.log(`Figure ${i}: x=[${span.start}, ${span.end}] (w=${span.end - span.start}), y=[${yMin}, ${yMax}] (h=${yMax - yMin})`);
  });
}

findColumns();

