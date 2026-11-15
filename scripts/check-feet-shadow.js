import sharp from 'sharp';

async function checkShadow() {
  const file = 'public/assets/doctor/doctor_front.png';
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  console.log('Front info:', info.width, info.height);
  // Check the area between feet around y = 240, x = 120-145
  for (let y = 230; y < 250; y += 5) {
    for (let x = 120; x <= 145; x += 5) {
      const idx = (y * info.width + x) * 4;
      console.log(`(${x}, ${y}) RGBA:`, data[idx], data[idx+1], data[idx+2], data[idx+3]);
    }
  }
}

checkShadow().catch(console.error);

