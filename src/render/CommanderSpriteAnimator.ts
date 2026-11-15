import * as THREE from 'three';
import { PlayerState, Direction4 } from '../sim/types';

export type AnimationState =
  | 'idle'
  | 'run'
  | 'jump_ascend'
  | 'jump_descend'
  | 'glide'
  | 'attack'
  | 'rmb'
  | 'ultimate'
  | 'dash'
  | 'hit'
  | 'death';
export type DirectionalFacing = Direction4;

export interface DoctorSpriteSheetSet {
  run: Record<DirectionalFacing, THREE.Texture>;
  jump: Record<DirectionalFacing, THREE.Texture>;
  glide: Record<DirectionalFacing, THREE.Texture>;
  attack: Record<DirectionalFacing, THREE.Texture>;
  rmb: Record<DirectionalFacing, THREE.Texture>;
  dash: Record<DirectionalFacing, THREE.Texture>;
  ult: Record<DirectionalFacing, THREE.Texture>;
}

export interface SpriteFrame {
  texture: THREE.Texture;
  uvOffset?: { x: number; y: number };
  uvRepeat?: { x: number; y: number };
}

export interface AnimationClipDef {
  state: AnimationState;
  direction: DirectionalFacing;
  fps: number;
  loop: boolean;
  frames: SpriteFrame[];
  isMultiFrame: boolean;
  sourceDescription: string;
}

export interface AnimationClipStatus {
  isMultiFrame: boolean;
  frameCount: number;
  fps: number;
  loop: boolean;
  source: string;
}

export interface AnimationSystemReport {
  totalClips: number;
  multiFrameCount: number;
  fallbackCount: number;
  states: Record<AnimationState, Record<DirectionalFacing, AnimationClipStatus>>;
}

/**
 * CommanderSpriteAnimator
 *
 * Modular 2.5D character animation controller for Commander.
 * - Supports camera-facing directional sprite rendering (front, back, left, right).
 * - Manages state transitions across Idle, Run, Attack, Dash, Hit, and Death.
 * - Supports multi-frame sprite sheets (with UV coordinates) or frame arrays.
 * - Does NOT fake walking with unnatural bobbing/sliding; provides an extensible
 *   frame-by-frame architecture with static directional artwork fallbacks when
 *   animation frames are pending.
 * - Maintains foot anchoring, correct scale, and clean alpha blending.
 */
export class CommanderSpriteAnimator {
  public sprite: THREE.Sprite;
  public material: THREE.SpriteMaterial;

  private clips: Map<string, AnimationClipDef> = new Map();
  private fallbackTextures: Record<DirectionalFacing, THREE.Texture>;
  private commanderRunSheets?: Record<DirectionalFacing, THREE.Texture>;
  private commanderJumpSheets?: Record<DirectionalFacing, THREE.Texture>;
  private commanderGlideSheets?: Record<DirectionalFacing, THREE.Texture>;
  private commanderAttackSheets?: Record<DirectionalFacing, THREE.Texture>;
  private commanderUltSheets?: Record<DirectionalFacing, THREE.Texture>;
  private doctorSheets?: DoctorSpriteSheetSet;
  private activeHeroId: string = 'commander';

  public currentState: AnimationState = 'idle';
  public currentDirection: DirectionalFacing = 'back';
  public lastMoveDirection: DirectionalFacing = 'back';
  public currentFrameIndex: number = 0;

  private frameTimer: number = 0;
  private hitTimer: number = 0;
  private attackTimer: number = 0;
  private rmbTimer: number = 0;
  private ultTimer: number = 0;
  private dashTimer: number = 0;
  private attackFacing: DirectionalFacing | null = null;
  private rmbFacing: DirectionalFacing | null = null;
  private ultFacing: DirectionalFacing | null = null;
  private dashFacing: DirectionalFacing | null = null;
  private isDead: boolean = false;
  private hasGlidedInAir: boolean = false;

  public readonly baseWidth: number = 52;
  public readonly baseHeight: number = 52;

  constructor(
    sprite: THREE.Sprite,
    fallbackTextures: Record<DirectionalFacing, THREE.Texture>,
    commanderRunSheets?: Record<DirectionalFacing, THREE.Texture>,
    commanderJumpSheets?: Record<DirectionalFacing, THREE.Texture>,
    commanderGlideSheets?: Record<DirectionalFacing, THREE.Texture>,
    commanderAttackSheets?: Record<DirectionalFacing, THREE.Texture>,
    commanderUltSheets?: Record<DirectionalFacing, THREE.Texture>
  ) {
    this.sprite = sprite;
    this.fallbackTextures = fallbackTextures;
    this.commanderRunSheets = commanderRunSheets;
    this.commanderJumpSheets = commanderJumpSheets;
    this.commanderGlideSheets = commanderGlideSheets;
    this.commanderAttackSheets = commanderAttackSheets;
    this.commanderUltSheets = commanderUltSheets;
    this.material = sprite.material;

    // Ensure correct foot anchoring: center at height/2 so bottom edge touches ground Y=0
    this.sprite.scale.set(this.baseWidth, this.baseHeight, 1);
    this.sprite.position.set(0, this.baseHeight / 2, 0);

    // Initialize all animation slots (10 states x 4 directions)
    this.initDefaultClips();
  }

  /**
   * Registers Commander's 4-directional 8-frame running sprite sheets.
   */
  public setCommanderRunSheets(sheets: Record<DirectionalFacing, THREE.Texture>): void {
    this.commanderRunSheets = sheets;
    this.initDefaultClips();
  }

  /**
   * Registers Commander's 4-directional 4-frame jumping sprite sheets.
   */
  public setCommanderJumpSheets(sheets: Record<DirectionalFacing, THREE.Texture>): void {
    this.commanderJumpSheets = sheets;
    this.initDefaultClips();
  }

  /**
   * Registers Commander's 4-directional 8-frame jet-boot gliding sprite sheets.
   */
  public setCommanderGlideSheets(sheets: Record<DirectionalFacing, THREE.Texture>): void {
    this.commanderGlideSheets = sheets;
    this.initDefaultClips();
  }

  /**
   * Registers Commander's 4-directional 4-frame pistol basic attack sprite sheets.
   */
  public setCommanderAttackSheets(sheets: Record<DirectionalFacing, THREE.Texture>): void {
    this.commanderAttackSheets = sheets;
    this.initDefaultClips();
  }

  /**
   * Registers Commander's 4-directional 6-frame Orbital Strike ultimate sprite sheets.
   */
  public setCommanderUltSheets(sheets: Record<DirectionalFacing, THREE.Texture>): void {
    this.commanderUltSheets = sheets;
    this.initDefaultClips();
  }

  /**
   * Registers Doctor's normalized 4-directional multi-frame sprite sheets across all states.
   */
  public setDoctorSheets(sheets: DoctorSpriteSheetSet): void {
    this.doctorSheets = sheets;
    if (this.activeHeroId === 'doctor') {
      this.initDefaultClips();
    }
  }

  /**
   * Initializes the directional animation slots using the verified
   * illustrated reference artwork as clean fallbacks, and attaches
   * Commander's directional running, jumping, gliding, attack, and ultimate sprite sheets when active.
   */
  private initDefaultClips(): void {
    const states: { state: AnimationState; fps: number; loop: boolean }[] = [
      { state: 'idle', fps: 6, loop: true },
      { state: 'run', fps: 9, loop: true },
      { state: 'jump_ascend', fps: 10, loop: false },
      { state: 'jump_descend', fps: 8, loop: false },
      { state: 'glide', fps: 9, loop: true },
      { state: 'attack', fps: 16, loop: false },
      { state: 'rmb', fps: 16, loop: false },
      { state: 'ultimate', fps: 10, loop: false },
      { state: 'dash', fps: 18, loop: false },
      { state: 'hit', fps: 12, loop: false },
      { state: 'death', fps: 8, loop: false }
    ];

    const directions: DirectionalFacing[] = ['front', 'back', 'left', 'right'];

    for (const s of states) {
      for (const dir of directions) {
        const tex = this.fallbackTextures[dir];
        const clip: AnimationClipDef = {
          state: s.state,
          direction: dir,
          fps: s.fps,
          loop: s.loop,
          frames: [
            {
              texture: tex,
              uvOffset: { x: 0, y: 0 },
              uvRepeat: { x: 1, y: 1 }
            }
          ],
          isMultiFrame: false,
          sourceDescription: `Static Directional Reference: ${this.activeHeroId}_${dir}.png`
        };
        this.clips.set(this.getClipKey(s.state, dir), clip);
      }
    }

    if (this.activeHeroId === 'commander') {
      // 1. Register Commander's 8-frame directional running sprite sheets (9 FPS)
      if (this.commanderRunSheets) {
        for (const dir of directions) {
          const sheetTex = this.commanderRunSheets[dir];
          if (sheetTex) {
            this.registerSpriteSheet(
              'run',
              dir,
              sheetTex,
              8,
              1,
              8,
              9,
              true,
              `Commander 8-Frame Running Sheet: commander_run_${dir}.png`
            );
          }
        }
      }

      // 2. Register Commander's 4-frame directional jump sprite sheets split into Ascent (0..1) and Descent (2..3)
      if (this.commanderJumpSheets) {
        for (const dir of directions) {
          const sheetTex = this.commanderJumpSheets[dir];
          if (sheetTex) {
            this.registerSpriteSheetSubRange(
              'jump_ascend',
              dir,
              sheetTex,
              4,
              1,
              0,
              2,
              10,
              false,
              `Commander Jump Ascent (Frames 0-1): commander_jump_${dir}.png`
            );
            this.registerSpriteSheetSubRange(
              'jump_descend',
              dir,
              sheetTex,
              4,
              1,
              2,
              2,
              8,
              false,
              `Commander Jump Descent (Frames 2-3): commander_jump_${dir}.png`
            );
          }
        }
      }

      // 3. Register Commander's 8-frame directional jet-boot glide sprite sheets (9 FPS)
      if (this.commanderGlideSheets) {
        for (const dir of directions) {
          const sheetTex = this.commanderGlideSheets[dir];
          if (sheetTex) {
            this.registerSpriteSheet(
              'glide',
              dir,
              sheetTex,
              8,
              1,
              8,
              9,
              true,
              `Commander 8-Frame Jet-Boot Glide Sheet: commander_glide_${dir}.png`
            );
          }
        }
      }

      // 4. Register Commander's 4-frame directional pistol basic attack sprite sheets
      if (this.commanderAttackSheets) {
        for (const dir of directions) {
          const sheetTex = this.commanderAttackSheets[dir];
          if (sheetTex) {
            this.registerSpriteSheet(
              'attack',
              dir,
              sheetTex,
              4,
              1,
              4,
              16,
              false,
              `Commander 4-Frame Pistol Attack Sheet: commander_attack_${dir}.png`
            );
          }
        }
      }

      // 5. Register Commander's 6-frame directional Orbital Strike ultimate sprite sheets
      if (this.commanderUltSheets) {
        for (const dir of directions) {
          const sheetTex = this.commanderUltSheets[dir];
          if (sheetTex) {
            this.registerSpriteSheet(
              'ultimate',
              dir,
              sheetTex,
              6,
              1,
              6,
              10,
              false,
              `Commander 6-Frame Orbital Strike Sheet: commander_ult_${dir}.png`
            );
          }
        }
      }
    } else if (this.activeHeroId === 'doctor' && this.doctorSheets) {
      const ds = this.doctorSheets;
      for (const dir of directions) {
        if (ds.run[dir]) {
          this.registerSpriteSheet('run', dir, ds.run[dir], 4, 2, 8, 12, true, `Doctor Run (${dir})`);
        }
        if (ds.jump[dir]) {
          this.registerSpriteSheetSubRange('jump_ascend', dir, ds.jump[dir], 4, 1, 0, 2, 10, false, `Doctor Jump Ascend (${dir})`);
          this.registerSpriteSheetSubRange('jump_descend', dir, ds.jump[dir], 4, 1, 2, 2, 9, false, `Doctor Jump Descend (${dir})`);
        }
        if (ds.glide[dir]) {
          // Loop strictly the airborne jet-hovering frames (2..5), excluding standing & crouch-land frames
          this.registerSpriteSheetSubRange('glide', dir, ds.glide[dir], 4, 2, 2, 4, 10, true, `Doctor Jetpack Glide (${dir})`);
        }
        if (ds.attack[dir]) {
          this.registerSpriteSheetSubRange('attack', dir, ds.attack[dir], 4, 2, 0, 4, 16, false, `Doctor Dual Pistols (${dir})`);
        }
        if (ds.rmb[dir]) {
          this.registerSpriteSheet('rmb', dir, ds.rmb[dir], 6, 1, 6, 16, false, `Doctor RMB Throw (${dir})`);
        }
        if (ds.dash[dir]) {
          this.registerSpriteSheet('dash', dir, ds.dash[dir], 4, 2, 8, 30, false, `Doctor Dash (${dir})`);
        }
        if (ds.ult[dir]) {
          this.registerSpriteSheet('ultimate', dir, ds.ult[dir], 4, 2, 8, 10, false, `Doctor 8-Frame Ult (${dir})`);
        }
      }
    }
  }

  private getClipKey(state: AnimationState, dir: DirectionalFacing): string {
    return `${state}_${dir}`;
  }

  /**
   * Registers a sub-range of frames from a multi-column sprite sheet (e.g., Ascent vs Descent frames of a Jump sheet).
   */
  public registerSpriteSheetSubRange(
    state: AnimationState,
    direction: DirectionalFacing,
    sheetTexture: THREE.Texture,
    cols: number,
    rows: number,
    startFrame: number,
    frameCount: number,
    fps: number = 10,
    loop: boolean = false,
    sourceDesc: string = 'Registered Sprite Sheet Sub-Range'
  ): void {
    const frames: SpriteFrame[] = [];
    const stepX = 1 / cols;
    const stepY = 1 / rows;

    for (let i = 0; i < frameCount; i++) {
      const frameIdx = startFrame + i;
      const col = frameIdx % cols;
      const row = Math.floor(frameIdx / cols);
      const offsetX = col * stepX;
      const offsetY = (rows - 1 - row) * stepY;

      frames.push({
        texture: sheetTexture,
        uvOffset: { x: offsetX, y: offsetY },
        uvRepeat: { x: stepX, y: stepY }
      });
    }

    const clip: AnimationClipDef = {
      state,
      direction,
      fps,
      loop,
      frames,
      isMultiFrame: frameCount > 1,
      sourceDescription: sourceDesc
    };

    this.clips.set(this.getClipKey(state, direction), clip);
  }

  /**
   * Extensible Registration: Register a multi-frame sprite sheet clip.
   *
   * @param state Animation state (idle, run, attack, dash, hit, death)
   * @param direction Facing direction (front, back, left, right)
   * @param sheetTexture Full spritesheet texture
   * @param cols Number of horizontal columns in sheet
   * @param rows Number of vertical rows in sheet
   * @param frameCount Number of active frames in this sequence
   * @param fps Playback speed in frames per second
   * @param loop Whether the animation repeats
   * @param sourceDesc Human-readable label for status reporting
   */
  public registerSpriteSheet(
    state: AnimationState,
    direction: DirectionalFacing,
    sheetTexture: THREE.Texture,
    cols: number,
    rows: number,
    frameCount: number,
    fps: number = 12,
    loop: boolean = true,
    sourceDesc: string = 'Registered Sprite Sheet'
  ): void {
    const frames: SpriteFrame[] = [];
    const stepX = 1 / cols;
    const stepY = 1 / rows;

    for (let i = 0; i < frameCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // In Three.js, UV origin (0,0) is bottom-left
      const offsetX = col * stepX;
      const offsetY = (rows - 1 - row) * stepY;

      frames.push({
        texture: sheetTexture,
        uvOffset: { x: offsetX, y: offsetY },
        uvRepeat: { x: stepX, y: stepY }
      });
    }

    const clip: AnimationClipDef = {
      state,
      direction,
      fps,
      loop,
      frames,
      isMultiFrame: frameCount > 1,
      sourceDescription: sourceDesc
    };

    this.clips.set(this.getClipKey(state, direction), clip);
  }

  /**
   * Extensible Registration: Register an array of individual frame textures.
   */
  public registerFrameSequence(
    state: AnimationState,
    direction: DirectionalFacing,
    textures: THREE.Texture[],
    fps: number = 12,
    loop: boolean = true,
    sourceDesc: string = 'Registered Frame Sequence'
  ): void {
    const frames: SpriteFrame[] = textures.map((tex) => ({
      texture: tex,
      uvOffset: { x: 0, y: 0 },
      uvRepeat: { x: 1, y: 1 }
    }));

    const clip: AnimationClipDef = {
      state,
      direction,
      fps,
      loop,
      frames,
      isMultiFrame: textures.length > 1,
      sourceDescription: sourceDesc
    };

    this.clips.set(this.getClipKey(state, direction), clip);
  }

  /**
   * Trigger primary attack animation.
   * For Doctor's Dual Pistols, seamlessly switches the 4-frame firing sub-range between Left (0..3) and Right (4..7) pistols!
   */
  public triggerAttack(
    duration: number = 0.24,
    facing?: DirectionalFacing,
    fps?: number,
    hand?: 'left' | 'right'
  ): void {
    if (this.isDead) return;
    this.attackTimer = duration;
    if (facing) {
      this.attackFacing = facing;
    }

    const dirs: DirectionalFacing[] = ['front', 'back', 'left', 'right'];
    if (this.activeHeroId === 'doctor' && this.doctorSheets?.attack) {
      const startFrame = hand === 'right' ? 4 : 0;
      const docFps = fps ?? 4 / Math.max(0.08, duration);
      for (const d of dirs) {
        const tex = this.doctorSheets.attack[d];
        if (tex) {
          this.registerSpriteSheetSubRange(
            'attack',
            d,
            tex,
            4,
            2,
            startFrame,
            4,
            docFps,
            false,
            `Doctor ${hand === 'right' ? 'Right' : 'Left'} Pistol (${d})`
          );
        }
      }
    } else {
      const dynamicFps = fps ?? 4 / Math.max(0.06, duration);
      for (const d of dirs) {
        const clip = this.clips.get(this.getClipKey('attack', d));
        if (clip && clip.isMultiFrame) {
          clip.fps = dynamicFps;
        }
      }
    }

    // Do not interrupt higher-priority states (ultimate, glide, jump, dash, rmb)
    if (
      this.currentState !== 'ultimate' &&
      this.currentState !== 'glide' &&
      this.currentState !== 'jump_ascend' &&
      this.currentState !== 'jump_descend' &&
      this.currentState !== 'dash' &&
      this.currentState !== 'rmb'
    ) {
      const targetDir = facing || this.attackFacing || this.currentDirection;
      const attackClip = this.clips.get(this.getClipKey('attack', targetDir));
      if (attackClip?.isMultiFrame) {
        this.currentState = 'attack';
        this.currentDirection = targetDir;
        this.currentFrameIndex = 0;
        this.frameTimer = 0;
        this.applyCurrentFrameToMaterial();
      }
    }
  }

  /**
   * Trigger secondary throw / deploy cast animation (Doctor 6-frame RMB grenade throw).
   */
  public triggerSecondary(
    duration: number = 0.36,
    facing?: DirectionalFacing
  ): void {
    if (this.isDead) return;
    if (facing) {
      this.rmbFacing = facing;
    }
    const checkDir = this.rmbFacing || this.currentDirection;
    const rmbClip = this.clips.get(this.getClipKey('rmb', checkDir));
    if (!rmbClip || !rmbClip.isMultiFrame) {
      this.triggerAttack(duration, facing);
      return;
    }

    this.rmbTimer = duration;
    const dynamicFps = rmbClip.frames.length / Math.max(0.12, duration);
    const dirs: DirectionalFacing[] = ['front', 'back', 'left', 'right'];
    for (const d of dirs) {
      const c = this.clips.get(this.getClipKey('rmb', d));
      if (c && c.isMultiFrame) c.fps = dynamicFps;
    }

    if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
      this.currentState = 'rmb';
      this.currentDirection = checkDir;
      this.currentFrameIndex = 0;
      this.frameTimer = 0;
      this.applyCurrentFrameToMaterial();
    }
  }

  /**
   * Trigger Commander's 6-frame Orbital Strike (R) casting animation.
   */
  public triggerUltimate(
    duration: number = 0.60,
    facing?: DirectionalFacing,
    fps: number = 10
  ): void {
    if (this.isDead) return;
    this.ultTimer = duration;
    const resolvedDir = facing || this.currentDirection;
    this.ultFacing = resolvedDir;

    const dirs: DirectionalFacing[] = ['front', 'back', 'left', 'right'];
    for (const d of dirs) {
      const clip = this.clips.get(this.getClipKey('ultimate', d));
      if (clip && clip.isMultiFrame) {
        clip.fps = fps;
      }
    }

    const ultClip = this.clips.get(this.getClipKey('ultimate', resolvedDir));
    if (ultClip?.isMultiFrame) {
      this.currentState = 'ultimate';
      this.currentDirection = resolvedDir;
      this.currentFrameIndex = 0;
      this.frameTimer = 0;
      this.applyCurrentFrameToMaterial();
    }
  }

  private syncSpriteScale(): void {
    if (this.activeHeroId === 'doctor' && this.currentState === 'ultimate') {
      const ultH = this.baseHeight * 1.25; // 65.0 matching 320/256 cell ratio
      const footOffsetWorld = (29 / 320) * ultH - (4 / 256) * this.baseHeight;
      this.sprite.scale.set(this.baseWidth, ultH, 1);
      this.sprite.position.set(0, ultH * 0.5 - footOffsetWorld, 0);
    } else if (this.sprite.scale.y !== this.baseHeight || this.sprite.position.y !== this.baseHeight * 0.5) {
      this.sprite.scale.set(this.baseWidth, this.baseHeight, 1);
      this.sprite.position.set(0, this.baseHeight * 0.5, 0);
    }
  }

  private applyCurrentFrameToMaterial(): void {
    this.syncSpriteScale();
    const clipKey = this.getClipKey(this.currentState, this.currentDirection);
    const clip = this.clips.get(clipKey) || this.clips.get(`idle_${this.currentDirection}`);
    const activeFrame =
      clip && clip.frames[this.currentFrameIndex]
        ? clip.frames[this.currentFrameIndex]
        : {
            texture: this.fallbackTextures[this.currentDirection],
            uvOffset: { x: 0, y: 0 },
            uvRepeat: { x: 1, y: 1 }
          };

    if (this.material.map !== activeFrame.texture) {
      this.material.map = activeFrame.texture;
      this.material.needsUpdate = true;
    }
    if (this.material.map && activeFrame.uvOffset && activeFrame.uvRepeat) {
      this.material.map.offset.set(activeFrame.uvOffset.x, activeFrame.uvOffset.y);
      this.material.map.repeat.set(activeFrame.uvRepeat.x, activeFrame.uvRepeat.y);
    }
  }

  /**
   * Trigger combat dash animation synced cleanly to actual dash duration & direction.
   */
  public triggerDash(duration: number = 0.24, facing?: DirectionalFacing): void {
    if (this.isDead) return;
    this.dashTimer = duration;
    if (facing) {
      this.dashFacing = facing;
      this.currentDirection = facing;
    }
    const dashClip = this.clips.get(this.getClipKey('dash', this.currentDirection));
    if (dashClip && dashClip.isMultiFrame) {
      const dynamicFps = dashClip.frames.length / Math.max(0.10, duration);
      const dirs: DirectionalFacing[] = ['front', 'back', 'left', 'right'];
      for (const d of dirs) {
        const c = this.clips.get(this.getClipKey('dash', d));
        if (c && c.isMultiFrame) c.fps = dynamicFps;
      }
    }
    this.currentState = 'dash';
    this.currentFrameIndex = 0;
    this.frameTimer = 0;
    this.applyCurrentFrameToMaterial();
  }

  /**
   * Trigger physical damage hit reaction.
   */
  public triggerHit(duration: number = 0.16): void {
    if (this.isDead) return;
    this.hitTimer = duration;
    if (this.currentState !== 'hit' && this.currentState !== 'dash') {
      this.currentState = 'hit';
      this.currentFrameIndex = 0;
      this.frameTimer = 0;
    }
  }

  /**
   * Trigger character death collapse.
   */
  public triggerDeath(): void {
    this.isDead = true;
    this.currentState = 'death';
    this.currentFrameIndex = 0;
    this.frameTimer = 0;
  }

  /**
   * Switches the active hero texture set (e.g. Commander vs Doctor) and reinitializes clips.
   */
  public setHeroTextures(
    fallbackTextures: Record<DirectionalFacing, THREE.Texture>,
    heroId: string = 'commander'
  ): void {
    this.activeHeroId = heroId;
    this.fallbackTextures = fallbackTextures;
    this.initDefaultClips();
    this.reset();
    const clip = this.clips.get(this.getClipKey(this.currentState, this.currentDirection));
    if (clip && clip.frames[0]) {
      this.material.map = clip.frames[0].texture;
      this.material.needsUpdate = true;
    }
  }

  /**
   * Reset animator upon game respawn or run restart.
   */
  public reset(): void {
    this.isDead = false;
    this.hasGlidedInAir = false;
    this.hitTimer = 0;
    this.attackTimer = 0;
    this.rmbTimer = 0;
    this.ultTimer = 0;
    this.dashTimer = 0;
    this.attackFacing = null;
    this.rmbFacing = null;
    this.ultFacing = null;
    this.dashFacing = null;
    this.currentState = 'idle';
    this.currentFrameIndex = 0;
    this.frameTimer = 0;
    this.sprite.scale.set(this.baseWidth, this.baseHeight, 1);
    this.sprite.position.set(0, this.baseHeight / 2, 0);
    this.material.color.setRGB(1, 1, 1);
    this.material.opacity = 1.0;
  }

  /**
   * Main animation controller update loop.
   */
  public update(
    dt: number,
    p: PlayerState,
    inputSnapshot: { moveDir: { x: number; y: number } }
  ): void {
    // 1. Decrement action timers
    if (this.hitTimer > 0) this.hitTimer -= dt;
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) this.attackFacing = null;
    }
    if (this.rmbTimer > 0) {
      this.rmbTimer -= dt;
      if (this.rmbTimer <= 0) this.rmbFacing = null;
    }
    if (this.ultTimer > 0) {
      this.ultTimer -= dt;
      if (this.ultTimer <= 0) this.ultFacing = null;
    }
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) this.dashFacing = null;
    }

    // 2. Resolve camera-relative movement direction
    const isMoving = inputSnapshot.moveDir.x !== 0 || inputSnapshot.moveDir.y !== 0;
    let moveDirFacing: DirectionalFacing = p.facing || this.lastMoveDirection || 'back';
    if (isMoving) {
      const sx = inputSnapshot.moveDir.x;
      const sy = inputSnapshot.moveDir.y;
      if (Math.abs(sx) > Math.abs(sy)) {
        moveDirFacing = sx > 0 ? 'right' : 'left';
      } else {
        moveDirFacing = sy > 0 ? 'front' : 'back';
      }
      this.lastMoveDirection = moveDirFacing;
    }

    // 3. Resolve target state by priority:
    //    1. Ultimate (R) casting
    //    2. Jet-boot gliding (if airborne and holding Space)
    //    3. Jumping / falling (jump_ascend / jump_descend)
    //    4. Basic attack (LMB)
    //    5. Running
    //    6. Idle
    if (p.isGrounded) {
      this.hasGlidedInAir = false;
    } else if (p.isGliding) {
      this.hasGlidedInAir = true;
    }

    const ultCheckDir = this.ultFacing || p.facing || this.currentDirection;
    const attackCheckDir = this.attackFacing || p.facing || this.currentDirection;
    const rmbCheckDir = this.rmbFacing || p.facing || this.currentDirection;
    const ultClip = this.clips.get(this.getClipKey('ultimate', ultCheckDir));
    const attackClip = this.clips.get(this.getClipKey('attack', attackCheckDir));
    const rmbClip = this.clips.get(this.getClipKey('rmb', rmbCheckDir));

    let targetState: AnimationState = 'idle';
    if (this.isDead || p.health <= 0) {
      targetState = 'death';
      this.isDead = true;
    } else if (this.ultTimer > 0 && ultClip?.isMultiFrame) {
      targetState = 'ultimate';
    } else if (this.dashTimer > 0 || p.isDashing) {
      targetState = 'dash';
    } else if (!p.isGrounded && p.isGliding) {
      targetState = 'glide';
    } else if (!p.isGrounded && p.vz >= 0 && !this.hasGlidedInAir) {
      targetState = 'jump_ascend';
    } else if (!p.isGrounded) {
      targetState = 'jump_descend';
    } else if (this.rmbTimer > 0 && rmbClip?.isMultiFrame) {
      targetState = 'rmb';
    } else if (this.attackTimer > 0 && attackClip?.isMultiFrame) {
      targetState = 'attack';
    } else if (isMoving) {
      targetState = 'run';
    } else if (this.hitTimer > 0) {
      targetState = 'hit';
    } else {
      targetState = 'idle';
    }

    // Resolve directional facing based on active state
    let targetDir: DirectionalFacing = p.facing || this.lastMoveDirection || 'back';
    if (targetState === 'ultimate') {
      targetDir = this.ultFacing || p.facing || this.currentDirection;
    } else if (targetState === 'dash') {
      targetDir = this.dashFacing || (isMoving ? moveDirFacing : p.facing) || this.currentDirection;
    } else if (targetState === 'rmb') {
      targetDir = this.rmbFacing || p.facing || this.currentDirection;
    } else if (targetState === 'attack') {
      // Basic attack always faces the attack target relative to the camera, even while moving
      targetDir = this.attackFacing || p.facing || this.currentDirection;
    } else if (isMoving) {
      targetDir = moveDirFacing;
    } else if (!p.isGrounded) {
      // Preserve last movement facing direction when airborne with no horizontal input
      targetDir = this.lastMoveDirection || p.facing || 'back';
    }

    // 4. Handle State or Directional transitions
    if (targetState !== this.currentState) {
      this.currentState = targetState;
      this.currentFrameIndex = 0;
      this.frameTimer = 0;
    }

    if (targetDir !== this.currentDirection) {
      this.currentDirection = targetDir;
      // Retain frame index phase when changing direction during continuous states (run, glide, jump_ascend, jump_descend, idle)
      if (
        this.currentState !== 'run' &&
        this.currentState !== 'glide' &&
        this.currentState !== 'jump_ascend' &&
        this.currentState !== 'jump_descend' &&
        this.currentState !== 'idle'
      ) {
        this.currentFrameIndex = 0;
        this.frameTimer = 0;
      }
    }

    // 5. Advance frame if clip has multiple frames
    const clipKey = this.getClipKey(this.currentState, this.currentDirection);
    const clip = this.clips.get(clipKey) || this.clips.get(`idle_${this.currentDirection}`);

    if (clip && clip.frames.length > 1) {
      this.frameTimer += dt;
      const frameDuration = 1 / Math.max(1, clip.fps);
      while (this.frameTimer >= frameDuration) {
        this.frameTimer -= frameDuration;
        this.currentFrameIndex++;
        if (this.currentFrameIndex >= clip.frames.length) {
          if (clip.loop) {
            this.currentFrameIndex = 0;
          } else {
            this.currentFrameIndex = clip.frames.length - 1;
            break;
          }
        }
      }
    } else {
      this.currentFrameIndex = 0;
    }

    // 6. Apply current frame texture & UV transforms to material
    const activeFrame = clip && clip.frames[this.currentFrameIndex]
      ? clip.frames[this.currentFrameIndex]
      : { texture: this.fallbackTextures[this.currentDirection], uvOffset: { x: 0, y: 0 }, uvRepeat: { x: 1, y: 1 } };

    if (this.material.map !== activeFrame.texture) {
      this.material.map = activeFrame.texture;
      this.material.needsUpdate = true;
    }

    if (activeFrame.uvOffset && activeFrame.uvRepeat) {
      if (
        this.material.map.offset.x !== activeFrame.uvOffset.x ||
        this.material.map.offset.y !== activeFrame.uvOffset.y ||
        this.material.map.repeat.x !== activeFrame.uvRepeat.x ||
        this.material.map.repeat.y !== activeFrame.uvRepeat.y
      ) {
        this.material.map.offset.set(activeFrame.uvOffset.x, activeFrame.uvOffset.y);
        this.material.map.repeat.set(activeFrame.uvRepeat.x, activeFrame.uvRepeat.y);
      }
    }

    // Keep uniform world character height & foot baseline
    this.syncSpriteScale();

    // 7. Visual Impact Polishing (Hit Flinch Flash & Death Fade)
    if (this.hitTimer > 0) {
      // Impact flash: brief reddish-white tint
      this.material.color.setRGB(1.0, 0.45, 0.45);
    } else {
      this.material.color.setRGB(1.0, 1.0, 1.0);
    }

    if (this.isDead) {
      // Natural fade-out on defeat
      this.material.opacity = Math.max(0.4, 1.0 - this.frameTimer * 0.4);
    } else {
      this.material.opacity = 1.0;
    }
  }

  /**
   * Generates a transparent, detailed breakdown of all directional
   * animation slots, indicating which clips have multi-frame artwork and
   * which are currently using the static illustrated fallbacks.
   */
  public getAssetStatusReport(): AnimationSystemReport {
    const states: AnimationState[] = [
      'idle',
      'run',
      'jump_ascend',
      'jump_descend',
      'glide',
      'attack',
      'rmb',
      'ultimate',
      'dash',
      'hit',
      'death'
    ];
    const directions: DirectionalFacing[] = ['front', 'back', 'left', 'right'];

    let multiFrameCount = 0;
    let fallbackCount = 0;

    const statusByState = {} as Record<AnimationState, Record<DirectionalFacing, AnimationClipStatus>>;

    for (const state of states) {
      statusByState[state] = {} as Record<DirectionalFacing, AnimationClipStatus>;
      for (const dir of directions) {
        const clip = this.clips.get(this.getClipKey(state, dir));
        if (clip && clip.isMultiFrame && clip.frames.length > 1) {
          multiFrameCount++;
          statusByState[state][dir] = {
            isMultiFrame: true,
            frameCount: clip.frames.length,
            fps: clip.fps,
            loop: clip.loop,
            source: clip.sourceDescription
          };
        } else {
          fallbackCount++;
          statusByState[state][dir] = {
            isMultiFrame: false,
            frameCount: 1,
            fps: clip ? clip.fps : 1,
            loop: clip ? clip.loop : false,
            source: clip ? clip.sourceDescription : `Static fallback (commander_${dir}.png)`
          };
        }
      }
    }

    return {
      totalClips: states.length * directions.length,
      multiFrameCount,
      fallbackCount,
      states: statusByState
    };
  }
}
