import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const assetsDir = path.resolve('public/assets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createBuffer(w, h, fillFn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const color = fillFn(x, y, w, h);
      buf[idx] = color[0];
      buf[idx + 1] = color[1];
      buf[idx + 2] = color[2];
      buf[idx + 3] = color[3];
    }
  }
  return buf;
}

async function savePng(buf, w, h, outPath) {
  ensureDir(path.dirname(outPath));
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPath);
}

// 1. Alien Sky & Distant Horizon Panorama (tileable horizontally, 1024x320)
async function generateHorizonPanorama() {
  const w = 1024, h = 320;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const ny = y / h; // 0 at top of sky, 1 at horizon line
    // Deep alien twilight gradient: dark indigo/violet top -> misty cyan-blue horizon glow
    let r = Math.round(6 + Math.pow(ny, 1.8) * 34);
    let g = Math.round(10 + Math.pow(ny, 1.5) * 65);
    let b = Math.round(24 + Math.pow(ny, 1.3) * 95);

    // Subtle aurora / nebula band across the upper sky
    const auroraWave = Math.sin((x / w) * Math.PI * 4 + ny * 5) * 0.5 + 0.5;
    if (ny > 0.15 && ny < 0.65) {
      const bandIntensity = Math.sin(((ny - 0.15) / 0.5) * Math.PI) * auroraWave;
      r += Math.round(bandIntensity * 38);
      g += Math.round(bandIntensity * 18);
      b += Math.round(bandIntensity * 55);
    }

    // Distant ringed moon / planet at x=740, y=88
    const moonDist = Math.hypot(x - 740, y - 88);
    if (moonDist < 46) {
      const mt = moonDist / 46;
      const shade = Math.max(0.2, (740 - x + 20) / 66);
      r = Math.round(r * 0.3 + (140 + (1 - mt) * 50) * shade);
      g = Math.round(g * 0.3 + (180 + (1 - mt) * 50) * shade);
      b = Math.round(b * 0.3 + (220 + (1 - mt) * 35) * shade);
    }

    // Far mountain silhouette layer 1 (periodic over width w for seamless horizontal wrap)
    const theta = (x / w) * Math.PI * 2;
    const farPeak =
      215 -
      Math.abs(Math.sin(theta * 3)) * 55 -
      Math.sin(theta * 7 + 1.2) * 22 -
      Math.cos(theta * 13) * 10;

    if (y >= farPeak) {
      const mDepth = (y - farPeak) / (h - farPeak);
      // Icy distant mountain silhouette with atmospheric haze near the bottom
      r = Math.round(16 + mDepth * 18);
      g = Math.round(30 + mDepth * 34);
      b = Math.round(52 + mDepth * 48);
    }

    // Nearer jagged crystal ridge silhouette layer 2
    const nearPeak =
      248 -
      Math.abs(Math.cos(theta * 4 + 0.6)) * 42 -
      Math.abs(Math.sin(theta * 9)) * 18 -
      Math.sin(theta * 17) * 6;

    if (y >= nearPeak) {
      const nDepth = (y - nearPeak) / (h - nearPeak);
      // Subtle crystalline violet-blue ridge blending into ground fog at ny = 1
      r = Math.round(18 + nDepth * 10);
      g = Math.round(28 + nDepth * 20);
      b = Math.round(46 + nDepth * 26);
    }

    // Horizon mist blend at the very bottom (y > 285)
    if (y > 285) {
      const mist = (y - 285) / 35;
      r = Math.round(r * (1 - mist) + 22 * mist);
      g = Math.round(g * (1 - mist) + 38 * mist);
      b = Math.round(b * (1 - mist) + 60 * mist);
    }

    return [Math.min(255, r), Math.min(255, g), Math.min(255, b), 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'horizon_panorama.png'));
}

// 2. Bioluminescent Alien Mushroom Cluster (Additional organic prop)
async function generateAlienMushroom() {
  const w = 96, h = 104;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    if (y > 96) return [0, 0, 0, 0];

    // Main umbrella cap at (48, 38)
    const capDx = (x - cx) / 30;
    const capDy = (y - 40) / 18;
    if (y <= 44 && capDx * capDx + capDy * capDy <= 1.0) {
      const glow = 1 - Math.hypot(capDx, capDy) * 0.65;
      // Glowing violet-cyan mushroom cap with spots
      const spot = Math.sin(x * 0.45) * Math.cos(y * 0.45) > 0.55 ? 55 : 0;
      return [
        Math.min(255, Math.round(95 * glow + spot)),
        Math.min(255, Math.round(210 * glow + spot)),
        Math.min(255, Math.round(255 * glow)),
        255
      ];
    }

    // Secondary smaller mushroom at (26, 58)
    const sDx = (x - 26) / 16;
    const sDy = (y - 60) / 10;
    if (y <= 63 && sDx * sDx + sDy * sDy <= 1.0) {
      return [130, 190, 255, 255];
    }

    // Stems
    if (y > 40 && y <= 92 && Math.abs(x - (cx + Math.sin(y * 0.1) * 3)) < 5.5) {
      return [45, 95, 125, 255];
    }
    if (y > 60 && y <= 90 && Math.abs(x - 26) < 3.5) {
      return [40, 85, 115, 255];
    }

    // Soft spore glow
    const dGlow = Math.hypot(x - cx, y - 45);
    if (dGlow < 44) {
      const a = Math.pow(1 - dGlow / 44, 2) * 65;
      return [60, 220, 255, Math.round(a)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'alien_mushroom.png'));
}

// 3. Physical Loot Item Containment Orb (subtle glowing aura ring for dropped passive items)
async function generateLootOrb() {
  const size = 64;
  const buf = createBuffer(size, size, (x, y) => {
    const cx = size / 2, cy = size / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d > 28) return [0, 0, 0, 0];
    if (Math.abs(d - 22) < 2.2) {
      return [120, 230, 255, 230];
    }
    const a = Math.pow(1 - d / 28, 1.8) * 110;
    return [40, 170, 255, Math.round(a)];
  });
  await savePng(buf, size, size, path.join(assetsDir, 'loot_orb.png'));
}

async function run() {
  await generateHorizonPanorama();
  await generateAlienMushroom();
  await generateLootOrb();
  console.log('Phase 2 assets generated successfully!');
}

run().catch(console.error);

