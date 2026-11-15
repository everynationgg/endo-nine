import * as THREE from 'three';
import { ThreeVFX } from './ThreeVFX';
import { HeroId } from '../sim/types';

export class SkillPreviewScene {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private vfx: ThreeVFX;
  private textureLoader: THREE.TextureLoader;

  // Platform & Environment
  private platformGroup: THREE.Group;
  private gridRing!: THREE.Mesh;

  // Characters & Entities
  private charGroup: THREE.Group;
  private charSprite!: THREE.Sprite;
  private charShadow!: THREE.Mesh;
  private dummyGroup: THREE.Group;
  private dummySprite!: THREE.Sprite;
  private dummyShadow!: THREE.Mesh;
  private dummyHpBarBg!: THREE.Mesh;
  private dummyHpBarFill!: THREE.Mesh;
  private dummyTargetReticle!: THREE.Mesh;
  private statusBadgeMesh: THREE.Mesh | null = null;

  // Floating / Orbiting Sword System for RMB Upgrade 3 preview
  private previewOrbitingSwords: Array<{ group: THREE.Group; swordModel: THREE.Group; hitDone?: boolean }> = [];
  private orbitingBladeAngle: number = 0;
  private secondaryDummies: Array<{ group: THREE.Group; sprite: THREE.Sprite; x: number; z: number }> = [];

  // Persistent Projectiles/Effects
  private activeLobbedBomb: THREE.Mesh | null = null;
  private activeTwinSlashGroup: THREE.Group | null = null;
  private previewDoctorPropGroup: THREE.Group | null = null;
  private previewHoloMat: THREE.ShaderMaterial | null = null;
  private previewHoloMesh: THREE.Mesh | null = null;
  private extraProjectiles: number = 0;

  // State
  private isPlaying: boolean = true;
  private cycleTimer: number = 0;
  private readonly cycleDuration: number = 3.2;
  private currentHeroId: HeroId = 'commander';
  private currentAbilityKey: string = 'energy_pulse';
  private hasTriggeredVFX: boolean = false;
  private hasTriggeredTick2: boolean = false;
  private hasTriggeredTick3: boolean = false;
  private animFrameId: number | null = null;
  private lastTime: number = performance.now();
  private timeCallback?: (progress: number, currentTime: number, duration: number) => void;

  // Loaded Textures Cache
  private textures: Record<string, THREE.Texture> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.textureLoader = new THREE.TextureLoader();

    // 1. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.canvas.width, this.canvas.height, false);
    this.renderer.setPixelRatio(1.0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 2. Scene & Camera
    this.scene = new THREE.Scene();
    const aspect = this.canvas.width / this.canvas.height;
    this.camera = new THREE.PerspectiveCamera(40, aspect, 1, 1000);
    this.camera.position.set(0, 52, 175);
    this.camera.lookAt(0, 16, 0);

    // 3. Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 1.4);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff5e6, 2.2);
    sun.position.set(60, 120, 80);
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x38bdf8, 1.5);
    rim.position.set(-80, 60, -60);
    this.scene.add(rim);

    // 4. Preload Textures
    this.loadTextures();

    // 5. Build Holographic Simulation Pedestal
    this.platformGroup = new THREE.Group();
    this.scene.add(this.platformGroup);
    this.buildPlatform();

    // 6. Build Character & Training Dummy
    this.charGroup = new THREE.Group();
    this.scene.add(this.charGroup);

    this.dummyGroup = new THREE.Group();
    this.scene.add(this.dummyGroup);

    this.buildCharacter();
    this.buildDummy();

    // 7. Isolated ThreeVFX instance for Real Gameplay Visual Effects
    this.vfx = new ThreeVFX(() => 0);
    this.scene.add(this.vfx.group);

    // 8. Start Loop
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  private loadTextures(): void {
    const texList: { key: string; url: string; cols?: number; rows?: number }[] = [
      { key: 'commander_idle', url: '/assets/commander/commander_right.png' },
      { key: 'commander_attack', url: '/assets/commander/commander_attack_right.png', cols: 4 },
      { key: 'doctor_idle', url: '/assets/doctor/doctor_right.png' },
      { key: 'doctor_run', url: '/assets/doctor/doctor_run_right.png', cols: 4, rows: 2 },
      { key: 'doctor_attack', url: '/assets/doctor/doctor_attack_right.png', cols: 4, rows: 2 },
      { key: 'doctor_rmb', url: '/assets/doctor/doctor_rmb_right.png', cols: 6, rows: 1 },
      { key: 'doctor_dash', url: '/assets/doctor/doctor_dash_right.png', cols: 4, rows: 2 },
      { key: 'doctor_ult', url: '/assets/doctor/doctor_ult_right.png', cols: 4, rows: 2 },
      { key: 'dummy', url: '/assets/enemy_elite.png' },
      { key: 'shadow', url: '/assets/shadow.png' },
      { key: 'rune_circle', url: '/assets/rune_circle.png' }
    ];

    for (const item of texList) {
      const tex = this.textureLoader.load(item.url, (loadedTex) => {
        const cols = item.cols || 1;
        const rows = item.rows || 1;
        if (cols > 1 || rows > 1) {
          loadedTex.repeat.set(1 / cols, 1 / rows);
          loadedTex.offset.set(0, 1 - 1 / rows);
          loadedTex.minFilter = THREE.LinearFilter;
          loadedTex.generateMipmaps = false;
        }
        if (this.charSprite && (item.key === 'commander_idle' || item.key === 'commander_attack' || item.key === 'doctor_idle')) {
          if (this.currentHeroId === 'commander' && item.key === 'commander_idle') {
            this.charSprite.material.map = loadedTex;
          } else if (this.currentHeroId === 'doctor' && item.key === 'doctor_idle') {
            this.charSprite.material.map = loadedTex;
          }
          this.charSprite.material.needsUpdate = true;
        }
        if (this.dummySprite && item.key === 'dummy') {
          this.dummySprite.material.needsUpdate = true;
        }
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textures[item.key] = tex;
    }
  }

  private buildPlatform(): void {
    // Heavy sci-fi metal pedestal
    const baseGeo = new THREE.CylinderGeometry(110, 116, 8, 48);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.8
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -4;
    this.platformGroup.add(base);

    // Glowing cyan simulation grid ring
    const ringGeo = new THREE.RingGeometry(85, 95, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
    });
    this.gridRing = new THREE.Mesh(ringGeo, ringMat);
    this.gridRing.rotation.x = -Math.PI / 2;
    this.gridRing.position.y = 0.2;
    this.platformGroup.add(this.gridRing);

    // Inner subtle tech compass
    const innerRingGeo = new THREE.RingGeometry(25, 27, 32);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.25;
    this.platformGroup.add(innerRing);
  }

  private buildCharacter(): void {
    // Character contact shadow
    const shadowGeo = new THREE.PlaneGeometry(36, 18);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.textures['shadow'],
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    this.charShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.charShadow.rotation.x = -Math.PI / 2;
    this.charShadow.position.set(-52, 0.3, 0);
    this.charGroup.add(this.charShadow);

    // 2.5D Character Sprite
    const charMat = new THREE.SpriteMaterial({
      map: this.textures['commander_idle'],
      transparent: true,
      alphaTest: 0.05
    });
    this.charSprite = new THREE.Sprite(charMat);
    this.charSprite.scale.set(48, 48, 1);
    this.charSprite.position.set(-52, 22, 0);
    this.charGroup.add(this.charSprite);
  }

  private buildDummy(): void {
    // Dummy contact shadow
    const shadowGeo = new THREE.PlaneGeometry(32, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.textures['shadow'],
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    this.dummyShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.dummyShadow.rotation.x = -Math.PI / 2;
    this.dummyShadow.position.set(52, 0.3, 0);
    this.dummyGroup.add(this.dummyShadow);

    // 2.5D Training Dummy Sprite
    const dummyMat = new THREE.SpriteMaterial({
      map: this.textures['dummy'],
      transparent: true,
      alphaTest: 0.05
    });
    this.dummySprite = new THREE.Sprite(dummyMat);
    this.dummySprite.scale.set(44, 44, 1);
    this.dummySprite.position.set(52, 20, 0);
    this.dummyGroup.add(this.dummySprite);

    // Mini Holographic Health Bar Frame
    const barFrameGeo = new THREE.PlaneGeometry(38, 5);
    const barFrameMat = new THREE.MeshBasicMaterial({
      color: 0x020617,
      side: THREE.DoubleSide
    });
    this.dummyHpBarBg = new THREE.Mesh(barFrameGeo, barFrameMat);
    this.dummyHpBarBg.position.set(52, 46, 0);
    this.dummyGroup.add(this.dummyHpBarBg);

    // Mini Holographic Health Bar Green Fill
    const barFillGeo = new THREE.PlaneGeometry(36, 3.5);
    barFillGeo.translate(18, 0, 0); // anchor left
    const barFillMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide
    });
    this.dummyHpBarFill = new THREE.Mesh(barFillGeo, barFillMat);
    this.dummyHpBarFill.position.set(52 - 18, 46, 0.1);
    this.dummyGroup.add(this.dummyHpBarFill);

    // Holographic Crosshair Target Marker
    const reticleGeo = new THREE.RingGeometry(18, 20, 24);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xeab308,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    this.dummyTargetReticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.dummyTargetReticle.rotation.x = -Math.PI / 2;
    this.dummyTargetReticle.position.set(52, 0.4, 0);
    this.dummyGroup.add(this.dummyTargetReticle);
  }

  private disposeObject3D(obj: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();

    obj.traverse((child: any) => {
      if (child.geometry) {
        geometries.add(child.geometry);
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          for (const mat of child.material) {
            if (mat) materials.add(mat);
          }
        } else {
          materials.add(child.material);
        }
      }
    });

    for (const geo of geometries) {
      geo.dispose();
    }
    for (const mat of materials) {
      mat.dispose();
    }
  }

  private rebuildStage(): void {
    // 1. Clean up and dispose old secondary dummies
    if (this.secondaryDummies.length > 0) {
      for (const d of this.secondaryDummies) {
        this.platformGroup.remove(d.group);
        this.disposeObject3D(d.group);
      }
      this.secondaryDummies = [];
    }

    // 2. Clean up and dispose old orbiting swords
    if (this.previewOrbitingSwords.length > 0) {
      for (const sw of this.previewOrbitingSwords) {
        this.charGroup.remove(sw.group);
        this.disposeObject3D(sw.group);
      }
      this.previewOrbitingSwords = [];
    }

    // 3. Set up secondary target dummies for Piercing Laser multi-branch previews
    if (this.currentAbilityKey === 'piercing_laser') {
      const branchCount = Math.min(6, 2 + this.extraProjectiles);
      const dummyCoords = [
        { x: 38, z: -28 },
        { x: 40, z: 28 },
        { x: 68, z: -22 },
        { x: 70, z: 22 },
        { x: 20, z: -28 },
        { x: 22, z: 28 }
      ];

      const dummyTex = this.textures['dummy'];
      const shadowTex = this.textures['shadow'];

      for (let i = 0; i < branchCount; i++) {
        const c = dummyCoords[i];
        const group = new THREE.Group();
        group.position.set(c.x, 0, c.z);

        if (shadowTex) {
          const shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(24, 12),
            new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.6, depthWrite: false })
          );
          shadow.rotation.x = -Math.PI / 2;
          shadow.position.y = 0.3;
          group.add(shadow);
        }

        const spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: dummyTex || undefined,
          transparent: true,
          alphaTest: 0.05
        }));
        spr.scale.set(34, 34, 1);
        spr.position.y = 16;
        group.add(spr);

        this.platformGroup.add(group);
        this.secondaryDummies.push({ group, sprite: spr, x: c.x, z: c.z });
      }
    }

    // 4. Set up Orbiting Electric Swords immediately in full 360° orbital formation (strictly capped at 7)
    if (this.currentAbilityKey === 'orbiting_blade') {
      const swordCount = Math.min(7, Math.max(1, 1 + this.extraProjectiles));
      for (let s = 0; s < swordCount; s++) {
        const group = new THREE.Group();
        const swordModel = this.vfx.createElectricSwordModel();
        group.add(swordModel);
        this.charGroup.add(group);
        this.previewOrbitingSwords.push({ group, swordModel, hitDone: false });
      }
      this.orbitingBladeAngle = 0;
    }
  }

  public setHero(heroId: HeroId): void {
    this.currentHeroId = heroId;
    if (this.currentHeroId === 'doctor') {
      const tex = this.textures['doctor_idle'];
      if (tex) {
        tex.repeat.set(1, 1);
        tex.offset.set(0, 0);
        this.charSprite.material.map = tex;
      }
    } else {
      const tex = this.textures['commander_idle'];
      if (tex) {
        tex.repeat.set(1, 1);
        tex.offset.set(0, 0);
        this.charSprite.material.map = tex;
      }
    }
    this.charSprite.material.needsUpdate = true;
    this.replay();
  }

  public setAbility(heroId: HeroId, abilityKey: string): void {
    this.currentHeroId = heroId;
    this.currentAbilityKey = abilityKey;
    this.setHero(heroId);
    this.rebuildStage();
    this.replay();
  }

  public setExtraProjectiles(count: number): void {
    this.extraProjectiles = Math.max(0, count);
    this.rebuildStage();
    this.replay();
  }

  public getExtraProjectiles(): number {
    return this.extraProjectiles;
  }

  public togglePlay(): boolean {
    this.isPlaying = !this.isPlaying;
    return this.isPlaying;
  }

  public setPlaying(playing: boolean): void {
    this.isPlaying = playing;
  }

  public replay(): void {
    this.cycleTimer = 0;
    this.hasTriggeredVFX = false;
    this.hasTriggeredTick2 = false;
    this.hasTriggeredTick3 = false;

    // Reset character and dummy positions
    this.charSprite.scale.set(48, 48, 1);
    this.charSprite.position.set(-52, 22, 0);
    this.charShadow.position.set(-52, 0.3, 0);
    this.dummySprite.position.set(52, 20, 0);
    this.dummyShadow.position.set(52, 0.3, 0);
    this.dummyHpBarBg.position.set(52, 46, 0);
    this.dummyHpBarFill.position.set(52 - 18, 46, 0.1);
    this.dummyHpBarFill.scale.x = 1.0;
    (this.dummyHpBarFill.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);

    const idleKey = this.currentHeroId === 'doctor' ? 'doctor_idle' : 'commander_idle';
    const idleTex = this.textures[idleKey];
    if (idleTex) {
      idleTex.repeat.set(1, 1);
      idleTex.offset.set(0, 0);
      this.charSprite.material.map = idleTex;
      this.charSprite.material.needsUpdate = true;
    }

    // Reset orbiting sword flags and angle
    this.orbitingBladeAngle = 0;
    for (const sw of this.previewOrbitingSwords) {
      sw.hitDone = false;
    }

    // 1. Clean up temporary active projectile groups and badges
    if (this.activeTwinSlashGroup) {
      this.scene.remove(this.activeTwinSlashGroup);
      this.disposeObject3D(this.activeTwinSlashGroup);
      this.activeTwinSlashGroup = null;
    }
    if (this.activeLobbedBomb) {
      this.scene.remove(this.activeLobbedBomb);
      this.disposeObject3D(this.activeLobbedBomb);
      this.activeLobbedBomb = null;
    }
    if (this.statusBadgeMesh) {
      this.dummyGroup.remove(this.statusBadgeMesh);
      this.disposeObject3D(this.statusBadgeMesh);
      this.statusBadgeMesh = null;
    }
    if (this.previewDoctorPropGroup) {
      this.scene.remove(this.previewDoctorPropGroup);
      this.disposeObject3D(this.previewDoctorPropGroup);
      this.previewDoctorPropGroup = null;
      this.previewHoloMat = null;
      this.previewHoloMesh = null;
    }

    // Clean up VFX particles in group
    for (let i = this.vfx.group.children.length - 1; i >= 0; i--) {
      const obj = this.vfx.group.children[i];
      if (obj === this.vfx.sharedOrbitalLight) {
        continue;
      }
      this.vfx.group.remove(obj);
      this.disposeObject3D(obj);
    }
  }

  public stepTo(targetTime: number): void {
    this.replay();
    this.isPlaying = false;
    const dt = 1 / 60;
    const steps = Math.round(targetTime / dt);
    for (let s = 0; s < steps; s++) {
      this.cycleTimer += dt;
      this.updatePreview(dt, performance.now());
      this.vfx.update(dt, this.camera);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.timeCallback) {
      this.timeCallback(
        Math.min(1.0, this.cycleTimer / this.cycleDuration),
        this.cycleTimer,
        this.cycleDuration
      );
    }
  }

  public setTimeCallback(cb: (progress: number, cur: number, dur: number) => void): void {
    this.timeCallback = cb;
  }

  private loop(now: number): void {
    this.animFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) * 0.001, 0.1);
    this.lastTime = now;

    if (this.isPlaying) {
      this.cycleTimer += dt;
      if (this.cycleTimer >= this.cycleDuration) {
        this.replay();
      }
    }

    // Update simulation preview logic
    this.updatePreview(dt, now);

    // Update ThreeVFX internal particles and ribbons
    this.vfx.update(dt, this.camera);

    // Rotate platform ambient markings
    if (this.gridRing) {
      this.gridRing.rotation.z += dt * 0.15;
    }
    if (this.dummyTargetReticle) {
      this.dummyTargetReticle.rotation.z -= dt * 0.3;
    }

    // Notify UI progress callback
    if (this.timeCallback) {
      this.timeCallback(
        Math.min(1.0, this.cycleTimer / this.cycleDuration),
        this.cycleTimer,
        this.cycleDuration
      );
    }

    // Render Preview Frame
    this.renderer.render(this.scene, this.camera);
  }

  private applyPreviewSheetFrame(texKey: string, cols: number, rows: number, frameIdx: number, scaleY: number = 48): void {
    const tex = this.textures[texKey];
    if (!tex) return;
    const clamped = Math.max(0, Math.min(cols * rows - 1, frameIdx));
    const col = clamped % cols;
    const row = Math.floor(clamped / cols);
    if (this.charSprite.material.map !== tex) {
      this.charSprite.material.map = tex;
      this.charSprite.material.needsUpdate = true;
    }
    tex.repeat.set(1 / cols, 1 / rows);
    tex.offset.set(col / cols, 1.0 - (row + 1) / rows);
    this.charSprite.scale.set(48, scaleY, 1);
  }

  private updatePreview(dt: number, now: number): void {
    const t = this.cycleTimer;
    const charPos2 = { x: -52, y: 0 };
    const dummyPos2 = { x: 52, y: 0 };
    const isDoctor = this.currentHeroId === 'doctor';
    const isDocDash = isDoctor && (
      this.currentAbilityKey === 'medical_rush' ||
      this.currentAbilityKey === 'extended_dash' ||
      this.currentAbilityKey === 'phase_barrier' ||
      this.currentAbilityKey === 'adrenaline_rush'
    );
    const isDocUlt = isDoctor && (
      this.currentAbilityKey === 'sanctuary_cross' ||
      this.currentAbilityKey === 'mobile_sanctuary' ||
      this.currentAbilityKey === 'divine_intervention' ||
      this.currentAbilityKey === 'rain_of_crosses'
    );
    const isDocRmb = isDoctor && (
      this.currentAbilityKey === 'toxic_contamination' ||
      this.currentAbilityKey === 'experimental_drones' ||
      this.currentAbilityKey === 'toxic_cluster_bomb' ||
      this.currentAbilityKey === 'holographic_decoy'
    );

    // 1. Idle Bobbing & Posture (t < 0.4s)
    if (t < 0.4) {
      const bob = Math.sin(t * 8) * 1.2;
      this.charSprite.position.y = 22 + bob;
      this.dummySprite.position.y = 20 + Math.sin(t * 6) * 0.8;
      this.applyPreviewSheetFrame(isDoctor ? 'doctor_idle' : 'commander_idle', 1, 1, 0, 48);
    }

    // 2. Windup Action & Attack animation at t = 0.4s to 1.0s
    if (t >= 0.4 && t < 1.0) {
      const progress = Math.min(0.99, (t - 0.4) / 0.58);
      if (isDoctor) {
        if (isDocUlt) {
          this.applyPreviewSheetFrame('doctor_ult', 4, 2, Math.floor(progress * 8), 60);
          this.charSprite.position.y = 24;
        } else if (isDocDash) {
          this.applyPreviewSheetFrame('doctor_dash', 4, 2, Math.floor(progress * 8), 48);
        } else if (isDocRmb) {
          this.applyPreviewSheetFrame('doctor_rmb', 6, 1, Math.floor(progress * 6), 48);
        } else {
          // Alternate Left pistol (0..3) and Right pistol (4..7) on second volley
          const frame = Math.floor(progress * 4);
          this.applyPreviewSheetFrame('doctor_attack', 4, 2, frame, 48);
        }
      } else {
        this.applyPreviewSheetFrame('commander_attack', 4, 1, Math.floor(progress * 4), 48);
      }
      if (!isDocDash) {
        this.charSprite.position.x = -50; // slight forward step
      }
    } else if (t >= 1.0) {
      // Return to idle sprite (Doctor shows second alternating pistol volley at t in [1.0, 1.35] for dual pistols)
      if (isDoctor && (this.currentAbilityKey === 'medical_pulse' || this.currentAbilityKey === 'toxic_chain') && t < 1.35) {
        const p2 = Math.min(0.99, (t - 1.0) / 0.35);
        this.applyPreviewSheetFrame('doctor_attack', 4, 2, 4 + Math.floor(p2 * 4), 48);
      } else {
        this.applyPreviewSheetFrame(isDoctor ? 'doctor_idle' : 'commander_idle', 1, 1, 0, 48);
        this.charSprite.position.y = 22;
      }
      if (
        this.currentAbilityKey !== 'tactical_dash' &&
        this.currentAbilityKey !== 'shock_dash' &&
        this.currentAbilityKey !== 'extended_dash' &&
        this.currentAbilityKey !== 'teleport' &&
        this.currentAbilityKey !== 'medical_rush' &&
        this.currentAbilityKey !== 'phase_barrier' &&
        this.currentAbilityKey !== 'adrenaline_rush'
      ) {
        this.charSprite.position.x = -52;
      }
    }

    // 3. Main Ability Cast Trigger at t = 0.5s
    if (t >= 0.5 && !this.hasTriggeredVFX) {
      this.hasTriggeredVFX = true;
      this.triggerAbilityVFX(charPos2, dummyPos2);
    }

    // 4. Secondary Multi-Tick / Detonation Triggers
    if (t >= 0.8 && !this.hasTriggeredTick2) {
      this.hasTriggeredTick2 = true;
      this.triggerMultiTick2(dummyPos2);
    }

    if (t >= 1.1 && !this.hasTriggeredTick3) {
      this.hasTriggeredTick3 = true;
      this.triggerMultiTick3(dummyPos2);
    }

    // 5. Active Twin Slash Flight Arc (for Base RMB Cross Slash)
    if (this.activeTwinSlashGroup) {
      const flightProgress = (t - 0.5) / 0.45; // 0.45s travel time
      if (flightProgress <= 1.0) {
        const curX = -52 + flightProgress * (52 - -52);
        this.activeTwinSlashGroup.position.set(curX, 22, 0);
        this.vfx.updateTwinSlashProjectileGroup(
          this.activeTwinSlashGroup,
          flightProgress,
          dt,
          { x: curX, y: 0 },
          22
        );
      } else {
        this.scene.remove(this.activeTwinSlashGroup);
        this.disposeObject3D(this.activeTwinSlashGroup);
        this.activeTwinSlashGroup = null;
        this.vfx.spawnBlasterImpactSpark(dummyPos2, 24);
        this.vfx.spawnDamageNumber(dummyPos2, 72, '#fbbf24', 24);
        this.wobbleDummy(1.0, 0.42);
      }
    }

    // 5B. Animate running holographic Doctor decoy preview if active
    if (this.previewHoloMesh && this.previewHoloMat) {
      const runProgress = Math.max(0, Math.min(1, (t - 0.8) / 1.4));
      this.previewHoloMesh.position.x = -34 + runProgress * 58;
      const fIdx = Math.floor((now * 0.012) % 8);
      this.previewHoloMat.uniforms.uUvOffset.value.set((fIdx % 4) / 4, 1 - (Math.floor(fIdx / 4) + 1) / 2);
      this.previewHoloMat.uniforms.uTime.value = now * 0.001;
      if (t > 1.75) {
        this.previewHoloMesh.visible = false;
      }
    }

    // 5C. Gently animate transient 3D celestial constructs or drones in preview
    if (this.previewDoctorPropGroup && (this.currentAbilityKey === 'divine_intervention' || this.currentAbilityKey === 'experimental_drones')) {
      this.previewDoctorPropGroup.children.forEach((child, idx) => {
        child.rotation.y += dt * (this.currentAbilityKey === 'divine_intervention' ? 1.1 : 0.6);
        child.position.y += Math.sin(now * 0.006 + idx) * dt * 5.0;
      });
    }

    // 6. Active Orbiting Electric Swords (for RMB Upgrade 3: Orbiting Electric Swords)
    if (this.previewOrbitingSwords.length > 0) {
      const swordCount = this.previewOrbitingSwords.length;
      const rad = 38;
      this.orbitingBladeAngle += 4.6 * 0.016; // Continuous full 360° orbital rotation

      for (let s = 0; s < swordCount; s++) {
        const sw = this.previewOrbitingSwords[s];
        const sAngle = this.orbitingBladeAngle + (Math.PI * 2 / swordCount) * s;
        // Commander's world position on the preview platform is at X = -52
        const swX = -52 + Math.cos(sAngle) * rad;
        const swZ = Math.sin(sAngle) * rad;
        const swY = 22 + Math.sin(t * 4.2 + s * 1.3) * 2.5;

        // When a sword swings toward the enemy dummy sector (rightward arc), physically lunge forward to impale
        const cosA = Math.cos(sAngle);
        if (cosA > 0.65) {
          const lungeNorm = (cosA - 0.65) / 0.35; // 0 -> 1 at apex
          const lungeReach = Math.sin(lungeNorm * Math.PI) * 48; // Swift physical dart forward
          const lungeX = swX + lungeReach;
          const lungeY = swY + (16 - swY) * (lungeReach / 48) * 0.5;
          const lungeZ = swZ * (1 - (lungeReach / 48) * 0.7);

          sw.swordModel.position.set(lungeX, lungeY, lungeZ);
          // Look at dummy during strike
          sw.swordModel.lookAt(new THREE.Vector3(48, 16, 0));
          sw.swordModel.rotateX(Math.PI / 2);

          if (cosA > 0.92 && !sw.hitDone) {
            sw.hitDone = true;
            this.vfx.spawnBlasterImpactSpark({ x: lungeX + 6, y: lungeZ }, 20);
            this.vfx.spawnDamageNumber(dummyPos2, 34, '#c084fc', 22);
            this.wobbleDummy(0.45, 0.45);
            this.showStatusBadge('ELECTRIFIED (+30% DMG)', 0xc084fc);
          }
        } else {
          // Visual position in orbit: visibly passes in front (swZ > 0) and behind (swZ < 0) Commander
          sw.swordModel.position.set(swX, swY, swZ);
          sw.swordModel.rotation.set(0.18, -sAngle, Math.sin(t * 5.0 + s) * 0.12);
          sw.hitDone = false;
        }
      }
    }
  }

  private triggerAbilityVFX(charPos: { x: number; y: number }, targetPos: { x: number; y: number }): void {
    const k = this.currentAbilityKey;

    switch (k) {
      // --- COMMANDER PRIMARY (LMB) ---
      case 'energy_pulse': { // Base LMB (Service Pistol)
        const totalShots = 1 + this.extraProjectiles;
        for (let i = 0; i < totalShots; i++) {
          const spreadY = (i - (totalShots - 1) / 2) * 8;
          const target = { x: targetPos.x, y: targetPos.y + spreadY };
          this.vfx.spawnBlasterMuzzleFlash(charPos, 22, 1, 0);
          this.vfx.spawnLaserBeam(charPos, target, 0);
          this.vfx.spawnBlasterImpactSpark(target, 20);
        }
        this.vfx.spawnDamageNumber(targetPos, 26 * totalShots, '#facc15', 22);
        this.wobbleDummy(0.6 + 0.08 * totalShots, 0.78);
        break;
      }

      case 'chill_beam': { // LMB Upgrade 1: Chill Beam
        const boltCount = 1 + this.extraProjectiles;
        this.vfx.spawnChillBeam(charPos, targetPos, 0, boltCount);
        this.vfx.spawnDamageNumber(targetPos, 14 * boltCount, '#38bdf8', 22);
        this.wobbleDummy(0.5, 0.82);
        this.showStatusBadge('CHILL (-40% SPD)', 0x00f0ff);
        break;
      }

      case 'piercing_laser': { // LMB Upgrade 2: Piercing Laser (Primary Laser + Up to 6 Secondary Branches)
        const branchCount = Math.min(6, 2 + this.extraProjectiles);
        const branches: Array<{ from: { x: number; y: number }; fromZ: number; to: { x: number; y: number }; toZ: number }> = [];
        for (let b = 0; b < branchCount; b++) {
          const sec = this.secondaryDummies[b];
          const target = sec ? { x: sec.x, y: sec.z } : { x: 52, y: (b % 2 === 0 ? 1 : -1) * (20 + b * 10) };
          branches.push({
            from: targetPos,
            fromZ: 16,
            to: target,
            toZ: 14
          });
        }
        this.vfx.spawnPiercingElectricLaser(
          charPos,
          targetPos,
          0,
          branches,
          16
        );
        this.vfx.spawnBlasterImpactSpark(targetPos, 22);
        for (const br of branches) {
          this.vfx.spawnBlasterImpactSpark(br.to, 20);
          this.vfx.spawnDamageNumber(br.to, 28, '#c084fc', 20);
        }
        this.vfx.spawnDamageNumber(targetPos, 38 + branchCount * 14, '#c084fc', 24);
        this.wobbleDummy(0.8, 0.68);
        this.showStatusBadge('ELECTRIFIED (+25% DMG)', 0xc084fc);
        break;
      }

      case 'extended_slash': { // LMB Upgrade 3: Extended Slash
        const slashCount = 1 + this.extraProjectiles;
        this.charSprite.position.x = -35; // step forward
        this.vfx.spawnExtendedSlash({ x: -35, y: 0 }, 0, 0, slashCount, 160);
        this.vfx.spawnBlasterImpactSpark(targetPos, 20);
        this.vfx.spawnDamageNumber(targetPos, 54 * slashCount, '#f59e0b', 24);
        this.wobbleDummy(0.9, 0.55);
        break;
      }

      // --- COMMANDER SECONDARY (RMB) ---
      case 'explosive_bomb': { // Base RMB: Cross Slash
        const extraLayers = this.extraProjectiles >= 4 ? 2 : (this.extraProjectiles >= 2 ? 1 : 0);
        this.activeTwinSlashGroup = this.vfx.createTwinSlashProjectileGroup(extraLayers);
        this.activeTwinSlashGroup.position.set(-52, 22, 0);
        this.scene.add(this.activeTwinSlashGroup);
        break;
      }

      case 'scissor_slash': { // RMB Upgrade 1: Scissor Slash
        const totalSlashes = 1 + this.extraProjectiles;
        this.vfx.spawnScissorSlash(charPos, 0, 0, targetPos, 70, totalSlashes);
        const finalDelay = totalSlashes * 220;
        setTimeout(() => {
          this.vfx.spawnBlasterImpactSpark(targetPos, 20);
          this.vfx.spawnDamageNumber(targetPos, 88 * totalSlashes, '#fbbf24', 26);
          this.wobbleDummy(1.2, 0.35);
        }, finalDelay);
        break;
      }

      case 'frost_burst': { // RMB Upgrade 2: Frost Burst
        const extraEruptions = this.extraProjectiles;
        const spikePositions: Array<{ pos: { x: number; y: number }; delay: number }> = [];
        for (let ep = 0; ep < extraEruptions; ep++) {
          const ang = (ep / Math.max(1, extraEruptions)) * Math.PI * 2 + 0.4;
          const dist = 32 + (ep % 2) * 16;
          spikePositions.push({
            pos: { x: charPos.x + Math.cos(ang) * dist, y: charPos.y + Math.sin(ang) * dist },
            delay: 0.12 * (ep + 1)
          });
        }
        this.vfx.spawnFrostBurst(charPos, 0, 135, extraEruptions, spikePositions);
        this.vfx.spawnDamageNumber(targetPos, 65 + extraEruptions * 25, '#00f0ff', 24);
        this.wobbleDummy(0.7, 0.60);
        this.showStatusBadge('CHILL BLIZZARD', 0x00f0ff);
        break;
      }

      case 'orbiting_blade': { // RMB Upgrade 3: Orbiting Electric Swords (Cap 7)
        for (const sw of this.previewOrbitingSwords) {
          sw.hitDone = false;
        }
        break;
      }

      // --- COMMANDER DASH (UTILITY) ---
      case 'tactical_dash': // Base Dash
        this.vfx.spawnDashGhost(charPos, this.charSprite.material.map!, 0);
        this.charSprite.position.x = 10;
        this.charShadow.position.x = 10;
        this.vfx.spawnShockwaveRing({ x: 20, y: 0 }, 55, 0x38bdf8, 0);
        this.wobbleDummy(0.7, 0.75);
        break;

      case 'shock_dash': // Dash Upgrade 1: Shock Dash
        this.vfx.spawnDashGhost(charPos, this.charSprite.material.map!, 0);
        this.charSprite.position.x = 20;
        this.charShadow.position.x = 20;
        this.vfx.spawnDashKineticImpact(targetPos, 0, 75, { x: 1, y: 0 });
        this.vfx.spawnDamageNumber(targetPos, 48, '#f59e0b', 24);
        this.wobbleDummy(1.1, 0.50);
        break;

      case 'extended_dash': // Universal Dash Augment 1: Extended Dash
        if (this.currentHeroId === 'doctor') {
          const docTex = this.textures['doctor_idle'] || this.charSprite.material.map!;
          this.vfx.spawnWhiteSilhouetteGhost({ x: -52, y: 0 }, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.45, 0.72);
          this.vfx.spawnWhiteSilhouetteGhost({ x: -16, y: 0 }, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.45, 0.72);
          this.vfx.spawnWhiteSilhouetteGhost({ x: 24, y: 0 }, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.45, 0.72);
          this.charSprite.position.x = 78;
          this.charShadow.position.x = 78;
          this.vfx.spawnShockwaveRing({ x: 78, y: 0 }, 56, 0x34d399, 0);
          this.vfx.spawnHealMoteBurst({ x: -10, y: 0 }, 8, 4);
          this.vfx.spawnDamageNumber(targetPos, 48, '#34d399', 22);
          this.wobbleDummy(0.5, 0.75);
        } else {
          this.vfx.spawnDashGhost(charPos, this.charSprite.material.map!, 0);
          this.vfx.spawnDashGhost({ x: 0, y: 0 }, this.charSprite.material.map!, 0);
          this.charSprite.position.x = 75; // past the dummy
          this.charShadow.position.x = 75;
          this.vfx.spawnShockwaveRing({ x: 75, y: 0 }, 60, 0x38bdf8, 0);
          this.wobbleDummy(0.4, 0.85);
        }
        break;

      case 'teleport': // Dash Upgrade 3: Teleport
        this.vfx.spawnTeleportPortals(charPos, 0, { x: 75, y: 0 }, 0, 45);
        this.charSprite.position.x = 75;
        this.charShadow.position.x = 75;
        this.vfx.spawnShockwaveRing({ x: 75, y: 0 }, 55, 0xc084fc, 0);
        this.vfx.spawnDamageNumber(targetPos, 42, '#a855f7', 24);
        this.wobbleDummy(0.6, 0.70);
        break;

      // --- COMMANDER ULTIMATE (R) ---
      case 'orbital_judgment': // Base Ultimate: Orbital Strike
        this.vfx.spawnOrbitalTargetLock(targetPos, 75, 0.45);
        setTimeout(() => {
          this.vfx.spawnOrbitalBlast(targetPos, 85, 0);
          this.vfx.spawnDamageNumber(targetPos, 240, '#facc15', 30);
          this.wobbleDummy(1.5, 0.20);
        }, 400);
        break;

      case 'singularity': // Ultimate Upgrade 1: Singularity
        this.vfx.spawnSingularityVFX(targetPos, 70, 1.8);
        setTimeout(() => {
          this.vfx.spawnSingularityDetonationVFX(targetPos, 85);
          this.vfx.spawnDamageNumber(targetPos, 360, '#c084fc', 32);
          this.wobbleDummy(1.6, 0.15);
        }, 1200);
        break;

      case 'convergence_barrage': // Ultimate Upgrade 2: Convergence Barrage
        this.vfx.spawnConvergenceBarrageVFX(targetPos, [ { x: targetPos.x - 20, y: targetPos.y + 15 }, { x: targetPos.x + 20, y: targetPos.y - 15 } ], 85, 2.0);
        setTimeout(() => {
          this.vfx.spawnConvergenceDetonationVFX(targetPos, 90);
          this.vfx.spawnDamageNumber(targetPos, 420, '#ef4444', 34);
          this.wobbleDummy(1.8, 0.05);
        }, 900);
        break;

      case 'cryogenic_impact': // Ultimate Upgrade 3: Cryogenic Impact
        this.vfx.spawnCryogenicFieldVFX(targetPos, 75, 2.5);
        this.vfx.spawnDamageNumber(targetPos, 320, '#38bdf8', 30);
        this.wobbleDummy(1.4, 0.10);
        this.showStatusBadge('PERMAFROST STUN', 0x00f0ff);
        break;

      // --- DOCTOR ACTIVE SKILLS & 12 APPROVED AUGMENTS ---
      case 'medical_pulse': { // Doctor Base LMB: Rapid Dual Pistols
        const count = 1 + this.extraProjectiles;
        for (let i = 0; i < count; i++) {
          const sy = (i - (count - 1) / 2) * 7;
          this.vfx.spawnLaserBeam(charPos, { x: targetPos.x, y: targetPos.y + sy }, 0);
          this.vfx.spawnShockwaveRing({ x: targetPos.x, y: targetPos.y + sy }, 18, 0x10b981, 18, 0.25);
        }
        this.vfx.spawnDamageNumber(targetPos, 24 * count, '#34d399', 22);
        this.wobbleDummy(0.5, 0.82);
        break;
      }

      case 'toxic_chain': { // Doctor LMB Augment 1: Toxic Chain
        const bounceA = { x: targetPos.x - 12, y: -22 };
        const bounceB = { x: targetPos.x + 14, y: 22 };
        this.vfx.spawnToxicChainArc(charPos, 20, targetPos, 18);
        this.vfx.spawnToxicChainArc(targetPos, 18, bounceA, 16);
        this.vfx.spawnToxicChainArc(bounceA, 16, bounceB, 16);
        this.vfx.spawnDamageNumber(targetPos, 24, '#84cc16', 22);
        this.wobbleDummy(0.6, 0.78);
        this.showStatusBadge('POISON STACKS (1/3)', 0x84cc16);
        break;
      }

      case 'cryogenic_scalpel': { // Doctor LMB Augment 2: Cryogenic Scalpel (Max 7, 1.25s wake)
        const blades = Math.min(7, 1 + this.extraProjectiles);
        for (let i = 0; i < Math.min(7, blades); i++) {
          const offY = (i - (Math.min(7, blades) - 1) / 2) * 10;
          this.vfx.spawnShockwaveRing({ x: 0, y: offY }, 24, 0x38bdf8, 2, 0.45);
          this.vfx.spawnShockwaveRing({ x: targetPos.x, y: offY }, 30, 0x7dd3fc, 2, 0.55);
        }
        this.vfx.spawnCryogenicFieldVFX({ x: 0, y: 0 }, 52, 1.25);
        this.vfx.spawnDamageNumber(targetPos, 32 * blades, '#38bdf8', 24);
        this.wobbleDummy(0.6, 0.74);
        this.showStatusBadge(`CHILLED + 1.25s WAKE (${blades}/7)`, 0x38bdf8);
        break;
      }

      case 'vital_extraction': { // Doctor LMB Augment 3: Vital Extraction (3 + extraProjectiles tethers)
        const tetherCount = 3 + this.extraProjectiles;
        this.vfx.spawnToxicChainArc(charPos, 20, targetPos, 18);
        for (let tIdx = 1; tIdx < Math.min(7, tetherCount); tIdx++) {
          const offY = (tIdx % 2 === 0 ? 1 : -1) * Math.ceil(tIdx / 2) * 15;
          this.vfx.spawnToxicChainArc(charPos, 20, { x: targetPos.x - 8, y: offY }, 16);
        }
        this.vfx.spawnHealMoteBurst(charPos, 10, 6);
        this.vfx.spawnDamageNumber(targetPos, 18 * tetherCount, '#10b981', 22);
        this.vfx.spawnDamageNumber({ x: charPos.x, y: charPos.y + 8 }, 8 * tetherCount, '#6ee7b7', 26);
        this.wobbleDummy(0.5, 0.72);
        break;
      }

      case 'toxic_contamination': // Doctor Base RMB: Toxic Grenade
        this.vfx.spawnToxicExplosion(targetPos, 2, 72);
        this.vfx.spawnDamageNumber(targetPos, 28, '#84cc16', 22);
        this.wobbleDummy(0.5, 0.78);
        this.showStatusBadge('BIO-TOXIN SLOW & DOT', 0x84cc16);
        break;

      case 'experimental_drones': { // Doctor RMB Augment 1: Mechanical Combat Drones (1..7 capped)
        const droneCount = Math.min(7, 1 + this.extraProjectiles);
        const pGroup = new THREE.Group();
        const hullMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3, metalness: 0.6 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.7 });
        const coreMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
        for (let d = 0; d < droneCount; d++) {
          const ang = (d / droneCount) * Math.PI * 2;
          const dPos = { x: charPos.x + Math.cos(ang) * 26, y: charPos.y + Math.sin(ang) * 26 };
          const dMeshGrp = new THREE.Group();
          dMeshGrp.position.set(dPos.x, 30, dPos.y);
          dMeshGrp.add(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 3.8, 3.0, 6), darkMat.clone()));
          const cap = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.4, 7.2), hullMat.clone());
          cap.position.y = 1.5;
          dMeshGrp.add(cap);
          const core = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 8), coreMat.clone());
          core.position.set(0, 1.2, 2.0);
          dMeshGrp.add(core);
          pGroup.add(dMeshGrp);

          this.vfx.spawnToxicChainArc(dPos, 30, targetPos, 18);
          this.vfx.spawnDroneImpactBurst(targetPos, 18);
        }
        hullMat.dispose();
        darkMat.dispose();
        coreMat.dispose();
        this.scene.add(pGroup);
        this.previewDoctorPropGroup = pGroup;
        this.vfx.spawnDamageNumber(targetPos, 24 * droneCount, '#34d399', 24);
        this.wobbleDummy(0.7, 0.65);
        break;
      }

      case 'toxic_cluster_bomb': { // Doctor RMB Augment 2: Toxic Cluster Bomb (1..5 capped)
        const mainCount = Math.min(5, 1 + this.extraProjectiles);
        this.vfx.spawnToxicExplosion(targetPos, 2, 78);
        for (let m = 0; m < mainCount; m++) {
          const ang = (m / Math.max(1, mainCount)) * Math.PI * 2 + 0.5;
          const subPos = { x: targetPos.x + Math.cos(ang) * 28, y: targetPos.y + Math.sin(ang) * 24 };
          this.vfx.spawnToxicExplosion(subPos, 2, 44);
        }
        this.vfx.spawnDamageNumber(targetPos, 64 * mainCount, '#a3e635', 26);
        this.wobbleDummy(1.1, 0.45);
        break;
      }

      case 'holographic_decoy': { // Doctor RMB Augment 3: Straight-Running 2-Hit Holographic Decoy
        const pGroup = new THREE.Group();
        const runTex = this.textures['doctor_run'] || this.textures['doctor_idle'] || this.charSprite.material.map!;
        const holoMat = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: runTex },
            uUvOffset: { value: new THREE.Vector2(0, 0.5) },
            uUvRepeat: { value: new THREE.Vector2(0.25, 0.5) },
            uTime: { value: 0 }
          },
          vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          `,
          fragmentShader: `
            uniform sampler2D uMap; uniform vec2 uUvOffset; uniform vec2 uUvRepeat; uniform float uTime;
            varying vec2 vUv;
            void main() {
              vec4 texel = texture2D(uMap, uUvOffset + vUv * uUvRepeat);
              if (texel.a < 0.12) discard;
              float scan = 0.72 + 0.28 * sin(vUv.y * 85.0 - uTime * 10.0);
              float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
              vec3 col = mix(vec3(0.06, 0.65, 0.48), vec3(0.65, 0.98, 0.85), lum);
              gl_FragColor = vec4(col * scan, texel.a * 0.84);
            }
          `,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        const holoMesh = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), holoMat);
        holoMesh.position.set(-34, 23, 0);
        pGroup.add(holoMesh);
        this.scene.add(pGroup);
        this.previewDoctorPropGroup = pGroup;
        this.previewHoloMat = holoMat;
        this.previewHoloMesh = holoMesh;
        this.vfx.spawnShockwaveRing({ x: -34, y: 0 }, 32, 0x34d399, 2, 0.7);
        this.showStatusBadge('2-HIT RUNNING DECOY', 0x2dd4bf);
        this.wobbleDummy(0.3, 0.85);
        break;
      }

      case 'medical_rush': { // Doctor Base Dash: Therapeutic Pass
        const docTex = this.textures['doctor_idle'] || this.charSprite.material.map!;
        this.vfx.spawnWhiteSilhouetteGhost(charPos, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.40, 0.72);
        this.vfx.spawnWhiteSilhouetteGhost({ x: -12, y: 0 }, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.40, 0.72);
        this.charSprite.position.x = 58;
        this.charShadow.position.x = 58;
        this.vfx.spawnHealMoteBurst(charPos, 8, 5);
        this.vfx.spawnShockwaveRing({ x: 58, y: 0 }, 52, 0x34d399, 0);
        this.vfx.spawnDamageNumber(targetPos, 45, '#34d399', 22);
        this.wobbleDummy(0.6, 0.72);
        break;
      }

      case 'phase_barrier': { // Doctor Dash Augment 2: Phase Barrier
        const docTex = this.textures['doctor_idle'] || this.charSprite.material.map!;
        this.vfx.spawnWhiteSilhouetteGhost(charPos, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.40, 0.72);
        this.charSprite.position.x = 45;
        this.charShadow.position.x = 45;
        this.vfx.spawnShockwaveRing({ x: 45, y: 0 }, 44, 0x6ee7b7, 14, 1.2);
        this.vfx.spawnShockwaveRing({ x: 45, y: 0 }, 58, 0x34d399, 4, 0.9);
        this.showStatusBadge('DAMAGE IMMUNE (+1.0s)', 0x6ee7b7);
        this.wobbleDummy(0.5, 0.78);
        break;
      }

      case 'adrenaline_rush': { // Doctor Dash Augment 3: Adrenaline Rush
        const docTex = this.textures['doctor_idle'] || this.charSprite.material.map!;
        this.vfx.spawnWhiteSilhouetteGhost(charPos, docTex, 0, { ox: 0, oy: 0, rx: 1, ry: 1 }, 0.40, 0.72);
        this.charSprite.position.x = 65;
        this.charShadow.position.x = 65;
        this.vfx.spawnShockwaveRing({ x: 65, y: 0 }, 48, 0x22c55e, 2, 0.8);
        this.vfx.spawnShockwaveRing({ x: 20, y: 0 }, 36, 0x34d399, 2, 0.5);
        this.showStatusBadge('+50% SPEED (1.5s)', 0x22c55e);
        this.wobbleDummy(0.5, 0.78);
        break;
      }

      case 'sanctuary_cross': // Doctor Base Ult: Sacred Medical Field (Borderless Cross)
      case 'mobile_sanctuary': { // Doctor Ult Augment 1: Mobile Sanctuary
        const pGroup = new THREE.Group();
        const crossGeo = new THREE.PlaneGeometry(155, 155);
        crossGeo.rotateX(-Math.PI / 2);
        const crossMat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          vertexShader: `varying vec2 vLocal; void main() { vLocal = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: `
            varying vec2 vLocal;
            float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
            void main() {
              float d = min(sdBox(vLocal, vec2(58.0, 14.0)), sdBox(vLocal, vec2(14.0, 58.0)));
              float body = 1.0 - smoothstep(-4.0, 18.0, d);
              float spine = smoothstep(-2.0, 12.0, -d);
              float alpha = body * 0.25 + spine * 0.24;
              if (alpha < 0.01) discard;
              gl_FragColor = vec4(mix(vec3(0.06, 0.72, 0.50), vec3(0.55, 0.98, 0.82), spine * 0.65), alpha);
            }
          `
        });
        const cm = new THREE.Mesh(crossGeo, crossMat);
        cm.position.set(this.currentAbilityKey === 'mobile_sanctuary' ? charPos.x + 12 : charPos.x, 1.2, 0);
        pGroup.add(cm);
        this.scene.add(pGroup);
        this.previewDoctorPropGroup = pGroup;

        this.vfx.spawnHeavenlyLightBeam(charPos, 0, 1.1, 0x34d399);
        this.vfx.spawnHealMoteBurst(charPos, 10, 6);
        this.vfx.spawnDamageNumber(targetPos, this.currentAbilityKey === 'mobile_sanctuary' ? 68 : 55, '#34d399', 24);
        this.wobbleDummy(0.65, 0.62);
        break;
      }

      case 'divine_intervention': { // Doctor Ult Augment 2: 4 Non-Humanoid Celestial Constructs
        this.vfx.spawnHeavenlyLightBeam(charPos, 0, 1.1, 0x6ee7b7);
        const quads = [
          { x: -75, y: -24 },
          { x: -28, y: -24 },
          { x: -75, y: 24 },
          { x: -28, y: 24 }
        ];
        const pGroup = new THREE.Group();
        const goldMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
        const emWire = new THREE.MeshBasicMaterial({ color: 0x34d399, wireframe: true, transparent: true, opacity: 0.85 });
        const wingMat = new THREE.MeshBasicMaterial({ color: 0x6ee7b7, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false });
        for (const q of quads) {
          const eg = new THREE.Group();
          eg.position.set(q.x, 26, q.y);
          const core = new THREE.Mesh(new THREE.OctahedronGeometry(5.0, 0), goldMat.clone());
          core.scale.set(0.8, 1.35, 0.8);
          eg.add(core);
          eg.add(new THREE.Mesh(new THREE.OctahedronGeometry(7.8, 0), emWire.clone()));
          const halo = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.7, 6, 20), goldMat.clone());
          halo.rotation.x = Math.PI / 2;
          halo.position.y = 12;
          eg.add(halo);
          const wingL = new THREE.Mesh(new THREE.BoxGeometry(11, 2.5, 1.0), wingMat.clone());
          wingL.position.set(-8, 2, 0);
          wingL.rotation.z = 0.35;
          const wingR = new THREE.Mesh(new THREE.BoxGeometry(11, 2.5, 1.0), wingMat.clone());
          wingR.position.set(8, 2, 0);
          wingR.rotation.z = -0.35;
          eg.add(wingL, wingR);
          pGroup.add(eg);

          this.vfx.spawnHeavenlyLightBeam(q, 0, 1.15, 0xfef08a);
          this.vfx.spawnToxicChainArc(q, 24, targetPos, 18);
        }
        goldMat.dispose();
        emWire.dispose();
        wingMat.dispose();
        this.scene.add(pGroup);
        this.previewDoctorPropGroup = pGroup;
        this.vfx.spawnDamageNumber(targetPos, 145, '#fef08a', 26);
        this.wobbleDummy(0.9, 0.45);
        break;
      }

      case 'rain_of_crosses': // Doctor Ult Augment 3: Rain of Crosses (5s storm, borderless crosses)
        this.vfx.spawnHeavenlyLightBeam(targetPos, 0, 1.0, 0x34d399);
        this.vfx.spawnHeavenlyLightBeam({ x: targetPos.x - 22, y: -18 }, 0, 0.9, 0x6ee7b7);
        this.vfx.spawnHeavenlyLightBeam({ x: targetPos.x + 20, y: 18 }, 0, 0.9, 0x6ee7b7);
        this.vfx.spawnDamageNumber(targetPos, 130, '#34d399', 26);
        this.wobbleDummy(1.1, 0.40);
        break;

      // --- PASSIVE BUFFS / ITEMS FALLBACK ---
      default:
        // Demonstrates passive tactical aura on hero
        this.vfx.spawnShockwaveRing(charPos, 50, 0x38bdf8, 0);
        break;
    }
  }

  private triggerMultiTick2(targetPos: { x: number; y: number }): void {
    if (this.currentAbilityKey === 'chill_beam') {
      this.vfx.spawnDamageNumber(targetPos, 14, '#38bdf8', 24);
      this.wobbleDummy(0.3, 0.70);
    } else if (this.currentAbilityKey === 'medical_pulse') {
      // Second alternating right-pistol volley
      this.vfx.spawnLaserBeam({ x: -52, y: 4 }, targetPos, 0);
      this.vfx.spawnShockwaveRing(targetPos, 18, 0x2dd4bf, 18, 0.25);
      this.vfx.spawnDamageNumber(targetPos, 24, '#2dd4bf', 22);
      this.wobbleDummy(0.5, 0.70);
    } else if (this.currentAbilityKey === 'toxic_chain') {
      this.vfx.spawnDamageNumber(targetPos, 24, '#84cc16', 22);
      this.showStatusBadge('POISON STACKS (2/3)', 0x84cc16);
    } else if (this.currentAbilityKey === 'cryogenic_scalpel') {
      // Boomerang return slash hit
      this.vfx.spawnShockwaveRing({ x: 0, y: 0 }, 30, 0x38bdf8, 6, 0.4);
      this.vfx.spawnDamageNumber(targetPos, 32, '#7dd3fc', 24);
      this.wobbleDummy(0.5, 0.55);
    } else if (this.currentAbilityKey === 'toxic_contamination' || this.currentAbilityKey === 'toxic_cluster_bomb') {
      this.vfx.spawnDamageNumber(targetPos, 14, '#84cc16', 22);
      this.wobbleDummy(0.25, 0.70);
    } else if (this.currentAbilityKey === 'holographic_decoy') {
      this.vfx.spawnToxicExplosion({ x: 24, y: 0 }, 2, 72);
      this.vfx.spawnDamageNumber(targetPos, 85, '#34d399', 26);
      this.wobbleDummy(0.9, 0.48);
    }
  }

  private triggerMultiTick3(targetPos: { x: number; y: number }): void {
    if (this.currentAbilityKey === 'chill_beam') {
      this.vfx.spawnDamageNumber(targetPos, 14, '#38bdf8', 26);
      this.wobbleDummy(0.3, 0.60);
    } else if (this.currentAbilityKey === 'toxic_chain') {
      this.vfx.spawnToxicExplosion(targetPos, 4, 68);
      this.vfx.spawnDamageNumber(targetPos, 78, '#bef264', 28);
      this.wobbleDummy(1.1, 0.42);
      this.showStatusBadge('3-STACK TOXIC BURST!', 0xbef264);
    } else if (this.currentAbilityKey === 'toxic_contamination' || this.currentAbilityKey === 'toxic_cluster_bomb') {
      this.vfx.spawnDamageNumber(targetPos, 14, '#a3e635', 22);
      this.wobbleDummy(0.25, 0.62);
    } else if (this.currentAbilityKey === 'rain_of_crosses') {
      this.vfx.spawnHeavenlyLightBeam(targetPos, 0, 0.85, 0x34d399);
      this.vfx.spawnDamageNumber(targetPos, 75, '#6ee7b7', 24);
      this.wobbleDummy(0.8, 0.25);
    }
  }

  private wobbleDummy(shakeAmount: number, remainingHpRatio: number): void {
    this.dummySprite.position.x = 52 + (Math.random() - 0.5) * 8 * shakeAmount;
    setTimeout(() => {
      this.dummySprite.position.x = 52;
    }, 120);

    // Update HP bar fill
    this.dummyHpBarFill.scale.x = Math.max(0.05, remainingHpRatio);
    if (remainingHpRatio < 0.3) {
      (this.dummyHpBarFill.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
    } else if (remainingHpRatio < 0.6) {
      (this.dummyHpBarFill.material as THREE.MeshBasicMaterial).color.setHex(0xf59e0b);
    }
  }

  private showStatusBadge(text: string, colorHex: number): void {
    if (this.statusBadgeMesh) {
      this.dummyGroup.remove(this.statusBadgeMesh);
      this.disposeObject3D(this.statusBadgeMesh);
      this.statusBadgeMesh = null;
    }
    if (this.previewDoctorPropGroup) {
      this.scene.remove(this.previewDoctorPropGroup);
      this.disposeObject3D(this.previewDoctorPropGroup);
      this.previewDoctorPropGroup = null;
      this.previewHoloMat = null;
      this.previewHoloMesh = null;
    }

    // Glowing status halo over dummy
    const haloGeo = new THREE.RingGeometry(14, 18, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    this.statusBadgeMesh = new THREE.Mesh(haloGeo, haloMat);
    this.statusBadgeMesh.position.set(52, 34, 0);
    this.dummyGroup.add(this.statusBadgeMesh);
  }

  public destroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.currentAbilityKey = '';
    this.rebuildStage();
    if (this.activeTwinSlashGroup) {
      this.scene.remove(this.activeTwinSlashGroup);
      this.disposeObject3D(this.activeTwinSlashGroup);
      this.activeTwinSlashGroup = null;
    }
    if (this.activeLobbedBomb) {
      this.scene.remove(this.activeLobbedBomb);
      this.disposeObject3D(this.activeLobbedBomb);
      this.activeLobbedBomb = null;
    }
    if (this.statusBadgeMesh) {
      this.dummyGroup.remove(this.statusBadgeMesh);
      this.disposeObject3D(this.statusBadgeMesh);
      this.statusBadgeMesh = null;
    }
    if (this.previewDoctorPropGroup) {
      this.scene.remove(this.previewDoctorPropGroup);
      this.disposeObject3D(this.previewDoctorPropGroup);
      this.previewDoctorPropGroup = null;
      this.previewHoloMat = null;
      this.previewHoloMesh = null;
    }
    this.renderer.dispose();
  }
}
