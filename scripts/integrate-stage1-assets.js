import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const uploadDir = path.resolve('C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded');
const assetsDir = path.resolve('public/assets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(assetsDir);

/**
 * Remove pure black background by computing luminance/threshold
 * and fading out pixels near black smoothly with soft edge feathering.
 */
async function processBlackBgToAlpha(inPath, outPath, threshold = 22, feather = 18) {
  const { data, info } = await sharp(inPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const outBuf = Buffer.alloc(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * channels;
      const dstIdx = (y * w + x) * 4;

      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];
      const maxVal = Math.max(r, g, b);

      outBuf[dstIdx] = r;
      outBuf[dstIdx + 1] = g;
      outBuf[dstIdx + 2] = b;

      if (maxVal <= threshold) {
        outBuf[dstIdx + 3] = 0;
      } else if (maxVal < threshold + feather) {
        const t = (maxVal - threshold) / feather;
        outBuf[dstIdx + 3] = Math.round(t * 255);
      } else {
        outBuf[dstIdx + 3] = 255;
      }
    }
  }

  await sharp(outBuf, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outPath);
  console.log(`Processed (Black->Alpha): ${outPath} (${w}x${h})`);
}

/**
 * Circular mask for UI icons on black backgrounds
 */
async function processCircularIcon(inPath, outPath) {
  const { data, info } = await sharp(inPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = (w / 2) * 0.985;
  const feather = 3.0;

  const outBuf = Buffer.alloc(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * channels;
      const dstIdx = (y * w + x) * 4;

      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];

      outBuf[dstIdx] = r;
      outBuf[dstIdx + 1] = g;
      outBuf[dstIdx + 2] = b;

      const dist = Math.hypot(x - cx, y - cy);
      if (dist > maxRadius) {
        outBuf[dstIdx + 3] = 0;
      } else if (dist > maxRadius - feather) {
        const t = (maxRadius - dist) / feather;
        outBuf[dstIdx + 3] = Math.round(t * 255);
      } else {
        outBuf[dstIdx + 3] = 255;
      }
    }
  }

  await sharp(outBuf, { raw: { width: w, height: h, channels: 4 } })
    .resize(256, 256)
    .png()
    .toFile(outPath);
  console.log(`Processed (Circular Icon): ${outPath} (256x256)`);
}

/**
 * Generate HD Void Wasp flying enemy
 */
async function generateVoidWasp(outPath) {
  const w = 256, h = 256;
  const outBuf = Buffer.alloc(w * h * 4);
  const cx = 128, cy = 120;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      // Abdomen stinger
      const abDist = Math.hypot((x - cx) * 1.35, y - (cy + 25));
      if (abDist <= 28) {
        const t = abDist / 28;
        outBuf[idx] = Math.round(180 * (1 - t * 0.5));
        outBuf[idx + 1] = Math.round(40 * (1 - t));
        outBuf[idx + 2] = Math.round(240 * (1 - t * 0.4));
        outBuf[idx + 3] = 255;
        // Stinger tip
        if (y > cy + 42 && Math.abs(x - cx) < 6) {
          outBuf[idx] = 255; outBuf[idx + 1] = 220; outBuf[idx + 2] = 40;
        }
        continue;
      }

      // Thorax and Head
      const headDist = Math.hypot((x - cx) * 1.2, y - (cy - 12));
      if (headDist <= 22) {
        // Glowing cyan compound eyes
        const eyeL = Math.hypot(x - (cx - 10), y - (cy - 14));
        const eyeR = Math.hypot(x - (cx + 10), y - (cy - 14));
        if (eyeL < 5 || eyeR < 5) {
          outBuf[idx] = 0; outBuf[idx + 1] = 240; outBuf[idx + 2] = 255; outBuf[idx + 3] = 255;
        } else {
          outBuf[idx] = 60; outBuf[idx + 1] = 20; outBuf[idx + 2] = 95; outBuf[idx + 3] = 255;
        }
        continue;
      }

      // Translucent Iridescent Wings (Left & Right)
      const wingDistL = Math.hypot((x - (cx - 55)) * 0.55, (y - (cy - 28)) * 1.6);
      const wingDistR = Math.hypot((x - (cx + 55)) * 0.55, (y - (cy - 28)) * 1.6);
      if (wingDistL <= 46 || wingDistR <= 46) {
        const wt = Math.min(wingDistL, wingDistR) / 46;
        outBuf[idx] = Math.round(120 + (1 - wt) * 80);
        outBuf[idx + 1] = Math.round(210 + (1 - wt) * 45);
        outBuf[idx + 2] = 255;
        outBuf[idx + 3] = Math.round((1 - wt) * 190);
        continue;
      }

      // Background transparent
      outBuf[idx] = 0;
      outBuf[idx + 1] = 0;
      outBuf[idx + 2] = 0;
      outBuf[idx + 3] = 0;
    }
  }

  await sharp(outBuf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPath);
  console.log(`Generated: ${outPath} (256x256)`);
}

async function run() {
  console.log('=== Integrating Stage 1 Assets ===\n');

  // 1. Environment Assets
  console.log('--- Environment Assets ---');
  // crystal_formations.png (PNG with transparent alpha)
  await sharp(path.join(uploadDir, 'media_1793728463152_0b061043.png'))
    .png()
    .toFile(path.join(assetsDir, 'crystal_formations.png'));
  console.log('Saved: crystal_formations.png');

  // overseer_monolith.png (PNG with transparent alpha)
  await sharp(path.join(uploadDir, 'media_1793728530233_fb9ade8d.png'))
    .png()
    .toFile(path.join(assetsDir, 'overseer_monolith.png'));
  console.log('Saved: overseer_monolith.png');

  // organic_pod_closed.png (PNG with transparent alpha)
  await sharp(path.join(uploadDir, 'media_1793728530228_c5c0fc59.png'))
    .png()
    .toFile(path.join(assetsDir, 'organic_pod_closed.png'));
  console.log('Saved: organic_pod_closed.png');

  // alien_mushrooms.png (JPG with black background -> knock out to transparent PNG)
  await processBlackBgToAlpha(
    path.join(uploadDir, 'media_1793728463137_83fabe36.jpg'),
    path.join(assetsDir, 'alien_mushrooms.png'),
    20, 24
  );

  // organic_pod_opened.png (JPG with black background -> knock out to transparent PNG)
  await processBlackBgToAlpha(
    path.join(uploadDir, 'media_1793728530220_9a204c54.jpg'),
    path.join(assetsDir, 'organic_pod_opened.png'),
    22, 22
  );

  // Also preserve backward compatible filenames:
  fs.copyFileSync(path.join(assetsDir, 'overseer_monolith.png'), path.join(assetsDir, 'overseer_artifact.png'));
  fs.copyFileSync(path.join(assetsDir, 'organic_pod_closed.png'), path.join(assetsDir, 'organic_pod.png'));
  fs.copyFileSync(path.join(assetsDir, 'alien_mushrooms.png'), path.join(assetsDir, 'alien_mushroom.png'));
  fs.copyFileSync(path.join(assetsDir, 'crystal_formations.png'), path.join(assetsDir, 'crystal_cluster.png'));

  // 2. Terrain Textures
  console.log('\n--- Terrain Textures ---');
  await sharp(path.join(uploadDir, 'media_1793728463157_6f8f4949.jpg'))
    .png()
    .toFile(path.join(assetsDir, 'alien_grass.png'));
  console.log('Saved: alien_grass.png');

  await sharp(path.join(uploadDir, 'media_1793728463149_667501c7.jpg'))
    .png()
    .toFile(path.join(assetsDir, 'organic_dark_mud.png'));
  console.log('Saved: organic_dark_mud.png');

  await sharp(path.join(uploadDir, 'media_1793728463144_75f3d00c.jpg'))
    .png()
    .toFile(path.join(assetsDir, 'rocky_cliff_face.png'));
  console.log('Saved: rocky_cliff_face.png');

  // Permafrost soil
  fs.copyFileSync(path.join(assetsDir, 'terrain_permafrost.png'), path.join(assetsDir, 'permafrost_soil.png'));
  console.log('Linked: permafrost_soil.png');

  // Also link backward compatible terrain files
  fs.copyFileSync(path.join(assetsDir, 'alien_grass.png'), path.join(assetsDir, 'terrain_alien_grass.png'));
  fs.copyFileSync(path.join(assetsDir, 'alien_grass.png'), path.join(assetsDir, 'plateau_grass_cap.png'));
  fs.copyFileSync(path.join(assetsDir, 'organic_dark_mud.png'), path.join(assetsDir, 'terrain_alien_mud.png'));
  fs.copyFileSync(path.join(assetsDir, 'rocky_cliff_face.png'), path.join(assetsDir, 'cliff_organic_rock.png'));

  // 3. Commander Skill Icons
  console.log('\n--- Skill Icons ---');
  await processCircularIcon(path.join(uploadDir, 'media_1793728540022_b70b4094.jpg'), path.join(assetsDir, 'rally_command.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728540018_d6e741af.jpg'), path.join(assetsDir, 'tactical_strike.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728540015_a78165e4.jpg'), path.join(assetsDir, 'defensive_protocol.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728540013_4353c21e.jpg'), path.join(assetsDir, 'combat_dash.png'));

  // 4. Augment Icons
  console.log('\n--- Augment Icons ---');
  await processCircularIcon(path.join(uploadDir, 'media_1793728540028_7a80c93f.jpg'), path.join(assetsDir, 'attack_power.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728547185_baa75b40.jpg'), path.join(assetsDir, 'attack_speed.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728547183_05e30816.jpg'), path.join(assetsDir, 'critical_chance.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728547174_b2b08b47.jpg'), path.join(assetsDir, 'critical_damage.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728547160_4749d600.jpg'), path.join(assetsDir, 'health.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728547155_a2419efe.jpg'), path.join(assetsDir, 'armor.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728556609_24e6f01e.jpg'), path.join(assetsDir, 'movement_speed.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728556597_9a1b0fad.jpg'), path.join(assetsDir, 'cooldown_reduction.png'));
  await processCircularIcon(path.join(uploadDir, 'media_1793728556592_b2ff8f4d.jpg'), path.join(assetsDir, 'life_steal.png'));

  // 5. Enemies
  console.log('\n--- Enemy Assets ---');
  fs.copyFileSync(path.join(assetsDir, 'enemy_crawler.png'), path.join(assetsDir, 'void_crawler.png'));
  fs.copyFileSync(path.join(assetsDir, 'enemy_spitter.png'), path.join(assetsDir, 'toxic_spitter.png'));
  fs.copyFileSync(path.join(assetsDir, 'enemy_elite.png'), path.join(assetsDir, 'void_goliath.png'));
  fs.copyFileSync(path.join(assetsDir, 'enemy_boss.png'), path.join(assetsDir, 'brood_overseer.png'));
  await generateVoidWasp(path.join(assetsDir, 'void_wasp.png'));
  console.log('Linked all Stage 1 enemies: void_crawler, toxic_spitter, void_wasp, void_goliath, brood_overseer');

  console.log('\n=== Asset Integration Preparation Complete! ===');
}

run().catch(console.error);

