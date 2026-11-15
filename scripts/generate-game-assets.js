import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const assetsDir = path.resolve('public/assets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Helper to create an RGBA buffer
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

// 1. Drop Shadow (Soft ellipse shadow for player & enemies)
async function generateShadow() {
  const w = 64, h = 32;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const nx = (x - w / 2) / (w / 2);
    const ny = (y - h / 2) / (h / 2);
    const dist = Math.sqrt(nx * nx + ny * ny);
    if (dist >= 1) return [0, 0, 0, 0];
    const alpha = Math.round(Math.pow(1 - dist, 1.5) * 140);
    return [0, 5, 12, alpha];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'shadow.png'));
}

// 2. Terrain tile: Frozen icy permafrost with subtle cracked veins
async function generateTerrainTiles() {
  const size = 128;
  const iceBuf = createBuffer(size, size, (x, y, w, h) => {
    // Perlin-like pseudo noise using sine/cosine harmonics
    const v1 = Math.sin(x * 0.08) * Math.cos(y * 0.08);
    const v2 = Math.sin((x + y) * 0.04) * 0.5;
    const v3 = Math.cos(x * 0.15 - y * 0.1) * 0.25;
    const n = (v1 + v2 + v3 + 1.75) / 3.5; // [0, 1]

    // Ice hues: dark navy/slate blue base to bright frosty cyan highlights
    const r = Math.round(18 + n * 24);
    const g = Math.round(30 + n * 45);
    const b = Math.round(48 + n * 70);

    // Subtle frost crack line
    const crack = Math.abs(Math.sin(x * 0.12 + Math.sin(y * 0.05) * 3));
    const isCrack = crack < 0.08 ? 1 - crack / 0.08 : 0;

    return [
      Math.min(255, Math.round(r + isCrack * 60)),
      Math.min(255, Math.round(g + isCrack * 80)),
      Math.min(255, Math.round(b + isCrack * 100)),
      255
    ];
  });
  await savePng(iceBuf, size, size, path.join(assetsDir, 'terrain_ice.png'));

  // Thawed dark soil patch
  const soilBuf = createBuffer(size, size, (x, y, w, h) => {
    const v = (Math.sin(x * 0.1) + Math.cos(y * 0.12) + 2) / 4;
    return [
      Math.round(22 + v * 18),
      Math.round(18 + v * 15),
      Math.round(26 + v * 20),
      255
    ];
  });
  await savePng(soilBuf, size, size, path.join(assetsDir, 'terrain_soil.png'));
}

// 3. Purple Crystal Cluster (Obstacle)
async function generateCrystal() {
  const w = 128, h = 160;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    // Multi-faceted crystal spire
    const cx = w / 2;
    // Ground anchor at y = 140
    if (y > 148) return [0, 0, 0, 0];

    // Main central crystal: tip at (64, 15), base at (40-88, 140)
    let inMain = false;
    let facet = 0;
    if (y >= 15 && y <= 140) {
      const progress = (y - 15) / 125;
      const halfW = progress * 26 + 2;
      if (Math.abs(x - cx) <= halfW) {
        inMain = true;
        facet = (x - cx) / halfW; // [-1, 1]
      }
    }

    // Left satellite crystal: tip at (32, 55), base at (20-44, 135)
    let inLeft = false;
    let facetLeft = 0;
    if (y >= 55 && y <= 135) {
      const progress = (y - 55) / 80;
      const lx = 32 - progress * 4;
      const halfW = progress * 14 + 2;
      if (Math.abs(x - lx) <= halfW) {
        inLeft = true;
        facetLeft = (x - lx) / halfW;
      }
    }

    // Right satellite crystal: tip at (96, 70), base at (84-106, 138)
    let inRight = false;
    let facetRight = 0;
    if (y >= 70 && y <= 138) {
      const progress = (y - 70) / 68;
      const rx = 96 + progress * 2;
      const halfW = progress * 13 + 2;
      if (Math.abs(x - rx) <= halfW) {
        inRight = true;
        facetRight = (x - rx) / halfW;
      }
    }

    if (inMain) {
      // Violet crystal shading with bright edge
      const edge = 1 - Math.abs(facet);
      const shade = facet < 0 ? 0.85 : 0.6;
      const r = Math.round((140 + edge * 90) * shade);
      const g = Math.round((40 + edge * 70) * shade);
      const b = Math.round((210 + edge * 45) * shade);
      return [r, g, b, 255];
    } else if (inLeft) {
      const edge = 1 - Math.abs(facetLeft);
      const shade = facetLeft < 0 ? 0.9 : 0.65;
      return [Math.round((120 + edge * 80) * shade), Math.round((30 + edge * 60) * shade), Math.round((190 + edge * 50) * shade), 255];
    } else if (inRight) {
      const edge = 1 - Math.abs(facetRight);
      const shade = facetRight < 0 ? 0.75 : 0.55;
      return [Math.round((110 + edge * 70) * shade), Math.round((25 + edge * 50) * shade), Math.round((180 + edge * 45) * shade), 255];
    }

    // Outer glow / aura around crystals
    const dMain = Math.hypot(x - cx, y - 80);
    if (dMain < 65) {
      const glow = Math.pow(1 - dMain / 65, 2) * 50;
      return [160, 50, 240, Math.round(glow)];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'crystal_cluster.png'));
}

// 4. Bioluminescent Alien Flora (Plant)
async function generateAlienFlora() {
  const w = 96, h = 110;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    // Base stalk at y = 95
    if (y > 102) return [0, 0, 0, 0];

    // Glowing bulbous head
    const bx = cx;
    const by = 42;
    const bulbDist = Math.hypot((x - bx) * 0.9, y - by);
    if (bulbDist < 26) {
      const t = bulbDist / 26;
      // Vibrant cyan / emerald bioluminescence
      const r = Math.round(10 + (1 - t) * 60);
      const g = Math.round(200 + (1 - t) * 55);
      const b = Math.round(220 + (1 - t) * 35);
      return [r, g, b, 255];
    }

    // Tendril / stalk connecting to ground
    const dx = Math.sin(y * 0.08) * 6;
    if (y >= 40 && y <= 98) {
      if (Math.abs(x - (cx + dx)) < (3 + (y - 40) * 0.05)) {
        return [20, 110, 120, 255];
      }
    }

    // Ambient glow
    if (bulbDist < 44) {
      const glow = Math.pow(1 - bulbDist / 44, 2) * 80;
      return [0, 230, 220, Math.round(glow)];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'alien_flora.png'));
}

// 5. Alien Rock Formation (Natural Obstacle)
async function generateAlienRock() {
  const w = 120, h = 90;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    const cy = 52;
    const rx = 48, ry = 30;
    // Jagged oval
    const angle = Math.atan2(y - cy, x - cx);
    const wobble = Math.sin(angle * 5) * 5 + Math.cos(angle * 8) * 3;
    const d = Math.hypot((x - cx) / (rx + wobble), (y - cy) / (ry + wobble));
    if (d <= 1) {
      // Shading based on light from top-left
      const lx = (x - (cx - 15)) / rx;
      const ly = (y - (cy - 15)) / ry;
      const light = Math.max(0.25, 1 - (lx * 0.5 + ly * 0.7));
      const r = Math.round((38 + Math.sin(x * 0.3) * 6) * light);
      const g = Math.round((48 + Math.sin(y * 0.3) * 8) * light);
      const b = Math.round((64 + Math.cos(x * 0.2) * 10) * light);
      return [r, g, b, 255];
    }
    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'alien_rock.png'));
}

// 6. Alien Organic Pod (Loot Chest)
async function generateOrganicPod() {
  const w = 96, h = 96;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    const cy = 50;
    const d = Math.hypot(x - cx, (y - cy) * 1.1);
    if (d <= 32) {
      const t = d / 32;
      // Organic pod: deep chitinous purple exterior with pulsing amber/golden bioluminescent seam
      const seamDist = Math.abs((x - cx) + Math.sin(y * 0.15) * 4);
      if (seamDist < 4) {
        // Glowing gold core seam
        return [255, 210, 50, 255];
      }
      const r = Math.round(110 * (1 - t * 0.5));
      const g = Math.round(35 * (1 - t * 0.5));
      const b = Math.round(140 * (1 - t * 0.4));
      return [r, g, b, 255];
    }
    // Tendrils rooted in ground
    if (y > 60 && y < 85 && Math.abs(x - cx) < 38) {
      const tDist = Math.abs(x - cx);
      if (tDist > 25 && tDist < 35) {
        return [60, 20, 80, 255];
      }
    }
    // Core glow
    if (d < 45) {
      const g = Math.pow(1 - d / 45, 2) * 90;
      return [255, 180, 40, Math.round(g)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'organic_pod.png'));
}

// 7. Overseer Artifact (Ancient Obelisk / Monolith)
async function generateArtifact() {
  const w = 140, h = 200;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    // Monolith body: tapered ancient obelisk
    if (y >= 20 && y <= 170) {
      const prog = (y - 20) / 150;
      const halfW = 12 + prog * 28;
      const dx = Math.abs(x - cx);
      if (dx <= halfW) {
        const u = dx / halfW;
        // Sci-fi metallic obsidian with gold inlay runes
        const rune = (Math.sin(y * 0.3) > 0.7 && dx < 6) || (Math.cos(y * 0.2) > 0.8 && dx > 8 && dx < 14);
        if (rune) {
          return [255, 220, 80, 255]; // Ancient golden energy rune
        }
        const shade = u < 0.5 ? 0.9 : 0.65;
        const r = Math.round(28 * shade);
        const g = Math.round(34 * shade);
        const b = Math.round(52 * shade);
        return [r, g, b, 255];
      }
    }

    // Floating crown / halo above obelisk
    const crownDist = Math.hypot(x - cx, y - 22);
    if (crownDist > 14 && crownDist < 20) {
      return [255, 215, 60, 240];
    }

    // Surrounding energy aura
    const dCenter = Math.hypot((x - cx) * 0.7, y - 95);
    if (dCenter < 75) {
      const aura = Math.pow(1 - dCenter / 75, 2) * 70;
      return [240, 190, 40, Math.round(aura)];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'overseer_artifact.png'));
}

// 8. Enemy: Crawler (Melee Alien)
async function generateCrawler() {
  const w = 80, h = 70;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    const cy = 36;
    // Chitinous carapace body
    const d = Math.hypot((x - cx) * 1.1, y - cy);
    if (d <= 20) {
      // Crimson/purple chitin
      const t = d / 20;
      // Glowing orange-red slit eyes at top
      if (y >= cy - 10 && y <= cy - 5 && (Math.abs(x - (cx - 7)) < 3 || Math.abs(x - (cx + 7)) < 3)) {
        return [255, 90, 20, 255];
      }
      const r = Math.round(170 * (1 - t * 0.4));
      const g = Math.round(35 * (1 - t * 0.4));
      const b = Math.round(55 * (1 - t * 0.4));
      return [r, g, b, 255];
    }
    // Claws / scuttling legs
    for (let i = -1; i <= 1; i += 2) {
      // 3 legs on each side
      for (let leg = -1; leg <= 1; leg++) {
        const lx = cx + i * (18 + Math.abs(leg) * 4);
        const ly = cy + leg * 10;
        const legDist = Math.hypot(x - lx, y - (ly + 8));
        if (legDist < 3.5) {
          return [120, 20, 40, 255];
        }
      }
    }
    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_crawler.png'));
}

// 9. Enemy: Spitter (Ranged Alien)
async function generateSpitter() {
  const w = 84, h = 84;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    const cy = 40;
    // Bulbous sac with toxic green/cyan bile
    const d = Math.hypot(x - cx, (y - cy) * 0.95);
    if (d <= 24) {
      const t = d / 24;
      // Toxic core
      if (d < 12) {
        return [60, 255, 120, 255];
      }
      const r = Math.round(40 + (1 - t) * 40);
      const g = Math.round(130 + (1 - t) * 80);
      const b = Math.round(90 + (1 - t) * 30);
      return [r, g, b, 255];
    }
    // Mouth nozzle / mandible
    if (y > 48 && y < 65 && Math.abs(x - cx) < 6) {
      return [25, 90, 60, 255];
    }
    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_spitter.png'));
}

// 10. Enemy: Elite Crawler (Bigger, armored, cyan spines)
async function generateEliteCrawler() {
  const w = 110, h = 96;
  const buf = createBuffer(w, h, (x, y, w, h) => {
    const cx = w / 2;
    const cy = 48;
    const d = Math.hypot((x - cx) * 1.05, y - cy);
    if (d <= 30) {
      const t = d / 30;
      // Royal violet armored plating
      // Cyan glowing spines
      const spine = Math.abs(Math.sin((x - cx) * 0.2)) > 0.8 && (y < cy);
      if (spine) {
        return [40, 230, 255, 255];
      }
      // Glowing dual eyes
      if (y >= cy - 14 && y <= cy - 7 && (Math.abs(x - (cx - 10)) < 4 || Math.abs(x - (cx + 10)) < 4)) {
        return [0, 240, 255, 255];
      }
      const r = Math.round(90 * (1 - t * 0.3));
      const g = Math.round(30 * (1 - t * 0.3));
      const b = Math.round(160 * (1 - t * 0.3));
      return [r, g, b, 255];
    }
    // Heavy spiked legs
    for (let i = -1; i <= 1; i += 2) {
      for (let leg = -1; leg <= 1; leg++) {
        const lx = cx + i * (26 + Math.abs(leg) * 5);
        const ly = cy + leg * 14;
        const legDist = Math.hypot(x - lx, y - (ly + 10));
        if (legDist < 5) {
          return [70, 20, 120, 255];
        }
      }
    }
    // Elite cyan aura
    if (d < 46) {
      const a = Math.pow(1 - d / 46, 2) * 80;
      return [0, 220, 255, Math.round(a)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_elite.png'));
}

// 11. Projectiles: Energy Pulse, Piercing Wave, Acid Glob, Orbital Strike Reticle
async function generateProjectiles() {
  // Energy Pulse: Bright gold/cyan energy orb with trailing core
  const pBuf = createBuffer(32, 32, (x, y, w, h) => {
    const d = Math.hypot(x - 16, y - 16);
    if (d <= 6) return [255, 255, 220, 255]; // Pure core
    if (d <= 14) {
      const t = (d - 6) / 8;
      return [255, Math.round(210 - t * 60), Math.round(70 - t * 50), Math.round((1 - t) * 255)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(pBuf, 32, 32, path.join(assetsDir, 'proj_pulse.png'));

  // Piercing Wave: Crescent energy slash
  const wBuf = createBuffer(64, 40, (x, y, w, h) => {
    const cx = 32, cy = 20;
    // Outer arc
    const dOut = Math.hypot((x - cx) * 0.7, y - 5);
    const dIn = Math.hypot((x - cx) * 0.7, y + 2);
    if (dOut <= 24 && dIn >= 18) {
      return [100, 220, 255, 255]; // Brilliant cyan energy wave
    }
    if (dOut <= 27 && dIn >= 15) {
      return [60, 180, 255, 120];
    }
    return [0, 0, 0, 0];
  });
  await savePng(wBuf, 64, 40, path.join(assetsDir, 'proj_wave.png'));

  // Enemy Acid Spit
  const sBuf = createBuffer(24, 24, (x, y, w, h) => {
    const d = Math.hypot(x - 12, y - 12);
    if (d <= 5) return [120, 255, 80, 255];
    if (d <= 10) return [60, 200, 40, Math.round((1 - (d - 5) / 5) * 220)];
    return [0, 0, 0, 0];
  });
  await savePng(sBuf, 24, 24, path.join(assetsDir, 'proj_acid.png'));

  // Orbital Reticle
  const rBuf = createBuffer(96, 96, (x, y, w, h) => {
    const cx = 48, cy = 48;
    const d = Math.hypot(x - cx, y - cy);
    if (Math.abs(d - 38) < 2.5 || Math.abs(d - 22) < 1.5) {
      return [255, 200, 40, 240];
    }
    // Crosshairs
    if ((Math.abs(x - cx) < 2 || Math.abs(y - cy) < 2) && d < 44 && d > 12) {
      return [255, 220, 60, 220];
    }
    return [0, 0, 0, 0];
  });
  await savePng(rBuf, 96, 96, path.join(assetsDir, 'orbital_reticle.png'));

  // Orbital Strike Beam
  const bBuf = createBuffer(80, 400, (x, y, w, h) => {
    const cx = 40;
    const dx = Math.abs(x - cx);
    if (dx <= 8) return [255, 255, 240, 255]; // Intense white-gold column
    if (dx <= 24) {
      const t = (dx - 8) / 16;
      return [255, Math.round(200 - t * 80), Math.round(60), Math.round((1 - t) * 220)];
    }
    if (dx <= 38) {
      const t = (dx - 24) / 14;
      return [240, 140, 40, Math.round((1 - t) * 90)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(bBuf, 80, 400, path.join(assetsDir, 'orbital_beam.png'));

  // Currency Shard (Overseer energy credit)
  const cBuf = createBuffer(24, 24, (x, y, w, h) => {
    const d = Math.abs(x - 12) + Math.abs(y - 12); // Diamond shape
    if (d <= 7) return [255, 230, 80, 255];
    if (d <= 10) return [220, 160, 30, 200];
    return [0, 0, 0, 0];
  });
  await savePng(cBuf, 24, 24, path.join(assetsDir, 'currency_shard.png'));
}

// 12. Item Icons for HUD / Inventory
async function generateItemIcons() {
  const size = 64;

  // 1. Overdrive (Gear / Turbofan / Chrono speed glyph)
  const overBuf = createBuffer(size, size, (x, y, w, h) => {
    const cx = size / 2, cy = size / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d < 28 && d > 20) return [255, 140, 20, 255]; // Orange energetic ring
    // Blades
    const angle = Math.atan2(y - cy, x - cx);
    const blade = Math.sin(angle * 6 + d * 0.1);
    if (d < 22 && d > 8 && blade > 0.4) return [255, 190, 40, 255];
    if (d <= 7) return [255, 240, 120, 255];
    return [0, 0, 0, 0];
  });
  await savePng(overBuf, size, size, path.join(assetsDir, 'item_overdrive.png'));

  // 2. Vital Core (Heart / Life gem)
  const vitBuf = createBuffer(size, size, (x, y, w, h) => {
    const cx = size / 2, cy = size / 2;
    // Stylized heart / shield
    const nx = (x - cx) / 22;
    const ny = (y - (cy - 4)) / 22;
    const heart = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3);
    if (heart <= 0) {
      return [40, 230, 140, 255]; // Vibrant restorative emerald
    }
    const d = Math.hypot(x - cx, y - cy);
    if (d < 28) {
      const a = Math.pow(1 - d / 28, 2) * 90;
      return [30, 220, 130, Math.round(a)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(vitBuf, size, size, path.join(assetsDir, 'item_vital_core.png'));

  // 3. Chain Spark (Lightning bolt)
  const sparkBuf = createBuffer(size, size, (x, y, w, h) => {
    const cx = size / 2, cy = size / 2;
    // Lightning polygon
    const inBolt = (
      (y >= 10 && y <= 32 && Math.abs((x - 36) + (y - 20) * 0.4) < 6) ||
      (y >= 26 && y <= 36 && x >= 22 && x <= 42) ||
      (y >= 32 && y <= 54 && Math.abs((x - 28) + (y - 42) * 0.4) < 5)
    );
    if (inBolt) return [100, 210, 255, 255]; // Electric cyan lightning
    const d = Math.hypot(x - cx, y - cy);
    if (d < 26) {
      const a = Math.pow(1 - d / 26, 2) * 80;
      return [50, 190, 255, Math.round(a)];
    }
    return [0, 0, 0, 0];
  });
  await savePng(sparkBuf, size, size, path.join(assetsDir, 'item_chain_spark.png'));
}

async function run() {
  console.log('Generating procedural game assets...');
  await generateShadow();
  await generateTerrainTiles();
  await generateCrystal();
  await generateAlienFlora();
  await generateAlienRock();
  await generateOrganicPod();
  await generateArtifact();
  await generateCrawler();
  await generateSpitter();
  await generateEliteCrawler();
  await generateProjectiles();
  await generateItemIcons();
  console.log('All game assets generated successfully!');
}

run().catch(console.error);

