import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outPath = path.resolve('public/assets/alien_horizon_panorama.png');

const W = 2048;
const H = 512;
const buf = Buffer.alloc(W * H * 4);

// Seeded pseudorandom
function pseudo(seed) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

// Generate stars
const starCount = 380;
const stars = [];
for (let i = 0; i < starCount; i++) {
  stars.push({
    x: Math.floor(pseudo(i * 13.1) * W),
    y: Math.floor(pseudo(i * 29.7) * (H * 0.55)),
    r: pseudo(i * 47.3) > 0.85 ? 2 : 1,
    brightness: 0.4 + pseudo(i * 61.2) * 0.6,
    color: pseudo(i * 83.4) > 0.5 ? [56, 189, 248] : [216, 180, 254] // cyan or purple
  });
}

// Periodic mountain profile (seamless at x = 0 and x = W)
function getMountainHeight(x, layer) {
  const theta = (x / W) * Math.PI * 2;
  if (layer === 0) {
    // Distant colossal peaks
    const h1 = Math.sin(theta * 3) * 60;
    const h2 = Math.cos(theta * 7) * 35;
    const h3 = Math.sin(theta * 13 + 1.2) * 20;
    const h4 = Math.abs(Math.sin(theta * 5)) * 45;
    return 210 + h1 + h2 + h3 + h4;
  } else if (layer === 1) {
    // Midground spires & ridges
    const h1 = Math.sin(theta * 6 + 0.8) * 45;
    const h2 = Math.abs(Math.cos(theta * 11)) * 38;
    const h3 = Math.sin(theta * 19) * 16;
    return 150 + h1 + h2 + h3;
  } else {
    // Foreground rocky foothills & alien flora
    const h1 = Math.cos(theta * 4 - 0.4) * 30;
    const h2 = Math.sin(theta * 12 + 0.5) * 22;
    const h3 = Math.cos(theta * 24) * 12;
    return 95 + h1 + h2 + h3;
  }
}

// Giant Planetary Ring in Sky (diagonal band from x ~ 400 to 1600)
function getRingIntensity(x, y) {
  // Arcing ring ellipse across the celestial dome
  const theta = (x / W) * Math.PI * 2;
  const ringY = 130 + Math.sin(theta + 0.5) * 85;
  const dist = Math.abs(y - ringY);
  if (dist < 28) {
    const core = Math.exp(-dist * 0.12);
    // Add fine ring striations
    const band = (Math.sin(dist * 0.85) + 1) * 0.5;
    return core * (0.65 + band * 0.35);
  }
  return 0;
}

// Colossal Derelict Obelisk Spire at specific angles (theta = 0.5, 2.2, 3.8, 5.1)
const spireAngles = [0.45, 2.15, 3.75, 5.25];
function getSpireMask(x, y) {
  const theta = (x / W) * Math.PI * 2;
  for (const sAngle of spireAngles) {
    let dAngle = Math.abs(theta - sAngle);
    if (dAngle > Math.PI) dAngle = Math.PI * 2 - dAngle;
    const distPx = dAngle * (W / (Math.PI * 2));
    if (distPx < 14) {
      const spireTop = 70;
      const spireBottom = 340;
      if (y >= spireTop && y <= spireBottom) {
        // Taper towards top
        const taper = 1 - (spireBottom - y) / (spireBottom - spireTop) * 0.55;
        if (distPx < 14 * taper) {
          // Inside spire
          const isEnergyCore = distPx < 2.5 && y > 110;
          return { inside: true, isEnergyCore };
        }
      }
    }
  }
  return { inside: false, isEnergyCore: false };
}

for (let y = 0; y < H; y++) {
  const yNorm = y / H;
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;

    // 1. Sky Gradient: Deep space indigo at top -> vibrant alien violet/cyan at horizon
    let r = 8 + Math.floor(yNorm * 18);
    let g = 10 + Math.floor(yNorm * 22);
    let b = 24 + Math.floor(yNorm * 48);

    // 2. Cosmic Nebula Cloud
    const theta = (x / W) * Math.PI * 2;
    const neb = (Math.sin(theta * 2 + yNorm * 3) * 0.5 + 0.5) * (1 - yNorm * 0.7);
    if (neb > 0.25) {
      r += Math.floor(neb * 38);
      g += Math.floor(neb * 16);
      b += Math.floor(neb * 55);
    }

    // 3. Planetary Ring Glow
    const ring = getRingIntensity(x, y);
    if (ring > 0) {
      r += Math.floor(ring * 110);
      g += Math.floor(ring * 180);
      b += Math.floor(ring * 240);
    }

    // 4. Distant Mountain Silhouette Layer 0 (Colossal Alien Peaks)
    const mHeight0 = getMountainHeight(x, 0);
    const mBaseY0 = H - mHeight0;
    if (y >= mBaseY0) {
      const depth = (y - mBaseY0) / Math.max(1, mHeight0);
      // Dark silhouette with cyan/violet atmospheric rim light
      const rim = Math.max(0, 1 - (y - mBaseY0) * 0.08);
      r = Math.floor(18 * depth + rim * 45);
      g = Math.floor(22 * depth + rim * 95);
      b = Math.floor(45 * depth + rim * 140);
    }

    // 5. Midground Spire & Mountain Layer 1
    const mHeight1 = getMountainHeight(x, 1);
    const mBaseY1 = H - mHeight1;
    if (y >= mBaseY1) {
      const depth = (y - mBaseY1) / Math.max(1, mHeight1);
      // Bioluminescent crystal veins along ridges
      const vein = Math.sin(x * 0.12 + y * 0.08) > 0.88 ? 0.8 : 0;
      r = Math.floor(14 * depth + vein * 180);
      g = Math.floor(18 * depth + vein * 80);
      b = Math.floor(38 * depth + vein * 255);
    }

    // 6. Foreground Foothills Layer 2
    const mHeight2 = getMountainHeight(x, 2);
    const mBaseY2 = H - mHeight2;
    if (y >= mBaseY2) {
      const depth = (y - mBaseY2) / Math.max(1, mHeight2);
      r = Math.floor(10 * depth);
      g = Math.floor(14 * depth);
      b = Math.floor(26 * depth);
    }

    // 7. Colossal Obelisk Spires
    const spire = getSpireMask(x, y);
    if (spire.inside) {
      if (spire.isEnergyCore) {
        // Blazing cyan conduit
        r = 56;
        g = 230;
        b = 255;
      } else {
        // Dark alien alloy monolith with gold edge
        r = 24;
        g = 28;
        b = 48;
      }
    }

    // 8. Ground Atmospheric Fog fade at bottom
    if (y > H - 85) {
      const fog = (y - (H - 85)) / 85;
      r = Math.floor(r * (1 - fog) + 12 * fog);
      g = Math.floor(g * (1 - fog) + 18 * fog);
      b = Math.floor(b * (1 - fog) + 36 * fog);
    }

    buf[idx] = Math.min(255, r);
    buf[idx + 1] = Math.min(255, g);
    buf[idx + 2] = Math.min(255, b);
    buf[idx + 3] = 255;
  }
}

// Draw crisp twinkling stars
for (const s of stars) {
  for (let dy = -s.r; dy <= s.r; dy++) {
    for (let dx = -s.r; dx <= s.r; dx++) {
      const px = (s.x + dx + W) % W;
      const py = s.y + dy;
      if (py >= 0 && py < H && dx * dx + dy * dy <= s.r * s.r) {
        // Only draw if above mountain skyline
        const mBase = H - getMountainHeight(px, 0);
        if (py < mBase) {
          const idx = (py * W + px) * 4;
          buf[idx] = Math.min(255, buf[idx] + Math.floor(s.color[0] * s.brightness));
          buf[idx + 1] = Math.min(255, buf[idx + 1] + Math.floor(s.color[1] * s.brightness));
          buf[idx + 2] = Math.min(255, buf[idx + 2] + Math.floor(s.color[2] * s.brightness));
        }
      }
    }
  }
}

await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(outPath);
console.log(`Horizon Panorama generated: ${outPath} (${W}x${H})`);

