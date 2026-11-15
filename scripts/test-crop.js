import sharp from 'sharp';

async function testCrop() {
  const col0 = 'scratch/doctor_col_0.png';
  // Let's crop out the outer decorative frame and examine the inner area
  // Dimensions of col0 are 384 x 1024
  await sharp(col0)
    .extract({ left: 35, top: 80, width: 315, height: 810 })
    .png()
    .toFile('scratch/test_crop_0.png');
  console.log('Saved test_crop_0.png');
}

testCrop().catch(console.error);

