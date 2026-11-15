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
      buf[idx] = Math.max(0, Math.min(255, Math.round(color[0])));
      buf[idx + 1] = Math.max(0, Math.min(255, Math.round(color[1])));
      buf[idx + 2] = Math.max(0, Math.min(255, Math.round(color[2])));
      buf[idx + 3] = Math.max(0, Math.min(255, Math.round(color[3])));
    }
  }
  return buf;
}

async function savePng(buf, w, h, outPath) {
  ensureDir(path.dirname(outPath));
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPath);
  console.log(`Generated: ${outPath} (${w}x${h})`);
}

// Math helpers
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distSq(x1, y1, x2, y2) {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2;
}

// -------------------------------------------------------------
// 1. HD XENO CRAWLER (256x256)
// A menacing predatory insectoid alien with segmented carapace,
// razor scythe legs, glowing emerald eyes, and sharp chitin plating
// -------------------------------------------------------------
async function generateHDCrawler() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 128, cy = 135;
    const nx = (x - cx) / 128;
    const ny = (y - cy) / 128;

    // Carapace main body (ovoid abdomen + thoracic shield)
    const bodyDist = Math.hypot((x - cx) * 1.15, (y - cy) * 0.95);
    const headDist = Math.hypot((x - cx) * 1.3, (y - (cy + 36)) * 1.2);

    // Carapace plating
    if (bodyDist <= 48) {
      const t = bodyDist / 48;
      // Segmented ridges along the back
      const ridge = Math.cos((y - cy) * 0.45) * 0.15;
      const highlight = Math.max(0, 1 - Math.hypot((x - (cx - 12)) * 1.2, (y - (cy - 14)) * 1.2) / 36);

      // Deep alien obsidian-violet chitin with glowing emerald vein highlights
      const vein = Math.sin((x - cx) * 0.35 + (y - cy) * 0.25) > 0.88 ? 1 : 0;

      let r = lerp(60, 22, t) + highlight * 45;
      let g = lerp(16, 8, t) + highlight * 25 + vein * 160;
      let b = lerp(95, 36, t) + highlight * 70 + vein * 80;

      // Rim light
      if (t > 0.82) {
        r += 40; b += 55;
      }
      return [r, g, b, 255];
    }

    // Head & Mandibles
    if (headDist <= 24) {
      const ht = headDist / 24;
      // Glowing green compound eyes
      const eyeL = Math.hypot(x - (cx - 12), y - (cy + 38));
      const eyeR = Math.hypot(x - (cx + 12), y - (cy + 38));
      if (eyeL <= 6 || eyeR <= 6) {
        return [52, 255, 140, 255]; // Blazing emerald eye
      }
      if (eyeL <= 9 || eyeR <= 9) {
        return [20, 180, 80, 180]; // Eye glow halo
      }
      return [45, 15, 65, 255];
    }

    // Sharp pincer mandibles
    for (const side of [-1, 1]) {
      const mx = cx + side * 14;
      const my = cy + 46;
      const mDist = Math.hypot(x - (mx + side * 10), y - (my + 14));
      if (mDist < 7) {
        return [220, 230, 240, 255]; // Razor bone white pincers
      }
    }

    // 6 Segmented Scythe Legs
    for (const side of [-1, 1]) {
      for (let legIdx = 0; legIdx < 3; legIdx++) {
        const legAngle = (side > 0 ? 0 : Math.PI) + (legIdx - 1) * 0.45;
        // Joint 1: shoulder to elbow
        const j0x = cx + side * 28;
        const j0y = cy - 14 + legIdx * 18;
        const j1x = j0x + Math.cos(legAngle) * 42;
        const j1y = j0y + Math.sin(legAngle) * 32 - 12;
        // Joint 2: elbow to claw tip
        const j2x = j1x + Math.cos(legAngle + side * 0.6) * 34;
        const j2y = j1y + 36;

        // Line distance checks for joints
        const d1 = distToSegment(x, y, j0x, j0y, j1x, j1y);
        const d2 = distToSegment(x, y, j1x, j1y, j2x, j2y);

        if (d1 < 4.2 || d2 < 3.2) {
          // Sharp violet chitin legs with bone white tips
          const isTip = Math.hypot(x - j2x, y - j2y) < 8;
          if (isTip) return [200, 220, 240, 255];
          return [75, 25, 110, 255];
        }
      }
    }

    // Soft bio-ambient glow
    const totalDist = Math.hypot(x - cx, y - cy);
    if (totalDist < 62) {
      const a = (1 - totalDist / 62) * 60;
      return [120, 40, 180, a];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_crawler.png'));
}

// -------------------------------------------------------------
// 2. HD ACID SPITTER (256x256)
// Menacing ranged bio-artillery alien with translucent pulsating
// toxic acid sac, glowing bile glands, and dripping corrosive fangs
// -------------------------------------------------------------
async function generateHDSpitter() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 128, cy = 120;

    // Translucent Toxic Acid Abdomen (Large bulbous sac)
    const sacDist = Math.hypot((x - cx) * 1.05, (y - (cy - 18)) * 0.9);
    if (sacDist <= 58) {
      const st = sacDist / 58;
      // Inner glowing core of boiling acid
      const coreDist = Math.hypot(x - cx, y - (cy - 18));
      if (coreDist <= 26) {
        const ct = coreDist / 26;
        return [
          lerp(220, 80, ct),
          lerp(255, 230, ct),
          lerp(60, 20, ct),
          255
        ];
      }
      // Veiny sac membrane
      const veins = Math.sin((x - cx) * 0.4) * Math.cos((y - cy) * 0.4);
      let r = lerp(30, 15, st) + (veins > 0.4 ? 40 : 0);
      let g = lerp(160, 70, st) + (veins > 0.4 ? 70 : 0);
      let b = lerp(60, 25, st);
      let a = lerp(240, 190, st);
      return [r, g, b, a];
    }

    // Forebody & Fanged Maw
    const headDist = Math.hypot((x - cx) * 1.25, (y - (cy + 38)) * 1.1);
    if (headDist <= 28) {
      // Four glowing amber predatory eyes
      const eye1 = Math.hypot(x - (cx - 14), y - (cy + 34));
      const eye2 = Math.hypot(x - (cx + 14), y - (cy + 34));
      const eye3 = Math.hypot(x - (cx - 8), y - (cy + 42));
      const eye4 = Math.hypot(x - (cx + 8), y - (cy + 42));
      if (eye1 < 4 || eye2 < 4 || eye3 < 3 || eye4 < 3) {
        return [255, 200, 30, 255]; // Amber glow
      }
      return [35, 65, 45, 255];
    }

    // Dripping Acid Fangs / Spit Nozzle
    if (y >= cy + 48 && y <= cy + 74 && Math.abs(x - cx) <= 10) {
      const dripT = (y - (cy + 48)) / 26;
      if (dripT > 0.75) {
        return [140, 255, 60, 255]; // Glowing toxic drip droplet
      }
      return [25, 50, 35, 255];
    }

    // Heavy Quadrupedal Stalker Legs
    for (const side of [-1, 1]) {
      for (let legIdx = 0; legIdx < 2; legIdx++) {
        const j0x = cx + side * 34;
        const j0y = cy + legIdx * 28;
        const j1x = j0x + side * 44;
        const j1y = j0y - 10;
        const j2x = j1x + side * 14;
        const j2y = j1y + 54;

        const d1 = distToSegment(x, y, j0x, j0y, j1x, j1y);
        const d2 = distToSegment(x, y, j1x, j1y, j2x, j2y);

        if (d1 < 5.5 || d2 < 4.2) {
          return [38, 70, 50, 255];
        }
      }
    }

    // Toxic ambient aura
    const glowD = Math.hypot(x - cx, y - (cy - 18));
    if (glowD < 78) {
      const ga = (1 - glowD / 78) * 85;
      return [60, 255, 100, ga];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_spitter.png'));
}

// -------------------------------------------------------------
// 3. HD VOID GOLIATH (ELITE) (256x256)
// Colossal armored alien champion with jagged obsidian crown horns,
// pulsing cyan plasma conduits, and crackling coronal electric aura
// -------------------------------------------------------------
async function generateHDElite() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 128, cy = 130;

    // Heavy Plated Thoracic Carapace
    const bodyDist = Math.hypot((x - cx) * 1.08, (y - cy) * 0.92);
    if (bodyDist <= 58) {
      const bt = bodyDist / 58;

      // Glowing Cyan Plasma Vents running along the spinal column
      const isSpineVent = Math.abs(x - cx) <= 5 && (y >= cy - 42 && y <= cy + 18);
      if (isSpineVent) {
        return [34, 235, 255, 255]; // Radiant cyan plasma core
      }

      // Obsidian armored plating with cyan vein fractures
      const fracture = Math.sin((x - cx) * 0.45 + (y - cy) * 0.3) > 0.82;
      if (fracture) {
        return [0, 210, 255, 255];
      }

      const highlight = Math.max(0, 1 - Math.hypot((x - (cx - 16)), (y - (cy - 18))) / 42);
      let r = lerp(45, 18, bt) + highlight * 30;
      let g = lerp(20, 10, bt) + highlight * 25;
      let b = lerp(80, 35, bt) + highlight * 65;

      return [r, g, b, 255];
    }

    // Jagged Horned Crown Crest
    for (const side of [-1, 1]) {
      // Main Horn Spire
      const h0x = cx + side * 18;
      const h0y = cy - 38;
      const h1x = cx + side * 46;
      const h1y = cy - 88;
      const hd = distToSegment(x, y, h0x, h0y, h1x, h1y);
      if (hd <= 6.5) {
        // Horn tips glow cyan
        if (y < cy - 70) return [0, 240, 255, 255];
        return [70, 24, 110, 255];
      }

      // Secondary Horn
      const h2x = cx + side * 62;
      const h2y = cy - 65;
      const hd2 = distToSegment(x, y, h0x + side * 12, h0y + 10, h2x, h2y);
      if (hd2 <= 5) {
        if (y < cy - 50) return [0, 220, 255, 255];
        return [60, 20, 95, 255];
      }
    }

    // Heavy Armored Scythe Limbs (4 massive limbs)
    for (const side of [-1, 1]) {
      for (let legIdx = 0; legIdx < 2; legIdx++) {
        const j0x = cx + side * 44;
        const j0y = cy - 10 + legIdx * 30;
        const j1x = j0x + side * 48;
        const j1y = j0y - 16;
        const j2x = j1x + side * 18;
        const j2y = j1y + 65;

        const d1 = distToSegment(x, y, j0x, j0y, j1x, j1y);
        const d2 = distToSegment(x, y, j1x, j1y, j2x, j2y);

        if (d1 < 7 || d2 < 5.5) {
          const isBlade = Math.hypot(x - j2x, y - j2y) < 14;
          if (isBlade) return [0, 235, 255, 255]; // Cyan energy cutting edge!
          return [50, 18, 80, 255];
        }
      }
    }

    // Pulsing Coronal Electric Aura (Surrounding Elite)
    const auraD = Math.hypot(x - cx, y - cy);
    if (auraD < 94) {
      const spark = Math.sin(Math.atan2(y - cy, x - cx) * 14 + auraD * 0.2) > 0.65 ? 1.8 : 1.0;
      const aa = Math.pow(1 - auraD / 94, 2) * 110 * spark;
      return [0, 220, 255, clamp(aa, 0, 255)];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_elite.png'));
}

// -------------------------------------------------------------
// 4. HD BROOD OVERSEER (BOSS) (512x512)
// A monstrous cosmic horror boss with floating crystalline spires,
// pulsating dread eye array, and massive armored mandibles
// -------------------------------------------------------------
async function generateHDBoss() {
  const w = 512, h = 512;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 256, cy = 250;

    // Colossal Bio-Organic Core
    const bodyD = Math.hypot((x - cx) * 1.12, (y - cy) * 0.94);
    if (bodyD <= 120) {
      const bt = bodyD / 120;

      // Abyssal Glowing Heart
      const coreD = Math.hypot(x - cx, y - cy);
      if (coreD <= 42) {
        const ct = coreD / 42;
        return [
          lerp(255, 180, ct),
          lerp(40, 20, ct),
          lerp(120, 230, ct),
          255
        ];
      }

      // 6 Terrifying Crimson Predatory Eyes
      const eyeAngles = [-0.6, -0.25, 0.25, 0.6];
      for (const ang of eyeAngles) {
        const ex = cx + Math.sin(ang) * 65;
        const ey = cy + 50 + Math.cos(ang) * 16;
        if (Math.hypot(x - ex, y - ey) < 9) {
          return [255, 45, 65, 255]; // Flaming crimson eyes
        }
      }

      // Intricate chitin ridges
      const ridge = Math.sin((x - cx) * 0.2) * Math.cos((y - cy) * 0.2);
      let r = lerp(75, 25, bt) + (ridge > 0.3 ? 35 : 0);
      let g = lerp(18, 8, bt);
      let b = lerp(120, 45, bt) + (ridge > 0.3 ? 55 : 0);
      return [r, g, b, 255];
    }

    // 4 Floating Biomechanical Orbiting Spires
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + 0.4;
      const sx = cx + Math.cos(ang) * 175;
      const sy = cy + Math.sin(ang) * 145;
      const sd = Math.hypot((x - sx) * 1.4, (y - sy) * 0.75);
      if (sd < 28) {
        if (sd < 12) return [255, 80, 160, 255]; // Core glow
        return [90, 25, 130, 255];
      }
    }

    // Colossal Serrated Scythe Claws
    for (const side of [-1, 1]) {
      const c0x = cx + side * 90;
      const c0y = cy + 20;
      const c1x = c0x + side * 110;
      const c1y = c0y - 30;
      const c2x = c1x + side * 40;
      const c2y = c1y + 150;

      const d1 = distToSegment(x, y, c0x, c0y, c1x, c1y);
      const d2 = distToSegment(x, y, c1x, c1y, c2x, c2y);

      if (d1 < 14 || d2 < 11) {
        const isTip = Math.hypot(x - c2x, y - c2y) < 22;
        if (isTip) return [255, 60, 120, 255];
        return [70, 20, 100, 255];
      }
    }

    // Boss Coronal Aura
    const auraD = Math.hypot(x - cx, y - cy);
    if (auraD < 210) {
      const pulse = (Math.sin(auraD * 0.15) + 1) * 0.5;
      const aa = Math.pow(1 - auraD / 210, 2) * 120 * (0.7 + pulse * 0.3);
      return [230, 40, 140, clamp(aa, 0, 255)];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'enemy_boss.png'));
}

// -------------------------------------------------------------
// 5. HD OVERSEER ARTIFACT MONOLITH (512x512)
// Ancient extraterrestrial obelisk with etched luminescent runes,
// metallic chamfer bevels, and floating energy conduit apex
// -------------------------------------------------------------
async function generateHDArtifact() {
  const w = 512, h = 512;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 256;
    const ny = y / 512;

    // Tapering Obelisk Spire from apex (y=40) to base (y=470)
    if (y >= 45 && y <= 475) {
      const prog = (y - 45) / 430;
      const halfWidth = lerp(18, 92, prog);

      if (Math.abs(x - cx) <= halfWidth) {
        const xt = Math.abs(x - cx) / halfWidth;

        // Central Luminescent Runic Channel
        if (Math.abs(x - cx) <= 12) {
          // Glowing runic pulses along the central groove
          const rune = Math.sin(y * 0.2) * Math.cos(y * 0.05);
          if (rune > 0.2) {
            return [254, 240, 138, 255]; // Golden solar rune
          }
          return [245, 158, 11, 255];
        }

        // Metallic alien alloy with specular edge bevels
        const isEdge = xt > 0.88;
        if (isEdge) {
          return [255, 230, 150, 255]; // Golden edge highlight
        }

        const shading = (1 - xt) * 0.6 + (1 - prog) * 0.4;
        let r = lerp(40, 18, xt) + shading * 45;
        let g = lerp(35, 16, xt) + shading * 40;
        let b = lerp(60, 28, xt) + shading * 65;

        // Horizontal alien glyph bands
        const glyphBand = (y % 44) < 6;
        if (glyphBand) {
          r += 40; g += 35; b += 10;
        }

        return [r, g, b, 255];
      }
    }

    // Floating Apex Energy Crystal
    if (y < 45 && y >= 10) {
      const apexDist = Math.hypot((x - cx) * 1.5, y - 28);
      if (apexDist <= 16) {
        return [255, 255, 200, 255];
      }
    }

    // Ambient God-Ray Glow around the Obelisk
    if (y >= 40 && y <= 480) {
      const prog = (y - 40) / 440;
      const halfWidth = lerp(20, 95, prog);
      const distFromFace = Math.abs(x - cx) - halfWidth;
      if (distFromFace >= 0 && distFromFace < 60) {
        const ga = Math.pow(1 - distFromFace / 60, 2) * 130;
        return [250, 204, 21, ga];
      }
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'overseer_artifact.png'));
}

// -------------------------------------------------------------
// 6. HD ORGANIC BIO-POD (CHEST) (256x256)
// Organic alien pod with bioluminescent amber seams and breathing petals
// -------------------------------------------------------------
async function generateHDBioPod() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 128, cy = 135;

    // Organic egg-shaped pod
    const d = Math.hypot((x - cx) * 1.1, (y - cy) * 0.95);
    if (d <= 65) {
      const t = d / 65;

      // 4 Central glowing amber aperture seams
      const seam = Math.abs(Math.sin(Math.atan2(y - cy, x - cx) * 3)) < 0.18;
      if (seam && d < 48) {
        return [255, 215, 60, 255]; // Intense bio-amber energy
      }

      // Organic vein striations
      const vein = Math.sin((x - cx) * 0.3 + (y - cy) * 0.3) > 0.75;
      let r = lerp(85, 28, t) + (vein ? 35 : 0);
      let g = lerp(35, 12, t) + (vein ? 20 : 0);
      let b = lerp(110, 42, t) + (vein ? 45 : 0);

      // Top highlight
      if (y < cy - 20) {
        r += 25; b += 35;
      }

      return [r, g, b, 255];
    }

    // Root tendrils anchoring the pod to ground
    if (y > cy + 42 && y < cy + 85 && Math.abs(x - cx) < 75) {
      const rootD = (y - (cy + 42)) / 43;
      if (Math.abs(x - cx) > 30) {
        return [45, 18, 60, 255];
      }
    }

    // Soft amber pod aura
    if (d < 82) {
      const ga = (1 - d / 82) * 75;
      return [250, 180, 20, ga];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'organic_pod.png'));
}

// Helper: Distance from point to line segment
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = distSq(x1, y1, x2, y2);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// -------------------------------------------------------------
// 7. HD BIOLUMINESCENT MUSHROOM (256x256)
// Pulsing cyan-teal mushroom with translucent gills and glowing spores
// -------------------------------------------------------------
async function generateHDMushroom() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 128, cy = 110;

    // Dome Cap
    const capDist = Math.hypot((x - cx) * 1.0, (y - cy) * 1.35);
    if (capDist <= 72 && y <= cy + 18) {
      const ct = capDist / 72;

      // Glowing bioluminescent spore dots
      const spore = Math.sin(x * 0.45) * Math.cos(y * 0.45) > 0.85;
      if (spore && capDist < 56) {
        return [220, 255, 255, 255]; // Blazing cyan-white spore
      }

      const highlight = Math.max(0, 1 - Math.hypot((x - (cx - 20)), (y - (cy - 24))) / 48);
      let r = lerp(10, 4, ct) + highlight * 40;
      let g = lerp(160, 45, ct) + highlight * 80;
      let b = lerp(230, 85, ct) + highlight * 95;

      return [r, g, b, 255];
    }

    // Underside Gills
    if (y > cy + 10 && y < cy + 34 && Math.abs(x - cx) < 64) {
      const gill = Math.sin((x - cx) * 0.8) > 0 ? 1 : 0;
      return [gill ? 0 : 20, gill ? 210 : 120, gill ? 255 : 170, 255];
    }

    // Stem
    if (y >= cy + 28 && y <= cy + 130) {
      const stemProg = (y - (cy + 28)) / 102;
      const stemW = lerp(14, 26, stemProg);
      if (Math.abs(x - cx) <= stemW) {
        const stx = Math.abs(x - cx) / stemW;
        let r = lerp(20, 8, stx);
        let g = lerp(80, 30, stx);
        let b = lerp(110, 45, stx);
        return [r, g, b, 255];
      }
    }

    // Ambient cap glow
    if (capDist < 95 && y < cy + 35) {
      const ga = Math.pow(1 - capDist / 95, 2) * 95;
      return [56, 189, 248, ga];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'alien_mushroom.png'));
}

// -------------------------------------------------------------
// 8. HD VIOLET CRYSTAL CLUSTER (256x256)
// Multi-faceted geometric spires with prism refractions & highlights
// -------------------------------------------------------------
async function generateHDCrystal() {
  const w = 256, h = 256;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 128, cy = 135;

    // 3 Spires: Center tall, Left medium, Right small
    const spires = [
      { apexX: 128, apexY: 25, baseW: 36, baseY: 220 },
      { apexX: 72,  apexY: 70, baseW: 28, baseY: 215 },
      { apexX: 182, apexY: 85, baseW: 24, baseY: 218 }
    ];

    for (const sp of spires) {
      if (y >= sp.apexY && y <= sp.baseY) {
        const prog = (y - sp.apexY) / (sp.baseY - sp.apexY);
        const curW = prog * sp.baseW;
        const dx = x - sp.apexX;
        if (Math.abs(dx) <= curW) {
          const face = dx / curW; // -1 to 1 across the facet
          // Left facet (bright highlight), Right facet (deep royal amethyst)
          if (face < 0) {
            const ft = Math.abs(face);
            return [
              lerp(230, 160, ft),
              lerp(180, 80, ft),
              lerp(255, 240, ft),
              255
            ];
          } else {
            const ft = face;
            return [
              lerp(140, 75, ft),
              lerp(60, 20, ft),
              lerp(210, 140, ft),
              255
            ];
          }
        }
      }
    }

    // Crystal prism halo
    const cd = Math.hypot(x - cx, y - 110);
    if (cd < 95) {
      const ga = (1 - cd / 95) * 65;
      return [192, 132, 252, ga];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'crystal_cluster.png'));
}

// -------------------------------------------------------------
// 9. HD AUGMENT CAPSULE (LOOT ORB) (128x128)
// -------------------------------------------------------------
async function generateHDLootOrb() {
  const w = 128, h = 128;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 64, cy = 64;
    const d = Math.hypot(x - cx, y - cy);

    // Glowing energy core
    if (d <= 22) {
      const t = d / 22;
      return [
        lerp(255, 120, t),
        lerp(240, 40, t),
        lerp(255, 230, t),
        255
      ];
    }

    // High tech containment ring
    if (d >= 24 && d <= 32) {
      const ang = Math.atan2(y - cy, x - cx);
      const notch = Math.sin(ang * 4) > 0.3;
      if (notch) {
        return [254, 240, 138, 255];
      }
      return [90, 40, 120, 255];
    }

    // Outer glow
    if (d < 56) {
      const ga = Math.pow(1 - d / 56, 2) * 160;
      return [168, 85, 247, ga];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'loot_orb.png'));
}

// -------------------------------------------------------------
// 10. HD CURRENCY SHARD (128x128)
// -------------------------------------------------------------
async function generateHDCurrency() {
  const w = 128, h = 128;
  const buf = createBuffer(w, h, (x, y) => {
    const cx = 64, cy = 64;
    // Faceted diamond shape
    const dx = Math.abs(x - cx) / 28;
    const dy = Math.abs(y - cy) / 44;
    if (dx + dy <= 1) {
      const isLeft = x < cx;
      const isTop = y < cy;
      if (isLeft && isTop) {
        return [255, 255, 200, 255]; // Glint
      } else if (isTop) {
        return [250, 204, 21, 255];  // Pure gold
      } else if (isLeft) {
        return [245, 158, 11, 255];  // Amber gold
      } else {
        return [180, 83, 9, 255];    // Shadow facet
      }
    }

    const d = Math.hypot(x - cx, y - cy);
    if (d < 46) {
      const ga = (1 - d / 46) * 120;
      return [250, 204, 21, ga];
    }

    return [0, 0, 0, 0];
  });
  await savePng(buf, w, h, path.join(assetsDir, 'currency_shard.png'));
}

async function main() {
  console.log('--- Generating HD High-Definition Game Assets ---');
  await generateHDCrawler();
  await generateHDSpitter();
  await generateHDElite();
  await generateHDBoss();
  await generateHDArtifact();
  await generateHDBioPod();
  await generateHDMushroom();
  await generateHDCrystal();
  await generateHDLootOrb();
  await generateHDCurrency();
  console.log('--- All HD Game Assets Generated Successfully! ---');
}

main().catch(console.error);

