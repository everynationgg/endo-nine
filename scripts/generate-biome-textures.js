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
  console.log(`Generated: ${outPath} (${w}x${h})`);
}

// Seamless periodic noise helper using exact harmonic frequencies (2 * PI * k / size)
function periodicNoise(x, y, size, k1, k2, k3) {
  const tau = Math.PI * 2;
  const nx = (x / size) * tau;
  const ny = (y / size) * tau;

  const n1 = Math.sin(nx * k1 + Math.cos(ny * k2)) * 0.5 + Math.cos(ny * k1 - Math.sin(nx * k2)) * 0.5;
  const n2 = Math.sin(nx * k2 * 2 + ny * k1) * 0.25 + Math.cos(ny * k2 * 2 - nx * k3) * 0.25;
  const n3 = Math.sin(nx * k3 * 3 - ny * k2 * 2) * 0.125 + Math.cos(ny * k3 * 3 + nx * k1) * 0.125;

  return (n1 + n2 + n3 + 1.75) / 3.5; // Normalized ~0 to 1
}

// 1. Lush Alien Grass Ground (512x512 Seamless)
// Rich alien turf blending deep forest jade, bright alien mint blades, and patches of dark organic mud
async function generateAlienGrass() {
  const w = 512, h = 512;
  const buf = createBuffer(w, h, (x, y) => {
    const macro = periodicNoise(x, y, w, 2, 3, 5);      // Macro patchiness: grass vs mud patches
    const grassBlade = periodicNoise(x * 3 % w, y * 3 % h, w, 11, 17, 23); // Fine grass blade texture
    const detail = periodicNoise(x, y, w, 7, 13, 19);

    if (macro < 0.28) {
      // Dark organic alien mud patch showing through the turf
      const mudT = macro / 0.28;
      let r = Math.round(28 + detail * 18);
      let g = Math.round(24 + detail * 14);
      let b = Math.round(34 + detail * 22);

      // Wet alien slime sheen on mud
      if (grassBlade > 0.65) {
        r += 15; g += 35; b += 40;
      }
      return [r, g, b, 255];
    }

    // Lush Alien Grass: jade emerald (#1b4d3e) to vibrant bio-mint (#22c55e / #10b981)
    const gBlend = (macro - 0.28) / 0.72;
    let r = Math.round(20 + gBlend * 25 + grassBlade * 18);
    let g = Math.round(65 + gBlend * 85 + grassBlade * 45);
    let b = Math.round(45 + gBlend * 35 + detail * 20);

    // Glowing bio-lichen spore specks scattered across the grass
    if (grassBlade > 0.82) {
      const spT = (grassBlade - 0.82) / 0.18;
      r = Math.min(255, Math.round(r + spT * 80));
      g = Math.min(255, Math.round(g + spT * 120));
      b = Math.min(255, Math.round(b + spT * 190));
    }

    return [r, g, b, 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'terrain_alien_grass.png'));
}

// 2. Wet Organic Alien Mud (512x512 Seamless)
// Squishy dark soil, purple-black alien humus, glistening damp mud pools
async function generateAlienMud() {
  const w = 512, h = 512;
  const buf = createBuffer(w, h, (x, y) => {
    const v = periodicNoise(x, y, w, 2, 4, 6);
    const detail = periodicNoise(x, y, w, 8, 14, 20);
    const puddle = periodicNoise(x, y, w, 3, 5, 7);

    // Deep alien mud base (#1e1728 -> #342840)
    let r = Math.round(30 + v * 28 + detail * 10);
    let g = Math.round(24 + v * 20 + detail * 8);
    let b = Math.round(42 + v * 36 + detail * 14);

    // Wet squishy mud puddle sheen
    if (puddle > 0.62) {
      const pT = (puddle - 0.62) / 0.38;
      r = Math.round(r + pT * 35);
      g = Math.round(g + pT * 55);
      b = Math.round(b + pT * 85);
    }

    // Alien organic moss speckles clinging to damp soil
    if (detail > 0.75) {
      g = Math.min(255, g + 40);
      r = Math.max(10, r - 10);
    }

    return [r, g, b, 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'terrain_alien_mud.png'));
}

// 3. Natural Organic Cliff Rock (512x512 Seamless)
// Natural weathered alien rock face with mossy ledges, dark basalt strata, and earthy mud bands
async function generateOrganicCliffRock() {
  const w = 512, h = 512;
  const tau = Math.PI * 2;

  const buf = createBuffer(w, h, (x, y) => {
    const ny = (y / h) * tau;
    const nx = (x / w) * tau;

    // Natural wavy horizontal rock striations (not artificial straight lines!)
    const layer = Math.sin(ny * 5 + Math.sin(nx * 3) * 0.8) * 0.4 +
                  Math.sin(ny * 11 + Math.cos(nx * 4) * 0.6) * 0.25;
    const rough = periodicNoise(x, y, w, 4, 8, 14) * 0.35;
    const v = (layer + rough + 1.2) / 2.4;

    // Dark slate & earthy clay cliff rock (#232b38 -> #4a5568)
    let r = Math.round(38 + v * 45);
    let g = Math.round(44 + v * 48);
    let b = Math.round(56 + v * 58);

    // Organic alien moss clinging to rock shelves
    const moss = Math.sin(ny * 7 + Math.cos(nx * 5) * 1.2);
    if (moss > 0.55 && v > 0.4) {
      const mT = (moss - 0.55) / 0.45;
      r = Math.round(r * (1 - mT * 0.4));
      g = Math.min(255, Math.round(g + mT * 65));
      b = Math.round(b * (1 - mT * 0.3));
    }

    return [r, g, b, 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'cliff_organic_rock.png'));
}

// 4. Plateau Grass Cap (512x512 Seamless)
// High-altitude elevated meadow: lush vibrant alien grass with purple wildflowers and moss
async function generatePlateauGrassCap() {
  const w = 512, h = 512;
  const buf = createBuffer(w, h, (x, y) => {
    const grass = periodicNoise(x, y, w, 3, 5, 8);
    const blades = periodicNoise(x * 2 % w, y * 2 % h, w, 12, 18, 24);

    // Lush highland alien grass (#166534 -> #22c55e)
    let r = Math.round(22 + grass * 26 + blades * 16);
    let g = Math.round(78 + grass * 75 + blades * 35);
    let b = Math.round(48 + grass * 35 + blades * 18);

    // Wild alien violet flowers scattered on the high ground
    const flower = periodicNoise(x, y, w, 9, 15, 21);
    if (flower > 0.78) {
      const fT = (flower - 0.78) / 0.22;
      r = Math.min(255, Math.round(r + fT * 180));
      g = Math.round(g * (1 - fT * 0.45));
      b = Math.min(255, Math.round(b + fT * 210));
    }

    return [r, g, b, 255];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'plateau_grass_cap.png'));
}

// 5. Natural Earthen Ramp Trail (256x256 Seamless)
// Worn muddy path beaten down by creatures, with trampled grass along the edges
async function generateEarthenRamp() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const centerDist = Math.abs(x - w / 2) / (w / 2); // 0 at center, 1 at edges
    const noise = (Math.sin(x * 0.12) + Math.cos(y * 0.18)) * 0.15;
    const edgeFactor = Math.min(1, Math.max(0, centerDist + noise));

    if (edgeFactor > 0.65) {
      // Lush grass along ramp edges
      const gT = (edgeFactor - 0.65) / 0.35;
      return [
        Math.round(25 + gT * 18),
        Math.round(85 + gT * 45),
        Math.round(48 + gT * 22),
        255
      ];
    } else {
      // Trampled dark alien mud & compacted dirt path in center
      const mudT = (1 - edgeFactor / 0.65);
      return [
        Math.round(45 + mudT * 15),
        Math.round(38 + mudT * 10),
        Math.round(48 + mudT * 18),
        255
      ];
    }
  });
  await savePng(buf, w, h, path.join(assetsDir, 'ramp_earthen.png'));
}

// 6. Splattered Alien Blood / Ichor Decal (256x256)
// Vibrant bioluminescent alien blood pool with splatter droplets, jagged streaks, and glowing core
async function generateAlienBloodDecal() {
  const w = 256, h = 256;
  const cx = w / 2;
  const cy = h / 2;

  const buf = createBuffer(w, h, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    // Organic splatter shape with jagged tentacles & droplets
    const lobes = Math.sin(angle * 7) * 14 + Math.cos(angle * 13) * 10 + Math.sin(angle * 4) * 18;
    const effectiveRadius = 65 + lobes;

    if (dist > effectiveRadius + 28) {
      // Check for small satellite droplets
      const dropNoise = Math.sin(dx * 0.25) * Math.cos(dy * 0.25);
      if (dist < 110 && dropNoise > 0.72) {
        // Cyan / acid-green alien droplet
        return [34, 211, 238, 220];
      }
      return [0, 0, 0, 0]; // Transparent background
    }

    const t = Math.max(0, 1 - dist / effectiveRadius);

    // Glowing alien blood: Electric Cyan (#22d3ee) at core fading to deep bio-indigo (#4338ca)
    const r = Math.round(20 + t * 45);
    const g = Math.round(180 + t * 65);
    const b = Math.round(220 + t * 35);
    const a = Math.round(Math.min(255, t * 320));

    return [r, g, b, a];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'alien_blood_decal.png'));
}

async function main() {
  await generateAlienGrass();
  await generateAlienMud();
  await generateOrganicCliffRock();
  await generatePlateauGrassCap();
  await generateEarthenRamp();
  await generateAlienBloodDecal();
  console.log('Organic alien biome textures (grass, mud, blood) generated successfully!');
}

main().catch(console.error);
