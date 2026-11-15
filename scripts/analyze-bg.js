import sharp from 'sharp';

const inputPath = "C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1793694147571_4b7f2149.jpg";

async function analyzeBackground() {
  const { data, info } = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
  console.log('Channels:', info.channels, 'Width:', info.width, 'Height:', info.height);
  
  // Sample corners: (0,0), (width-1, 0), (0, height-1), (width-1, height-1)
  const corners = [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
    [100, 10],
    [500, 10],
    [900, 10]
  ];
  for (const [x, y] of corners) {
    const idx = (y * info.width + x) * info.channels;
    console.log(`Pixel (${x}, ${y}): R=${data[idx]}, G=${data[idx+1]}, B=${data[idx+2]}`);
  }
}

analyzeBackground();

