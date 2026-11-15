import Phaser from 'phaser';
import { Simulation } from '../sim/Simulation';
import { InputManager } from '../input/InputManager';
import { CameraController } from './CameraController';
import { VFXManager } from './VFXManager';
import { SoundManager } from './SoundManager';
import { UIManager } from '../ui/UIManager';
import { SimEvent } from '../sim/types';

interface ObstacleRenderEntry {
  dataIndex: number;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  phaseOffset: number;
}

interface TerrainPatchEntry {
  wx: number;
  wy: number;
  baseScale: number;
  angle: number;
  sprite: Phaser.GameObjects.Image;
}

export class GameScene extends Phaser.Scene {
  private simulation!: Simulation;
  private inputManager!: InputManager;
  public cameraController!: CameraController;
  private vfxManager!: VFXManager;
  private soundManager!: SoundManager;
  private uiManager!: UIManager;

  // 2.5D Environment Layers
  private horizonTile!: Phaser.GameObjects.TileSprite;
  private groundGraphics!: Phaser.GameObjects.Graphics;
  private terrainGraphicsLow!: Phaser.GameObjects.Graphics;
  private plateauGraphics: Phaser.GameObjects.Graphics[] = [];
  private terrainPatches: TerrainPatchEntry[] = [];
  private obstacleEntries: ObstacleRenderEntry[] = [];

  // Player & Jetpack Traversal
  private playerSprite!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Image;
  private playerResolveAura!: Phaser.GameObjects.Ellipse;
  private playerJetPlumeL!: Phaser.GameObjects.Image;
  private playerJetPlumeR!: Phaser.GameObjects.Image;

  // Dynamic Entity Maps
  private enemyMap: Map<
    string,
    {
      sprite: Phaser.GameObjects.Sprite;
      shadow: Phaser.GameObjects.Image;
      hpBarBg: Phaser.GameObjects.Rectangle;
      hpBarFill: Phaser.GameObjects.Rectangle;
    }
  > = new Map();

  private projMap: Map<string, Phaser.GameObjects.Image> = new Map();
  private dropMap: Map<
    string,
    { sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }
  > = new Map();
  private itemDropMap: Map<
    string,
    {
      orb: Phaser.GameObjects.Image;
      icon: Phaser.GameObjects.Image;
      shadow: Phaser.GameObjects.Image;
      label: Phaser.GameObjects.Text;
    }
  > = new Map();
  private podMap: Map<
    string,
    {
      sprite: Phaser.GameObjects.Image;
      shadow: Phaser.GameObjects.Image;
      ring: Phaser.GameObjects.Ellipse;
      prompt: Phaser.GameObjects.Text;
    }
  > = new Map();
  private strikeMap: Map<
    string,
    {
      areaEllipse: Phaser.GameObjects.Ellipse;
      reticle: Phaser.GameObjects.Image;
      beam?: Phaser.GameObjects.Image;
    }
  > = new Map();

  private artifactSprite!: Phaser.GameObjects.Image;
  private artifactShadow!: Phaser.GameObjects.Image;
  private artifactGlow!: Phaser.GameObjects.Ellipse;
  private artifactPrompt!: Phaser.GameObjects.Text;

  private walkBobTimer: number = 0;

  constructor() {
    super('GameScene');
  }

  public init(data: { uiManager: UIManager; soundManager: SoundManager }): void {
    this.uiManager = data.uiManager;
    this.soundManager = data.soundManager;
    this.simulation = new Simulation();
    this.inputManager = new InputManager();
  }

  public preload(): void {
    // Commander turnaround sprites
    this.load.image('commander_front', '/assets/commander/commander_front.png');
    this.load.image('commander_back', '/assets/commander/commander_back.png');
    this.load.image('commander_right', '/assets/commander/commander_right.png');
    this.load.image('commander_left', '/assets/commander/commander_left.png');

    // Environment & Phase 2/3 Assets
    this.load.image('horizon_panorama', '/assets/horizon_panorama.png');
    this.load.image('shadow', '/assets/shadow.png');
    this.load.image('terrain_ice', '/assets/terrain_ice.png');
    this.load.image('terrain_soil', '/assets/terrain_soil.png');
    this.load.image('terrain_permafrost', '/assets/terrain_permafrost.png');
    this.load.image('terrain_thawed', '/assets/terrain_thawed.png');
    this.load.image('cliff_strata', '/assets/cliff_strata.png');
    this.load.image('ramp_tread', '/assets/ramp_tread.png');
    this.load.image('plateau_cap', '/assets/plateau_cap.png');
    this.load.image('cliff_wall', '/assets/cliff_wall.png');
    this.load.image('chasm_fissure', '/assets/chasm_fissure.png');
    this.load.image('natural_bridge', '/assets/natural_bridge.png');
    this.load.image('jet_plume', '/assets/jet_plume.png');

    // Props
    this.load.image('crystal_cluster', '/assets/crystal_cluster.png');
    this.load.image('alien_flora', '/assets/alien_flora.png');
    this.load.image('alien_mushroom', '/assets/alien_mushroom.png');
    this.load.image('alien_rock', '/assets/alien_rock.png');
    this.load.image('organic_pod', '/assets/organic_pod.png');
    this.load.image('overseer_artifact', '/assets/overseer_artifact.png');

    // Enemies
    this.load.image('enemy_crawler', '/assets/enemy_crawler.png');
    this.load.image('enemy_spitter', '/assets/enemy_spitter.png');
    this.load.image('enemy_elite', '/assets/enemy_elite.png');

    // Projectiles, Loot & VFX
    this.load.image('proj_pulse', '/assets/proj_pulse.png');
    this.load.image('proj_wave', '/assets/proj_wave.png');
    this.load.image('proj_acid', '/assets/proj_acid.png');
    this.load.image('orbital_reticle', '/assets/orbital_reticle.png');
    this.load.image('orbital_beam', '/assets/orbital_beam.png');
    this.load.image('currency_shard', '/assets/currency_shard.png');
    this.load.image('loot_orb', '/assets/loot_orb.png');
    this.load.image('item_overdrive', '/assets/item_overdrive.png');
    this.load.image('item_vital_core', '/assets/item_vital_core.png');
    this.load.image('item_chain_spark', '/assets/item_chain_spark.png');
  }

  public create(): void {
    const simState = this.simulation.state;
    this.cameraController = new CameraController(
      this.cameras.main,
      simState.worldWidth,
      simState.worldHeight
    );
    this.cameraController.snapTo(simState.player.pos);
    this.vfxManager = new VFXManager(this, this.cameraController);

    // 1. Skybox & Distant Horizon Panorama + Ground Plane
    this.create25DEnvironment();

    // 2. Obstacles (crystals, rocks, flora, glowing mushrooms)
    this.createObstacles();

    // 3. Ancient Overseer Artifact
    this.createArtifact();

    // 4. Alien Organic Pods
    this.createOrganicPods();

    // 5. Player Sprite, Jet Plumes & Shadow
    this.playerShadow = this.add.image(0, 0, 'shadow');
    this.playerShadow.setDepth(50);

    this.playerResolveAura = this.add.ellipse(0, 0, 74, 38, 0xffd700, 0.22);
    this.playerResolveAura.setStrokeStyle(2, 0xffea00, 0.85);
    this.playerResolveAura.setVisible(false);

    // Twin Jet Thruster plumes for gliding
    this.playerJetPlumeL = this.add.image(0, 0, 'jet_plume');
    this.playerJetPlumeL.setOrigin(0.5, 0.0);
    this.playerJetPlumeL.setVisible(false);

    this.playerJetPlumeR = this.add.image(0, 0, 'jet_plume');
    this.playerJetPlumeR.setOrigin(0.5, 0.0);
    this.playerJetPlumeR.setVisible(false);

    this.playerSprite = this.add.sprite(0, 0, 'commander_front');
    this.playerSprite.setOrigin(0.5, 0.95);

    this.scale.on('resize', () => {
      this.layoutSkyAndGround();
    });

    this.uiManager.initGame(this.simulation);
  }

  private create25DEnvironment(): void {
    const vw = this.cameraController.getViewportWidth();
    const horizonY = this.cameraController.getHorizonScreenY();

    // Foreshortened background ground plane graphics (drawn below horizon)
    this.groundGraphics = this.add.graphics();
    this.groundGraphics.setDepth(1);

    // Multi-level terrain graphics: low tier (chasms, ramps, bridges, drop shadows)
    this.terrainGraphicsLow = this.add.graphics();
    this.terrainGraphicsLow.setDepth(4);

    // Plateau graphics (one per elevated mesa, depth-sorted dynamically with entities)
    const plateaus = this.simulation.state.terrain.plateaus;
    this.plateauGraphics = plateaus.map(() => this.add.graphics());

    // Distant horizon sky & crystal mountain panorama
    this.horizonTile = this.add.tileSprite(
      vw * 0.5,
      (horizonY + 18) * 0.5,
      vw,
      horizonY + 18,
      'horizon_panorama'
    );
    this.horizonTile.setDepth(3);

    // Scatter foreshortened alien terrain patches across the world
    const w = this.simulation.state.worldWidth;
    const h = this.simulation.state.worldHeight;
    const patchKeys = [
      'terrain_permafrost',
      'terrain_thawed',
      'terrain_ice',
      'terrain_permafrost',
      'terrain_thawed'
    ];

    for (let i = 0; i < 115; i++) {
      const wx = 120 + ((i * 383 + 127) % (w - 240));
      const wy = 120 + ((i * 617 + 251) % (h - 240));
      const key = patchKeys[i % patchKeys.length];
      const spr = this.add.image(0, 0, key);
      spr.setAlpha(key === 'terrain_ice' ? 0.4 : 0.62);
      spr.setDepth(2);
      this.terrainPatches.push({
        wx,
        wy,
        baseScale: 1.6 + (i % 5) * 0.35,
        angle: (i * 49) % 360,
        sprite: spr
      });
    }

    this.layoutSkyAndGround();
  }

  private layoutSkyAndGround(): void {
    if (!this.horizonTile) return;
    const vw = this.cameraController.getViewportWidth();
    const horizonY = this.cameraController.getHorizonScreenY();
    const skyH = horizonY + 18;

    this.horizonTile.setPosition(vw * 0.5, skyH * 0.5);
    this.horizonTile.setSize(vw, skyH);
    this.horizonTile.setDisplaySize(vw, skyH);
  }

  private renderForeshortenedGround(): void {
    const vw = this.cameraController.getViewportWidth();
    const vh = this.cameraController.getViewportHeight();
    const horizonY = this.cameraController.getHorizonScreenY();

    // 360-degree panorama scroll linked to camera yaw + world position
    const yawOffset = (this.cameraController.currentYaw / (Math.PI * 2)) * 1024;
    this.horizonTile.tilePositionX = yawOffset + this.cameraController.focusWorldPos.x * 0.08;

    const g = this.groundGraphics;
    g.clear();

    // Natural smooth depth bands (cohesive alien frozen/thawed planetary soil)
    const bands = 24;
    const groundH = vh - horizonY;
    for (let b = 0; b < bands; b++) {
      const t0 = b / bands;
      const t1 = (b + 1) / bands;
      const y0 = horizonY + t0 * groundH;
      const bandH = (t1 - t0) * groundH + 1;

      // Soft transition from deep horizon indigo to rich dark frozen surface
      const curve = Math.pow(t0, 0.65);
      const r = Math.round(13 + curve * 12);
      const gr = Math.round(19 + curve * 18);
      const bl = Math.round(34 + curve * 28);
      const color = (r << 16) | (gr << 8) | bl;

      g.fillStyle(color, 1);
      g.fillRect(0, y0, vw, bandH);
    }

    // Subtle curved organic subterranean bioluminescent veins (no rigid polygon grid)
    const cx = this.cameraController.focusWorldPos.x;
    const cy = this.cameraController.focusWorldPos.y;
    g.lineStyle(1.5, 0x38bdf8, 0.12);
    const veinSpacing = 360;
    for (let i = -3; i <= 3; i++) {
      const baseWx = Math.floor(cx / veinSpacing) * veinSpacing + i * veinSpacing;
      g.beginPath();
      let started = false;
      for (let step = -4; step <= 4; step++) {
        const wy = cy + step * 180;
        const wx = baseWx + Math.sin(wy * 0.0035 + i) * 75;
        const pt = this.cameraController.project(wx, wy, 0);
        if (pt.visible) {
          if (!started) {
            g.moveTo(pt.screenX, Math.max(horizonY + 4, pt.screenY));
            started = true;
          } else {
            g.lineTo(pt.screenX, pt.screenY);
          }
        }
      }
      if (started) g.strokePath();
    }

    // Project organic thawed terrain patches with pitch foreshortening
    const pitch = this.cameraController.config.pitchAngle;
    for (let i = 0; i < this.terrainPatches.length; i++) {
      const patch = this.terrainPatches[i];
      const proj = this.cameraController.project(patch.wx, patch.wy, 0);
      if (!proj.visible) {
        patch.sprite.setVisible(false);
        continue;
      }
      patch.sprite.setVisible(true);
      patch.sprite.setPosition(proj.screenX, proj.screenY);
      const s = proj.scale * patch.baseScale;
      patch.sprite.setScale(s, s * pitch);
      patch.sprite.setAlpha((1 - proj.fogFactor * 0.75) * 0.52);
    }
  }

  private renderTerrainElevation(time: number): void {
    const tg = this.terrainGraphicsLow;
    tg.clear();

    const terrain = this.simulation.state.terrain;
    const p = this.simulation.state.player;

    // -------------------------------------------------------------
    // 1. Ambient Drop Shadows Beneath Elevated Plateaus & Bridges
    // -------------------------------------------------------------
    for (let i = 0; i < terrain.plateaus.length; i++) {
      const pl = terrain.plateaus[i];
      const shadowOffX = 14;
      const shadowOffY = 24;
      const s0 = this.cameraController.project(pl.x + shadowOffX, pl.y + shadowOffY, 0);
      const s1 = this.cameraController.project(pl.x + pl.w + shadowOffX, pl.y + shadowOffY, 0);
      const s2 = this.cameraController.project(pl.x + pl.w + shadowOffX, pl.y + pl.h + shadowOffY, 0);
      const s3 = this.cameraController.project(pl.x + shadowOffX, pl.y + pl.h + shadowOffY, 0);

      if (s0.visible || s1.visible || s2.visible || s3.visible) {
        tg.fillStyle(0x050912, 0.46);
        tg.beginPath();
        tg.moveTo(s0.screenX, s0.screenY);
        tg.lineTo(s1.screenX, s1.screenY);
        tg.lineTo(s2.screenX, s2.screenY);
        tg.lineTo(s3.screenX, s3.screenY);
        tg.closePath();
        tg.fillPath();
      }
    }

    // -------------------------------------------------------------
    // 2. Chasms & Glowing Bioluminescent Fissures (-80 Z)
    // -------------------------------------------------------------
    for (let i = 0; i < terrain.chasms.length; i++) {
      const c = terrain.chasms[i];
      const t0 = this.cameraController.project(c.x, c.y, 0);
      const t1 = this.cameraController.project(c.x + c.w, c.y, 0);
      const t2 = this.cameraController.project(c.x + c.w, c.y + c.h, 0);
      const t3 = this.cameraController.project(c.x, c.y + c.h, 0);

      const b0 = this.cameraController.project(c.x, c.y, c.depth);
      const b1 = this.cameraController.project(c.x + c.w, c.y, c.depth);
      const b2 = this.cameraController.project(c.x + c.w, c.y + c.h, c.depth);
      const b3 = this.cameraController.project(c.x, c.y + c.h, c.depth);

      if (t0.visible || t1.visible || t2.visible || t3.visible || b0.visible) {
        // Deep abyss floor fill
        tg.fillStyle(0x040812, 0.98);
        tg.beginPath();
        tg.moveTo(b0.screenX, b0.screenY);
        tg.lineTo(b1.screenX, b1.screenY);
        tg.lineTo(b2.screenX, b2.screenY);
        tg.lineTo(b3.screenX, b3.screenY);
        tg.closePath();
        tg.fillPath();

        // Chasm inner rock walls
        tg.fillStyle(0x08121e, 0.94);
        tg.beginPath();
        tg.moveTo(t0.screenX, t0.screenY);
        tg.lineTo(t1.screenX, t1.screenY);
        tg.lineTo(b1.screenX, b1.screenY);
        tg.lineTo(b0.screenX, b0.screenY);
        tg.closePath();
        tg.fillPath();

        tg.beginPath();
        tg.moveTo(t3.screenX, t3.screenY);
        tg.lineTo(t2.screenX, t2.screenY);
        tg.lineTo(b2.screenX, b2.screenY);
        tg.lineTo(b3.screenX, b3.screenY);
        tg.closePath();
        tg.fillPath();

        // Pulsing thermal plasma stream flowing along the chasm bed
        const pulse = Math.sin(time * 0.003 + i) * 0.15 + 0.85;
        tg.lineStyle(4, 0x00e5ff, 0.88 * pulse);
        const midY0 = (b0.screenY + b3.screenY) * 0.5;
        const midX0 = (b0.screenX + b3.screenX) * 0.5;
        const midY1 = (b1.screenY + b2.screenY) * 0.5;
        const midX1 = (b1.screenX + b2.screenX) * 0.5;
        tg.beginPath();
        tg.moveTo(midX0, midY0);
        tg.lineTo(midX1, midY1);
        tg.strokePath();

        // Core white-cyan thermal current
        tg.lineStyle(1.8, 0xe0f2fe, 0.95 * pulse);
        tg.strokePath();

        // Chasm top rim frost fractures
        tg.lineStyle(1.5, 0x2563eb, 0.55);
        tg.beginPath();
        tg.moveTo(t0.screenX, t0.screenY);
        tg.lineTo(t1.screenX, t1.screenY);
        tg.lineTo(t2.screenX, t2.screenY);
        tg.lineTo(t3.screenX, t3.screenY);
        tg.closePath();
        tg.strokePath();
      }
    }

    // -------------------------------------------------------------
    // 3. Natural Ancient Bridges (Crossing over Chasms)
    // -------------------------------------------------------------
    for (let i = 0; i < terrain.bridges.length; i++) {
      const b = terrain.bridges[i];
      const p0 = this.cameraController.project(b.x, b.y, b.elevation);
      const p1 = this.cameraController.project(b.x + b.w, b.y, b.elevation);
      const p2 = this.cameraController.project(b.x + b.w, b.y + b.h, b.elevation);
      const p3 = this.cameraController.project(b.x, b.y + b.h, b.elevation);

      if (p0.visible || p1.visible || p2.visible || p3.visible) {
        // Bridge roadway slab
        tg.fillStyle(0x192537, 1.0);
        tg.beginPath();
        tg.moveTo(p0.screenX, p0.screenY);
        tg.lineTo(p1.screenX, p1.screenY);
        tg.lineTo(p2.screenX, p2.screenY);
        tg.lineTo(p3.screenX, p3.screenY);
        tg.closePath();
        tg.fillPath();

        // Side support curbs
        tg.lineStyle(2.5, 0x38bdf8, 0.85);
        tg.beginPath();
        tg.moveTo(p0.screenX, p0.screenY);
        tg.lineTo(p3.screenX, p3.screenY);
        tg.moveTo(p1.screenX, p1.screenY);
        tg.lineTo(p2.screenX, p2.screenY);
        tg.strokePath();

        // Golden rune energy conduit down center
        tg.lineStyle(2, 0xfacc15, 0.9);
        const midX0 = (p0.screenX + p1.screenX) * 0.5;
        const midY0 = (p0.screenY + p1.screenY) * 0.5;
        const midX1 = (p2.screenX + p3.screenX) * 0.5;
        const midY1 = (p2.screenY + p3.screenY) * 0.5;
        tg.beginPath();
        tg.moveTo(midX0, midY0);
        tg.lineTo(midX1, midY1);
        tg.strokePath();
      }
    }

    // -------------------------------------------------------------
    // 4. Sloped Ramps (Incline Transitions to Plateaus)
    // -------------------------------------------------------------
    for (let i = 0; i < terrain.ramps.length; i++) {
      const r = terrain.ramps[i];
      let z0 = r.bottomZ, z1 = r.bottomZ, z2 = r.topZ, z3 = r.topZ;
      switch (r.direction) {
        case 'north': z0 = r.bottomZ; z1 = r.bottomZ; z2 = r.topZ; z3 = r.topZ; break;
        case 'south': z0 = r.topZ; z1 = r.topZ; z2 = r.bottomZ; z3 = r.bottomZ; break;
        case 'east':  z0 = r.bottomZ; z1 = r.topZ; z2 = r.topZ; z3 = r.bottomZ; break;
        case 'west':  z0 = r.topZ; z1 = r.bottomZ; z2 = r.bottomZ; z3 = r.topZ; break;
      }
      const p0 = this.cameraController.project(r.x, r.y + r.h, z0);
      const p1 = this.cameraController.project(r.x + r.w, r.y + r.h, z1);
      const p2 = this.cameraController.project(r.x + r.w, r.y, z2);
      const p3 = this.cameraController.project(r.x, r.y, z3);

      if (p0.visible || p1.visible || p2.visible || p3.visible) {
        // Ramp surface fill
        tg.fillStyle(0x1a283b, 0.98);
        tg.beginPath();
        tg.moveTo(p0.screenX, p0.screenY);
        tg.lineTo(p1.screenX, p1.screenY);
        tg.lineTo(p2.screenX, p2.screenY);
        tg.lineTo(p3.screenX, p3.screenY);
        tg.closePath();
        tg.fillPath();

        // Stepped frost treads across the ramp incline
        tg.lineStyle(1.5, 0x60a5fa, 0.65);
        const steps = 6;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const leftX = p0.screenX + (p3.screenX - p0.screenX) * t;
          const leftY = p0.screenY + (p3.screenY - p0.screenY) * t;
          const rightX = p1.screenX + (p2.screenX - p1.screenX) * t;
          const rightY = p1.screenY + (p2.screenY - p1.screenY) * t;
          tg.beginPath();
          tg.moveTo(leftX, leftY);
          tg.lineTo(rightX, rightY);
          tg.strokePath();
        }

        // Luminous guide curbs on ramp sides
        tg.lineStyle(2.5, 0x38bdf8, 0.85);
        tg.beginPath();
        tg.moveTo(p0.screenX, p0.screenY);
        tg.lineTo(p3.screenX, p3.screenY);
        tg.moveTo(p1.screenX, p1.screenY);
        tg.lineTo(p2.screenX, p2.screenY);
        tg.strokePath();
      }
    }

    // -------------------------------------------------------------
    // 5. Plateaus with Front-Facing 3D Extruded Cliff Walls & Depth Sorting
    // -------------------------------------------------------------
    for (let i = 0; i < terrain.plateaus.length; i++) {
      const pl = terrain.plateaus[i];
      const pg = this.plateauGraphics[i];
      if (!pg) continue;
      pg.clear();

      const corners = [
        { x: pl.x, y: pl.y },
        { x: pl.x + pl.w, y: pl.y },
        { x: pl.x + pl.w, y: pl.y + pl.h },
        { x: pl.x, y: pl.y + pl.h }
      ];

      let maxFrontY = -9999;

      // Draw all cliff walls that face toward the camera
      for (let s = 0; s < 4; s++) {
        const cA = corners[s];
        const cB = corners[(s + 1) % 4];

        const ptA_bot = this.cameraController.project(cA.x, cA.y, 0);
        const ptB_bot = this.cameraController.project(cB.x, cB.y, 0);
        const ptA_top = this.cameraController.project(cA.x, cA.y, pl.elevation);
        const ptB_top = this.cameraController.project(cB.x, cB.y, pl.elevation);

        maxFrontY = Math.max(maxFrontY, ptA_bot.screenY, ptB_bot.screenY);

        // Robust 2D screen winding cross product
        const v1x = ptB_top.screenX - ptA_top.screenX;
        const v1y = ptB_top.screenY - ptA_top.screenY;
        const v2x = ptA_bot.screenX - ptA_top.screenX;
        const v2y = ptA_bot.screenY - ptA_top.screenY;
        const winding = v1x * v2y - v1y * v2x;

        if (winding > 0 && (ptA_top.visible || ptB_top.visible || ptA_bot.visible || ptB_bot.visible)) {
          // Dark basalt rock base of cliff wall
          pg.fillStyle(0x0e1725, 0.98);
          pg.beginPath();
          pg.moveTo(ptA_bot.screenX, ptA_bot.screenY);
          pg.lineTo(ptB_bot.screenX, ptB_bot.screenY);
          pg.lineTo(ptB_top.screenX, ptB_top.screenY);
          pg.lineTo(ptA_top.screenX, ptA_top.screenY);
          pg.closePath();
          pg.fillPath();

          // Upper rock layer with bluish alien tint
          pg.fillStyle(0x18273d, 0.65);
          const midA_X = (ptA_bot.screenX + ptA_top.screenX) * 0.5;
          const midA_Y = (ptA_bot.screenY + ptA_top.screenY) * 0.5;
          const midB_X = (ptB_bot.screenX + ptB_top.screenX) * 0.5;
          const midB_Y = (ptB_bot.screenY + ptB_top.screenY) * 0.5;
          pg.beginPath();
          pg.moveTo(midA_X, midA_Y);
          pg.lineTo(midB_X, midB_Y);
          pg.lineTo(ptB_top.screenX, ptB_top.screenY);
          pg.lineTo(ptA_top.screenX, ptA_top.screenY);
          pg.closePath();
          pg.fillPath();

          // Horizontal geological strata bands
          pg.lineStyle(1.2, 0x22354a, 0.55);
          for (let k = 1; k < 4; k++) {
            const frac = k / 4;
            const lX = ptA_top.screenX + (ptA_bot.screenX - ptA_top.screenX) * frac;
            const lY = ptA_top.screenY + (ptA_bot.screenY - ptA_top.screenY) * frac;
            const rX = ptB_top.screenX + (ptB_bot.screenX - ptB_top.screenX) * frac;
            const rY = ptB_top.screenY + (ptB_bot.screenY - ptB_top.screenY) * frac;
            pg.beginPath();
            pg.moveTo(lX, lY);
            pg.lineTo(rX, rY);
            pg.strokePath();
          }

          // Embedded vertical crystalline veins in the rock
          pg.lineStyle(1, 0x38bdf8, 0.4);
          for (let k = 1; k < 5; k++) {
            const frac = k / 5;
            const topX = ptA_top.screenX + (ptB_top.screenX - ptA_top.screenX) * frac;
            const topY = ptA_top.screenY + (ptB_top.screenY - ptA_top.screenY) * frac;
            const botX = ptA_bot.screenX + (ptB_bot.screenX - ptA_bot.screenX) * frac;
            const botY = ptA_bot.screenY + (ptB_bot.screenY - ptA_bot.screenY) * frac;
            pg.beginPath();
            pg.moveTo(topX, topY);
            pg.lineTo(botX, botY);
            pg.strokePath();
          }

          // Crisp crystalline rim bevel highlight on top edge
          pg.lineStyle(2.5, 0x67e8f9, 0.9);
          pg.beginPath();
          pg.moveTo(ptA_top.screenX, ptA_top.screenY);
          pg.lineTo(ptB_top.screenX, ptB_top.screenY);
          pg.strokePath();
        }
      }

      // Top Plateau Surface (Flat elevated cap)
      const t0 = this.cameraController.project(corners[0].x, corners[0].y, pl.elevation);
      const t1 = this.cameraController.project(corners[1].x, corners[1].y, pl.elevation);
      const t2 = this.cameraController.project(corners[2].x, corners[2].y, pl.elevation);
      const t3 = this.cameraController.project(corners[3].x, corners[3].y, pl.elevation);

      if (t0.visible || t1.visible || t2.visible || t3.visible) {
        // High-altitude frosted mesa cap fill
        pg.fillStyle(0x1d2e45, 0.96);
        pg.beginPath();
        pg.moveTo(t0.screenX, t0.screenY);
        pg.lineTo(t1.screenX, t1.screenY);
        pg.lineTo(t2.screenX, t2.screenY);
        pg.lineTo(t3.screenX, t3.screenY);
        pg.closePath();
        pg.fillPath();

        // Subtle frost border
        pg.lineStyle(1.5, 0x60a5fa, 0.6);
        pg.beginPath();
        pg.moveTo(t0.screenX, t0.screenY);
        pg.lineTo(t1.screenX, t1.screenY);
        pg.lineTo(t2.screenX, t2.screenY);
        pg.lineTo(t3.screenX, t3.screenY);
        pg.closePath();
        pg.strokePath();
      }

      // Dynamic Depth Sorting: plateaus occlude entities behind them
      pg.setDepth(Math.max(5, Math.round(maxFrontY - 2)));

      // Camera Occlusion Check: if Commander is standing behind a cliff wall, fade the rock to 0.45 alpha
      const isBehind =
        p.pos.x >= pl.x - 30 &&
        p.pos.x <= pl.x + pl.w + 30 &&
        p.pos.y >= pl.y - 120 &&
        p.pos.y <= pl.y + pl.h + 20 &&
        p.z < pl.elevation - 10;

      pg.setAlpha(isBehind ? 0.45 : 1.0);
    }
  }

  private createObstacles(): void {
    const obsList = this.simulation.state.obstacles;
    for (let i = 0; i < obsList.length; i++) {
      const obs = obsList[i];
      const shadow = this.add.image(0, 0, 'shadow');

      let key = 'crystal_cluster';
      if (obs.type === 'rock') key = 'alien_rock';
      else if (obs.type === 'flora') key = 'alien_flora';
      else if (obs.type === 'mushroom') key = 'alien_mushroom';

      const sprite = this.add.image(0, 0, key);
      sprite.setOrigin(0.5, 0.88);

      this.obstacleEntries.push({
        dataIndex: i,
        sprite,
        shadow,
        phaseOffset: i * 0.7
      });
    }
  }

  private createArtifact(): void {
    this.artifactGlow = this.add.ellipse(0, 0, 160, 84, 0xffd54f, 0.18);
    this.artifactGlow.setStrokeStyle(3, 0xffca28, 0.7);

    this.artifactShadow = this.add.image(0, 0, 'shadow');

    this.artifactSprite = this.add.image(0, 0, 'overseer_artifact');
    this.artifactSprite.setOrigin(0.5, 0.9);

    this.artifactPrompt = this.add.text(0, 0, '[E] EXTRACT OVERSEER ARTIFACT', {
      fontSize: '13px',
      fontStyle: 'bold',
      fontFamily: 'system-ui, sans-serif',
      color: '#facc15',
      backgroundColor: 'rgba(10, 14, 24, 0.85)',
      padding: { x: 8, y: 4 }
    });
    this.artifactPrompt.setOrigin(0.5);
    this.artifactPrompt.setVisible(false);
    this.artifactPrompt.setDepth(4200);
  }

  private createOrganicPods(): void {
    const pods = this.simulation.state.pods;
    for (let i = 0; i < pods.length; i++) {
      const pod = pods[i];
      const shadow = this.add.image(0, 0, 'shadow');

      const sprite = this.add.image(0, 0, 'organic_pod');
      sprite.setOrigin(0.5, 0.85);

      const ring = this.add.ellipse(0, 0, 90, 48, 0xffa726, 0.12);
      ring.setStrokeStyle(2, 0xffb74d, 0.65);

      const prompt = this.add.text(0, 0, '', {
        fontSize: '12px',
        fontStyle: 'bold',
        fontFamily: 'system-ui, sans-serif',
        color: '#facc15',
        backgroundColor: 'rgba(10, 14, 24, 0.85)',
        padding: { x: 7, y: 3 }
      });
      prompt.setOrigin(0.5);
      prompt.setVisible(false);
      prompt.setDepth(4100);

      this.podMap.set(pod.id, { sprite, shadow, ring, prompt });
    }
  }

  public update(time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);

    // 1. Mouse & Orbit Camera Update
    if (this.inputManager.zoomDelta !== 0) {
      this.cameraController.handleZoom(this.inputManager.zoomDelta);
      this.inputManager.zoomDelta = 0;
    }
    this.inputManager.updateWorldMouse(this.cameraController);
    const inputSnapshot = this.inputManager.getSnapshot(
      this.simulation.state.player.pos,
      this.cameraController.currentYaw
    );

    // 2. Step Simulation
    const events = this.simulation.tick(dt, inputSnapshot);

    // 3. Process Events (SFX, VFX, Toasts)
    this.processEvents(events);

    // 4. Update Camera Follow
    this.cameraController.update(this.simulation.state.player.pos, dt);

    // 5. Render 2.5D Environment & Elevation
    this.renderForeshortenedGround();
    this.renderTerrainElevation(time);

    // 6. Sync Entities
    this.syncObstacles(time);
    this.syncPlayer(dt, inputSnapshot);
    this.syncEnemies();
    this.syncProjectiles();
    this.syncCurrencyDrops();
    this.syncItemDrops(time);
    this.syncPods(time);
    this.syncArtifact(time);
    this.syncOrbitalStrikes();

    // 7. Update HUD
    this.uiManager.update(this.simulation.state);
  }

  private processEvents(events: SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'pulse_fired':
          this.soundManager.playPulse();
          break;
        case 'wave_fired':
          this.soundManager.playWave();
          break;
        case 'dash_used':
          this.soundManager.playDash();
          this.vfxManager.spawnDashGhost(
            this.simulation.state.player.pos,
            `commander_${this.simulation.state.player.facing}`,
            this.cameraController.getCommanderBaseScale(),
            this.simulation.state.player.z
          );
          break;
        case 'jump_started':
          this.soundManager.playJump();
          break;
        case 'glide_started':
          this.soundManager.playGlide();
          break;
        case 'landed':
          this.soundManager.playLand();
          this.vfxManager.spawnLandingRing(this.simulation.state.player.pos, e.data.z);
          break;
        case 'damage_dealt':
          if (e.data.isOrbitalBlast) {
            this.soundManager.playOrbitalStrike();
            this.vfxManager.spawnOrbitalBlast(e.data.pos, e.data.radius);
          } else {
            this.vfxManager.spawnDamageNumber(e.data.pos, e.data.damage, '#ffffff');
          }
          break;
        case 'chain_spark':
          this.soundManager.playChainSpark();
          this.vfxManager.drawChainLightning(e.data.from, e.data.to);
          this.vfxManager.spawnDamageNumber(e.data.to, e.data.damage, '#64d8ff');
          break;
        case 'enemy_killed':
          this.soundManager.playEnemyHit();
          break;
        case 'player_hit':
          this.cameras.main.shake(140, 0.007);
          break;
        case 'pod_opened':
        case 'item_acquired':
        case 'buff_selected':
          this.soundManager.playItemAcquired();
          if (e.type === 'item_acquired') {
            this.uiManager.showPickupNotification(
              `${e.data.name} Acquired (Stack x${e.data.stackCount})`
            );
          } else if (e.type === 'buff_selected') {
            this.uiManager.showPickupNotification(
              `Augment Active: ${e.data.name}`
            );
          }
          break;
        case 'currency_collected':
          break;
      }
    }
  }

  private applyDistanceFogTint(
    gameObject: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image,
    fogFactor: number
  ): void {
    if (fogFactor <= 0.05) {
      gameObject.clearTint();
      return;
    }
    const r = Math.round(255 * (1 - fogFactor * 0.55) + 74 * (fogFactor * 0.55));
    const g = Math.round(255 * (1 - fogFactor * 0.45) + 122 * (fogFactor * 0.45));
    const b = Math.round(255 * (1 - fogFactor * 0.3) + 156 * (fogFactor * 0.3));
    gameObject.setTint((r << 16) | (g << 8) | b);
  }

  private syncObstacles(time: number): void {
    const obsList = this.simulation.state.obstacles;
    const pitch = this.cameraController.config.pitchAngle;

    for (let i = 0; i < this.obstacleEntries.length; i++) {
      const entry = this.obstacleEntries[i];
      const obs = obsList[entry.dataIndex];
      const elevation = this.simulation.state.terrain.getElevation(obs.pos.x, obs.pos.y).height;
      const proj = this.cameraController.project(obs.pos.x, obs.pos.y, elevation);

      if (!proj.visible) {
        entry.sprite.setVisible(false);
        entry.shadow.setVisible(false);
        continue;
      }

      entry.sprite.setVisible(true);
      entry.shadow.setVisible(true);

      const s = proj.scale * obs.scaleVar * 0.88;
      const breathe =
        obs.type === 'flora' || obs.type === 'mushroom' || obs.type === 'crystal'
          ? 1 + Math.sin(time * 0.0025 + entry.phaseOffset) * 0.03
          : 1;

      entry.sprite.setPosition(proj.screenX, proj.screenY);
      entry.sprite.setScale(s, s * breathe);
      entry.sprite.setDepth(Math.max(10, Math.round(proj.screenY)));
      this.applyDistanceFogTint(entry.sprite, proj.fogFactor);

      entry.shadow.setPosition(proj.screenX, proj.screenY + 4 * proj.scale);
      entry.shadow.setScale((obs.radius / 22) * proj.scale, (obs.radius / 22) * proj.scale * pitch);
      entry.shadow.setDepth(Math.max(9, Math.round(proj.screenY - 1)));
    }
  }

  private syncPlayer(dt: number, inputSnapshot: any): void {
    const p = this.simulation.state.player;
    const pitch = this.cameraController.config.pitchAngle;

    const texKey = `commander_${p.facing}`;
    if (this.playerSprite.texture.key !== texKey) {
      this.playerSprite.setTexture(texKey);
    }

    const isMoving =
      !this.simulation.state.isPausedForBuffChoice &&
      (inputSnapshot.moveDir.x !== 0 || inputSnapshot.moveDir.y !== 0);

    let bobZ = 0;
    if (isMoving && !p.isDashing && p.isGrounded) {
      this.walkBobTimer += dt * 14;
      bobZ = Math.abs(Math.sin(this.walkBobTimer)) * 5;
    } else {
      this.walkBobTimer = 0;
    }

    // Shadow is always anchored directly to terrain surface beneath Commander
    const projShadow = this.cameraController.project(p.pos.x, p.pos.y, p.groundZ);
    // Commander sprite projects at true altitude z
    const projChar = this.cameraController.project(p.pos.x, p.pos.y, p.z + bobZ);
    const charScale = this.cameraController.getCommanderBaseScale();

    // Altitude scaling of shadow
    const altitude = Math.max(0, p.z - p.groundZ);
    const shadowScale = Math.max(0.42, 1 - altitude * 0.0035);
    const shadowAlpha = Math.max(0.2, 0.85 - altitude * 0.0032);

    this.playerShadow.setPosition(projShadow.screenX, projShadow.screenY + 3);
    this.playerShadow.setScale(
      1.15 * projShadow.scale * shadowScale,
      1.15 * projShadow.scale * pitch * shadowScale
    );
    this.playerShadow.setAlpha(shadowAlpha);
    this.playerShadow.setDepth(Math.max(15, Math.round(projShadow.screenY - 1)));

    this.playerSprite.setPosition(projChar.screenX, projChar.screenY);
    this.playerSprite.setScale(charScale);
    this.playerSprite.setDepth(Math.max(20, Math.round(projShadow.screenY + p.z * 0.1)));

    // Jetpack Thruster Flame Effect (visible during glide)
    if (p.isGliding) {
      this.playerJetPlumeL.setVisible(true);
      this.playerJetPlumeR.setVisible(true);
      const flicker = 0.85 + Math.random() * 0.3;

      this.playerJetPlumeL.setPosition(projChar.screenX - 8, projChar.screenY - 8);
      this.playerJetPlumeL.setScale(charScale * 1.1, charScale * 1.4 * flicker);
      this.playerJetPlumeL.setDepth(this.playerSprite.depth - 1);

      this.playerJetPlumeR.setPosition(projChar.screenX + 8, projChar.screenY - 8);
      this.playerJetPlumeR.setScale(charScale * 1.1, charScale * 1.4 * flicker);
      this.playerJetPlumeR.setDepth(this.playerSprite.depth - 1);
    } else {
      this.playerJetPlumeL.setVisible(false);
      this.playerJetPlumeR.setVisible(false);
    }

    if (p.defenseBonusTimer > 0) {
      this.playerResolveAura.setVisible(true);
      this.playerResolveAura.setPosition(projChar.screenX, projChar.screenY - 18 * projChar.scale);
      this.playerResolveAura.setScale(projChar.scale);
      this.playerResolveAura.setDepth(Math.max(21, Math.round(projShadow.screenY + 1)));
    } else {
      this.playerResolveAura.setVisible(false);
    }

    if (p.isDashing && Math.random() < 0.4) {
      this.vfxManager.spawnDashGhost(p.pos, texKey, charScale, p.z);
    }
  }

  private syncEnemies(): void {
    const enemies = this.simulation.state.enemies;
    const currentIds = new Set<string>();
    const pitch = this.cameraController.config.pitchAngle;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      currentIds.add(e.id);

      let record = this.enemyMap.get(e.id);
      if (!record) {
        const shadow = this.add.image(0, 0, 'shadow');

        let key = 'enemy_crawler';
        if (e.type === 'spitter') key = 'enemy_spitter';
        else if (e.type === 'elite' || e.type === 'boss') key = 'enemy_elite';

        const sprite = this.add.sprite(0, 0, key);
        sprite.setOrigin(0.5, 0.85);

        const hpBarBg = this.add.rectangle(0, 0, 34, 4, 0x090d16, 0.85);
        const hpBarFill = this.add.rectangle(
          0,
          0,
          34,
          4,
          e.isElite ? 0x00e5ff : 0xff3d00,
          1
        );
        hpBarFill.setOrigin(0, 0.5);

        record = { sprite, shadow, hpBarBg, hpBarFill };
        this.enemyMap.set(e.id, record);
      }

      const proj = this.cameraController.project(e.pos.x, e.pos.y, e.z);
      if (!proj.visible) {
        record.sprite.setVisible(false);
        record.shadow.setVisible(false);
        record.hpBarBg.setVisible(false);
        record.hpBarFill.setVisible(false);
        continue;
      }

      record.sprite.setVisible(true);
      record.shadow.setVisible(true);
      record.hpBarBg.setVisible(true);
      record.hpBarFill.setVisible(true);

      const baseScale = e.isBoss ? 1.35 : e.isElite ? 0.96 : 0.76;
      const s = proj.scale * baseScale;

      record.sprite.setPosition(proj.screenX, proj.screenY);
      record.sprite.setScale(s);
      record.sprite.setDepth(Math.max(10, Math.round(proj.screenY)));
      this.applyDistanceFogTint(record.sprite, proj.fogFactor);

      record.shadow.setPosition(proj.screenX, proj.screenY + 3 * proj.scale);
      record.shadow.setScale(
        (e.radius / 18) * proj.scale,
        (e.radius / 18) * proj.scale * pitch
      );
      record.shadow.setDepth(Math.max(9, Math.round(proj.screenY - 1)));

      const hpPct = Math.max(0, e.health / e.maxHealth);
      const barW = (e.isElite ? 48 : 34) * proj.scale;
      const barH = Math.max(3, 4.5 * proj.scale);
      const barY = proj.screenY - (e.isElite ? 52 : 36) * proj.scale;

      record.hpBarBg.setPosition(proj.screenX, barY);
      record.hpBarBg.setSize(barW, barH);
      record.hpBarBg.setDepth(Math.max(11, Math.round(proj.screenY + 1)));

      record.hpBarFill.setPosition(proj.screenX - barW * 0.5, barY);
      record.hpBarFill.setSize(barW * hpPct, barH);
      record.hpBarFill.setDepth(Math.max(12, Math.round(proj.screenY + 2)));
    }

    for (const [id, record] of this.enemyMap.entries()) {
      if (!currentIds.has(id)) {
        record.sprite.destroy();
        record.shadow.destroy();
        record.hpBarBg.destroy();
        record.hpBarFill.destroy();
        this.enemyMap.delete(id);
      }
    }
  }

  private syncProjectiles(): void {
    const projs = this.simulation.state.projectiles;
    const currentIds = new Set<string>();

    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      currentIds.add(p.id);

      let spr = this.projMap.get(p.id);
      if (!spr) {
        let key = 'proj_pulse';
        if (p.type === 'wave') key = 'proj_wave';
        else if (p.type === 'acid') key = 'proj_acid';

        spr = this.add.image(0, 0, key);
        this.projMap.set(p.id, spr);
      }

      const elevation = this.simulation.state.terrain.getElevation(p.pos.x, p.pos.y).height;
      const proj = this.cameraController.project(p.pos.x, p.pos.y, elevation + 16);
      if (!proj.visible) {
        spr.setVisible(false);
        continue;
      }

      spr.setVisible(true);
      spr.setPosition(proj.screenX, proj.screenY);
      spr.setScale(proj.scale * (p.type === 'wave' ? 1.05 : 0.88));
      spr.setDepth(Math.max(15, Math.round(proj.screenY + 10)));

      const pNext = this.cameraController.project(
        p.pos.x + p.velocity.x * 0.05,
        p.pos.y + p.velocity.y * 0.05,
        elevation + 16
      );
      spr.setRotation(Math.atan2(pNext.screenY - proj.screenY, pNext.screenX - proj.screenX));
    }

    for (const [id, spr] of this.projMap.entries()) {
      if (!currentIds.has(id)) {
        spr.destroy();
        this.projMap.delete(id);
      }
    }
  }

  private syncCurrencyDrops(): void {
    const drops = this.simulation.state.currencyDrops;
    const currentIds = new Set<string>();
    const pitch = this.cameraController.config.pitchAngle;

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      currentIds.add(d.id);

      let rec = this.dropMap.get(d.id);
      if (!rec) {
        const shadow = this.add.image(0, 0, 'shadow');
        const sprite = this.add.image(0, 0, 'currency_shard');
        rec = { sprite, shadow };
        this.dropMap.set(d.id, rec);
      }

      const groundZ = this.simulation.state.terrain.getElevation(d.pos.x, d.pos.y).height;
      const projGround = this.cameraController.project(d.pos.x, d.pos.y, groundZ);
      const projItem = this.cameraController.project(d.pos.x, d.pos.y, d.z + 4);

      if (!projGround.visible) {
        rec.sprite.setVisible(false);
        rec.shadow.setVisible(false);
        continue;
      }

      rec.sprite.setVisible(true);
      rec.shadow.setVisible(true);

      const valScale = d.value >= 3 ? 1.05 : 0.85;
      rec.sprite.setPosition(projItem.screenX, projItem.screenY);
      rec.sprite.setScale(projItem.scale * valScale);
      rec.sprite.setDepth(Math.max(12, Math.round(projGround.screenY + 1)));

      rec.shadow.setPosition(projGround.screenX, projGround.screenY + 2);
      rec.shadow.setScale(0.35 * projGround.scale, 0.35 * projGround.scale * pitch);
      rec.shadow.setDepth(Math.max(11, Math.round(projGround.screenY)));
    }

    for (const [id, rec] of this.dropMap.entries()) {
      if (!currentIds.has(id)) {
        rec.sprite.destroy();
        rec.shadow.destroy();
        this.dropMap.delete(id);
      }
    }
  }

  private syncItemDrops(time: number): void {
    const itemDrops = this.simulation.state.itemDrops;
    const currentIds = new Set<string>();
    const pitch = this.cameraController.config.pitchAngle;

    for (let i = 0; i < itemDrops.length; i++) {
      const d = itemDrops[i];
      currentIds.add(d.id);

      let rec = this.itemDropMap.get(d.id);
      if (!rec) {
        const shadow = this.add.image(0, 0, 'shadow');
        const orb = this.add.image(0, 0, 'loot_orb');
        const icon = this.add.image(0, 0, d.itemId ? `item_${d.itemId}` : 'loot_orb');
        const labelText = (d.itemId ? d.itemId.replace('_', ' ') : 'AUGMENT').toUpperCase();
        const label = this.add.text(0, 0, labelText, {
          fontSize: '11px',
          fontStyle: 'bold',
          fontFamily: 'system-ui, sans-serif',
          color: '#38bdf8',
          backgroundColor: 'rgba(10, 14, 24, 0.78)',
          padding: { x: 5, y: 2 }
        });
        label.setOrigin(0.5);

        rec = { orb, icon, shadow, label };
        this.itemDropMap.set(d.id, rec);
      }

      const groundZ = this.simulation.state.terrain.getElevation(d.pos.x, d.pos.y).height;
      const hoverZ = d.settled ? groundZ + 10 + Math.sin(time * 0.004 + i) * 4 : d.z + 8;
      const projGround = this.cameraController.project(d.pos.x, d.pos.y, groundZ);
      const projOrb = this.cameraController.project(d.pos.x, d.pos.y, hoverZ);

      if (!projGround.visible) {
        rec.orb.setVisible(false);
        rec.icon.setVisible(false);
        rec.shadow.setVisible(false);
        rec.label.setVisible(false);
        continue;
      }

      rec.orb.setVisible(true);
      rec.icon.setVisible(true);
      rec.shadow.setVisible(true);
      rec.label.setVisible(true);

      rec.orb.setPosition(projOrb.screenX, projOrb.screenY);
      rec.orb.setScale(projOrb.scale * 0.82);
      rec.orb.setDepth(Math.max(14, Math.round(projGround.screenY + 1)));

      rec.icon.setPosition(projOrb.screenX, projOrb.screenY);
      rec.icon.setScale(projOrb.scale * 0.56);
      rec.icon.setDepth(Math.max(15, Math.round(projGround.screenY + 2)));

      rec.label.setPosition(projOrb.screenX, projOrb.screenY - 26 * projOrb.scale);
      rec.label.setScale(Math.max(0.7, Math.min(1.1, projOrb.scale)));
      rec.label.setDepth(Math.max(16, Math.round(projGround.screenY + 3)));

      rec.shadow.setPosition(projGround.screenX, projGround.screenY + 3);
      rec.shadow.setScale(0.65 * projGround.scale, 0.65 * projGround.scale * pitch);
      rec.shadow.setDepth(Math.max(13, Math.round(projGround.screenY)));
    }

    for (const [id, rec] of this.itemDropMap.entries()) {
      if (!currentIds.has(id)) {
        rec.orb.destroy();
        rec.icon.destroy();
        rec.shadow.destroy();
        rec.label.destroy();
        this.itemDropMap.delete(id);
      }
    }
  }

  private syncPods(time: number): void {
    const pods = this.simulation.state.pods;
    const player = this.simulation.state.player;
    const pitch = this.cameraController.config.pitchAngle;
    const interactablePod = this.simulation.getInteractablePod();

    for (let i = 0; i < pods.length; i++) {
      const pod = pods[i];
      const rec = this.podMap.get(pod.id);
      if (!rec) continue;

      const podElevation = this.simulation.state.terrain.getElevation(pod.pos.x, pod.pos.y).height;
      const proj = this.cameraController.project(pod.pos.x, pod.pos.y, podElevation);
      if (!proj.visible) {
        rec.sprite.setVisible(false);
        rec.shadow.setVisible(false);
        rec.ring.setVisible(false);
        rec.prompt.setVisible(false);
        continue;
      }

      rec.sprite.setVisible(true);
      rec.shadow.setVisible(true);

      rec.sprite.setPosition(proj.screenX, proj.screenY);
      rec.sprite.setScale(proj.scale * 0.9);
      rec.sprite.setDepth(Math.max(10, Math.round(proj.screenY)));

      rec.shadow.setPosition(proj.screenX, proj.screenY + 4 * proj.scale);
      rec.shadow.setScale(1.3 * proj.scale, 1.3 * proj.scale * pitch);
      rec.shadow.setDepth(Math.max(9, Math.round(proj.screenY - 1)));

      if (pod.isOpened) {
        rec.sprite.setTint(0x4a4a58);
        rec.ring.setVisible(false);
        rec.prompt.setVisible(false);
      } else {
        const affordable = player.currency >= pod.cost;
        rec.ring.setVisible(true);
        rec.ring.setPosition(proj.screenX, proj.screenY);
        const pulse = 1 + Math.sin(time * 0.004 + i) * 0.08;
        rec.ring.setScale(proj.scale * pulse);
        rec.ring.setDepth(Math.max(8, Math.round(proj.screenY - 2)));

        if (affordable) {
          this.applyDistanceFogTint(rec.sprite, proj.fogFactor);
          rec.ring.setStrokeStyle(2, 0xfacc15, 0.8);
          rec.ring.setFillStyle(0xfacc15, 0.14);
        } else {
          rec.sprite.setTint(0x8878a8);
          rec.ring.setStrokeStyle(1.5, 0x64748b, 0.45);
          rec.ring.setFillStyle(0x475569, 0.07);
        }

        const dist = Math.hypot(player.pos.x - pod.pos.x, player.pos.y - pod.pos.y);
        if (interactablePod?.id === pod.id || dist < 145) {
          rec.prompt.setVisible(true);
          rec.prompt.setPosition(proj.screenX, proj.screenY - 66 * proj.scale);
          if (affordable) {
            rec.prompt.setText(`[E] Open Alien Pod (${pod.cost} Shards)`);
            rec.prompt.setColor('#facc15');
          } else {
            rec.prompt.setText(`Alien Pod — Need ${pod.cost} Shards`);
            rec.prompt.setColor('#94a3b8');
          }
        } else {
          rec.prompt.setVisible(false);
        }
      }
    }
  }

  private syncArtifact(time: number): void {
    const art = this.simulation.state.artifact;
    const player = this.simulation.state.player;
    const pitch = this.cameraController.config.pitchAngle;
    const elevation = this.simulation.state.terrain.getElevation(art.pos.x, art.pos.y).height;
    const proj = this.cameraController.project(art.pos.x, art.pos.y, elevation);

    if (!proj.visible) {
      this.artifactSprite.setVisible(false);
      this.artifactShadow.setVisible(false);
      this.artifactGlow.setVisible(false);
      this.artifactPrompt.setVisible(false);
      return;
    }

    this.artifactSprite.setVisible(true);
    this.artifactShadow.setVisible(true);
    this.artifactGlow.setVisible(true);

    this.artifactSprite.setPosition(proj.screenX, proj.screenY);
    this.artifactSprite.setScale(proj.scale);
    this.artifactSprite.setDepth(Math.max(10, Math.round(proj.screenY)));
    this.applyDistanceFogTint(this.artifactSprite, proj.fogFactor);

    this.artifactShadow.setPosition(proj.screenX, proj.screenY + 6 * proj.scale);
    this.artifactShadow.setScale(2.1 * proj.scale, 2.1 * proj.scale * pitch);
    this.artifactShadow.setDepth(Math.max(9, Math.round(proj.screenY - 1)));

    const pulse = 1 + Math.sin(time * 0.003) * 0.1;
    this.artifactGlow.setPosition(proj.screenX, proj.screenY);
    this.artifactGlow.setScale(proj.scale * pulse);
    this.artifactGlow.setDepth(Math.max(8, Math.round(proj.screenY - 2)));

    if (art.isCharged) {
      this.artifactGlow.setFillStyle(0xffd54f, 0.35);
      this.artifactGlow.setStrokeStyle(4, 0xffeb3b, 0.95);
      const dist = Math.hypot(player.pos.x - art.pos.x, player.pos.y - art.pos.y);
      if (dist < 220) {
        this.artifactPrompt.setVisible(true);
        this.artifactPrompt.setPosition(proj.screenX, proj.screenY - 150 * proj.scale);
      } else {
        this.artifactPrompt.setVisible(false);
      }
    } else {
      const pct = art.chargeProgress / 100;
      this.artifactGlow.setAlpha(0.18 + pct * 0.45);
      this.artifactPrompt.setVisible(false);
    }
  }

  private syncOrbitalStrikes(): void {
    const strikes = this.simulation.state.orbitalStrikes;
    const currentIds = new Set<string>();
    const pitch = this.cameraController.config.pitchAngle;

    for (let i = 0; i < strikes.length; i++) {
      const s = strikes[i];
      currentIds.add(s.id);

      let record = this.strikeMap.get(s.id);
      if (!record) {
        const areaEllipse = this.add.ellipse(0, 0, s.radius * 2, s.radius * 2 * pitch, 0xfacc15, 0.16);
        areaEllipse.setStrokeStyle(2.5, 0xfacc15, 0.85);

        const reticle = this.add.image(0, 0, 'orbital_reticle');
        this.tweens.add({
          targets: reticle,
          angle: 360,
          duration: 1200,
          repeat: -1
        });

        record = { areaEllipse, reticle };
        this.strikeMap.set(s.id, record);
      }

      const strikeElevation = this.simulation.state.terrain.getElevation(s.targetPos.x, s.targetPos.y).height;
      const proj = this.cameraController.project(s.targetPos.x, s.targetPos.y, strikeElevation);
      if (!proj.visible) {
        record.areaEllipse.setVisible(false);
        record.reticle.setVisible(false);
        if (record.beam) record.beam.setVisible(false);
        continue;
      }

      if (!s.hasStruck) {
        record.areaEllipse.setVisible(true);
        record.areaEllipse.setPosition(proj.screenX, proj.screenY);
        record.areaEllipse.setSize(s.radius * 2 * proj.scale, s.radius * 2 * proj.scale * pitch);
        record.areaEllipse.setDepth(Math.max(7, Math.round(proj.screenY - 3)));

        record.reticle.setVisible(true);
        record.reticle.setPosition(proj.screenX, proj.screenY);
        record.reticle.setScale(proj.scale * 1.15, proj.scale * 1.15 * pitch);
        record.reticle.setDepth(Math.max(8, Math.round(proj.screenY - 2)));
      } else {
        record.areaEllipse.setVisible(false);
        record.reticle.setVisible(false);

        if (!record.beam) {
          const beam = this.add.image(proj.screenX, proj.screenY, 'orbital_beam');
          beam.setOrigin(0.5, 1.0);
          beam.setScale(proj.scale * 1.65, proj.scale * 1.35);
          beam.setDepth(3800);

          this.tweens.add({
            targets: beam,
            alpha: 0,
            scaleX: proj.scale * 2.2,
            duration: 420,
            onComplete: () => beam.destroy()
          });

          record.beam = beam;
        } else {
          record.beam.setPosition(proj.screenX, proj.screenY);
        }
      }
    }

    for (const [id, record] of this.strikeMap.entries()) {
      if (!currentIds.has(id)) {
        record.areaEllipse.destroy();
        record.reticle.destroy();
        if (record.beam) record.beam.destroy();
        this.strikeMap.delete(id);
      }
    }
  }

  public restartRun(): void {
    this.enemyMap.forEach(r => {
      r.sprite.destroy();
      r.shadow.destroy();
      r.hpBarBg.destroy();
      r.hpBarFill.destroy();
    });
    this.enemyMap.clear();

    this.projMap.forEach(s => s.destroy());
    this.projMap.clear();

    this.dropMap.forEach(r => {
      r.sprite.destroy();
      r.shadow.destroy();
    });
    this.dropMap.clear();

    this.itemDropMap.forEach(r => {
      r.orb.destroy();
      r.icon.destroy();
      r.shadow.destroy();
      r.label.destroy();
    });
    this.itemDropMap.clear();

    this.strikeMap.forEach(r => {
      r.areaEllipse.destroy();
      r.reticle.destroy();
      if (r.beam) r.beam.destroy();
    });
    this.strikeMap.clear();

    this.podMap.forEach(r => {
      r.sprite.clearTint();
      r.ring.setVisible(true);
      r.prompt.setVisible(false);
    });

    this.simulation = new Simulation();
    this.cameraController.resetCamera();
    this.cameraController.snapTo(this.simulation.state.player.pos);
    this.uiManager.initGame(this.simulation);
  }
}
