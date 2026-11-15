const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1024;
const BLEND_BAND = 160; // Width of raised-cosine toroidal seam blend band

async function main() {
  const inputPath = process.argv[2] || path.join(__dirname, '../public/assets/alien_thawed_ground_raw.png');
  const outputPath = path.join(__dirname, '../public/assets/alien_thawed_ground.png');
  const tiledCheckPath = path.join(__dirname, '../scratch/alien_thawed_ground_2x2_check.png');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input raw texture not found at: ${inputPath}`);
  }

  // Ensure scratch directory exists
  const scratchDir = path.dirname(tiledCheckPath);
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const { data: src } = await sharp(inputPath)
    .resize(SIZE, SIZE, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Toroidal seam synthesis:
  // Blend the original image with a half-period shifted copy (x + 512, y + 512) mod 1024
  // weighted by a smooth 2D raised-cosine window near the outer edges of the tile.
  // Because the shifted copy is continuous across (x=0, y=0) while the original is continuous
  // across (x=512, y=512), smoothly transitioning to the shifted copy within BLEND_BAND of
  // the border makes the resulting 1024x1024 tile 100% periodic and seamless on all 4 edges!
  const out = Buffer.alloc(SIZE * SIZE * 3);

  function edgeWeight(coord) {
    const distToEdge = Math.min(coord, SIZE - 1 - coord);
    if (distToEdge >= BLEND_BAND) return 0.0;
    // Smooth cosine curve: 1.0 at distToEdge=0, 0.0 at distToEdge=BLEND_BAND
    const t = distToEdge / BLEND_BAND;
    return 0.5 * (1.0 + Math.cos(Math.PI * t));
  }

  for (let y = 0; y < SIZE; y++) {
    const wy = edgeWeight(y);
    const sy = (y + SIZE / 2) % SIZE;

    for (let x = 0; x < SIZE; x++) {
      const wx = edgeWeight(x);
      const sx = (x + SIZE / 2) % SIZE;

      // Combined border weight (0 in interior, 1 along all 4 outer edges)
      const w = 1.0 - (1.0 - wx) * (1.0 - wy);

      const idxA = (y * SIZE + x) * 3;
      const idxB = (sy * SIZE + sx) * 3;
      const idxX = (y * SIZE + sx) * 3;
      const idxY = (sy * SIZE + x) * 3;

      // 4-way toroidal interpolation for completely artifact-free corners and edges
      const w00 = (1.0 - wx) * (1.0 - wy);
      const w10 = wx * (1.0 - wy);
      const w01 = (1.0 - wx) * wy;
      const w11 = wx * wy;

      for (let c = 0; c < 3; c++) {
        const val =
          src[idxA + c] * w00 +
          src[idxX + c] * w10 +
          src[idxY + c] * w01 +
          src[idxB + c] * w11;
        out[idxA + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }

  await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .toColorspace('srgb')
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`Saved seamless 1024x1024 texture to ${outputPath}`);

  // Generate 2x2 tiled preview (1024x1024 showing four 512x512 quadrants) to verify zero seams
  const halfTile = await sharp(outputPath).resize(512, 512).toBuffer();
  await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .composite([
      { input: halfTile, left: 0, top: 0 },
      { input: halfTile, left: 512, top: 0 },
      { input: halfTile, left: 0, top: 512 },
      { input: halfTile, left: 512, top: 512 }
    ])
    .png()
    .toFile(tiledCheckPath);

  console.log(`Saved 2x2 seamless tiling check to ${tiledCheckPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

