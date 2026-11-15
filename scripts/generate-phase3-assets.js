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

// 1. Layered Icy-Rock Cliff Wall Texture (128x128 tileable horizontally)
async function generateCliffWall() {
  const w = 128, h = 128;
  const buf = createBuffer(w, h, (x, y) => {
    // Vertical striations + rock stratification
    const strat = Math.sin(y * 0.18) * 0.5 + Math.cos(y * 0.45) * 0.25;
    const vert = Math.sin(x * 0.3) * 0.2;
    const noise = Math.sin(x * 0.15 + y * 0.1) * 0.3;
    const v = (strat + vert + noise + 1.5) / 3;

    // Deep alien slate-blue/purple rock base with frosted ledge highlights
    const r = Math.round(18 + v * 28);
    const g = Math.round(26 + v * 38);
    const b = Math.round(44 + v * 62);

    // Glowing crystalline mineral veins embedded in cliff face
    const vein = Math.abs(Math.sin(x * 0.25 + Math.sin(y * 0.1) * 4));
    if (vein < 0.08) {
      const intensity = 1 - vein / 0.08;
      return [
        Math.min(255, Math.round(r + intensity * 80)),
        Math.min(255, Math.round(g + intensity * 140)),
        Math.min(255, Math.round(b + intensity * 200)),
        255
      ];
    }

    return [r, g, b, 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'cliff_wall.png'));
}

// 2. Glowing Chasm / Fissure with Bioluminescent Mist (128x128)
async function generateChasmFissure() {
  const w = 128, h = 128;
  const buf = createBuffer(w, h, (x, y) => {
    // Fissure depth gradient: very dark abyssal edges, vibrant glowing bioluminescent core
    const distCenter = Math.abs(x - w / 2) / (w / 2);
    if (distCenter > 0.95) return [12, 16, 26, 255];

    const coreGlow = Math.pow(1 - distCenter, 2.2);
    const pulseWave = Math.sin(y * 0.15 + x * 0.05) * 0.2 + 0.8;

    // Glowing cyan/violet thermal plasma stream at bottom of fissure
    const r = Math.round(20 + coreGlow * 120 * pulseWave);
    const g = Math.round(35 + coreGlow * 210 * pulseWave);
    const b = Math.round(60 + coreGlow * 255);

    return [
      Math.min(255, r),
      Math.min(255, g),
      Math.min(255, b),
      255
    ];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'chasm_fissure.png'));
}

// 3. Natural Ancient Rock / Crystal Bridge (96x160)
async function generateNaturalBridge() {
  const w = 96, h = 160;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = w / 2;
    const dx = Math.abs(x - cx);
    // Bridge spans vertically along Y, width ~60px
    if (dx > 32) return [0, 0, 0, 0];

    const edgeDist = 32 - dx;
    const edgeShade = Math.min(1, edgeDist / 6);
    // Smooth ancient carved rock surface with gold inlay runes
    const r = Math.round((36 + Math.sin(y * 0.2) * 6) * edgeShade);
    const g = Math.round((46 + Math.sin(x * 0.3) * 8) * edgeShade);
    const b = Math.round((68 + Math.cos(y * 0.15) * 10) * edgeShade);

    // Golden rune line down center
    if (dx < 3 && Math.sin(y * 0.3) > 0.3) {
      return [255, 215, 60, 255];
    }

    return [r, g, b, 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'natural_bridge.png'));
}

// 4. Jetpack Thruster Plume (Flame / energetic plasma burst for gliding, 32x48)
async function generateJetPlume() {
  const w = 32, h = 48;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = w / 2;
    const dx = Math.abs(x - cx);
    if (y < 4 || y > 44) return [0, 0, 0, 0];

    const prog = (y - 4) / 40;
    const maxDx = (1 - prog * 0.6) * 11;
    if (dx > maxDx) return [0, 0, 0, 0];

    const t = dx / (maxDx || 1);
    if (t < 0.35 && prog < 0.6) {
      // White-hot core
      return [255, 255, 240, 255];
    } else if (t < 0.7) {
      // Brilliant cyan / gold energy flame
      return [
        Math.round(100 + (1 - prog) * 155),
        Math.round(220 + (1 - prog) * 35),
        255,
        Math.round((1 - prog * 0.8) * 255)
      ];
    } else {
      return [
        60,
        180,
        255,
        Math.round((1 - t) * (1 - prog) * 220)
      ];
    }
  });
  await savePng(buf, w, h, path.join(assetsDir, 'jet_plume.png'));
}

async function run() {
  console.log('Generating Phase 3 vertical terrain and traversal assets...');
  await generateCliffWall();
  await generateChasmFissure();
  await generateNaturalBridge();
  await generateJetPlume();
  console.log('Phase 3 assets generated successfully!');
}

run().catch(console.error);

