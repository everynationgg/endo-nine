import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const srcDir = 'C:/Users/yoggn/Downloads/Ender Nine';
const assetsDir = path.resolve('public/assets');
const commanderDir = path.resolve('public/assets/commander');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
ensureDir(assetsDir);
ensureDir(commanderDir);

/**
 * Knock out black background with feathered alpha edge
 */
async function processBlackBgToAlpha(inPath, outPath, threshold = 22, feather = 20) {
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
  console.log(`Knocked out Black->Alpha: ${outPath}`);
}

/**
 * Circular mask for UI icons
 */
async function processCircularIcon(inPath, outPath) {
  const { data, info } = await sharp(inPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = (w / 2) * 0.985;
  const feather = 3.5;

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
  console.log(`Processed Circular Icon: ${outPath} (256x256)`);
}

async function run() {
  console.log('=== Integrating TRUE Full-Fidelity Assets from Downloads ===\n');

  // 1. Characters: Slice Commander Female Sprite into 4 Directions
  console.log('--- 1. Commander Directional Sprites ---');
  const sheetPath = path.join(srcDir, 'Characters/Commander Female Sprite.png');
  const quadW = Math.floor(1448 / 4); // 362
  const directions = [
    { name: 'commander_front.png', index: 0 },
    { name: 'commander_back.png', index: 1 },
    { name: 'commander_right.png', index: 2 }, // Column 2 faces right
    { name: 'commander_left.png', index: 3 }   // Column 3 faces left
  ];

  for (const dir of directions) {
    const left = dir.index * quadW;
    const buf = await sharp(sheetPath)
      .extract({ left, top: 0, width: quadW, height: 1086 })
      .png()
      .toBuffer();

    const outPath = path.join(commanderDir, dir.name);
    await sharp(buf)
      .trim()
      .resize(256, 256, {
        fit: 'contain',
        position: 'bottom',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outPath);
    console.log(`Saved Directional Sprite: ${dir.name} -> ${outPath}`);
  }

  // Also copy portrait art for character select
  await sharp(path.join(srcDir, 'Characters/Commander Female.png'))
    .resize(512, 512, { fit: 'cover' })
    .png()
    .toFile(path.join(assetsDir, 'commander_female_portrait.png'));
  console.log('Saved: commander_female_portrait.png');

  // 2. Enemies: Real High-Definition Assets
  console.log('\n--- 2. High-Definition Stage 1 Enemies ---');
  // Void Crawler
  await sharp(path.join(srcDir, 'Enemies/void_crawler.png'))
    .trim()
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'void_crawler.png'));
  console.log('Saved: void_crawler.png (from Downloads)');

  // Toxic Spitter
  await sharp(path.join(srcDir, 'Enemies/Toxic Spitter Alien Creature.png'))
    .trim()
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'toxic_spitter.png'));
  console.log('Saved: toxic_spitter.png (from Downloads/Toxic Spitter Alien Creature.png)');

  // Void Wasp
  await sharp(path.join(srcDir, 'Enemies/Neon Void Wasp in Flight.png'))
    .trim()
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'void_wasp.png'));
  console.log('Saved: void_wasp.png (from Downloads/Neon Void Wasp in Flight.png)');

  // Void Goliath
  await sharp(path.join(srcDir, 'Enemies/Void Goliath_ Neon Chitin Beast.png'))
    .trim()
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'void_goliath.png'));
  console.log('Saved: void_goliath.png (from Downloads/Void Goliath_ Neon Chitin Beast.png)');

  // Brood Overseer (Empowered Sovereign Boss derived from Goliath with Crimson/Gold Boss Hue & Royal Crest)
  {
    const goliathRaw = await sharp(path.join(srcDir, 'Enemies/Void Goliath_ Neon Chitin Beast.png'))
      .trim()
      .resize(768, 768, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const gw = goliathRaw.info.width;
    const gh = goliathRaw.info.height;
    const gData = goliathRaw.data;
    const bossBuf = Buffer.alloc(gw * gh * 4);

    for (let i = 0; i < gw * gh; i++) {
      const idx = i * 4;
      const r = gData[idx];
      const g = gData[idx + 1];
      const b = gData[idx + 2];
      const a = gData[idx + 3];

      if (a === 0) {
        bossBuf[idx] = 0; bossBuf[idx + 1] = 0; bossBuf[idx + 2] = 0; bossBuf[idx + 3] = 0;
      } else {
        // Shift cyan/purple to royal crimson & golden embers for Brood Overseer Boss
        const redBoost = Math.min(255, Math.round(r * 1.35 + b * 0.45));
        const greenTint = Math.min(255, Math.round(g * 0.75 + r * 0.25));
        const blueTone = Math.min(255, Math.round(b * 0.85));
        bossBuf[idx] = redBoost;
        bossBuf[idx + 1] = greenTint;
        bossBuf[idx + 2] = blueTone;
        bossBuf[idx + 3] = a;
      }
    }

    await sharp(bossBuf, { raw: { width: gw, height: gh, channels: 4 } })
      .png()
      .toFile(path.join(assetsDir, 'brood_overseer.png'));
    console.log('Saved: brood_overseer.png (Brood Sovereign Boss)');
  }

  // Also preserve backward-compatible aliases:
  fs.copyFileSync(path.join(assetsDir, 'void_crawler.png'), path.join(assetsDir, 'enemy_crawler.png'));
  fs.copyFileSync(path.join(assetsDir, 'toxic_spitter.png'), path.join(assetsDir, 'enemy_spitter.png'));
  fs.copyFileSync(path.join(assetsDir, 'void_goliath.png'), path.join(assetsDir, 'enemy_elite.png'));
  fs.copyFileSync(path.join(assetsDir, 'brood_overseer.png'), path.join(assetsDir, 'enemy_boss.png'));

  // 3. Environment Assets
  console.log('\n--- 3. Environment Assets ---');
  await sharp(path.join(srcDir, 'Environment/Glowing Alien Overseer Monolith.png'))
    .trim()
    .resize(512, 680, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'overseer_monolith.png'));
  console.log('Saved: overseer_monolith.png');

  await sharp(path.join(srcDir, 'Environment/Closed Sci-Fi Bio-Pod with Purple Accents.png'))
    .trim()
    .resize(384, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'organic_pod_closed.png'));
  console.log('Saved: organic_pod_closed.png');

  await processBlackBgToAlpha(
    path.join(srcDir, 'Environment/Open Bio-Pod with Purple Glow.png'),
    path.join(assetsDir, 'organic_pod_opened.png'),
    24, 20
  );
  console.log('Saved: organic_pod_opened.png');

  await sharp(path.join(srcDir, 'Environment/Glowing Alien Mushroom Cluster.png'))
    .trim()
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'alien_mushrooms.png'));
  console.log('Saved: alien_mushrooms.png');

  await sharp(path.join(srcDir, 'Environment/Glowing Purple Crystal Cluster.png'))
    .trim()
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assetsDir, 'crystal_formations.png'));
  console.log('Saved: crystal_formations.png');

  // Environment backward compatibility
  fs.copyFileSync(path.join(assetsDir, 'overseer_monolith.png'), path.join(assetsDir, 'overseer_artifact.png'));
  fs.copyFileSync(path.join(assetsDir, 'organic_pod_closed.png'), path.join(assetsDir, 'organic_pod.png'));
  fs.copyFileSync(path.join(assetsDir, 'alien_mushrooms.png'), path.join(assetsDir, 'alien_mushroom.png'));
  fs.copyFileSync(path.join(assetsDir, 'crystal_formations.png'), path.join(assetsDir, 'crystal_cluster.png'));

  // 4. Terrain Textures
  console.log('\n--- 4. Terrain Textures ---');
  await sharp(path.join(srcDir, 'Environment/Seamless Bioluminescent Alien Terrain.png'))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'alien_grass.png'));
  console.log('Saved: alien_grass.png');

  await sharp(path.join(srcDir, 'Environment/Alien Purple Mud Texture.png'))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'organic_dark_mud.png'));
  console.log('Saved: organic_dark_mud.png');

  await sharp(path.join(srcDir, 'Environment/Glowing Violet Crystal Cliff Texture.png'))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'rocky_cliff_face.png'));
  console.log('Saved: rocky_cliff_face.png');

  await sharp(path.join(srcDir, 'Environment/Icy Alien Frostland Texture.png'))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'permafrost_soil.png'));
  console.log('Saved: permafrost_soil.png');

  // Terrain backward compatibility
  fs.copyFileSync(path.join(assetsDir, 'alien_grass.png'), path.join(assetsDir, 'terrain_alien_grass.png'));
  fs.copyFileSync(path.join(assetsDir, 'alien_grass.png'), path.join(assetsDir, 'plateau_grass_cap.png'));
  fs.copyFileSync(path.join(assetsDir, 'organic_dark_mud.png'), path.join(assetsDir, 'terrain_alien_mud.png'));
  fs.copyFileSync(path.join(assetsDir, 'rocky_cliff_face.png'), path.join(assetsDir, 'cliff_organic_rock.png'));
  fs.copyFileSync(path.join(assetsDir, 'permafrost_soil.png'), path.join(assetsDir, 'terrain_permafrost.png'));

  // 5. Skill Icons
  console.log('\n--- 5. Skill Icons ---');
  await processCircularIcon(path.join(srcDir, 'Environment/Holographic Eagle Command Banner.png'), path.join(assetsDir, 'rally_command.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Orbital Strike Targeting HUD.png'), path.join(assetsDir, 'tactical_strike.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Eagle Shield Defense Emblem.png'), path.join(assetsDir, 'defensive_protocol.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Commander Dash Icon.png'), path.join(assetsDir, 'combat_dash.png'));

  // 6. Augment Icons
  console.log('\n--- 6. Augment Icons ---');
  await processCircularIcon(path.join(srcDir, 'Environment/Glowing Sword Attack Boost.png'), path.join(assetsDir, 'attack_power.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Purple HUD with Golden Speeding Bullets.png'), path.join(assetsDir, 'attack_speed.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Gold Target Burst.png'), path.join(assetsDir, 'critical_chance.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Critical Damage Emblem.png'), path.join(assetsDir, 'critical_damage.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Glowing Purple Health Boost Emblem.png'), path.join(assetsDir, 'health.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Glowing Golden Shield HUD Emblem.png'), path.join(assetsDir, 'armor.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Gold Sprint Emblem.png'), path.join(assetsDir, 'movement_speed.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Purple-Gold Cooldown Emblem.png'), path.join(assetsDir, 'cooldown_reduction.png'));
  await processCircularIcon(path.join(srcDir, 'Environment/Neon Life Steal Emblem.png'), path.join(assetsDir, 'life_steal.png'));

  console.log('\n=== MASTER INTEGRATION FINISHED SUCCESSFULLY ===');
}

run().catch(console.error);

