import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Simulation } from '../sim/Simulation';
import { InputManager } from '../input/InputManager';
import { SoundManager } from './SoundManager';
import { UIManager, GraphicsQuality } from '../ui/UIManager';
import { ThreeTerrain } from './ThreeTerrain';
import { loadTestMapFromFile, loadTestMapFromUrl, TestMapScaleMode, LoadedTestMap, RedCrystalMaterialEntry } from './TestMapLoader';
import { ThreeVFX } from './ThreeVFX';
import { Commander3DModel } from './Commander3DModel';
import { CommanderSpriteAnimator } from './CommanderSpriteAnimator';
import { Stage1Boss3DModel } from './Stage1Boss3DModel';
import { SimEvent, Vector2, HeroId, EnemyType } from '../sim/types';
import { STAGE1_BOSS_CONFIG } from '../sim/Stage1BossConfig';
import { ENEMY_VISUAL_CATALOG, EnemyVisualDef } from '../sim/EnemyVisualDefs';
import { DOCTOR_CONFIG } from '../sim/DoctorConfig';
import { buildStage1ProceduralFlora } from './ProceduralAlienFlora';
import { SeededRandom } from '../sim/ItemDefs';
import type { NarrativeObserver } from '../narrative/NarrativeObserver';
import type { DialogueDirector } from '../narrative/DialogueDirector';

export const DEFAULT_STAGE1_MAP_URL = '/assets/maps/Blenderrr.glb';
export const DEFAULT_STAGE1_MAP_NAME = 'Blenderrr.glb';

const BILLBOARD_25D_VERT = `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uPuppetMode;
  uniform float uPhase;
  uniform float uMoveFactor;
  varying vec2 vUv;
  varying float vReliefZ;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float t = uTime * (0.75 + 0.65 * uMoveFactor) + uPhase;
    float reliefZ = 0.0;

    if (uPuppetMode > 2.5) {
      // Mode 3: Void Wasp & Brood Overseer — High-frequency 3D translucent wing flutter + curling stinger abdomen
      float sideDist = abs(uv.x - 0.5) * 2.0;
      float wingZone = smoothstep(0.42, 0.85, uv.y) * smoothstep(0.16, 0.62, sideDist);
      float flap = sin(uTime * 28.0 + uPhase + sideDist * 2.2) * wingZone;
      pos.x += (uv.x - 0.5) * flap * 0.14;
      pos.y += flap * 0.07;
      reliefZ += flap * 0.18;

      // Sinuous curling segmented stinger tail in lower half
      float tailZone = smoothstep(0.50, 0.04, uv.y);
      float curl = sin(t * 5.2 - uv.y * 7.0) * tailZone;
      pos.x += curl * 0.045;
      pos.y += abs(curl) * 0.025;
      reliefZ += curl * 0.08;
    } else if (uPuppetMode > 1.5) {
      // Mode 2: Toxic Spitter — Throbbing/swelling bioluminescent acid sac + alternating arachnid leg scuttle
      vec2 sacCenter = vec2(0.68, 0.58);
      float sacDist = length((uv - sacCenter) * vec2(1.1, 1.25));
      float sacMask = smoothstep(0.42, 0.05, sacDist);
      float pulse = 0.5 + 0.5 * sin(uTime * 4.8 + uPhase);
      pos.xy += (uv - sacCenter) * sacMask * (0.06 + 0.09 * pulse);
      reliefZ += sacMask * (0.10 + 0.12 * pulse);

      // Alternating arachnid leg scuttle in lower 42%
      float legZone = smoothstep(0.45, 0.02, uv.y);
      float sideSign = uv.x < 0.5 ? -1.0 : 1.0;
      float legWave = sin(t * 10.5 + uv.x * 16.0 + sideSign * 1.57) * legZone * (0.35 + 0.65 * uMoveFactor);
      pos.y += max(0.0, legWave) * 0.055;
      pos.x += legWave * 0.024;
    } else if (uPuppetMode > 0.5) {
      // Mode 1: Void Crawler & Void Goliath — Heavy alternating claw/leg stride + breathing horned carapace heave
      float legZone = smoothstep(0.46, 0.02, uv.y);
      float sideSign = uv.x < 0.5 ? -1.0 : 1.0;
      float stride = sin(t * 9.5 + uv.x * 12.0 + sideSign * 1.57) * legZone * (0.35 + 0.65 * uMoveFactor);
      pos.y += max(0.0, stride) * 0.052;
      pos.x += stride * 0.028 * sideSign;

      // Upper carapace & scythe-arm heave
      float torsoZone = smoothstep(0.25, 0.85, uv.y);
      float breath = sin(uTime * 3.6 + uPhase) * torsoZone;
      pos.y += breath * 0.022;
      reliefZ += (1.0 - pow(abs(uv.x - 0.5) * 1.8, 2.0)) * 0.12 + breath * 0.05;
    }

    pos.z += reliefZ;
    vReliefZ = reliefZ;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const BILLBOARD_25D_FRAG = `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform float uFrameOffset;
  uniform float uFrameWidth;
  uniform vec2 uTexelSize;
  uniform float uAlphaTest;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uHitFlash;
  uniform vec3 uStatusTint;
  uniform float uEmergeShade;
  uniform vec3 uRimColor;
  uniform float uRimStrength;
  uniform float uFootAOStrength;
  uniform float uBioPulseStrength;
  uniform float uBounceStrength;
  varying vec2 vUv;
  varying float vReliefZ;

  float sampleLuma(vec2 uv) {
    vec4 c = texture2D(uMap, uv);
    return dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a;
  }

  void main() {
    float halfX = 0.5 * uTexelSize.x;
    float halfY = 0.5 * uTexelSize.y;
    float safeWidth = max(uTexelSize.x, uFrameWidth - 2.0 * halfX);
    float uCoord = uFrameOffset + halfX + vUv.x * safeWidth;
    float vCoord = mix(halfY, 1.0 - halfY, vUv.y);
    vec2 sampleUv = vec2(uCoord, vCoord);

    vec4 texel = texture2D(uMap, sampleUv);
    if (texel.a < uAlphaTest) discard;

    // 1. Auto-Derived Chitin Surface Normal from local luminance relief gradients
    vec2 stepUv = uTexelSize * 2.2;
    float lL = sampleLuma(sampleUv - vec2(stepUv.x, 0.0));
    float lR = sampleLuma(sampleUv + vec2(stepUv.x, 0.0));
    float lD = sampleLuma(sampleUv - vec2(0.0, stepUv.y));
    float lU = sampleLuma(sampleUv + vec2(0.0, stepUv.y));
    float dLx = (lR - lL);
    float dLy = (lU - lD);

    float edgeDist = abs(vUv.x - 0.5) * 2.0;
    vec3 surfNormal = normalize(vec3(
      -dLx * 2.8 + (vUv.x - 0.5) * 0.85,
      -dLy * 2.8 + (vUv.y - 0.45) * 0.65,
      1.0
    ));

    // 2. Directional Overhead Key Light + Chitin Specular Highlight
    vec3 keyDir = normalize(vec3(-0.35, 0.78, 0.52));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfVec = normalize(keyDir + viewDir);
    float diff = clamp(dot(surfNormal, keyDir), 0.0, 1.0);
    float spec = pow(clamp(dot(surfNormal, halfVec), 0.0, 1.0), 18.0);

    float topShade = mix(0.76, 1.15, smoothstep(0.06, 0.92, vUv.y));
    float cylRelief = mix(1.06, 0.78, edgeDist * edgeDist);
    float footAO = mix(1.0 - uFootAOStrength, 1.0, smoothstep(0.0, 0.22, vUv.y));

    // 3. Bioluminescent Emissive Detection (Magenta Void Veins & Lime-Green Acid Sacs)
    float maxCh = max(texel.r, max(texel.g, texel.b));
    float minCh = min(texel.r, min(texel.g, texel.b));
    float sat = maxCh > 0.001 ? (maxCh - minCh) / maxCh : 0.0;

    // Detect glowing magenta/violet cracks & wings OR glowing lime-green toxic acid
    float isMagentaGlow = smoothstep(0.45, 0.78, texel.r) * smoothstep(0.42, 0.75, texel.b) * smoothstep(0.08, 0.38, max(texel.r, texel.b) - texel.g);
    float isAcidGlow = smoothstep(0.48, 0.82, texel.g) * smoothstep(0.15, 0.45, texel.g - texel.b);
    float bioMask = clamp(isMagentaGlow + isAcidGlow, 0.0, 1.0);
    float pulseWave = 0.5 + 0.5 * sin(uTime * 4.2 + vUv.y * 5.0);
    float bioPulse = 1.0 + uBioPulseStrength * sat * pulseWave + bioMask * (0.35 + 0.30 * pulseWave);

    // 4. Warm Molten Lava Ground-Bounce Light & Silhouette Rim Light
    vec3 lavaBounceDir = normalize(vec3(0.0, -0.82, 0.56));
    float bounceDot = clamp(dot(surfNormal, lavaBounceDir), 0.0, 1.0) * smoothstep(0.75, 0.04, vUv.y);
    vec3 lavaBounceCol = vec3(0.95, 0.36, 0.06) * bounceDot * uBounceStrength * (0.35 + 0.65 * maxCh);

    float rimMask = smoothstep(0.46, 0.96, edgeDist) * smoothstep(0.14, 0.92, vUv.y);
    vec3 chitinSpecCol = vec3(0.95, 0.78, 1.0) * spec * 0.22 * (1.0 - bioMask * 0.5);

    // Convert sRGB texture sample to linear space so OutputPass ACESFilmic + sRGB conversion doesn't double-gamma wash out colors!
    vec3 baseLinear = pow(max(texel.rgb, vec3(0.0)), vec3(2.2));
    vec3 color = baseLinear * topShade * cylRelief * footAO * (0.82 + 0.36 * diff) * bioPulse;
    color += chitinSpecCol * 0.5 + lavaBounceCol * 0.45;
    color += uRimColor * (rimMask * uRimStrength * 0.42 * (0.35 + 0.65 * maxCh));
    color *= uStatusTint * uEmergeShade;
    color = mix(color, vec3(0.85, 0.75, 0.92), uHitFlash * 0.45);

    gl_FragColor = vec4(color, texel.a * uOpacity);
    #include <fog_fragment>
  }
`;

const VOLUMETRIC_BEAM_VERT = `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const VOLUMETRIC_BEAM_FRAG = `
  uniform float uTime;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  uniform float uFalloffPow;
  uniform float uOpacity;
  uniform float uScrollSpeed;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
    float coreMask = pow(ndotv, uFalloffPow);
    float spiral = sin(vUv.y * 26.0 - uTime * uScrollSpeed + vUv.x * 12.56637) * 0.5 + 0.5;
    float axialWave = sin(vUv.y * 42.0 - uTime * (uScrollSpeed * 1.45)) * 0.5 + 0.5;
    float endFade = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
    float intensity = mix(0.68, 1.28, spiral * 0.6 + axialWave * 0.4);
    vec3 col = mix(uEdgeColor, uCoreColor, smoothstep(0.22, 0.92, coreMask * intensity));
    float alpha = coreMask * endFade * uOpacity * mix(0.78, 1.0, axialWave);
    gl_FragColor = vec4(col * intensity, alpha);
  }
`;

const BIO_PLASMA_VERT = `
  uniform float uTime;
  uniform float uWobbleAmp;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vUv = uv;
    float ripple = sin(position.x * 0.34 + uTime * 6.5)
                 * cos(position.y * 0.34 - uTime * 5.2)
                 * sin(position.z * 0.34 + uTime * 4.8);
    vec3 displaced = position + normal * (ripple * uWobbleAmp);
    vLocalPos = displaced;
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const BIO_PLASMA_FRAG = `
  uniform float uTime;
  uniform vec3 uCoreColor;
  uniform vec3 uMidColor;
  uniform vec3 uRimColor;
  uniform float uOpacity;
  uniform float uRimMode;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
    // Helical swirling molten lava-plasma currents around the sphere
    float ang = atan(vLocalPos.z, vLocalPos.x);
    float lat = vLocalPos.y * 0.14;
    float swirl1 = sin(ang * 3.0 + lat * 2.2 - uTime * 7.2 + sin(lat * 3.0 + uTime * 4.0) * 1.1);
    float swirl2 = cos(ang * 5.0 - lat * 2.8 + uTime * 5.8 + swirl1 * 0.9);
    float p1 = sin(vLocalPos.x * 0.24 + uTime * 5.0 + swirl1);
    float eddy = clamp(0.5 + 0.30 * swirl1 + 0.18 * swirl2 + 0.14 * p1, 0.0, 1.0);

    vec3 col;
    float alpha;
    if (uRimMode > 0.5) {
      float halo = pow(1.0 - ndotv, 1.55) * smoothstep(0.0, 0.22, ndotv);
      col = mix(uRimColor, uCoreColor, smoothstep(0.3, 0.9, eddy));
      alpha = clamp(halo * (0.68 + 0.58 * eddy), 0.0, 1.0) * uOpacity;
    } else {
      float centerGlow = pow(ndotv, 0.85);
      vec3 crustDark = uRimColor * 0.35;
      col = mix(crustDark, uRimColor, smoothstep(0.08, 0.38, eddy));
      col = mix(col, uMidColor, smoothstep(0.36, 0.72, eddy * 0.65 + centerGlow * 0.35));
      col = mix(col, uCoreColor, smoothstep(0.70, 0.95, eddy * (0.45 + 0.55 * centerGlow)));
      alpha = mix(0.82, 1.0, centerGlow) * uOpacity;
    }
    gl_FragColor = vec4(col * 1.15, alpha);
  }
`;

const PLASMA_WAKE_VERT = `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PLASMA_WAKE_FRAG = `
  uniform float uTime;
  uniform vec3 uHeadColor;
  uniform vec3 uTailColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
    float trailMask = pow(vUv.y, 1.35) * smoothstep(1.0, 0.84, vUv.y);
    // Double helical lava-swirl ribbons spiraling back along the comet wake
    float ribbonA = sin(vUv.x * 12.5663 + vUv.y * 16.0 - uTime * 22.0);
    float ribbonB = cos(vUv.x * 18.8495 - vUv.y * 11.0 - uTime * 16.0);
    float streaks = clamp(0.55 + 0.30 * ribbonA + 0.22 * ribbonB, 0.0, 1.0);
    vec3 col = mix(uTailColor, uHeadColor, clamp(vUv.y * 0.75 + streaks * 0.35, 0.0, 1.0));
    float alpha = pow(ndotv, 1.1) * trailMask * streaks * uOpacity;
    gl_FragColor = vec4(col * 1.15, alpha);
  }
`;

interface EnemyRenderEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  visualDef?: EnemyVisualDef;
  aspectWidth: number;
  aspectHeight: number;
  aspectResolved: boolean;
  shadow: THREE.Mesh;
  auraRing?: THREE.Mesh;
  hpBarGroup: THREE.Group;
  hpBarFill: THREE.Mesh;
  lastHealth: number;
  hitFlashTimer: number;
  baseScale: number;
  encasedIceGroup?: THREE.Group;
  lastTiltX?: number;
  lastTiltY?: number;
  cachedSlopeX?: number;
  cachedSlopeZ?: number;
  // Stage 1 Titan Boss components
  isTitan?: boolean;
  titan3D?: Stage1Boss3DModel;
  titanMesh?: THREE.Mesh;
  titanMaterial?: THREE.ShaderMaterial;
  titanAnimTime?: number;
  titanLastWalkFrame?: number;
  titanLaserGroup?: THREE.Group;
  titanLaserBeamCore?: THREE.Mesh;
  titanLaserBeamAura?: THREE.Mesh;
  titanLaserMouthFunnel?: THREE.Mesh;
  titanLaserMouthOrb?: THREE.Mesh;
  titanLaserHelixTubes?: THREE.Mesh[];
  titanLaserHelixSpinePts?: THREE.Vector3[][];
  titanLaserImpactDome?: THREE.Mesh;
  titanLaserImpactDisc?: THREE.Mesh;
  titanLaserImpactRing?: THREE.Mesh;
  titanLaserJitterTimer?: number;
  titanElementalOrbs?: THREE.Group[];
  titanElementalMat?: THREE.ShaderMaterial;
  titanElementalHaloMat?: THREE.ShaderMaterial;
  titanTentacleGroup?: THREE.Group;
  titanTentacleMarkerGroup?: THREE.Group;
  titanTentacleMarkerRing?: THREE.Mesh;
  titanTentacleMarkerFill?: THREE.Mesh;
  titanTentacleMarkerCore?: THREE.Mesh;
  titanTentacleMarkerChevrons?: THREE.Group;
  titanTentacleRingOrigXZ?: Float32Array;
  titanTentacleFillOrigXZ?: Float32Array;
  titanTentacleCoreOrigXZ?: Float32Array;
  titanTentacleChevronAngle?: number;
  titanTentacleMeshes?: THREE.Mesh[];
  titanTentacleSpines?: THREE.Line[];
  titanTentacleSpinePts?: THREE.Vector3[][];
  titanTentacleSpineLinePts?: THREE.Vector3[][];
  titanTentacleStingers?: THREE.Mesh[];
  titanTentacleImpactRings?: THREE.Mesh[];
}

interface ObstacleRenderEntry {
  id: string;
  mesh: THREE.Object3D;
  shadow: THREE.Mesh;
}

interface PodRenderEntry {
  group: THREE.Group;
  closedGroup: THREE.Group;
  openedGroup: THREE.Group;
  frontPlaneClosed: THREE.Mesh;
  frontPlaneOpened: THREE.Mesh;
  crossPlaneClosed?: THREE.Mesh;
  crossPlaneOpened?: THREE.Mesh;
  frontPlane: THREE.Mesh;
  crossPlane?: THREE.Mesh;
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
  beacon?: THREE.Mesh;
  coreMesh?: THREE.Mesh;
  light?: THREE.PointLight;
  isOpenedVisual?: boolean;
  isClonedForDissolve?: boolean;
}

interface WorldEventRenderEntry {
  id: string;
  group: THREE.Group;
  ringMesh: THREE.Mesh;
  innerRing?: THREE.Mesh;
  coreMesh: THREE.Mesh;
  floatingShard?: THREE.Mesh;
  beamMesh?: THREE.Mesh;
  light?: THREE.PointLight;
  dashPlatformGroup?: THREE.Group;
  dashPlatformMeshes?: Array<{
    group: THREE.Group;
    padMesh: THREE.Mesh;
    ringMesh: THREE.Mesh;
    summitCore?: THREE.Mesh;
    summitBeam?: THREE.Mesh;
  }>;
  payloadBeaconGroup?: THREE.Group;
  payloadBeamGroup?: THREE.Group;
  payloadCoreMesh?: THREE.Mesh;
  payloadInnerBeam?: THREE.Mesh;
  payloadOuterBeam?: THREE.Mesh;
  payloadRingMesh?: THREE.Mesh;
}

export class ThreeApp {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private simulation: Simulation;
  private inputManager: InputManager;
  private soundManager: SoundManager;
  private uiManager: UIManager;
  private narrativeObserver: NarrativeObserver | null = null;
  private dialogueDirector: DialogueDirector | null = null;

  private textureLoader: THREE.TextureLoader;
  private textures: Record<string, THREE.Texture> = {};

  private terrain: ThreeTerrain;
  private vfx: ThreeVFX;

  // Camera Orbit Settings (PokéBonk style third-person camera)
  public invertCameraPan: boolean = false;
  public invertCameraPitch: boolean = false;
  public mouseSensitivity: number = 1.0;
  public cameraYaw: number = 0;        // Radians around Y axis
  public targetYaw: number = 0;
  public cameraPitch: number = 0.62;   // Radians (~35 deg from horizontal)
  public targetPitch: number = 0.62;
  public cameraDistance: number = 490; // Distance behind 2x-scaled player
  public targetDistance: number = 490;
  public isPointerLocked: boolean = false;
  private lastMouseX: number | null = null;
  private lastMouseY: number | null = null;
  private cameraFocus: THREE.Vector3 = new THREE.Vector3(4000, 65, 4000);
  private camEyeScratch: THREE.Vector3 = new THREE.Vector3();
  private camSampleScratch: THREE.Vector3 = new THREE.Vector3();
  private camShoulderScratch: THREE.Vector3 = new THREE.Vector3();
  private camCollisionDistFrac: number = 1.0;
  private camFwd: THREE.Vector3 = new THREE.Vector3();
  private camRight: THREE.Vector3 = new THREE.Vector3();

  // Lighting & Post-Processing
  private composer: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private graphicsQuality: GraphicsQuality = 'medium';
  private useComposer: boolean = true;
  private animateClouds: boolean = true;
  private maxDynamicLights: number = 8;
  private skyCloudUniforms: { uTime: { value: number }; uFogColor: { value: THREE.Color } } | null = null;
  private horizonCloudMeshes: THREE.Mesh[] = [];
  private customMapFreezeSetter: ((progress: number, originX?: number, originY?: number) => void) | null = null;
  private regionalFreezeActive: boolean = false;
  private regionalFreezeElapsed: number = 0;
  private regionalFreezeDuration: number = 20.0;
  private regionalFreezeOrigin: Vector2 = { x: 1800, y: 1800 };
  private regionalFreezeMoteAccum: number = 0;
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;

  // Player 3D Objects
  private playerGroup: THREE.Group;
  private playerSprite: THREE.Sprite;
  public spriteAnimator!: CommanderSpriteAnimator;
  public commander3D!: Commander3DModel;
  public use3DCommander: boolean = false;
  private playerShadow: THREE.Mesh;
  private playerResolveAura: THREE.Mesh;
  private jetPlumeL: THREE.Sprite;
  private jetPlumeR: THREE.Sprite;
  private orbitingBladeGroup!: THREE.Group;
  private orbitingSwords: Array<{
    group: THREE.Group;
    swordModel: THREE.Group;
    trailLine: THREE.Line;
    trailPosAttr: THREE.BufferAttribute;
    trailColAttr: THREE.BufferAttribute;
    branchLines: THREE.LineSegments;
    branchPosAttr: THREE.BufferAttribute;
    branchColAttr: THREE.BufferAttribute;
  }> = [];

  // Entities
  private enemyMap: Map<string, EnemyRenderEntry> = new Map();
  private obstacleEntries: ObstacleRenderEntry[] = [];
  private podMap: Map<string, PodRenderEntry> = new Map();
  private projMap: Map<string, THREE.Object3D> = new Map();
  private projTemplateCache: Map<string, THREE.Group> = new Map();
  private recoveryFieldMap: Map<string, { group: THREE.Group; ring: THREE.Mesh }> = new Map();
  private toxicFieldMap: Map<string, { group: THREE.Group; ring: THREE.Mesh; gooMat?: THREE.ShaderMaterial }> = new Map();
  private sanctuaryCrossMap: Map<string, { group: THREE.Group; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; snapX: number; snapY: number; snapZ: number }> = new Map();
  private frostTrailMap: Map<string, { group: THREE.Group; mesh: THREE.Mesh }> = new Map();
  private vitalTetherMap: Map<string, { mesh: THREE.Mesh; coreMesh: THREE.Mesh; pulseOrb: THREE.Mesh; flowT: number }> = new Map();
  private doctorDroneMap: Map<string, {
    group: THREE.Group;
    turret: THREE.Group;
    coreMesh: THREE.Mesh;
    coreMat: THREE.MeshBasicMaterial;
    chargeOrb: THREE.Mesh;
    chargeMat: THREE.MeshBasicMaterial;
    muzzleFlash: THREE.Group;
    rotorL: THREE.Mesh;
    rotorR: THREE.Mesh;
    beamLine?: THREE.Line;
  }> = new Map();
  private holographicDecoyMap: Map<string, { group: THREE.Group; billboard: THREE.Mesh; holoMat: THREE.ShaderMaterial }> = new Map();
  private divineAngelMap: Map<string, {
    group: THREE.Group;
    bodyGroup: THREE.Group;
    coreMesh: THREE.Mesh;
    outerCage: THREE.Mesh;
    haloCrown: THREE.Mesh;
    gimbalA: THREE.Mesh;
    gimbalB: THREE.Mesh;
    wingRigL: THREE.Group;
    wingRigR: THREE.Group;
    motesGroup: THREE.Group;
  }> = new Map();
  private fallingCrossMap: Map<string, { group: THREE.Group; warningMesh: THREE.Mesh; warningMat: THREE.ShaderMaterial; crossGroup: THREE.Group }> = new Map();
  private sharedDroneRes?: {
    hullGeo: THREE.BufferGeometry;
    capGeo: THREE.BufferGeometry;
    podGeo: THREE.BufferGeometry;
    rotorGeo: THREE.BufferGeometry;
    barrelGeo: THREE.BufferGeometry;
    coreGeo: THREE.BufferGeometry;
    chargeGeo: THREE.BufferGeometry;
    muzzleConeGeo: THREE.BufferGeometry;
    armorMat: THREE.MeshStandardMaterial;
    trimMat: THREE.MeshStandardMaterial;
    darkFrameMat: THREE.MeshStandardMaterial;
    ventMat: THREE.MeshBasicMaterial;
    muzzleMat: THREE.MeshBasicMaterial;
  };
  private sharedAngelRes?: {
    coreGeo: THREE.BufferGeometry;
    cageGeo: THREE.BufferGeometry;
    haloGeo: THREE.BufferGeometry;
    gimbalGeo: THREE.BufferGeometry;
    bladeOuterGeo: THREE.BufferGeometry;
    bladeMidGeo: THREE.BufferGeometry;
    bladeInnerGeo: THREE.BufferGeometry;
    moteGeo: THREE.BufferGeometry;
    goldMat: THREE.MeshBasicMaterial;
    emeraldCageMat: THREE.MeshBasicMaterial;
    wingGoldMat: THREE.MeshBasicMaterial;
    wingEmeraldMat: THREE.MeshBasicMaterial;
    moteMat: THREE.MeshBasicMaterial;
  };
  private playerPhaseBarrierMesh?: THREE.Group;
  private playerAdrenalineRing?: THREE.Mesh;
  private doctorDashGhostTimer: number = 0;
  private dropMap: Map<string, THREE.Mesh> = new Map();
  private sharedDropGeo = new THREE.OctahedronGeometry(8);
  private sharedDropMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  private itemDropMap: Map<string, THREE.Group> = new Map();
  private worldEventMap: Map<string, WorldEventRenderEntry> = new Map();

  // Shared Pod (Chest) Resources for Zero-Lag Open/Close & Despawning (scaled for 2x characters)
  private sharedPodPlaneGeo = new THREE.PlaneGeometry(84, 112);
  private sharedPodShadowGeo = new THREE.PlaneGeometry(88, 88);
  private sharedPodRingGeo = new THREE.RingGeometry(68, 76, 32);
  private sharedPodCoreGeo = new THREE.SphereGeometry(13, 12, 10);
  private sharedPodRingMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
  private sharedPodClosedMat: THREE.MeshStandardMaterial | null = null;
  private sharedPodOpenedMat: THREE.MeshStandardMaterial | null = null;
  private sharedPodCoreMat: THREE.MeshBasicMaterial | null = null;
  private sharedPodShadowMat: THREE.MeshBasicMaterial | null = null;

  // Shared Stage 1 Boss Tentacle Textures (Generated once, reused zero-GC)
  private tentacleSkinTex?: THREE.CanvasTexture;
  private tentacleEmissiveTex?: THREE.CanvasTexture;

  // Shared Item & Buff Drop Resources for Zero-Lag Spawning & Recycling (2x scale)
  private sharedItemOrbGeo = new THREE.SphereGeometry(12, 12, 12);
  private sharedItemOrbMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 1.4
  });
  private sharedBuffCoreGeo = new THREE.IcosahedronGeometry(14, 0);
  private sharedBuffCoreMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.8,
    metalness: 0.9,
    roughness: 0.1
  });
  private sharedBuffCageGeo = new THREE.BoxGeometry(24, 24, 24);
  private sharedBuffCageMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
    transparent: true,
    opacity: 0.75
  });
  private sharedBuffBeamGeo = new THREE.CylinderGeometry(3.0, 5.6, 130, 8, 1, true);
  private sharedBuffBeamMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide
  });
  private itemDropPool: THREE.Group[] = [];

  // Shared GPU Resources for Enemy & Boss Billboards / HP Bars / Shadows
  private sharedUnitPlaneGeo: THREE.PlaneGeometry = new THREE.PlaneGeometry(1, 1);
  private sharedEnemyPuppetGeo: THREE.PlaneGeometry = new THREE.PlaneGeometry(1, 1, 16, 16);
  private sharedEnemyShadowMat: THREE.MeshBasicMaterial | null = null;
  private sharedHpBgMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ color: 0x090d16, side: THREE.DoubleSide });
  private sharedHpMatCache: Map<number, THREE.MeshBasicMaterial> = new Map();
  private sharedAuraRingGeoCache: Map<number, THREE.BufferGeometry> = new Map();
  private sharedAuraMatCache: Map<number, THREE.Material> = new Map();
  private sharedElementalOrbGeo: THREE.BufferGeometry | null = null;
  private sharedElementalHaloGeo: THREE.BufferGeometry | null = null;
  private sharedElementalWakeGeo: THREE.BufferGeometry | null = null;
  private sharedElementalOrbMat: THREE.ShaderMaterial | null = null;
  private sharedElementalHaloMat: THREE.ShaderMaterial | null = null;
  private sharedElementalWakeMat: THREE.ShaderMaterial | null = null;
  private readonly titanMouthScratch = new THREE.Vector3();
  private readonly titanEndScratch = new THREE.Vector3();
  private readonly titanBeamVecScratch = new THREE.Vector3();
  private readonly titanBeamDirScratch = new THREE.Vector3();
  private readonly titanV1Scratch = new THREE.Vector3();
  private readonly titanV2Scratch = new THREE.Vector3();
  private readonly titanUpScratch = new THREE.Vector3(0, 1, 0);
  private readonly titanPosZScratch = new THREE.Vector3(0, 0, 1);
  private projectileGroupPool: Map<string, THREE.Group[]> = new Map();
  private readonly scratchEnemyIds: Set<string> = new Set();
  private readonly scratchProjIds: Set<string> = new Set();
  private readonly scratchDropIds: Set<string> = new Set();
  private readonly scratchItemDropIds: Set<string> = new Set();
  private readonly scratchRecoveryIds: Set<string> = new Set();
  private readonly scratchToxicIds: Set<string> = new Set();
  private readonly scratchCrossIds: Set<string> = new Set();
  private readonly scratchDocFrostIds: Set<string> = new Set();
  private readonly scratchDocTetherIds: Set<string> = new Set();
  private readonly scratchDocDroneIds: Set<string> = new Set();
  private readonly scratchDocDecoyIds: Set<string> = new Set();
  private readonly scratchDocAngelIds: Set<string> = new Set();
  private readonly scratchDocFallingIds: Set<string> = new Set();
  private readonly tentacleTScratch = new THREE.Vector3();
  private readonly tentacleNScratch = new THREE.Vector3();
  private readonly tentacleBScratch = new THREE.Vector3();
  private readonly tentacleUnitXScratch = new THREE.Vector3(1, 0, 0);
  private readonly tentacleCrestScratch = new THREE.Vector3();
  private readonly tentacleStingerDirScratch = new THREE.Vector3();
  private readonly tetherStartScratch = new THREE.Vector3();
  private readonly tetherEndScratch = new THREE.Vector3();
  private readonly tetherDeltaScratch = new THREE.Vector3();
  private readonly tetherMidScratch = new THREE.Vector3();
  private readonly tetherDirScratch = new THREE.Vector3();
  private readonly tentacleRootScratch = new THREE.Vector3();
  private readonly tentacleTargetScratch = new THREE.Vector3();
  private readonly tentacleFullVecScratch = new THREE.Vector3();
  private readonly tentacleHorizDirScratch = new THREE.Vector3();
  private readonly tentacleHorizPerpScratch = new THREE.Vector3();
  private readonly tentacleCurPosScratch = new THREE.Vector3();

  // Overseer Artifact
  private artifactGroup!: THREE.Group;
  private artifactBeacon!: THREE.Mesh;
  private artifactRing1: THREE.Mesh | null = null;
  private artifactRing2: THREE.Mesh | null = null;
  private stage1SceneryGroup: THREE.Group | null = null;
  private mountaintopHorizonGroup: THREE.Group | null = null;
  private testMapDressingGroup: THREE.Group | null = null;
  private testMapDynamicLights: Array<{
    light: THREE.PointLight;
    kind: 'tower' | 'ship' | 'flora';
    baseIntensity: number;
    phase: number;
    homePos?: THREE.Vector3;
  }> = [];
  private floraLightAnchors: Array<{ pos: THREE.Vector3; color: number }> = [];
  private snowSporePoints: THREE.Points | null = null;
  private snowSporeCount: number = 0;
  private snowSporeKinds: Uint8Array | null = null;
  private snowSporePhases: Float32Array | null = null;
  private shipSparkPoints: THREE.Points | null = null;
  private shipSparkBasePos: THREE.Vector3 | null = null;
  private shipSparkPhases: Float32Array | null = null;
  private summitBeaconMesh: THREE.Mesh | null = null;
  private floraLightUpdateAccum: number = 0;
  private cameraTrauma: number = 0;
  private earthquakeTimer: number = 0;
  private earthquakeDuration: number = 0;
  private earthquakeIntensity: number = 0;
  private earthquakeIsMajor: boolean = false;
  public isTestMapActive: boolean = false;
  public isCustomUploadedMap: boolean = false;
  public activeMapFileName: string = DEFAULT_STAGE1_MAP_NAME;
  private savedStage1Obstacles: typeof this.simulation.state.obstacles | null = null;
  private savedStage1ArtifactPos: Vector2 | null = null;
  private savedStage1EventPositions: Array<{ pos: Vector2; elevation: number }> | null = null;
  private savedStage1PodPositions: Vector2[] | null = null;
  private activeRedCrystalMaterials: RedCrystalMaterialEntry[] = [];

  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  // Developer Mode / Stage Editor & Perf Hooks
  public isEditorMode: boolean = false;
  public isDevModeSession: boolean = false;
  private editorTickCallback: ((dt: number, now: number) => void) | null = null;
  private postRenderCallback: ((dt: number, now: number, info: THREE.WebGLInfo) => void) | null = null;

  private lastTime: number = 0;
  private isRunning: boolean = true;
  private readonly boundRenderLoop = this.renderLoop.bind(this);

  constructor(
    container: HTMLElement,
    simulation: Simulation,
    soundManager: SoundManager,
    uiManager: UIManager
  ) {
    this.container = container;
    this.simulation = simulation;
    this.soundManager = soundManager;
    this.uiManager = uiManager;
    this.inputManager = new InputManager();
    this.textureLoader = new THREE.TextureLoader();

    // 1. Three.js Renderer (ACES Filmic Tone Mapping + Selective Bloom Pipeline)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);

    // 2. Scene & Brighter Moonlit Mountaintop Night Atmosphere
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101c30);
    this.scene.fog = new THREE.FogExp2(0x192942, 0.00022);

    // 3. Perspective Camera (50 deg FOV for cinematic third-person view, 22000 far plane for mountaintop vistas)
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 22000);

    // 3b. Post-Processing Composer (RenderPass + Half-Res Selective UnrealBloomPass + OutputPass)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(window.innerWidth * 0.5), Math.floor(window.innerHeight * 0.5)),
      0.24,
      0.36,
      0.88
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // 4. Readable Night Lighting (Cool Moonlight Fill + Horizon Rim — Zero Shadow Maps)
    this.ambientLight = new THREE.AmbientLight(0x4a668f, 1.05);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x7aa4d6, 0x28364d, 1.10);
    this.scene.add(this.hemiLight);

    const cx = this.simulation.state.worldWidth / 2; // 1800
    const cy = this.simulation.state.worldHeight / 2; // 1800

    this.sunLight = new THREE.DirectionalLight(0xc7e0ff, 1.85);
    this.sunLight.position.set(cx + 800, 2400, cy - 800);
    this.sunLight.castShadow = false;
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.85);
    this.rimLight.position.set(cx - 900, 1200, cy + 900);
    this.scene.add(this.rimLight);

    // 5. Preload Textures
    this.loadTextures();

    // 6. 3D Terrain
    this.terrain = new ThreeTerrain(this.simulation.state.terrain, this.textureLoader);
    this.scene.add(this.terrain.group);

    // 7. 3D VFX (with elevation-aware fast visual terrain height sampler)
    this.vfx = new ThreeVFX((x, z, refY) =>
      this.simulation.state.terrain.getFastVisualHeight(x, z, refY, 56)
    );
    this.scene.add(this.vfx.group);

    // 8. Player Group & Billboard Sprites (2x entity scale)
    const playerInitPos = this.simulation.state.player.pos;
    const startElev = this.simulation.state.terrain.getElevation(playerInitPos.x, playerInitPos.y).height;
    this.cameraFocus.set(playerInitPos.x, startElev, playerInitPos.y);

    this.playerGroup = new THREE.Group();
    this.scene.add(this.playerGroup);

    // Shadow decal (2x scale)
    const shadowGeo = new THREE.PlaneGeometry(72, 72);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.textures['shadow'],
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    this.playerShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.playerShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.playerShadow);

    // Commander Billboard Sprite (2.5D Camera-Facing Representation, 2x scale)
    const charMat = new THREE.SpriteMaterial({
      map: this.textures['commander_front'],
      toneMapped: false,
      transparent: true,
      alphaTest: 0.05
    });
    this.playerSprite = new THREE.Sprite(charMat);
    this.playerSprite.scale.set(104, 104, 1);
    this.playerSprite.position.set(0, 52, 0);
    this.playerSprite.visible = !this.use3DCommander;
    this.playerGroup.add(this.playerSprite);

    // Modular 2.5D Sprite Animation Controller
    this.spriteAnimator = new CommanderSpriteAnimator(
      this.playerSprite,
      {
        front: this.textures['commander_front'],
        back: this.textures['commander_back'],
        left: this.textures['commander_left'],
        right: this.textures['commander_right']
      },
      {
        front: this.textures['commander_run_front'],
        back: this.textures['commander_run_back'],
        left: this.textures['commander_run_left'],
        right: this.textures['commander_run_right']
      },
      {
        front: this.textures['commander_jump_front'],
        back: this.textures['commander_jump_back'],
        left: this.textures['commander_jump_left'],
        right: this.textures['commander_jump_right']
      },
      {
        front: this.textures['commander_glide_front'],
        back: this.textures['commander_glide_back'],
        left: this.textures['commander_glide_left'],
        right: this.textures['commander_glide_right']
      },
      {
        front: this.textures['commander_attack_front'],
        back: this.textures['commander_attack_back'],
        left: this.textures['commander_attack_left'],
        right: this.textures['commander_attack_right']
      },
      {
        front: this.textures['commander_ult_front'],
        back: this.textures['commander_ult_back'],
        left: this.textures['commander_ult_left'],
        right: this.textures['commander_ult_right']
      }
    );

    this.spriteAnimator.setDoctorSheets({
      run: {
        front: this.textures['doctor_run_front'],
        back: this.textures['doctor_run_back'],
        left: this.textures['doctor_run_left'],
        right: this.textures['doctor_run_right']
      },
      jump: {
        front: this.textures['doctor_jump_front'],
        back: this.textures['doctor_jump_back'],
        left: this.textures['doctor_jump_left'],
        right: this.textures['doctor_jump_right']
      },
      glide: {
        front: this.textures['doctor_glide_front'],
        back: this.textures['doctor_glide_back'],
        left: this.textures['doctor_glide_left'],
        right: this.textures['doctor_glide_right']
      },
      attack: {
        front: this.textures['doctor_attack_front'],
        back: this.textures['doctor_attack_back'],
        left: this.textures['doctor_attack_left'],
        right: this.textures['doctor_attack_right']
      },
      rmb: {
        front: this.textures['doctor_rmb_front'],
        back: this.textures['doctor_rmb_back'],
        left: this.textures['doctor_rmb_left'],
        right: this.textures['doctor_rmb_right']
      },
      dash: {
        front: this.textures['doctor_dash_front'],
        back: this.textures['doctor_dash_back'],
        left: this.textures['doctor_dash_left'],
        right: this.textures['doctor_dash_right']
      },
      ult: {
        front: this.textures['doctor_ult_front'],
        back: this.textures['doctor_ult_back'],
        left: this.textures['doctor_ult_left'],
        right: this.textures['doctor_ult_right']
      }
    });

    // Fully Animated 3D Commander Character Model (2x entity scale)
    this.commander3D = new Commander3DModel();
    this.commander3D.group.scale.setScalar(2.0);
    this.commander3D.group.visible = this.use3DCommander;
    this.playerGroup.add(this.commander3D.group);

    // Resolve / Sanctuary swirling bio-flame mist aura (zero RingGeometry)
    const auraGeo = new THREE.PlaneGeometry(118, 118);
    auraGeo.rotateX(-Math.PI / 2);
    const auraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffd700) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        float auHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float auNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(auHash(i), auHash(i + vec2(1.0, 0.0)), f.x), mix(auHash(i + vec2(0.0, 1.0)), auHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float r = length(vUv);
          float a = atan(vUv.y, vUv.x);
          float wisp = auNoise(vec2(cos(a + uTime * 1.4), sin(a + uTime * 1.4)) * 2.8 + vUv * 2.2) * 0.65
                     + auNoise(vUv * 5.0 - vec2(uTime * 1.8)) * 0.35;
          float dr = r - (wisp - 0.5) * 0.36;
          if (dr > 0.96) discard;
          float flameBand = exp(-pow((dr - 0.62) / 0.14, 2.0)) * smoothstep(0.25, 0.85, wisp);
          float innerMist = smoothstep(0.75, 0.12, dr) * wisp * 0.24;
          float alpha = clamp((flameBand * 0.85 + innerMist), 0.0, 0.82);
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(uColor * (1.0 + flameBand * 0.4), alpha);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.playerResolveAura = new THREE.Mesh(auraGeo, auraMat);
    this.playerResolveAura.visible = false;
    this.playerGroup.add(this.playerResolveAura);

    // Dash Barrier Swirling Organic Bio-Shroud Veil (zero geometric Icosahedron/Wireframe)
    this.playerPhaseBarrierMesh = new THREE.Group();
    const barrierVeilGeo = this.vfx.createOrganicPlumeColumnGeo(52, 62, 92, 16, 6, 0.22, 1.2);
    const barrierVeilMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        float bvHash(vec2 p) { return fract(sin(dot(p, vec2(41.2, 289.1))) * 43758.5453); }
        float bvNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(bvHash(i), bvHash(i + vec2(1.0, 0.0)), f.x), mix(bvHash(i + vec2(0.0, 1.0)), bvHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float n = bvNoise(vec2(vUv.x * 7.0 + uTime * 0.8, vUv.y * 5.0 - uTime * 1.2))
                  + 0.5 * bvNoise(vec2(vUv.x * 14.0 - uTime * 1.4, vUv.y * 10.0));
          float vMask = sin(vUv.y * 3.14159265);
          float wisps = smoothstep(0.45, 1.2, n) * vMask;
          if (wisps < 0.02) discard;
          vec3 col = mix(vec3(0.08, 0.72, 0.52), vec3(0.56, 0.98, 0.82), smoothstep(0.6, 1.3, n));
          gl_FragColor = vec4(col, wisps * 0.45);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const barrierInner = new THREE.Mesh(barrierVeilGeo, barrierVeilMat);
    const barrierOuter = new THREE.Mesh(barrierVeilGeo.clone(), barrierVeilMat);
    barrierOuter.scale.set(1.12, 0.88, 1.12);
    barrierOuter.rotation.y = 1.1;
    barrierOuter.userData.isSharedMat = true;
    this.playerPhaseBarrierMesh.add(barrierInner, barrierOuter);
    this.playerPhaseBarrierMesh.position.y = 48;
    this.playerPhaseBarrierMesh.visible = false;
    this.playerGroup.add(this.playerPhaseBarrierMesh);

    // Adrenaline Rush Swirling Wind & Emerald Mist Surge (zero RingGeometry)
    const adrenGeo = new THREE.PlaneGeometry(132, 132);
    adrenGeo.rotateX(-Math.PI / 2);
    const adrenMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x22c55e) } },
      vertexShader: auraMat.vertexShader,
      fragmentShader: auraMat.fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.playerAdrenalineRing = new THREE.Mesh(adrenGeo, adrenMat);
    this.playerAdrenalineRing.position.y = 1.6;
    this.playerAdrenalineRing.visible = false;
    this.playerGroup.add(this.playerAdrenalineRing);

    // Jet Thruster Plumes for Gliding (2x scale)
    const plumeMat = new THREE.SpriteMaterial({
      map: this.textures['jet_plume'],
      transparent: true,
      opacity: 0.95
    });
    this.jetPlumeL = new THREE.Sprite(plumeMat);
    this.jetPlumeL.scale.set(24, 48, 1);
    this.jetPlumeL.visible = false;
    this.playerGroup.add(this.jetPlumeL);

    this.jetPlumeR = new THREE.Sprite(plumeMat.clone());
    this.jetPlumeR.scale.set(24, 48, 1);
    this.jetPlumeR.visible = false;
    this.playerGroup.add(this.jetPlumeR);

    // Persistent Violet Floating Electric Sword System (Secondary Upgrade 3)
    this.orbitingBladeGroup = new THREE.Group();
    this.orbitingBladeGroup.visible = false;
    this.scene.add(this.orbitingBladeGroup);

    // 9. World Props (Artifact, Pods, Obstacles)
    this.artifactGroup = this.createArtifact();
    this.scene.add(this.artifactGroup);

    this.createPods();
    this.createWorldEvents();
    this.createObstacles();
    this.createSkyElements();

    // 10. Window resize & interaction events
    window.addEventListener('resize', this.onResize.bind(this));
    this.setupOrbitControls();

    this.uiManager.initGame(this.simulation);
    this.uiManager.onRequestPointerLock = () => this.requestPointerLock();
    this.uiManager.onSettingsChangedCallback = (settings) => {
      this.invertCameraPan = settings.invertCameraPan;
      this.invertCameraPitch = settings.invertCameraPitch;
      this.mouseSensitivity = settings.mouseSensitivity;
      this.use3DCommander = settings.use3DCommander;
      if (this.playerSprite) this.playerSprite.visible = !this.use3DCommander;
      if (this.commander3D) this.commander3D.group.visible = this.use3DCommander;
      this.setGraphicsQuality(settings.graphicsQuality || 'medium');
      this.soundManager.setMasterVolume(settings.masterVolume);
      this.soundManager.setMuted(settings.isMuted);
    };

    // Sync initial settings from uiManager
    this.invertCameraPan = this.uiManager.settings.invertCameraPan;
    this.invertCameraPitch = this.uiManager.settings.invertCameraPitch;
    this.mouseSensitivity = this.uiManager.settings.mouseSensitivity;
    this.use3DCommander = this.uiManager.settings.use3DCommander;
    if (this.playerSprite) this.playerSprite.visible = !this.use3DCommander;
    if (this.commander3D) this.commander3D.group.visible = this.use3DCommander;
    this.setGraphicsQuality(this.uiManager.settings.graphicsQuality || 'medium');

    // Start render loop immediately
    this.lastTime = performance.now();
    requestAnimationFrame(this.boundRenderLoop);
  }

  private loadTextures(): void {
    const list = [
      // Commander directional sprites & running/jumping/gliding/attack/ultimate sheets
      'commander_front', 'commander_back', 'commander_left', 'commander_right',
      'commander_run_front', 'commander_run_back', 'commander_run_left', 'commander_run_right',
      'commander_jump_front', 'commander_jump_back', 'commander_jump_left', 'commander_jump_right',
      'commander_glide_front', 'commander_glide_back', 'commander_glide_left', 'commander_glide_right',
      'commander_attack_front', 'commander_attack_back', 'commander_attack_left', 'commander_attack_right',
      'commander_ult_front', 'commander_ult_back', 'commander_ult_left', 'commander_ult_right',
      // Doctor directional sprites & normalized multi-frame sheets
      'doctor_front', 'doctor_back', 'doctor_left', 'doctor_right',
      'doctor_run_front', 'doctor_run_back', 'doctor_run_left', 'doctor_run_right',
      'doctor_jump_front', 'doctor_jump_back', 'doctor_jump_left', 'doctor_jump_right',
      'doctor_glide_front', 'doctor_glide_back', 'doctor_glide_left', 'doctor_glide_right',
      'doctor_attack_front', 'doctor_attack_back', 'doctor_attack_left', 'doctor_attack_right',
      'doctor_rmb_front', 'doctor_rmb_back', 'doctor_rmb_left', 'doctor_rmb_right',
      'doctor_dash_front', 'doctor_dash_back', 'doctor_dash_left', 'doctor_dash_right',
      'doctor_ult_front', 'doctor_ult_back', 'doctor_ult_left', 'doctor_ult_right',
      // Stage 1 Enemies
      'void_crawler', 'toxic_spitter', 'void_wasp', 'void_goliath', 'brood_overseer',
      'enemy_crawler', 'enemy_spitter', 'enemy_elite', 'enemy_boss',
      // Stage 1 Main Boss (Titan Colossus) Sprite Sheets
      'boss_walk_front', 'boss_walk_back', 'boss_walk_left', 'boss_walk_right',
      'boss_laser_front', 'boss_laser_back', 'boss_laser_left', 'boss_laser_right',
      'boss_tentacle_front', 'boss_tentacle_back', 'boss_tentacle_left', 'boss_tentacle_right',
      'boss_elemental_front', 'boss_elemental_back', 'boss_elemental_left', 'boss_elemental_right',
      // Stage 1 Environment
      'overseer_monolith', 'organic_pod_closed', 'organic_pod_opened', 'alien_mushrooms',
      'organic_pod', 'overseer_artifact', 'alien_mushroom', 'crystal_cluster', 'alien_rock', 'alien_flora',
      'tree_crimson_canopy', 'tree_crimson_veins', 'tree_coral',
      'crystal_violet', 'crystal_cyan', 'crystal_amber', 'crystal_crimson',
      'rock_var_1', 'rock_var_2', 'rock_var_3', 'rock_var_4', 'rock_var_5', 'rock_var_6', 'rock_var_7', 'rock_var_8',
      'shoreline_1', 'shoreline_2', 'shoreline_3', 'shoreline_4', 'shoreline_5', 'shoreline_6',
      // Decals & VFX & Graphics Overhaul Textures
      'shadow', 'jet_plume', 'currency_shard', 'loot_orb',
      'caustic_fluid', 'rune_circle', 'energy_flare', 'rock_texture', 'totem_carving', 'void_hive_texture'
    ];

    const cb = `?v=2.1`;
    const enemyAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    for (const name of list) {
      let basePath = `/assets/${name}.png`;
      if (name.startsWith('commander_')) {
        basePath = `/assets/commander/${name}.png`;
      } else if (name.startsWith('doctor_')) {
        basePath = `/assets/doctor/${name}.png`;
      } else if (name === 'tree_crimson_canopy') {
        basePath = `/assets/environment/Alien Crimson Canopy Tree-2.png`;
      } else if (name === 'tree_crimson_veins') {
        basePath = `/assets/environment/Crimson Veins Alien Tree-1.png`;
      } else if (name === 'tree_coral') {
        basePath = `/assets/environment/Bioluminescent Alien Coral Tree-3.png`;
      } else if (name === 'crystal_violet') {
        basePath = `/assets/environment/extracted/rock_crystal_sheet1_1.png`;
      } else if (name === 'crystal_cyan') {
        basePath = `/assets/environment/extracted/rock_crystal_sheet2_1.png`;
      } else if (name === 'crystal_amber') {
        basePath = `/assets/environment/extracted/rock_crystal_sheet3_1.png`;
      } else if (name === 'crystal_crimson') {
        basePath = `/assets/environment/extracted/rock_crystal_sheet3_2.png`;
      } else if (name.startsWith('rock_var_')) {
        const num = parseInt(name.replace('rock_var_', ''), 10);
        basePath = `/assets/environment/extracted/rock_crystal_sheet1_${num + 1}.png`;
      } else if (name.startsWith('shoreline_')) {
        const num = parseInt(name.replace('shoreline_', ''), 10);
        basePath = `/assets/environment/extracted/shoreline_asset_${num}.png`;
      } else if (name.startsWith('boss_')) {
        basePath = `/assets/stage1_boss/${name}.png`;
      }
      const tex = this.textureLoader.load(basePath + cb);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      if (
        name.startsWith('commander_run_') ||
        name.startsWith('commander_jump_') ||
        name.startsWith('commander_glide_') ||
        name.startsWith('commander_attack_') ||
        name.startsWith('commander_ult_') ||
        name.startsWith('doctor_run_') ||
        name.startsWith('doctor_jump_') ||
        name.startsWith('doctor_glide_') ||
        name.startsWith('doctor_attack_') ||
        name.startsWith('doctor_rmb_') ||
        name.startsWith('doctor_dash_') ||
        name.startsWith('doctor_ult_')
      ) {
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
      } else if (name.startsWith('boss_')) {
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = enemyAniso;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
      } else {
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        if (
          name.startsWith('void_') ||
          name.startsWith('toxic_') ||
          name.startsWith('brood_') ||
          name.startsWith('enemy_')
        ) {
          tex.anisotropy = enemyAniso;
        }
      }
      this.textures[name] = tex;
    }
  }

  public requestPointerLock(): void {
    if (this.isPointerLocked) return;
    const tryFallback = () => {
      try {
        const bp = (document.body as any).requestPointerLock?.();
        if (bp && typeof bp.catch === 'function') {
          bp.catch(() => { });
        }
      } catch (_) { }
    };
    try {
      const p = (this.renderer.domElement as any).requestPointerLock?.();
      if (p && typeof p.catch === 'function') {
        p.catch(() => tryFallback());
      }
    } catch (err) {
      tryFallback();
    }
  }

  public exitPointerLock(): void {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch (err) {
        // Ignore
      }
    }
  }

  private isScreenOpen(id: string): boolean {
    const el = document.getElementById(id);
    return Boolean(el && !el.classList.contains('hidden'));
  }

  private setupOrbitControls(): void {
    // 1. Pointer Lock Event Listener
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = Boolean(document.pointerLockElement);
      document.body.classList.toggle('pointer-locked', this.isPointerLocked);
      this.lastMouseX = null;
      this.lastMouseY = null;
    });

    document.addEventListener('pointerlockerror', () => {
      // Browser pointer lock pending or rejected
    });

    // 2. Click or pointer down on canvas or game area to lock cursor (instant on click/down)
    const handleTryLock = (e: MouseEvent | PointerEvent) => {
      this.soundManager.unlock();
      if (this.isEditorMode || this.simulation.state.isPaused) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.interactive, button, .buff-card, .screen-modal, input, select, #dev-editor-root, #dev-gameplay-debugger, #dev-perf-overlay, #dev-playtest-bar')) return;
      if (this.simulation.state.isPausedForBuffChoice || this.simulation.state.isGameOver || this.simulation.state.isStageCleared) return;

      const heroSelectOpen = this.isScreenOpen('screen-hero-select');
      const mainMenuOpen = this.isScreenOpen('screen-main-menu');
      const settingsOpen = this.isScreenOpen('screen-settings');
      const devDashOpen = this.isScreenOpen('screen-dev-dashboard');
      if (heroSelectOpen || mainMenuOpen || settingsOpen || devDashOpen || !this.simulation.state.isGameStarted) return;

      this.requestPointerLock();
    };

    window.addEventListener('mousedown', handleTryLock);
    window.addEventListener('pointerdown', handleTryLock);
    this.renderer.domElement.addEventListener('click', handleTryLock);

    // 3. Direct Mouse Movement Camera Steering (No click-and-drag required!)
    window.addEventListener('mousemove', (e) => {
      if (this.isEditorMode || this.simulation.state.isPaused) return;
      if (this.isDevModeSession && !this.isPointerLocked) {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('#dev-editor-root, #dev-gameplay-debugger, #dev-perf-overlay, #dev-playtest-bar, .screen-modal, button, input, select')) {
          return;
        }
      }
      // Don't steer camera when navigating menus or paused for tactical rank up
      if (this.simulation.state.isPausedForBuffChoice) return;
      const heroSelectOpen = this.isScreenOpen('screen-hero-select');
      const mainMenuOpen = this.isScreenOpen('screen-main-menu');
      const settingsOpen = this.isScreenOpen('screen-settings');
      const devDashOpen = this.isScreenOpen('screen-dev-dashboard');
      if (heroSelectOpen || mainMenuOpen || settingsOpen || devDashOpen) return;

      let dx = 0;
      let dy = 0;

      if (this.isPointerLocked) {
        dx = e.movementX || 0;
        dy = e.movementY || 0;
      } else {
        // If movementX is provided by browser even when unlocked, use it to prevent screen edge stopping!
        if (e.movementX !== undefined && e.movementX !== 0) {
          dx = e.movementX;
          dy = e.movementY || 0;
        } else if (this.lastMouseX !== null && this.lastMouseY !== null) {
          dx = e.clientX - this.lastMouseX;
          dy = e.clientY - this.lastMouseY;
        }
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }

      // Filter single-frame pointer lock acquisition jumps
      if (Math.abs(dx) > 300) dx = 0;
      if (Math.abs(dy) > 300) dy = 0;

      if (dx !== 0 || dy !== 0) {
        // PokéBonk camera steering with configurable sensitivity and inversion
        const panMult = (this.invertCameraPan ? 0.0028 : -0.0028) * this.mouseSensitivity;
        this.targetYaw += dx * panMult;

        const pitchMult = (this.invertCameraPitch ? -0.0022 : 0.0022) * this.mouseSensitivity;
        this.targetPitch = Math.max(0.10, Math.min(1.15, this.targetPitch + dy * pitchMult));
      }

      // Update Mouse Raycaster against 3D Terrain
      if (this.isPointerLocked) {
        this.updateMouseRaycast(window.innerWidth / 2, window.innerHeight / 2);
      } else {
        this.updateMouseRaycast(e.clientX, e.clientY);
      }
    });

    // 4. Mouse Wheel Zoom Distance
    window.addEventListener('wheel', (e) => {
      if (this.isEditorMode || this.simulation.state.isPaused) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.interactive, .screen-modal, #dev-gameplay-debugger, #dev-perf-overlay')) return;
      this.targetDistance = Math.max(220, Math.min(860, this.targetDistance + Math.sign(e.deltaY) * 36));
    }, { passive: true });
  }

  private updateMouseRaycast(screenX: number, screenY: number): void {
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const terrain = this.simulation.state.terrain;

    // Fast analytical ray-march against mathematical heightfield (0 triangle checks!)
    if (dir.y < -0.01) {
      const maxDist = 2200;
      const steps = 24;
      const stepSize = maxDist / steps;
      let prevT = 0;

      for (let i = 1; i <= steps; i++) {
        const t = i * stepSize;
        const rx = origin.x + dir.x * t;
        const ry = origin.y + dir.y * t;
        const rz = origin.z + dir.z * t;
        const h = terrain.calculateHeight(rx, rz);

        if (ry <= h) {
          // One binary-refinement midpoint step for sub-unit accuracy
          const midT = (prevT + t) * 0.5;
          const hitX = origin.x + dir.x * midT;
          const hitZ = origin.z + dir.z * midT;
          const hitY = terrain.calculateHeight(hitX, hitZ);

          this.inputManager.mouseWorldPos.x = hitX;
          this.inputManager.mouseWorldPos.y = hitZ;
          this.inputManager.mouseWorldPos3D = { x: hitX, y: hitZ, z: hitY };
          return;
        }
        prevT = t;
      }
    }

    // Fallback to plane at player's current vertical elevation
    const pZ = this.simulation.state.player.z + 26;
    const elevationPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -pZ);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(elevationPlane, point);

    if (point) {
      this.inputManager.mouseWorldPos.x = point.x;
      this.inputManager.mouseWorldPos.y = point.z;
      this.inputManager.mouseWorldPos3D = {
        x: point.x,
        y: point.z,
        z: point.y
      };
    }
  }

  private createSkyElements(): void {
    const cx = this.simulation.state.worldWidth / 2;
    const cy = this.simulation.state.worldHeight / 2;

    // 0b. Stage 1 Colossal Stone Arches, Ring, Moons & Horizon Ridges (legacy procedural scenery hidden by default)
    this.stage1SceneryGroup = new THREE.Group();
    this.stage1SceneryGroup.visible = false;
    this.scene.add(this.stage1SceneryGroup);

    // Giant Glowing 3D Celestial Planetary Ring
    const ringGeo = new THREE.RingGeometry(2600, 4200, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const skyRing = new THREE.Mesh(ringGeo, ringMat);
    skyRing.rotation.x = Math.PI / 3.4;
    skyRing.rotation.y = Math.PI / 5.5;
    skyRing.position.set(cx, 1600, cy);
    this.stage1SceneryGroup.add(skyRing);

    const stoneArchMat = new THREE.MeshLambertMaterial({
      color: 0x3b506b,
      flatShading: true
    });

    // Arch 1: The Great Summit Overseer Arch (towers dramatically behind Upper Summit framing the Monolith)
    const northArchGeo = new THREE.TorusGeometry(580, 48, 14, 32, Math.PI * 1.15);
    const northArch = new THREE.Mesh(northArchGeo, stoneArchMat);
    northArch.position.set(1380, 615 + 80, 850);
    northArch.rotation.x = Math.PI / 2 + 0.12;
    northArch.rotation.y = 0.15;
    this.stage1SceneryGroup.add(northArch);

    // Arch 3: Distant Ancient Ring Monument on the Eastern Ridge
    const ridgeArchGeo = new THREE.TorusGeometry(480, 42, 12, 28, Math.PI * 1.05);
    const ridgeArch = new THREE.Mesh(ridgeArchGeo, stoneArchMat);
    ridgeArch.position.set(3050, 280, 1750);
    ridgeArch.rotation.x = Math.PI / 2 - 0.25;
    ridgeArch.rotation.y = 0.45;
    this.stage1SceneryGroup.add(ridgeArch);

    // 0d. Distant Mountain Silhouette Ridges on the far horizon (lightweight atmospheric depth, no crater box!)
    const vistaMat = new THREE.MeshLambertMaterial({
      color: 0x47627d,
      flatShading: true
    });

    const vistaRidges = [
      { x: cx - 1800, y: -20, z: cy + 2400, r: 850, h: 420 }, // Far South-West Mountain Massif
      { x: cx + 1600, y: -30, z: cy + 2600, r: 920, h: 480 }, // Far South-East Distant Peaks
      { x: cx + 2400, y: -10, z: cy - 1400, r: 780, h: 540 }, // Far North-East Distant Spire Ridge
      { x: cx - 2200, y: -20, z: cy - 1800, r: 840, h: 620 }  // Far North-West Silhouette
    ];

    for (const v of vistaRidges) {
      const geo = new THREE.ConeGeometry(v.r, v.h, 7);
      const mesh = new THREE.Mesh(geo, vistaMat);
      mesh.position.set(v.x, v.y + v.h * 0.45, v.z);
      mesh.scale.set(1.4, 1.0, 0.7);
      mesh.rotation.y = Math.random() * Math.PI;
      this.stage1SceneryGroup.add(mesh);
    }

    // 1. Distant Celestial Moons
    const moonGeo = new THREE.SphereGeometry(220, 24, 24);
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xc8d6e5,
      emissive: 0x94a3b8,
      emissiveIntensity: 0.6,
      roughness: 0.7,
      metalness: 0.1
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(cx - 1500, 1600, cy - 2500);
    this.stage1SceneryGroup.add(moon);

    const smallMoonGeo = new THREE.SphereGeometry(120, 20, 20);
    const smallMoonMat = new THREE.MeshStandardMaterial({
      color: 0xd8b4fe,
      emissive: 0xa855f7,
      emissiveIntensity: 0.8,
      roughness: 0.6,
      metalness: 0.2
    });
    const smallMoon = new THREE.Mesh(smallMoonGeo, smallMoonMat);
    smallMoon.position.set(cx - 900, 1750, cy - 2300);
    this.stage1SceneryGroup.add(smallMoon);
  }

  private createElectricSwordModel(): THREE.Group {
    return this.vfx.createElectricSwordModel();
  }

  private createOrbitingSwordVisual(): {
    group: THREE.Group;
    swordModel: THREE.Group;
    trailLine: THREE.Line;
    trailPosAttr: THREE.BufferAttribute;
    trailColAttr: THREE.BufferAttribute;
    branchLines: THREE.LineSegments;
    branchPosAttr: THREE.BufferAttribute;
    branchColAttr: THREE.BufferAttribute;
  } {
    const group = new THREE.Group();

    const swordModel = this.createElectricSwordModel();
    swordModel.scale.setScalar(2.0);
    group.add(swordModel);

    // Dynamic Violet Lightning Motion Trail
    const trailPoints = 24;
    const trailPosArr = new Float32Array(trailPoints * 3);
    const trailColArr = new Float32Array(trailPoints * 3);
    const trailGeo = new THREE.BufferGeometry();
    const trailPosAttr = new THREE.BufferAttribute(trailPosArr, 3);
    const trailColAttr = new THREE.BufferAttribute(trailColArr, 3);
    trailGeo.setAttribute('position', trailPosAttr);
    trailGeo.setAttribute('color', trailColAttr);
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    group.add(trailLine);

    // Branching electrical arcs
    const branchPoints = 12; // 6 branch lines
    const branchPosArr = new Float32Array(branchPoints * 3);
    const branchColArr = new Float32Array(branchPoints * 3);
    const branchGeo = new THREE.BufferGeometry();
    const branchPosAttr = new THREE.BufferAttribute(branchPosArr, 3);
    const branchColAttr = new THREE.BufferAttribute(branchColArr, 3);
    branchGeo.setAttribute('position', branchPosAttr);
    branchGeo.setAttribute('color', branchColAttr);
    const branchMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const branchLines = new THREE.LineSegments(branchGeo, branchMat);
    group.add(branchLines);

    this.orbitingBladeGroup.add(group);

    return {
      group,
      swordModel,
      trailLine,
      trailPosAttr,
      trailColAttr,
      branchLines,
      branchPosAttr,
      branchColAttr
    };
  }

  private createArtifact(): THREE.Group {
    const art = this.simulation.state.artifact;
    const elev = this.simulation.state.terrain.getElevation(art.pos.x, art.pos.y).height;
    const grp = new THREE.Group();
    grp.position.set(art.pos.x, elev + (art.zOffset ?? 0), art.pos.y);
    grp.rotation.y = art.rotationY ?? 0;
    grp.scale.setScalar(art.scale ?? 1);

    // Stage 1 Overseer Monolith Obelisk Sprite
    const artMat = new THREE.SpriteMaterial({
      map: this.textures['overseer_monolith'] || this.textures['overseer_artifact'],
      toneMapped: false
    });
    const spr = new THREE.Sprite(artMat);
    spr.scale.set(96, 128, 1);
    spr.position.set(0, 64, 0); // Foot anchored on Sanctuary Mesa
    grp.add(spr);

    // 2 Counter-rotating 3D Levitation Rings around Monolith
    const torusGeo1 = new THREE.TorusGeometry(36, 2.2, 16, 48);
    const torusMat1 = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.8,
      metalness: 0.85,
      roughness: 0.2
    });
    this.artifactRing1 = new THREE.Mesh(torusGeo1, torusMat1);
    this.artifactRing1.position.set(0, 56, 0);
    this.artifactRing1.rotation.x = Math.PI / 4;
    grp.add(this.artifactRing1);

    const torusGeo2 = new THREE.TorusGeometry(44, 1.8, 16, 48);
    const torusMat2 = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.6,
      metalness: 0.9,
      roughness: 0.15
    });
    this.artifactRing2 = new THREE.Mesh(torusGeo2, torusMat2);
    this.artifactRing2.position.set(0, 56, 0);
    this.artifactRing2.rotation.y = Math.PI / 3;
    grp.add(this.artifactRing2);

    // Textured Ancient Stone Dais Base
    const daisGeo = new THREE.CylinderGeometry(44, 52, 8, 32);
    const daisMat = new THREE.MeshStandardMaterial({
      map: this.textures['rock_texture'],
      bumpMap: this.textures['rock_texture'],
      bumpScale: 0.85,
      roughness: 0.75,
      metalness: 0.25
    });
    const daisMesh = new THREE.Mesh(daisGeo, daisMat);
    daisMesh.position.y = 4;
    grp.add(daisMesh);

    // Ground Runic Decal Circle with actual ancient runic graphics
    const runeDecalGeo = new THREE.PlaneGeometry(140, 140);
    const runeDecalMat = new THREE.MeshBasicMaterial({
      map: this.textures['rune_circle'],
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending
    });
    const runeDecal = new THREE.Mesh(runeDecalGeo, runeDecalMat);
    runeDecal.rotation.x = -Math.PI / 2;
    runeDecal.position.y = 8.3;
    grp.add(runeDecal);

    // Ground Runic Ring on Sanctuary Mesa
    const runeGeo = new THREE.RingGeometry(52, 68, 48);
    const runeMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55
    });
    const runeMesh = new THREE.Mesh(runeGeo, runeMat);
    runeMesh.rotation.x = -Math.PI / 2;
    runeMesh.position.y = 0.3;
    grp.add(runeMesh);

    // Vertical Golden Beacon Beam (Pierces into the clouds like the RoR2 Teleporter)
    const beamGeo = new THREE.CylinderGeometry(10, 24, 2400, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    this.artifactBeacon = new THREE.Mesh(beamGeo, beamMat);
    this.artifactBeacon.position.set(0, 1200, 0);
    grp.add(this.artifactBeacon);

    this.tagEditorRef(grp, 'teleporter', 'overseer_teleporter');
    return grp;
  }

  private tagEditorRef(root: THREE.Object3D, category: string, id: string): void {
    root.userData.editorRef = { category, id };
    root.traverse((child) => {
      child.userData.editorRef = { category, id };
    });
  }

  private syncArtifactTransform(): void {
    if (!this.artifactGroup) return;
    const art = this.simulation.state.artifact;
    const elev = this.simulation.state.terrain.getElevation(art.pos.x, art.pos.y).height;
    this.artifactGroup.position.set(art.pos.x, elev + (art.zOffset ?? 0), art.pos.y);
    this.artifactGroup.rotation.y = art.rotationY ?? 0;
    this.artifactGroup.scale.setScalar(art.scale ?? 1);
  }

  private createPods(): void {
    for (const entry of this.podMap.values()) {
      if (entry.group) {
        entry.group.visible = false;
        this.scene.remove(entry.group);
      }
    }
    this.podMap.clear();

    const pods = this.simulation.state.pods;
    const closedTex = this.textures['organic_pod_closed'] || this.textures['organic_pod'];
    const openedTex = this.textures['organic_pod_opened'] || closedTex;

    // Initialize shared reusable pod materials once (zero per-chest shader allocations)
    if (!this.sharedPodClosedMat && closedTex && openedTex) {
      this.renderer.initTexture(closedTex);
      this.renderer.initTexture(openedTex);

      this.sharedPodClosedMat = new THREE.MeshStandardMaterial({
        map: closedTex,
        toneMapped: false,
        transparent: true,
        opacity: 1.0,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
        roughness: 0.50,
        metalness: 0.20
      });

      this.sharedPodOpenedMat = new THREE.MeshStandardMaterial({
        map: openedTex,
        toneMapped: false,
        transparent: true,
        opacity: 1.0,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
        roughness: 0.50,
        metalness: 0.20
      });

      this.sharedPodCoreMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.85
      });

      this.sharedPodShadowMat = new THREE.MeshBasicMaterial({
        map: this.textures['shadow'],
        transparent: true,
        opacity: 0.82,
        depthWrite: false
      });
    }

    const closedMat = this.sharedPodClosedMat || new THREE.MeshBasicMaterial({ color: 0x84cc16 });
    const openedMat = this.sharedPodOpenedMat || new THREE.MeshBasicMaterial({ color: 0x64748b });
    const coreMat = this.sharedPodCoreMat || new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const shadowMat = this.sharedPodShadowMat || new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7 });

    for (let i = 0; i < pods.length; i++) {
      const pod = pods[i];
      const elevation = this.simulation.state.terrain.getElevation(pod.pos.x, pod.pos.y).height;

      const podGroup = new THREE.Group();
      podGroup.position.set(pod.pos.x, elevation + (pod.zOffset ?? 0), pod.pos.y);
      podGroup.rotation.y = pod.rotationY ?? 0;
      podGroup.scale.setScalar(pod.scale ?? 1);

      // 1. Closed State Sub-Group (uses shared pre-compiled standard material)
      const closedGroup = new THREE.Group();
      const frontPlaneClosed = new THREE.Mesh(this.sharedPodPlaneGeo, closedMat);
      frontPlaneClosed.position.set(0, 56, 0);
      closedGroup.add(frontPlaneClosed);

      const crossPlaneClosed = new THREE.Mesh(this.sharedPodPlaneGeo, closedMat);
      crossPlaneClosed.rotation.y = Math.PI / 2;
      crossPlaneClosed.position.set(0, 56, 0);
      closedGroup.add(crossPlaneClosed);
      podGroup.add(closedGroup);

      // 2. Opened State Sub-Group (uses shared pre-compiled standard material)
      const openedGroup = new THREE.Group();
      const frontPlaneOpened = new THREE.Mesh(this.sharedPodPlaneGeo, openedMat);
      frontPlaneOpened.position.set(0, 56, 0);
      openedGroup.add(frontPlaneOpened);

      const crossPlaneOpened = new THREE.Mesh(this.sharedPodPlaneGeo, openedMat);
      crossPlaneOpened.rotation.y = Math.PI / 2;
      crossPlaneOpened.position.set(0, 56, 0);
      openedGroup.add(crossPlaneOpened);
      podGroup.add(openedGroup);

      // Initial visual visibility (both sub-groups pre-warmed on GPU)
      closedGroup.visible = !pod.isOpened;
      openedGroup.visible = pod.isOpened;

      // 3. Bioluminescent Spore Core Mesh (Shared basic material)
      const coreMesh = new THREE.Mesh(this.sharedPodCoreGeo, coreMat);
      coreMesh.position.set(0, 42, 0);
      podGroup.add(coreMesh);

      // 4. Contact Ground Shadow (Shared basic material)
      const shadow = new THREE.Mesh(this.sharedPodShadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.2, 0);
      podGroup.add(shadow);

      // 5. Interaction Radius Ring (Shared ring material)
      const ring = new THREE.Mesh(this.sharedPodRingGeo, this.sharedPodRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.3, 0);
      ring.visible = !pod.isOpened;
      podGroup.add(ring);

      this.tagEditorRef(podGroup, 'pod', pod.id);
      this.scene.add(podGroup);
      this.podMap.set(pod.id, {
        group: podGroup,
        closedGroup,
        openedGroup,
        frontPlaneClosed,
        frontPlaneOpened,
        crossPlaneClosed,
        crossPlaneOpened,
        frontPlane: frontPlaneClosed,
        crossPlane: crossPlaneClosed,
        shadow,
        ring,
        coreMesh,
        isOpenedVisual: pod.isOpened,
        isClonedForDissolve: false
      });
    }
  }

  private syncPods(): void {
    const pods = this.simulation.state.pods;
    const now = performance.now();
    const camX = this.cameraFocus.x;
    const camZ = this.cameraFocus.z;

    // Zero-allocation removal: only perform set checks if a pod was actually destroyed
    if (this.podMap.size !== pods.length) {
      const currentPodIds = new Set(pods.map(p => p.id));
      for (const [id, entry] of this.podMap.entries()) {
        if (!currentPodIds.has(id)) {
          if (entry.group) {
            entry.group.visible = false;
            this.scene.remove(entry.group);
            // Dispose only cloned dissolve materials
            if (entry.isClonedForDissolve) {
              (entry.frontPlaneOpened.material as THREE.Material)?.dispose();
              if (entry.crossPlaneOpened) (entry.crossPlaneOpened.material as THREE.Material)?.dispose();
              if (entry.coreMesh) (entry.coreMesh.material as THREE.Material)?.dispose();
              (entry.shadow.material as THREE.Material)?.dispose();
            }
          }
          this.podMap.delete(id);
        }
      }
    }

    for (let i = 0; i < pods.length; i++) {
      const pod = pods[i];
      const entry = this.podMap.get(pod.id);
      if (!entry) continue;

      // Distance culling: skip rotation & animation for distant off-screen chests (>1500 units)
      const dx = pod.pos.x - camX;
      const dy = pod.pos.y - camZ;
      if (dx * dx + dy * dy > 1500 * 1500) {
        continue;
      }

      // Keep both sub-groups aligned with camera orientation
      entry.closedGroup.rotation.y = this.cameraYaw;
      entry.openedGroup.rotation.y = this.cameraYaw;

      if (pod.isOpened) {
        if (!entry.isOpenedVisual) {
          // Zero-latency visual switch: toggles group visibility without shader compilation
          entry.closedGroup.visible = false;
          entry.openedGroup.visible = true;
          entry.ring.visible = false;
          if (entry.beacon) entry.beacon.visible = false;
          entry.isOpenedVisual = true;
        }

        // Biological fade-out strictly in place at world coordinates
        if (pod.isDissolving && pod.dissolveTimer !== undefined) {
          const progress = Math.max(0, Math.min(1.0, pod.dissolveTimer / 1.0));
          if (progress <= 0.01) {
            entry.group.visible = false;
          } else {
            // Clone materials on-demand only for this specific dissolving chest
            if (!entry.isClonedForDissolve && this.sharedPodOpenedMat && this.sharedPodCoreMat && this.sharedPodShadowMat) {
              entry.isClonedForDissolve = true;
              entry.frontPlaneOpened.material = this.sharedPodOpenedMat.clone();
              if (entry.crossPlaneOpened) entry.crossPlaneOpened.material = this.sharedPodOpenedMat.clone();
              if (entry.coreMesh) entry.coreMesh.material = this.sharedPodCoreMat.clone();
              if (entry.shadow) entry.shadow.material = this.sharedPodShadowMat.clone();
            }

            if (entry.isClonedForDissolve) {
              (entry.frontPlaneOpened.material as THREE.MeshStandardMaterial).opacity = progress;
              if (entry.crossPlaneOpened) {
                (entry.crossPlaneOpened.material as THREE.MeshStandardMaterial).opacity = progress;
              }
              if (entry.coreMesh) (entry.coreMesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * progress;
              if (entry.shadow) (entry.shadow.material as THREE.MeshBasicMaterial).opacity = 0.82 * progress;
            }
          }
        }
      } else {
        if (entry.isOpenedVisual) {
          entry.closedGroup.visible = true;
          entry.openedGroup.visible = false;
          entry.ring.visible = true;
          entry.isOpenedVisual = false;
        }
        entry.ring.visible = true;
        if (entry.coreMesh) {
          const corePulse = 0.9 + 0.18 * Math.sin(now * 0.004 + i);
          entry.coreMesh.scale.set(corePulse, corePulse, corePulse);
        }
      }
    }
  }

  private createWorldEvents(): void {
    for (const entry of this.worldEventMap.values()) {
      this.scene.remove(entry.group);
      if (entry.dashPlatformGroup) this.scene.remove(entry.dashPlatformGroup);
      if (entry.payloadBeaconGroup) this.scene.remove(entry.payloadBeaconGroup);
    }
    this.worldEventMap.clear();

    const events = this.simulation.state.worldEvents;
    for (const ev of events) {
      const elevation = this.simulation.state.terrain.getElevation(ev.pos.x, ev.pos.y).height;
      const grp = new THREE.Group();
      grp.position.set(ev.pos.x, elevation + (ev.zOffset ?? 0), ev.pos.y);
      grp.rotation.y = ev.rotationY ?? 0;
      grp.scale.setScalar(ev.scale ?? 1);

      let entry: WorldEventRenderEntry;

      if (ev.type === 'primal_totem') {
        // 1. Primal Bio-Resonance Totem (Basic Skill Altering)
        const baseGeo = new THREE.CylinderGeometry(14, 18, 6, 8);
        const baseMat = new THREE.MeshStandardMaterial({
          map: this.textures['rock_texture'],
          bumpMap: this.textures['rock_texture'],
          bumpScale: 0.8,
          roughness: 0.75,
          metalness: 0.25
        });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.position.y = 3;
        grp.add(baseMesh);

        // Ground ancient runic glyph projection
        const runeDecalGeo = new THREE.PlaneGeometry(160, 160);
        const runeDecalMat = new THREE.MeshBasicMaterial({
          map: this.textures['rune_circle'],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending
        });
        const runeDecal = new THREE.Mesh(runeDecalGeo, runeDecalMat);
        runeDecal.rotation.x = -Math.PI / 2;
        runeDecal.position.y = 0.35;
        grp.add(runeDecal);

        const totemGeo = new THREE.CylinderGeometry(5, 12, 64, 8);
        const totemMat = new THREE.MeshStandardMaterial({
          map: this.textures['totem_carving'],
          emissiveMap: this.textures['totem_carving'],
          emissive: 0x06b6d4,
          emissiveIntensity: 1.6,
          roughness: 0.3,
          metalness: 0.7
        });
        const totemMesh = new THREE.Mesh(totemGeo, totemMat);
        totemMesh.position.y = 35;
        grp.add(totemMesh);

        const crownGeo = new THREE.OctahedronGeometry(9);
        const crownMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 2.0,
          roughness: 0.1,
          metalness: 0.95
        });
        const crownMesh = new THREE.Mesh(crownGeo, crownMat);
        crownMesh.position.y = 74;
        grp.add(crownMesh);

        const ringGeo = new THREE.RingGeometry(ev.radius - 3, ev.radius + 3, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.65
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.3;
        grp.add(ringMesh);

        const innerGeo = new THREE.RingGeometry(24, 28, 36);
        const innerMat = new THREE.MeshBasicMaterial({
          color: 0x06b6d4,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5
        });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        innerMesh.rotation.x = -Math.PI / 2;
        innerMesh.position.y = 0.35;
        grp.add(innerMesh);

        entry = {
          id: ev.id,
          group: grp,
          ringMesh,
          innerRing: innerMesh,
          coreMesh: totemMesh,
          floatingShard: crownMesh
        };
      } else if (ev.type === 'secondary_totem') {
        // 2. Kinetic Blade Conduit (Secondary Skill Altering) - Amber/Gold
        const baseGeo = new THREE.CylinderGeometry(14, 18, 6, 8);
        const baseMat = new THREE.MeshStandardMaterial({
          map: this.textures['rock_texture'],
          roughness: 0.75,
          metalness: 0.35
        });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.position.y = 3;
        grp.add(baseMesh);

        const runeDecalGeo = new THREE.PlaneGeometry(160, 160);
        const runeDecalMat = new THREE.MeshBasicMaterial({
          map: this.textures['rune_circle'],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          color: 0xf59e0b,
          blending: THREE.AdditiveBlending
        });
        const runeDecal = new THREE.Mesh(runeDecalGeo, runeDecalMat);
        runeDecal.rotation.x = -Math.PI / 2;
        runeDecal.position.y = 0.35;
        grp.add(runeDecal);

        const bladeGeo = new THREE.CylinderGeometry(2, 6, 52, 6);
        const bladeMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xd97706,
          emissiveIntensity: 1.6,
          roughness: 0.25,
          metalness: 0.85
        });
        const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
        blade1.position.set(-6, 28, 0);
        blade1.rotation.z = -0.15;
        grp.add(blade1);

        const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
        blade2.position.set(6, 28, 0);
        blade2.rotation.z = 0.15;
        grp.add(blade2);

        const shardGeo = new THREE.OctahedronGeometry(8);
        const shardMat = new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0xf59e0b,
          emissiveIntensity: 2.2,
          roughness: 0.1,
          metalness: 0.95
        });
        const shardMesh = new THREE.Mesh(shardGeo, shardMat);
        shardMesh.position.y = 66;
        grp.add(shardMesh);

        const ringGeo = new THREE.RingGeometry(ev.radius - 3, ev.radius + 3, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.65
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.3;
        grp.add(ringMesh);

        entry = {
          id: ev.id,
          group: grp,
          ringMesh,
          coreMesh: blade1,
          floatingShard: shardMesh
        };
      } else if (ev.type === 'dash_totem') {
        // 3. Phase Thruster Pylon (Dash Skill Altering) - Violet-Blue
        const baseGeo = new THREE.CylinderGeometry(14, 18, 6, 8);
        const baseMat = new THREE.MeshStandardMaterial({
          map: this.textures['rock_texture'],
          roughness: 0.75,
          metalness: 0.4
        });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.position.y = 3;
        grp.add(baseMesh);

        const runeDecalGeo = new THREE.PlaneGeometry(160, 160);
        const runeDecalMat = new THREE.MeshBasicMaterial({
          map: this.textures['rune_circle'],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          color: 0x818cf8,
          blending: THREE.AdditiveBlending
        });
        const runeDecal = new THREE.Mesh(runeDecalGeo, runeDecalMat);
        runeDecal.rotation.x = -Math.PI / 2;
        runeDecal.position.y = 0.35;
        grp.add(runeDecal);

        const pylonGeo = new THREE.CylinderGeometry(6, 11, 54, 8);
        const pylonMat = new THREE.MeshStandardMaterial({
          color: 0x6366f1,
          emissive: 0x4f46e5,
          emissiveIntensity: 1.5,
          roughness: 0.3,
          metalness: 0.8
        });
        const pylonMesh = new THREE.Mesh(pylonGeo, pylonMat);
        pylonMesh.position.y = 30;
        grp.add(pylonMesh);

        const crystalGeo = new THREE.DodecahedronGeometry(8);
        const crystalMat = new THREE.MeshStandardMaterial({
          color: 0xa5b4fc,
          emissive: 0x818cf8,
          emissiveIntensity: 2.0,
          roughness: 0.1,
          metalness: 0.95
        });
        const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
        crystalMesh.position.y = 66;
        grp.add(crystalMesh);

        const ringGeo = new THREE.RingGeometry(ev.radius - 3, ev.radius + 3, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x818cf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.65
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.3;
        grp.add(ringMesh);

        // 5 Jump-High Phase Platforms (Hidden until event starts!)
        const dashPlatformGroup = new THREE.Group();
        dashPlatformGroup.visible = false;
        const dashPlatformMeshes: NonNullable<WorldEventRenderEntry['dashPlatformMeshes']> = [];

        const padGeo = new THREE.CylinderGeometry(35, 32, 3.5, 32);
        const padRingGeo = new THREE.RingGeometry(32.5, 36, 36);

        for (let pIdx = 0; pIdx < 5; pIdx++) {
          const pGrp = new THREE.Group();
          const padMat = new THREE.MeshStandardMaterial({
            color: pIdx === 4 ? 0x38bdf8 : 0x6366f1,
            emissive: pIdx === 4 ? 0x0284c7 : 0x4f46e5,
            emissiveIntensity: 1.4,
            roughness: 0.2,
            metalness: 0.85,
            transparent: true,
            opacity: 0.88
          });
          const padMesh = new THREE.Mesh(padGeo, padMat);
          padMesh.position.y = -1.75;
          pGrp.add(padMesh);

          const pRingMat = new THREE.MeshBasicMaterial({
            color: pIdx === 4 ? 0x7dd3fc : 0xa5b4fc,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9
          });
          const pRingMesh = new THREE.Mesh(padRingGeo, pRingMat);
          pRingMesh.rotation.x = -Math.PI / 2;
          pRingMesh.position.y = 0.15;
          pGrp.add(pRingMesh);

          let summitCore: THREE.Mesh | undefined;
          let summitBeam: THREE.Mesh | undefined;
          if (pIdx === 4) {
            const sCoreGeo = new THREE.OctahedronGeometry(11, 0);
            const sCoreMat = new THREE.MeshStandardMaterial({
              color: 0x38bdf8,
              emissive: 0x0ea5e9,
              emissiveIntensity: 2.5,
              roughness: 0.1,
              metalness: 0.95
            });
            summitCore = new THREE.Mesh(sCoreGeo, sCoreMat);
            summitCore.position.y = 22;
            pGrp.add(summitCore);

            const sBeamGeo = new THREE.CylinderGeometry(3.5, 8, 220, 16, 1, true);
            const sBeamMat = new THREE.MeshBasicMaterial({
              color: 0x38bdf8,
              transparent: true,
              opacity: 0.45,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
              depthWrite: false
            });
            summitBeam = new THREE.Mesh(sBeamGeo, sBeamMat);
            summitBeam.position.y = 110;
            pGrp.add(summitBeam);
          }

          dashPlatformGroup.add(pGrp);
          dashPlatformMeshes.push({
            group: pGrp,
            padMesh,
            ringMesh: pRingMesh,
            summitCore,
            summitBeam
          });
        }
        this.scene.add(dashPlatformGroup);

        entry = {
          id: ev.id,
          group: grp,
          ringMesh,
          coreMesh: pylonMesh,
          floatingShard: crystalMesh,
          dashPlatformGroup,
          dashPlatformMeshes
        };
      } else if (ev.type === 'orbital_uplink') {
        // 2. Orbital Uplink Beacon (Ultimate Skill Altering)
        const padGeo = new THREE.CylinderGeometry(26, 30, 4, 32);
        const padMat = new THREE.MeshStandardMaterial({
          map: this.textures['rock_texture'],
          bumpMap: this.textures['rock_texture'],
          bumpScale: 0.85,
          roughness: 0.65,
          metalness: 0.45
        });
        const padMesh = new THREE.Mesh(padGeo, padMat);
        padMesh.position.y = 2;
        grp.add(padMesh);

        // Ground ancient runic glyph projection
        const runeDecalGeo = new THREE.PlaneGeometry(160, 160);
        const runeDecalMat = new THREE.MeshBasicMaterial({
          map: this.textures['rune_circle'],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          color: 0xfbbf24,
          blending: THREE.AdditiveBlending
        });
        const runeDecal = new THREE.Mesh(runeDecalGeo, runeDecalMat);
        runeDecal.rotation.x = -Math.PI / 2;
        runeDecal.position.y = 0.35;
        grp.add(runeDecal);

        const dishGeo = new THREE.CylinderGeometry(6, 14, 38, 12);
        const dishMat = new THREE.MeshStandardMaterial({
          map: this.textures['totem_carving'],
          color: 0xf59e0b,
          emissive: 0xd97706,
          emissiveIntensity: 1.3,
          metalness: 0.85,
          roughness: 0.25
        });
        const dishMesh = new THREE.Mesh(dishGeo, dishMat);
        dishMesh.position.y = 21;
        grp.add(dishMesh);

        const ringGeo = new THREE.RingGeometry(ev.radius - 3, ev.radius + 3, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.3;
        grp.add(ringMesh);

        // Ultimate Event: Collectible Quantum Core & Huge Vertical Light Pillar (Hidden until event starts!)
        const payloadBeaconGroup = new THREE.Group();
        payloadBeaconGroup.visible = false;

        const payloadBeamGroup = new THREE.Group();
        const innerBeamGeo = new THREE.CylinderGeometry(7, 11, 2400, 20, 1, true);
        const innerBeamMat = new THREE.MeshBasicMaterial({
          color: 0xfef08a,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const payloadInnerBeam = new THREE.Mesh(innerBeamGeo, innerBeamMat);
        payloadInnerBeam.position.y = 1200;
        payloadBeamGroup.add(payloadInnerBeam);

        const outerBeamGeo = new THREE.CylinderGeometry(24, 34, 2400, 24, 1, true);
        const outerBeamMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.38,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const payloadOuterBeam = new THREE.Mesh(outerBeamGeo, outerBeamMat);
        payloadOuterBeam.position.y = 1200;
        payloadBeamGroup.add(payloadOuterBeam);

        const pRingGeo = new THREE.RingGeometry(36, 46, 36);
        const pRingMat = new THREE.MeshBasicMaterial({
          color: 0xfbbf24,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending
        });
        const payloadRingMesh = new THREE.Mesh(pRingGeo, pRingMat);
        payloadRingMesh.rotation.x = -Math.PI / 2;
        payloadRingMesh.position.y = 0.6;
        payloadBeamGroup.add(payloadRingMesh);

        payloadBeaconGroup.add(payloadBeamGroup);

        const coreGeo = new THREE.OctahedronGeometry(13, 1);
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0xfef08a,
          emissive: 0xf59e0b,
          emissiveIntensity: 2.6,
          roughness: 0.1,
          metalness: 0.9
        });
        const payloadCoreMesh = new THREE.Mesh(coreGeo, coreMat);
        payloadBeaconGroup.add(payloadCoreMesh);

        this.scene.add(payloadBeaconGroup);

        entry = {
          id: ev.id,
          group: grp,
          ringMesh,
          coreMesh: dishMesh,
          payloadBeaconGroup,
          payloadBeamGroup,
          payloadCoreMesh,
          payloadInnerBeam,
          payloadOuterBeam,
          payloadRingMesh
        };
      } else {
        // 3. Trial of Corruption Altar (Void Mutator / Enemy Modifier)
        const daisGeo = new THREE.CylinderGeometry(16, 22, 5, 8);
        const daisMat = new THREE.MeshStandardMaterial({
          map: this.textures['rock_texture'],
          bumpMap: this.textures['rock_texture'],
          bumpScale: 0.9,
          roughness: 0.85,
          metalness: 0.25
        });
        const daisMesh = new THREE.Mesh(daisGeo, daisMat);
        daisMesh.position.y = 2.5;
        grp.add(daisMesh);

        // Ground ancient runic glyph projection
        const runeDecalGeo = new THREE.PlaneGeometry(160, 160);
        const runeDecalMat = new THREE.MeshBasicMaterial({
          map: this.textures['rune_circle'],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
          color: 0xc084fc,
          blending: THREE.AdditiveBlending
        });
        const runeDecal = new THREE.Mesh(runeDecalGeo, runeDecalMat);
        runeDecal.rotation.x = -Math.PI / 2;
        runeDecal.position.y = 0.35;
        grp.add(runeDecal);

        const voidGeo = new THREE.IcosahedronGeometry(13, 1);
        const voidMat = new THREE.MeshStandardMaterial({
          map: this.textures['void_hive_texture'],
          emissiveMap: this.textures['void_hive_texture'],
          emissive: 0x9333ea,
          emissiveIntensity: 1.8,
          roughness: 0.35,
          metalness: 0.75
        });
        const voidMesh = new THREE.Mesh(voidGeo, voidMat);
        voidMesh.position.y = 28;
        grp.add(voidMesh);

        const cageGeo = new THREE.BoxGeometry(22, 22, 22);
        const cageMat = new THREE.MeshBasicMaterial({
          color: 0xc084fc,
          wireframe: true,
          transparent: true,
          opacity: 0.65
        });
        const cageMesh = new THREE.Mesh(cageGeo, cageMat);
        cageMesh.position.y = 28;
        grp.add(cageMesh);

        const ringGeo = new THREE.RingGeometry(ev.radius - 3, ev.radius + 3, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xc084fc,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.3;
        grp.add(ringMesh);

        entry = {
          id: ev.id,
          group: grp,
          ringMesh,
          coreMesh: voidMesh,
          floatingShard: cageMesh
        };
      }

      this.tagEditorRef(grp, 'world_event', ev.id);
      this.scene.add(grp);
      this.worldEventMap.set(ev.id, entry);
    }
  }

  private syncWorldEvents(dt: number, now: number): void {
    const events = this.simulation.state.worldEvents;
    for (const ev of events) {
      const entry = this.worldEventMap.get(ev.id);
      if (!entry) continue;

      if (entry.floatingShard) {
        entry.floatingShard.rotation.y += 0.025;
        entry.floatingShard.rotation.x += 0.012;
        entry.floatingShard.position.y = (ev.type === 'primal_totem' ? 74 : ev.type === 'secondary_totem' || ev.type === 'dash_totem' ? 66 : 28) + Math.sin(now * 0.003) * 3;
      }

      if (entry.beamMesh) {
        entry.beamMesh.rotation.y += 0.01;
        const beamPulse = 0.4 + Math.sin(now * 0.004) * 0.2 + (ev.chargeProgress / 100) * 0.4;
        (entry.beamMesh.material as THREE.MeshBasicMaterial).opacity = ev.isCompleted ? 0.2 : beamPulse;
      }

      if (entry.ringMesh) {
        entry.ringMesh.rotation.z += 0.008;
        const ringMat = entry.ringMesh.material as THREE.MeshBasicMaterial;
        if (ev.isCompleted) {
          ringMat.opacity = 0.15;
        } else if (ev.isActive) {
          const pulse = 0.6 + Math.sin(now * 0.008) * 0.3;
          ringMat.opacity = pulse;
        } else {
          ringMat.opacity = 0.45;
        }
      }

      if (entry.innerRing) {
        entry.innerRing.rotation.z -= 0.015;
      }

      if (entry.light) {
        const baseIntensity = ev.type === 'orbital_uplink' ? 3.2 : 2.5;
        entry.light.intensity = ev.isCompleted ? 1.0 : baseIntensity + (ev.chargeProgress / 100) * 2.0;
      }

      // Dash Event: 5 jump-high platforms (strictly invisible before event starts and after completion)
      if (entry.dashPlatformGroup && entry.dashPlatformMeshes) {
        const showPlatforms = ev.isActive && !ev.isCompleted && !!ev.dashPlatforms && ev.dashPlatforms.length > 0;
        entry.dashPlatformGroup.visible = showPlatforms;
        if (showPlatforms && ev.dashPlatforms) {
          const nextTargetIdx = (ev.highestPlatformReached || 0) + 1;
          for (let i = 0; i < entry.dashPlatformMeshes.length && i < ev.dashPlatforms.length; i++) {
            const plat = ev.dashPlatforms[i];
            const meshInfo = entry.dashPlatformMeshes[i];
            meshInfo.group.position.set(plat.x, plat.z, plat.y);

            const padMat = meshInfo.padMesh.material as THREE.MeshStandardMaterial;
            const pRingMat = meshInfo.ringMesh.material as THREE.MeshBasicMaterial;
            if (plat.reached) {
              padMat.color.setHex(0x10b981);
              padMat.emissive.setHex(0x059669);
              padMat.emissiveIntensity = 1.6;
              pRingMat.color.setHex(0x6ee7b7);
            } else if (plat.index === nextTargetIdx) {
              padMat.color.setHex(0x38bdf8);
              padMat.emissive.setHex(0x0284c7);
              padMat.emissiveIntensity = 1.8 + Math.sin(now * 0.008) * 0.5;
              pRingMat.color.setHex(0x7dd3fc);
            } else {
              padMat.color.setHex(plat.index === 5 ? 0x38bdf8 : 0x6366f1);
              padMat.emissive.setHex(plat.index === 5 ? 0x0284c7 : 0x4f46e5);
              padMat.emissiveIntensity = 1.3;
              pRingMat.color.setHex(plat.index === 5 ? 0x7dd3fc : 0xa5b4fc);
            }

            if (meshInfo.summitCore) {
              meshInfo.summitCore.rotation.y += dt * 2.2;
              meshInfo.summitCore.rotation.x += dt * 1.1;
              meshInfo.summitCore.position.y = 22 + Math.sin(now * 0.005) * 3.5;
            }
            if (meshInfo.summitBeam) {
              meshInfo.summitBeam.rotation.y += dt * 0.8;
              (meshInfo.summitBeam.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(now * 0.006) * 0.15;
            }
          }
        }
      }

      // Ultimate Event: Collectible Quantum Core + Huge Vertical Light Pillar
      if (entry.payloadBeaconGroup && entry.payloadBeamGroup && entry.payloadCoreMesh) {
        const showPayload = ev.isActive && !ev.isCompleted && !!ev.payloadPos;
        entry.payloadBeaconGroup.visible = showPayload;
        if (showPayload && ev.payloadPos) {
          const p = this.simulation.state.player;
          if (!ev.payloadCollected) {
            // Guide player to the collectible item with the huge vertical light pillar
            entry.payloadBeamGroup.position.set(ev.payloadPos.x, ev.payloadPos.z, ev.payloadPos.y);
            entry.payloadCoreMesh.position.set(
              ev.payloadPos.x,
              ev.payloadPos.z + 24 + Math.sin(now * 0.005) * 4.5,
              ev.payloadPos.y
            );
          } else {
            // Item collected: shift huge vertical light pillar back to the delivery shrine & float core on player!
            const shrineElev = this.simulation.state.terrain.getElevation(ev.pos.x, ev.pos.y).height + (ev.zOffset ?? 0);
            entry.payloadBeamGroup.position.set(ev.pos.x, shrineElev, ev.pos.y);
            entry.payloadCoreMesh.position.set(
              p.pos.x,
              p.z + 56 + Math.sin(now * 0.008) * 3.0,
              p.pos.y
            );
          }

          entry.payloadCoreMesh.rotation.y += dt * 2.6;
          entry.payloadCoreMesh.rotation.z += dt * 1.4;
          if (entry.payloadInnerBeam) {
            entry.payloadInnerBeam.rotation.y += dt * 0.9;
            (entry.payloadInnerBeam.material as THREE.MeshBasicMaterial).opacity = 0.72 + Math.sin(now * 0.007) * 0.18;
          }
          if (entry.payloadOuterBeam) {
            entry.payloadOuterBeam.rotation.y -= dt * 0.5;
            (entry.payloadOuterBeam.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(now * 0.005) * 0.12;
          }
          if (entry.payloadRingMesh) {
            const s = 1.0 + Math.sin(now * 0.006) * 0.12;
            entry.payloadRingMesh.scale.set(s, s, 1);
          }
        }
      }
    }
  }

  private createObstacles(): void {
    for (const entry of this.obstacleEntries) {
      this.scene.remove(entry.mesh);
      this.scene.remove(entry.shadow);
    }
    this.obstacleEntries = [];

    const obsList = this.simulation.state.obstacles;
    const shadowGeo = new THREE.PlaneGeometry(36, 36);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.textures['shadow'],
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });

    for (let i = 0; i < obsList.length; i++) {
      const obs = obsList[i];
      // Skip spaceship collision boundaries: the crashed colony ship landmark is rendered by ThreeTerrain or the test GLB
      if (obs.id.startsWith('ship_') || obs.id.startsWith('test_ship_')) continue;
      const elevation = this.simulation.state.terrain.getElevation(obs.pos.x, obs.pos.y).height + (obs.zOffset ?? 0);

      let tex: THREE.Texture | undefined;
      let wMult = 3.0;
      let hMult = 3.0;
      let yAnchor = 0.5;
      let shadowDiv = 14;

      if (obs.type === 'tree') {
        tex = (obs.variant === 1)
          ? this.textures['tree_crimson_veins']
          : (obs.variant === 2)
            ? this.textures['tree_coral']
            : this.textures['tree_crimson_canopy'];
        wMult = 3.4;
        hMult = 4.4;
        yAnchor = 0.46;
        shadowDiv = 12;
      } else if (obs.type === 'crystal') {
        const v = (obs.variant ?? 0) % 4;
        tex = v === 1 ? this.textures['crystal_cyan']
          : v === 2 ? this.textures['crystal_amber']
            : v === 3 ? this.textures['crystal_crimson']
              : this.textures['crystal_violet'];
      } else if (obs.type === 'rock') {
        const rIdx = ((obs.variant ?? i) % 8) + 1;
        tex = this.textures[`rock_var_${rIdx}`] || this.textures['alien_rock'];
        hMult = 2.8;
        yAnchor = 0.44;
      } else {
        tex = this.textures['alien_mushrooms'] || this.textures['alien_mushroom'];
        wMult = 2.8;
        hMult = 2.8;
      }

      const sprMat = new THREE.SpriteMaterial({
        map: tex,
        toneMapped: false,
        alphaTest: 0.05,
        rotation: obs.rotationY ?? 0
      });
      const spr = new THREE.Sprite(sprMat);
      const w = obs.radius * wMult * (obs.scaleVar || 1.0);
      const h = obs.radius * hMult * (obs.scaleVar || 1.0);
      spr.scale.set(w, h, 1);
      spr.position.set(obs.pos.x, elevation + h * yAnchor, obs.pos.y);
      this.tagEditorRef(spr, 'obstacle', obs.id);
      this.scene.add(spr);

      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(obs.pos.x, elevation + 0.2, obs.pos.y);
      shadow.scale.set((obs.radius * (obs.scaleVar || 1.0)) / shadowDiv, (obs.radius * (obs.scaleVar || 1.0)) / shadowDiv, 1);
      this.tagEditorRef(shadow, 'obstacle', obs.id);
      this.scene.add(shadow);

      this.obstacleEntries.push({ id: obs.id, mesh: spr, shadow });
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const maxDpr = this.graphicsQuality === 'low' ? 1.0 : this.graphicsQuality === 'high' ? 1.5 : 1.25;
    this.renderer.setPixelRatio(Math.min(dpr, maxDpr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    const bloomScale = this.graphicsQuality === 'high' ? 0.75 : 0.5;
    this.bloomPass?.setSize(Math.max(1, Math.floor(w * bloomScale)), Math.max(1, Math.floor(h * bloomScale)));
  }

  private renderLoop(now: number): void {
    if (!this.isRunning) return;
    requestAnimationFrame(this.boundRenderLoop);

    // Pause background 3D simulation and rendering when Character Selection Hub is open to eliminate menu lag
    const isHeroSelectOpen = this.isScreenOpen('screen-hero-select');
    if (isHeroSelectOpen) {
      this.lastTime = now;
      return;
    }

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.isEditorMode) {
      if (this.isPointerLocked) {
        this.exitPointerLock();
      }
      if (this.artifactRing1 && this.artifactRing2) {
        this.artifactRing1.rotation.y += 0.025;
        this.artifactRing1.rotation.z += 0.012;
        this.artifactRing2.rotation.x += 0.018;
        this.artifactRing2.rotation.y -= 0.022;
      }
      this.editorTickCallback?.(dt, now);
      this.terrain.update(dt, now, this.camera);
      this.updateHorizonClouds(now);
      this.updateTestMapEnvironment(dt, now);
      if (this.useComposer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      this.postRenderCallback?.(dt, now, this.renderer.info);
      return;
    }

    // 1. Keyboard Camera Orbit Shortcuts (Q / E or Left/Right Arrow to spin, C to reset)
    if (this.inputManager.keys['q'] || this.inputManager.keys['arrowleft']) {
      this.targetYaw -= 0.035;
    }
    if (this.inputManager.keys['arrowright']) {
      this.targetYaw += 0.035;
    }
    if (this.inputManager.keys['c']) {
      this.targetYaw = 0;
      this.targetPitch = 0.62;
      this.targetDistance = 490;
    }
    if (this.inputManager.keys['m']) {
      this.inputManager.keys['m'] = false;
      const isMuted = this.soundManager.toggleMute();
      this.uiManager.updateAudioIcon(isMuted);
      this.uiManager.showPickupNotification(isMuted ? 'Sound Muted [M]' : 'Sound Enabled [M]');
    }
    if (this.inputManager.keys['i']) {
      this.inputManager.keys['i'] = false;
      const inverted = this.toggleInvertCameraPan();
      this.uiManager.updateCameraPanIcon(inverted);
      this.uiManager.showPickupNotification(inverted ? 'Camera Pan: Inverted [I]' : 'Camera Pan: Standard [I]');
    }
    if (this.inputManager.keys['c']) {
      this.inputManager.keys['c'] = false;
      this.targetYaw = 0;
      this.targetPitch = 0.62;
      this.uiManager.showPickupNotification('Camera View Reset [C]');
    }

    // Release pointer lock if paused, an interactive modal, or tactical rank up pause is active
    if ((this.simulation.state.isPaused || this.simulation.state.isPausedForBuffChoice || this.simulation.state.isGameOver || this.simulation.state.isStageCleared) && this.isPointerLocked) {
      this.exitPointerLock();
    }

    // 2. Smooth Camera Interpolation (Responsive & Crisp)
    this.cameraYaw += (this.targetYaw - this.cameraYaw) * 0.25;
    this.cameraPitch += (this.targetPitch - this.cameraPitch) * 0.25;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * 0.22;

    // 2b. Ambient Atmosphere Animation
    if (this.artifactRing1 && this.artifactRing2) {
      this.artifactRing1.rotation.y += 0.025;
      this.artifactRing1.rotation.z += 0.012;
      this.artifactRing2.rotation.x += 0.018;
      this.artifactRing2.rotation.y -= 0.022;
    }

    // 2c. Update Camera Position & Orientation (Track Commander smoothly)
    const p = this.simulation.state.player;
    const art = this.simulation.state.artifact;

    let targetFocusX = p.pos.x;
    let targetFocusY = p.z;
    let targetFocusZ = p.pos.y;
    let targetDist = this.cameraDistance;

    // Cinematic boss emergence presentation: when teleporter summon is triggered at summit (1400, 1050),
    // camera presents the colossal Titan rising from underground in front of the shipwreck (1800, 2600)
    if (art && art.isSummoning) {
      const titan = this.simulation.state.enemies.find((en) => en.isStage1Titan && en.health > 0);
      if (titan) {
        targetFocusX = titan.pos.x;
        targetFocusY = titan.z + 160;
        targetFocusZ = titan.pos.y - 140;
        targetDist = Math.max(this.cameraDistance, 680);
      }
    }

    this.cameraFocus.x += (targetFocusX - this.cameraFocus.x) * 0.12;
    this.cameraFocus.y += (targetFocusY - this.cameraFocus.y) * 0.12;
    this.cameraFocus.z += (targetFocusZ - this.cameraFocus.z) * 0.12;

    const eyeX = this.cameraFocus.x - targetDist * Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch);
    const eyeY = this.cameraFocus.y + targetDist * Math.sin(this.cameraPitch);
    const eyeZ = this.cameraFocus.z - targetDist * Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch);
    this.camEyeScratch.set(eyeX, eyeY, eyeZ);
    this.resolveCameraTerrainCollision(this.cameraFocus, this.camEyeScratch, dt);
    this.camera.position.copy(this.camEyeScratch);
    this.camera.lookAt(this.cameraFocus.x, this.cameraFocus.y + 42, this.cameraFocus.z);
    this.camera.updateMatrixWorld();

    // Central crosshair raycasting keeps combat aiming locked to camera orientation
    if (this.isPointerLocked) {
      this.updateMouseRaycast(window.innerWidth / 2, window.innerHeight / 2);
    }

    // 2d. Extract exact horizontal screen vectors directly from Camera World Matrix (reusing vectors to avoid GC)
    this.camera.getWorldDirection(this.camFwd);
    this.camFwd.y = 0;
    this.camFwd.normalize();

    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.camRight.y = 0;
    this.camRight.normalize();

    // 3. Step Simulation with exact screen axes
    const inputSnapshot = this.inputManager.getSnapshot(
      this.simulation.state.player.pos,
      this.cameraYaw,
      { x: this.camFwd.x, y: this.camFwd.z },
      { x: this.camRight.x, y: this.camRight.z }
    );
    const events = this.simulation.tick(dt, inputSnapshot);

    // 4. Dispatch Sim Events to Audio & VFX
    this.processEvents(events);

    // 4b. Diegetic Narrative Director & Observer
    if (this.narrativeObserver && this.dialogueDirector) {
      const signals = this.narrativeObserver.update(
        dt,
        events,
        this.simulation.state,
        this.dialogueDirector.isPriorityBusy()
      );
      for (let i = 0; i < signals.length; i++) {
        this.dialogueDirector.notifySignal(
          signals[i].triggerId,
          signals[i].context,
          this.simulation.state
        );
      }
      const telemetry = this.narrativeObserver.getTelemetry(this.simulation.state);
      this.dialogueDirector.update(dt, this.simulation.state, telemetry);
    }

    // 5. Synchronize Entities
    this.syncPlayer(dt, inputSnapshot);
    this.syncEnemies(dt);
    this.syncPods();
    this.syncWorldEvents(dt, now);
    this.syncProjectiles();
    this.syncRecoveryFields(dt);
    this.syncDoctorEntities(dt, now);
    this.syncDrops();
    this.syncVFX(dt, now);
    this.terrain.update(dt, now, this.camera);
    this.updateRegionalFreeze(dt);
    this.updateHorizonClouds(now);
    this.updateTestMapEnvironment(dt, now);

    // 6. Update HUD
    this.uiManager.update(this.simulation.state);

    // 7. Visceral Camera Trauma Shake (Triggered by ultimate shockwave, earthquakes & heavy explosions)
    let seismicHeaveX = 0;
    let seismicHeaveY = 0;
    let seismicHeaveZ = 0;
    if (
      this.earthquakeTimer > 0 &&
      this.earthquakeDuration > 0 &&
      !this.simulation.state.isPaused &&
      !this.simulation.state.isPausedForBuffChoice
    ) {
      this.earthquakeTimer = Math.max(0, this.earthquakeTimer - dt);
      const progress = Math.min(1, Math.max(0, 1 - this.earthquakeTimer / this.earthquakeDuration));
      const envelope =
        progress < 0.12
          ? progress / 0.12
          : progress < 0.55
            ? 1.0
            : Math.cos(((progress - 0.55) / 0.45) * (Math.PI * 0.5));
      this.cameraTrauma = Math.max(this.cameraTrauma, envelope * this.earthquakeIntensity);

      const elapsedSec = this.earthquakeDuration - this.earthquakeTimer;
      const heaveScale = (this.earthquakeIsMajor ? 2.4 : 1.75) * envelope * this.earthquakeIntensity * 12;
      seismicHeaveX = (Math.sin(elapsedSec * 28) * 0.65 + Math.cos(elapsedSec * 43) * 0.35) * heaveScale;
      seismicHeaveY = (Math.cos(elapsedSec * 37) * 0.6 + Math.sin(elapsedSec * 53) * 0.4) * heaveScale * 0.7;
      seismicHeaveZ = (Math.sin(elapsedSec * 31) * 0.65 + Math.cos(elapsedSec * 47) * 0.35) * heaveScale;
    }

    if (this.cameraTrauma > 0 || seismicHeaveX !== 0 || seismicHeaveY !== 0 || seismicHeaveZ !== 0) {
      const traumaMag =
        Math.pow(this.cameraTrauma, 2) *
        16 *
        (this.earthquakeTimer > 0 ? (this.earthquakeIsMajor ? 2.4 : 1.75) : 1.0);
      this.camera.position.x += (Math.random() - 0.5) * traumaMag + seismicHeaveX;
      this.camera.position.y += (Math.random() - 0.5) * traumaMag * 0.7 + seismicHeaveY;
      this.camera.position.z += (Math.random() - 0.5) * traumaMag + seismicHeaveZ;
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 2.2);
    }

    // 8. Render Scene via Post-Processing Composer (Bloom + ACES Filmic Output) or direct Low-preset pass
    if (this.useComposer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.postRenderCallback?.(dt, now, this.renderer.info);
  }

  public addCameraTrauma(amount: number): void {
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + amount);
  }

  public triggerEarthquake(severity: 'moderate' | 'major'): void {
    const isMajor = severity === 'major';
    this.earthquakeIsMajor = isMajor;
    this.earthquakeDuration = isMajor ? 5.2 : 3.6;
    this.earthquakeTimer = this.earthquakeDuration;
    this.earthquakeIntensity = isMajor ? 1.0 : 0.82;
    this.addCameraTrauma(isMajor ? 1.0 : 0.78);
    this.soundManager.playEarthquake(isMajor);
    const p = this.simulation.state.player;
    this.vfx.spawnShockwaveRing(p.pos, isMajor ? 420 : 240, isMajor ? 0xf97316 : 0xfacc15, p.z, isMajor ? 1.5 : 0.95);
  }

  private syncPlayer(dt: number, inputSnapshot: any): void {
    const p = this.simulation.state.player;
    const now = performance.now();

    if (this.use3DCommander) {
      this.playerSprite.visible = false;
      this.commander3D.group.visible = true;
      this.commander3D.update(
        dt,
        p,
        inputSnapshot,
        this.inputManager.mouseWorldPos,
        now
      );
      this.playerResolveAura.visible = false; // 3D model handles its own 3D forcefield dome
    } else {
      this.playerSprite.visible = true;
      this.commander3D.group.visible = false;

      // Update 2.5D Sprite Animation Controller (Idle, Run, Attack, Dash, Hit, Death)
      this.spriteAnimator.update(dt, p, inputSnapshot);

      // Doctor Dash (Therapeutic Pass): Emit dense crisp white silhouette afterimage trail
      if (p.heroId === 'doctor' && p.isDashing) {
        this.doctorDashGhostTimer -= dt;
        if (this.doctorDashGhostTimer <= 0) {
          this.doctorDashGhostTimer = 0.036;
          const sprMap = this.playerSprite.material.map || this.textures['doctor_front'];
          if (sprMap) {
            const uvRect = {
              ox: sprMap.offset.x,
              oy: sprMap.offset.y,
              rx: sprMap.repeat.x,
              ry: sprMap.repeat.y
            };
            this.vfx.spawnWhiteSilhouetteGhost(p.pos, sprMap, p.z, uvRect, 0.34, 0.72);
          }
        }
      } else {
        this.doctorDashGhostTimer = 0;
      }

      const auraMat = this.playerResolveAura.material as THREE.ShaderMaterial;
      const showSanctuaryAura = !!p.inSanctuaryCross && p.defenseBonusTimer <= 0;
      this.playerResolveAura.visible = p.defenseBonusTimer > 0 || showSanctuaryAura;
      if (auraMat.uniforms?.uTime) {
        auraMat.uniforms.uTime.value = now * 0.001;
      }
      if (showSanctuaryAura) {
        auraMat.uniforms?.uColor?.value.setHex(0x10b981);
        this.playerResolveAura.rotation.y += dt * 1.4;
      } else if (p.defenseBonusTimer > 0) {
        auraMat.uniforms?.uColor?.value.setHex(0xffd700);
      }
    }

    // Doctor Dash Augments: Swirling Bio-Shroud Veil & Adrenaline Wind Mist
    if (this.playerPhaseBarrierMesh) {
      const pbActive = (p.phaseBarrierTimer ?? 0) > 0;
      this.playerPhaseBarrierMesh.visible = pbActive;
      if (pbActive) {
        this.playerPhaseBarrierMesh.rotation.y += dt * 1.85;
        const firstChild = this.playerPhaseBarrierMesh.children[0] as THREE.Mesh | undefined;
        const veilMat = firstChild?.material as THREE.ShaderMaterial | undefined;
        if (veilMat?.uniforms?.uTime) veilMat.uniforms.uTime.value = now * 0.001;
        const pulse = 1.0 + 0.05 * Math.sin(now * 0.012);
        this.playerPhaseBarrierMesh.scale.setScalar(pulse);
      }
    }
    if (this.playerAdrenalineRing) {
      const adrActive = (p.adrenalineRushTimer ?? 0) > 0;
      this.playerAdrenalineRing.visible = adrActive;
      if (adrActive) {
        this.playerAdrenalineRing.rotation.y -= dt * 3.5;
        const adrenMat = this.playerAdrenalineRing.material as THREE.ShaderMaterial;
        if (adrenMat.uniforms?.uTime) adrenMat.uniforms.uTime.value = now * 0.001;
        const pulse = 0.94 + 0.12 * Math.sin(now * 0.018);
        this.playerAdrenalineRing.scale.set(pulse, 1, pulse);
      }
    }

    // Update Player 3D position (World X, Elevation Z -> Three.js Y, World Y -> Three.js Z)
    // Feet remain solidly anchored to the terrain without artificial sprite bobbing
    this.playerGroup.position.set(p.pos.x, p.z, p.pos.y);

    if (p.orbitingBladeActive) {
      this.orbitingBladeGroup.visible = true;
      const extra = p.calculatedStats?.extraProjectiles || 0;
      // Strict cap at 7 swords: Math.min(7, 1 + bonusProjectiles)
      const targetSwordCount = Math.min(7, Math.max(1, p.orbitingSwordCount || (1 + extra)));

      // Ensure pool has enough sword visuals
      while (this.orbitingSwords.length < targetSwordCount) {
        this.orbitingSwords.push(this.createOrbitingSwordVisual());
      }

      const rad = p.orbitingBladeRadius ?? 164;
      const baseAngle = p.orbitingBladeAngle ?? 0;

      for (let s = 0; s < this.orbitingSwords.length; s++) {
        const sword = this.orbitingSwords[s];
        if (s >= targetSwordCount) {
          sword.group.visible = false;
          continue;
        }
        sword.group.visible = true;

        // Evenly spaced 360° orbital angle
        const sAngle = baseAngle + (Math.PI * 2 / targetSwordCount) * s;
        const homeX = p.pos.x + Math.cos(sAngle) * rad;
        const homeY = p.pos.y + Math.sin(sAngle) * rad;
        const homeZ = p.z + 44 + Math.sin(now * 0.005 + s * 1.2) * 5.0;

        const fs = p.floatingSwords && p.floatingSwords[s];
        const swX = fs ? fs.x : homeX;
        const swY = fs ? fs.y : homeY;
        const swZ = fs ? fs.z : homeZ;

        // Position in Three.js world space: (x, z, y)
        sword.group.position.set(swX, swZ, swY);

        if (fs && fs.state === 'lunge' && fs.targetX !== undefined && fs.targetY !== undefined) {
          // Visceral kinetic sword lunge: blade points directly towards target enemy!
          const targetWorld = new THREE.Vector3(fs.targetX, fs.targetZ ?? swZ, fs.targetY);
          sword.swordModel.lookAt(targetWorld);
          sword.swordModel.rotateX(Math.PI / 2);
        } else if (fs && fs.state === 'return') {
          // Smooth return arc: blade points towards home orbital slot
          const homeWorld = new THREE.Vector3(homeX, homeZ, homeY);
          sword.swordModel.lookAt(homeWorld);
          sword.swordModel.rotateX(Math.PI / 2);
        } else {
          // Orient blade tangent to the orbital circle along direction of motion
          const tangentYaw = -sAngle;
          sword.swordModel.rotation.set(0.18, tangentYaw, Math.sin(now * 0.006 + s) * 0.12);
        }

        // Crackling electric orbital arc trail trailing backward along the orbit or strike vector
        const trailCount = 24;
        const dTheta = 0.42;
        const isLungingOrReturning = fs && (fs.state === 'lunge' || fs.state === 'return');

        for (let k = 0; k < trailCount; k++) {
          const ratio = k / (trailCount - 1);
          let tx: number, ty: number, tz: number;

          if (isLungingOrReturning) {
            tx = (homeX - swX) * ratio;
            ty = (homeY - swY) * ratio;
            tz = (homeZ - swZ) * ratio;
          } else {
            const tAngle = sAngle - ratio * dTheta;
            tx = (p.pos.x + Math.cos(tAngle) * rad) - swX;
            ty = (p.pos.y + Math.sin(tAngle) * rad) - swY;
            tz = 0;
          }

          const jitter = (1.0 - ratio) * 1.8;
          const jx = (Math.sin(k * 2.8 + now * 0.02) * jitter);
          const jy = (Math.cos(k * 3.1 + now * 0.02) * jitter);
          const jz = (Math.sin(k * 3.5 + now * 0.02) * jitter);

          sword.trailPosAttr.setXYZ(k, tx + jx, tz + jz, ty + jy);
          const fade = Math.pow(Math.max(0, 1.0 - ratio), 1.4);
          sword.trailColAttr.setXYZ(k, 0.95 * fade, 0.42 * fade, 1.0 * fade);
        }
        sword.trailPosAttr.needsUpdate = true;
        sword.trailColAttr.needsUpdate = true;

        // Electrical sparks branching out along the trail
        const branchIndices = [3, 8, 14];
        let bIdx = 0;
        for (let bi = 0; bi < branchIndices.length; bi++) {
          const k = branchIndices[bi];
          const rootX = sword.trailPosAttr.getX(k);
          const rootY = sword.trailPosAttr.getY(k);
          const rootZ = sword.trailPosAttr.getZ(k);
          const forkLen = 12 + Math.sin(now * 0.03 + bi + s) * 6;

          sword.branchPosAttr.setXYZ(bIdx, rootX, rootY, rootZ);
          sword.branchColAttr.setXYZ(bIdx, 0.98, 0.65, 1.0);
          bIdx++;

          sword.branchPosAttr.setXYZ(
            bIdx,
            rootX + (Math.random() - 0.5) * forkLen * 1.5,
            rootY + (Math.random() - 0.5) * forkLen,
            rootZ + (Math.random() - 0.5) * forkLen * 1.5
          );
          sword.branchColAttr.setXYZ(bIdx, 0.55, 0.15, 0.85);
          bIdx++;
        }
        sword.branchPosAttr.needsUpdate = true;
        sword.branchColAttr.needsUpdate = true;
      }
    } else {
      this.orbitingBladeGroup.visible = false;
      for (const sword of this.orbitingSwords) {
        sword.group.visible = false;
      }
    }

    if (p.isDashing && p.heroId === 'commander') {
      this.vfx.updateDashChargeFollow(p.pos, p.z, p.dashDir, dt);
    }

    // Shadow decal directly on terrain below
    const altitude = Math.max(0, p.z - p.groundZ);
    const shadowScale = Math.max(0.4, 1 - altitude * 0.0035);
    const shadowAlpha = Math.max(0.18, 0.8 - altitude * 0.0035);
    this.playerShadow.position.set(p.pos.x, p.groundZ + 0.2, p.pos.y);
    this.playerShadow.scale.set(shadowScale, shadowScale, 1);
    (this.playerShadow.material as THREE.MeshBasicMaterial).opacity = shadowAlpha;

    // Legacy Jetpack Gliding Flames (Disabled for 2.5D Commander since blue boot flames are integrated into commander_glide_* sheets)
    if (p.isGliding && (p.heroId !== 'commander' || this.use3DCommander)) {
      this.jetPlumeL.visible = true;
      this.jetPlumeR.visible = true;
      const flicker = 0.85 + Math.random() * 0.3;

      let plumeZ = -4;
      let plumeXLeft = -12;
      let plumeXRight = 12;
      if (p.facing === 'front') {
        plumeZ = -8; // Jetpack behind chest when facing forward
      } else if (p.facing === 'back') {
        plumeZ = 4;  // Jetpack directly visible when facing away
      } else if (p.facing === 'left') {
        plumeXLeft = 4;
        plumeXRight = 16;
        plumeZ = 0;
      } else if (p.facing === 'right') {
        plumeXLeft = -16;
        plumeXRight = -4;
        plumeZ = 0;
      }

      this.jetPlumeL.position.set(plumeXLeft, 28, plumeZ);
      this.jetPlumeL.scale.set(20, 44 * flicker, 1);

      this.jetPlumeR.position.set(plumeXRight, 28, plumeZ);
      this.jetPlumeR.scale.set(20, 44 * flicker, 1);
    } else {
      this.jetPlumeL.visible = false;
      this.jetPlumeR.visible = false;
    }
  }

  private createVolumetricBeamMaterial(
    coreHex: number,
    edgeHex: number,
    falloffPow: number,
    opacity: number,
    scrollSpeed: number
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCoreColor: { value: new THREE.Color(coreHex) },
        uEdgeColor: { value: new THREE.Color(edgeHex) },
        uFalloffPow: { value: falloffPow },
        uOpacity: { value: opacity },
        uScrollSpeed: { value: scrollSpeed }
      },
      vertexShader: VOLUMETRIC_BEAM_VERT,
      fragmentShader: VOLUMETRIC_BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false
    });
  }

  private createBioPlasmaMaterial(
    coreHex: number,
    midHex: number,
    rimHex: number,
    wobbleAmp: number,
    opacity: number,
    rimMode: boolean,
    additive: boolean = rimMode
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCoreColor: { value: new THREE.Color(coreHex) },
        uMidColor: { value: new THREE.Color(midHex) },
        uRimColor: { value: new THREE.Color(rimHex) },
        uWobbleAmp: { value: wobbleAmp },
        uOpacity: { value: opacity },
        uRimMode: { value: rimMode ? 1.0 : 0.0 }
      },
      vertexShader: BIO_PLASMA_VERT,
      fragmentShader: BIO_PLASMA_FRAG,
      transparent: true,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.FrontSide,
      fog: false
    });
  }

  private getSharedElementalProjectileAssets(): {
    orbGeo: THREE.BufferGeometry;
    haloGeo: THREE.BufferGeometry;
    wakeGeo: THREE.BufferGeometry;
    orbMat: THREE.ShaderMaterial;
    haloMat: THREE.ShaderMaterial;
    wakeMat: THREE.ShaderMaterial;
  } {
    if (!this.sharedElementalOrbGeo) {
      this.sharedElementalOrbGeo = this.vfx.createOrganicPlumeColumnGeo(4.5, 9.5, 20, 12, 6, 0.34, 1.5);
      this.sharedElementalOrbGeo.rotateX(Math.PI / 2);
      this.sharedElementalHaloGeo = this.vfx.createOrganicPlumeColumnGeo(7.5, 14.5, 28, 12, 6, 0.42, -1.3);
      this.sharedElementalHaloGeo.rotateX(Math.PI / 2);
      const wakeGeo = this.vfx.createOrganicPlumeColumnGeo(12.0, 1.2, 86, 12, 6, 0.32, 1.8);
      wakeGeo.rotateX(Math.PI / 2);
      wakeGeo.translate(0, 0, -40);
      this.sharedElementalWakeGeo = wakeGeo;

      this.sharedElementalOrbMat = this.createBioPlasmaMaterial(
        0xffffff,
        0xe879f9,
        0x7e22ce,
        0.7,
        0.98,
        false,
        false
      );
      this.sharedElementalHaloMat = this.createBioPlasmaMaterial(
        0xf5d0fe,
        0xd946ef,
        0x9333ea,
        1.0,
        0.92,
        true,
        true
      );
      this.sharedElementalWakeMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uHeadColor: { value: new THREE.Color(0xf5d0fe) },
          uTailColor: { value: new THREE.Color(0x7e22ce) },
          uOpacity: { value: 0.96 }
        },
        vertexShader: PLASMA_WAKE_VERT,
        fragmentShader: PLASMA_WAKE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false
      });
    }

    return {
      orbGeo: this.sharedElementalOrbGeo,
      haloGeo: this.sharedElementalHaloGeo!,
      wakeGeo: this.sharedElementalWakeGeo!,
      orbMat: this.sharedElementalOrbMat!,
      haloMat: this.sharedElementalHaloMat!,
      wakeMat: this.sharedElementalWakeMat!
    };
  }

  private getTentacleTextures(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
    if (!this.tentacleSkinTex || !this.tentacleEmissiveTex) {
      // 1. Procedural Alien Flesh & Chitin Texture (128 x 512, length along Y/V)
      const skinCanvas = document.createElement('canvas');
      skinCanvas.width = 128;
      skinCanvas.height = 512;
      const ctx = skinCanvas.getContext('2d')!;

      // Deep obsidian-plum alien muscle gradient
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0.0, '#22072e');
      grad.addColorStop(0.5, '#43125c');
      grad.addColorStop(1.0, '#581c87');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 512);

      // Longitudinal bio-muscle striations
      for (let x = 0; x < 128; x += 4) {
        ctx.strokeStyle = (x % 8 === 0) ? 'rgba(88, 28, 135, 0.45)' : 'rgba(30, 8, 42, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(x * 0.2) * 6, 512);
        ctx.stroke();
      }

      // Segmented chitinous armor rings / scales with lavender-rose rim highlights
      for (let y = 0; y < 512; y += 18) {
        // Dark segment groove
        ctx.strokeStyle = 'rgba(15, 3, 22, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(128, y);
        ctx.stroke();

        // Metallic chitin rim light
        ctx.strokeStyle = 'rgba(216, 150, 216, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y + 2);
        ctx.lineTo(128, y + 2);
        ctx.stroke();
      }

      this.tentacleSkinTex = new THREE.CanvasTexture(skinCanvas);
      this.tentacleSkinTex.wrapS = THREE.RepeatWrapping;
      this.tentacleSkinTex.wrapT = THREE.ClampToEdgeWrapping;
      this.tentacleSkinTex.colorSpace = THREE.SRGBColorSpace;

      // 2. Bioluminescent Emissive Map (Glowing magenta-crimson veins along black background)
      const emCanvas = document.createElement('canvas');
      emCanvas.width = 128;
      emCanvas.height = 512;
      const emCtx = emCanvas.getContext('2d')!;

      emCtx.fillStyle = '#000000';
      emCtx.fillRect(0, 0, 128, 512);

      // Central pulsing bioluminescent dorsal vein
      emCtx.strokeStyle = '#f43f5e';
      emCtx.lineWidth = 6;
      emCtx.shadowColor = '#d946ef';
      emCtx.shadowBlur = 10;
      emCtx.beginPath();
      for (let y = 0; y <= 512; y += 8) {
        const vx = 64 + Math.sin(y * 0.06) * 14;
        if (y === 0) emCtx.moveTo(vx, y);
        else emCtx.lineTo(vx, y);
      }
      emCtx.stroke();

      // Branching bio-electric capillaries
      emCtx.strokeStyle = '#c084fc';
      emCtx.lineWidth = 2.5;
      for (let b = 0; b < 20; b++) {
        const by = 25 + b * 24;
        const bx = 64 + Math.sin(by * 0.06) * 14;
        const dir = (b % 2 === 0) ? 1 : -1;
        emCtx.beginPath();
        emCtx.moveTo(bx, by);
        emCtx.quadraticCurveTo(bx + dir * 20, by + 6, bx + dir * 42, by + 14);
        emCtx.stroke();
      }

      this.tentacleEmissiveTex = new THREE.CanvasTexture(emCanvas);
      this.tentacleEmissiveTex.wrapS = THREE.RepeatWrapping;
      this.tentacleEmissiveTex.wrapT = THREE.ClampToEdgeWrapping;
    }

    return { map: this.tentacleSkinTex, emissiveMap: this.tentacleEmissiveTex };
  }

  private createTentacleBufferGeo(segments: number = 28, radialSegments: number = 10): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const vertexCount = (segments + 1) * radialSegments + 1;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    // Pre-populate UVs (U around radial, V along tentacle length 0 to 1)
    for (let s = 0; s <= segments; s++) {
      const v = s / segments;
      for (let r = 0; r < radialSegments; r++) {
        const u = r / radialSegments;
        const idx = s * radialSegments + r;
        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = v;
      }
    }
    const tipIdx = (segments + 1) * radialSegments;
    uvs[tipIdx * 2] = 0.5;
    uvs[tipIdx * 2 + 1] = 1.0;

    // Tube faces
    for (let s = 0; s < segments; s++) {
      for (let r = 0; r < radialSegments; r++) {
        const nextR = (r + 1) % radialSegments;
        const v0 = s * radialSegments + r;
        const v1 = s * radialSegments + nextR;
        const v2 = (s + 1) * radialSegments + r;
        const v3 = (s + 1) * radialSegments + nextR;

        indices.push(v0, v1, v2);
        indices.push(v2, v1, v3);
      }
    }

    // Tip fan
    const lastRingStart = segments * radialSegments;
    for (let r = 0; r < radialSegments; r++) {
      const nextR = (r + 1) % radialSegments;
      indices.push(lastRingStart + r, lastRingStart + nextR, tipIdx);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  private updateTentacleGeo(
    geo: THREE.BufferGeometry,
    spinePoints: THREE.Vector3[],
    baseRadius: number = 18.0,
    radialSegments: number = 10
  ): void {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    if (!posAttr || !normAttr) return;

    const segments = spinePoints.length - 1;
    const T = this.tentacleTScratch;
    const N = this.tentacleNScratch;
    const B = this.tentacleBScratch;
    const worldUp = this.titanUpScratch;

    for (let s = 0; s <= segments; s++) {
      const pt = spinePoints[s];
      if (s < segments) {
        T.subVectors(spinePoints[s + 1], pt).normalize();
      } else {
        T.subVectors(pt, spinePoints[s - 1]).normalize();
      }
      if (T.lengthSq() < 0.0001) T.set(0, 0, 1);

      if (s === 0) {
        // Initial normal vector perpendicular to tangent
        N.crossVectors(T, worldUp).normalize();
        if (N.lengthSq() < 0.0001) {
          N.crossVectors(T, this.tentacleUnitXScratch).normalize();
        }
      } else {
        // Parallel transport frame projection: removes twist and vertical gimbal singularity
        const dot = N.dot(T);
        N.addScaledVector(T, -dot).normalize();
        if (N.lengthSq() < 0.0001) {
          N.crossVectors(T, worldUp).normalize();
        }
      }
      B.crossVectors(T, N).normalize();

      // Organic tapered radius with subtle muscular ring segmentation
      const t = s / segments;
      const taper = Math.pow(1.0 - t * 0.92, 1.35);
      const segmentRipple = 1.0 + 0.08 * Math.sin(t * Math.PI * 16.0);
      const radius = (baseRadius * taper + 1.6) * segmentRipple;

      for (let r = 0; r < radialSegments; r++) {
        const theta = (r / radialSegments) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const nx = N.x * cosT + B.x * sinT;
        const ny = N.y * cosT + B.y * sinT;
        const nz = N.z * cosT + B.z * sinT;

        const vx = pt.x + nx * radius;
        const vy = pt.y + ny * radius;
        const vz = pt.z + nz * radius;

        const idx = s * radialSegments + r;
        posAttr.setXYZ(idx, vx, vy, vz);
        normAttr.setXYZ(idx, nx, ny, nz);
      }
    }

    // Set tip vertex along final tangent
    const lastPt = spinePoints[segments];
    const prevPt = spinePoints[segments - 1];
    T.subVectors(lastPt, prevPt).normalize();
    const tipX = lastPt.x + T.x * 10.0;
    const tipY = lastPt.y + T.y * 10.0;
    const tipZ = lastPt.z + T.z * 10.0;

    const tipIdx = (segments + 1) * radialSegments;
    posAttr.setXYZ(tipIdx, tipX, tipY, tipZ);
    normAttr.setXYZ(tipIdx, T.x, T.y, T.z);

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  private createConformalRingGeo(_innerRadius: number, outerRadius: number, _thetaSegments: number = 48, phiSegments: number = 1): { geo: THREE.BufferGeometry; origXZ: Float32Array } {
    const segs = Math.max(12, Math.min(24, phiSegments * 8 + 8));
    const geo = new THREE.PlaneGeometry(outerRadius * 2.2, outerRadius * 2.2, segs, segs);
    geo.rotateX(-Math.PI / 2); // Rotate to XZ ground plane
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const origXZ = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      origXZ[i * 2] = pos.getX(i);
      origXZ[i * 2 + 1] = pos.getZ(i);
    }
    return { geo, origXZ };
  }

  private updateConformalMarkerGeo(geo: THREE.BufferGeometry, origXZ: Float32Array, centerX: number, centerZ: number, centerElev: number, elevOffset: number = 1.4): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!pos || origXZ.length !== pos.count * 2) return;
    for (let i = 0; i < pos.count; i++) {
      const lx = origXZ[i * 2];
      const lz = origXZ[i * 2 + 1];
      const worldH = this.simulation.state.terrain.getElevation(centerX + lx, centerZ + lz, centerElev, 64).height;
      const clampedRel = Math.max(-28, Math.min(28, worldH - centerElev));
      pos.setY(i, clampedRel + elevOffset);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /**
   * Keeps the third-person camera unobstructed without snapping upward into a top-down view:
   * raycasts from shoulder height to the desired orbit eye to pull zoom smoothly inward before walls/cliffs/arches,
   * and only nudges upward over gentle local ground slopes beneath the eye.
   */
  private resolveCameraTerrainCollision(focus: THREE.Vector3, eye: THREE.Vector3, dt: number): void {
    const terrain = this.simulation.state.terrain;
    const desiredEyeY = eye.y;

    const focusGroundH = terrain.meshCollider
      ? focus.y
      : terrain.calculateHeight(focus.x, focus.z);
    const pivotY = Math.max(focus.y + 64, focusGroundH + 56);
    this.camShoulderScratch.set(focus.x, pivotY, focus.z);

    let targetHitT = 1.0;
    if (terrain.meshCollider) {
      const hit = terrain.meshCollider.raycast3D(
        { x: this.camShoulderScratch.x, y: this.camShoulderScratch.z, z: this.camShoulderScratch.y },
        { x: eye.x, y: eye.z, z: eye.y },
        true
      );
      if (hit.hit) {
        targetHitT = Math.max(0.28, hit.t * 0.88);
      }
    } else {
      const steps = 12;
      for (let i = 2; i < steps; i++) {
        const t = i / steps;
        this.camSampleScratch.lerpVectors(this.camShoulderScratch, eye, t);
        const terrainH = terrain.calculateHeight(this.camSampleScratch.x, this.camSampleScratch.z);
        if (this.camSampleScratch.y < terrainH + 6) {
          targetHitT = Math.max(0.32, (i - 0.5) / steps);
          break;
        }
      }
    }

    const blendRate = targetHitT < this.camCollisionDistFrac ? 18 : 8;
    this.camCollisionDistFrac += (targetHitT - this.camCollisionDistFrac) * Math.min(1, dt * blendRate);

    if (this.camCollisionDistFrac < 0.999) {
      eye.lerpVectors(this.camShoulderScratch, eye, this.camCollisionDistFrac);
    }

    // Gentle local ground clearance only (never query at 1e6 or catapult up onto overhead bridges/tower roofs!)
    if (!terrain.meshCollider || terrain.isInsidePlayableBounds(eye.x, eye.z, 0)) {
      const eyeGroundH = terrain.meshCollider
        ? terrain.meshCollider.querySupport(eye.x, eye.z, Math.min(eye.y, focus.y + 80), 16).height
        : terrain.calculateHeight(eye.x, eye.z);
      const minClearY = eyeGroundH + 18;
      // Only lift up if the terrain slope under the eye is close to eye height; steep obstacles are already handled by ray pull-in
      if (eye.y < minClearY && minClearY <= desiredEyeY + 55) {
        eye.y = minClearY;
      }
    }
  }

  private getSharedEnemyShadowMat(): THREE.MeshBasicMaterial {
    if (!this.sharedEnemyShadowMat) {
      this.sharedEnemyShadowMat = new THREE.MeshBasicMaterial({
        map: this.textures['shadow'],
        transparent: true,
        opacity: 0.78,
        depthWrite: false
      });
    }
    return this.sharedEnemyShadowMat;
  }

  private getSharedColorMat(cache: Map<number, THREE.MeshBasicMaterial>, color: number, opacity: number = 1.0): THREE.MeshBasicMaterial {
    let mat = cache.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: opacity < 1.0,
        opacity
      });
      cache.set(color, mat);
    }
    return mat;
  }

  private getSharedAuraRingGeo(radius: number): THREE.BufferGeometry {
    const key = Math.round(radius);
    let geo = this.sharedAuraRingGeoCache.get(key);
    if (!geo) {
      geo = new THREE.PlaneGeometry(key * 2.25, key * 2.25);
      geo.rotateX(-Math.PI / 2);
      this.sharedAuraRingGeoCache.set(key, geo);
    }
    return geo;
  }

  private getSharedAuraMistMat(colorHex: number): THREE.Material {
    let mat = this.sharedAuraMatCache.get(colorHex);
    if (!mat) {
      const sMat = this.vfx.createOrganicRippleShader(colorHex, undefined, (colorHex % 97) * 0.3);
      sMat.uniforms.uProgress.value = 0.55;
      sMat.uniforms.uAlpha.value = 0.72;
      mat = sMat;
      this.sharedAuraMatCache.set(colorHex, mat);
    }
    return mat;
  }

  private computeSpriteAspectScale(
    tex: THREE.Texture | undefined,
    frameCount: number,
    baseHeight: number,
    fallbackWidth?: number,
    fallbackHeight?: number
  ): { width: number; height: number; imgW: number; imgH: number; resolved: boolean } {
    const img = tex?.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined;
    const imgW = img?.naturalWidth || img?.width || 0;
    const imgH = img?.naturalHeight || img?.height || 0;
    if (imgW > 0 && imgH > 0) {
      const frameW = imgW / Math.max(1, frameCount);
      return {
        width: baseHeight * (frameW / imgH),
        height: baseHeight,
        imgW,
        imgH,
        resolved: true
      };
    }
    if (fallbackWidth && fallbackHeight && fallbackHeight > 0) {
      return {
        width: baseHeight * (fallbackWidth / fallbackHeight),
        height: baseHeight,
        imgW: fallbackWidth * Math.max(1, frameCount),
        imgH: fallbackHeight,
        resolved: false
      };
    }
    return { width: baseHeight, height: baseHeight, imgW: 512, imgH: 512, resolved: false };
  }

  private create25DBillboardMaterial(
    tex: THREE.Texture | undefined,
    options: {
      alphaTest?: number;
      rimColor?: number;
      rimStrength?: number;
      footAOStrength?: number;
      bioPulseStrength?: number;
      puppetMode?: number;
      phase?: number;
      bounceStrength?: number;
    } = {}
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uMap: { value: tex || null },
          uFrameOffset: { value: 0.0 },
          uFrameWidth: { value: 1.0 },
          uTexelSize: { value: new THREE.Vector2(1 / 512, 1 / 512) },
          uAlphaTest: { value: options.alphaTest ?? 0.15 },
          uOpacity: { value: 1.0 },
          uTime: { value: 0.0 },
          uHitFlash: { value: 0.0 },
          uStatusTint: { value: new THREE.Color(1, 1, 1) },
          uEmergeShade: { value: 1.0 },
          uRimColor: { value: new THREE.Color(options.rimColor ?? 0x7dd3fc) },
          uRimStrength: { value: options.rimStrength ?? 0.45 },
          uFootAOStrength: { value: options.footAOStrength ?? 0.36 },
          uBioPulseStrength: { value: options.bioPulseStrength ?? 0.22 },
          uPuppetMode: { value: options.puppetMode ?? 0.0 },
          uPhase: { value: options.phase ?? 0.0 },
          uMoveFactor: { value: 1.0 },
          uBounceStrength: { value: options.bounceStrength ?? 0.65 }
        }
      ]),
      vertexShader: BILLBOARD_25D_VERT,
      fragmentShader: BILLBOARD_25D_FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true
    });
  }

  private setCylindricalYaw(obj: THREE.Object3D, worldX: number, worldZ: number): number {
    const yaw = Math.atan2(this.camera.position.x - worldX, this.camera.position.z - worldZ);
    obj.rotation.set(0, yaw, 0);
    return yaw;
  }

  private disposeEnemyRenderEntry(record: EnemyRenderEntry): void {
    const disposeOwnedChildren = (root: THREE.Object3D) => {
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
          const m = child as THREE.Mesh;
          if (!m.userData?.isSharedGeo) m.geometry?.dispose();
          if (!m.userData?.isSharedMat) {
            if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
            else m.material?.dispose();
          }
        }
      });
    };

    if (record.isTitan) {
      if (record.titan3D) {
        this.scene.remove(record.titan3D.group);
        record.titan3D.dispose();
      }
      if (record.titanMesh) {
        this.scene.remove(record.titanMesh);
        record.titanMaterial?.dispose();
      }
      if (record.titanLaserGroup) {
        this.scene.remove(record.titanLaserGroup);
        disposeOwnedChildren(record.titanLaserGroup);
      }
      if (record.titanTentacleGroup) {
        this.scene.remove(record.titanTentacleGroup);
        disposeOwnedChildren(record.titanTentacleGroup);
      }
      if (record.titanElementalOrbs) {
        for (const orb of record.titanElementalOrbs) {
          this.scene.remove(orb);
          disposeOwnedChildren(orb);
        }
      }
      record.titanElementalMat?.dispose();
      record.titanElementalHaloMat?.dispose();
    }

    this.scene.remove(record.mesh);
    record.material.dispose();
    this.scene.remove(record.shadow);
    this.scene.remove(record.hpBarGroup);
    if (record.auraRing) {
      this.scene.remove(record.auraRing);
    }
    if (record.encasedIceGroup) {
      this.scene.remove(record.encasedIceGroup);
      disposeOwnedChildren(record.encasedIceGroup);
    }
  }

  private syncEnemies(dt: number = 0.016): void {
    const enemies = this.simulation.state.enemies;
    const currentIds = this.scratchEnemyIds;
    currentIds.clear();
    const elapsedSec = performance.now() * 0.001;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      currentIds.add(e.id);

      let record = this.enemyMap.get(e.id);
      if (!record) {
        if (e.isStage1Titan) {
          // Dedicated Stage 1 Titan Colossus Setup (Articulated 3D Organic Mesh + Volumetric Shaders)
          const { map: tSkinTex, emissiveMap: tEmissiveTex } = this.getTentacleTextures();
          const boss3D = new Stage1Boss3DModel(tSkinTex, tEmissiveTex);
          this.scene.add(boss3D.group);

          // Titan Volumetric 3D Bio-Plasma Beam Group (Attack 1: Laser Sweep)
          const laserGrp = new THREE.Group();
          laserGrp.name = 'titan_laser_grp';
          laserGrp.userData = { isTitanPart: true };
          laserGrp.frustumCulled = false;
          laserGrp.renderOrder = 300;

          // 1. Inner Incandescent Turbulent Core Stream (zero CylinderGeometry)
          const beamCoreGeo = this.vfx.createOrganicPlumeColumnGeo(18.0, 14.0, 1, 16, 10, 0.24, 1.2);
          const beamCoreMat = this.createVolumetricBeamMaterial(0xffffff, 0xf0abfc, 1.35, 0.96, 26.0);
          const beamCore = new THREE.Mesh(beamCoreGeo, beamCoreMat);
          beamCore.frustumCulled = false;
          beamCore.renderOrder = 302;
          laserGrp.add(beamCore);

          // 2. Outer Volumetric Magenta-Violet Plasma Sheath
          const beamAuraGeo = this.vfx.createOrganicPlumeColumnGeo(44.0, 30.0, 1, 16, 10, 0.30, -1.4);
          const beamAuraMat = this.createVolumetricBeamMaterial(0xe879f9, 0x7e22ce, 2.35, 0.72, 18.0);
          const beamAura = new THREE.Mesh(beamAuraGeo, beamAuraMat);
          beamAura.frustumCulled = false;
          beamAura.renderOrder = 300;
          laserGrp.add(beamAura);

          // 3. Flared Maw Emitter Plasma Plume + Molten Oral Flame Core
          const mouthFunnelGeo = this.vfx.createOrganicPlumeColumnGeo(36.0, 13.0, 56, 16, 6, 0.28, 1.1);
          mouthFunnelGeo.translate(0, 28, 0);
          const mouthFunnelMat = this.createVolumetricBeamMaterial(0xf5d0fe, 0xc084fc, 1.7, 0.85, 22.0);
          const mouthFunnel = new THREE.Mesh(mouthFunnelGeo, mouthFunnelMat);
          mouthFunnel.frustumCulled = false;
          mouthFunnel.renderOrder = 303;
          laserGrp.add(mouthFunnel);

          const mouthOrbGeo = this.vfx.createOrganicPlumeColumnGeo(14.0, 24.0, 40, 14, 6, 0.35, -1.6);
          const mouthOrbMat = this.createBioPlasmaMaterial(0xffffff, 0xf472b6, 0xa855f7, 1.4, 0.96, false, true);
          const mouthOrb = new THREE.Mesh(mouthOrbGeo, mouthOrbMat);
          mouthOrb.frustumCulled = false;
          mouthOrb.renderOrder = 304;
          laserGrp.add(mouthOrb);

          // 4. Twin 3D Articulated Helical Bio-Energy Tendrils Coiling Along Beam
          const helixTubes: THREE.Mesh[] = [];
          const helixSpinePts: THREE.Vector3[][] = [];
          const helixMat = new THREE.MeshStandardMaterial({
            map: tSkinTex,
            emissiveMap: tEmissiveTex,
            emissive: 0xe879f9,
            emissiveIntensity: 1.55,
            roughness: 0.22,
            metalness: 0.35,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
          });
          for (let a = 0; a < 2; a++) {
            const hGeo = this.createTentacleBufferGeo(26, 10);
            const hMesh = new THREE.Mesh(hGeo, helixMat);
            hMesh.frustumCulled = false;
            hMesh.renderOrder = 305;
            hMesh.userData = { isSharedMat: a > 0 };
            laserGrp.add(hMesh);
            helixTubes.push(hMesh);

            const pts: THREE.Vector3[] = [];
            for (let s = 0; s <= 26; s++) pts.push(new THREE.Vector3());
            helixSpinePts.push(pts);
          }

          // 5. Boiling 3D Turbulent Impact Plasma Plume & Ground Mist Gusts (zero sphere/circle/ring)
          const impactDomeGeo = this.vfx.createOrganicPlumeColumnGeo(16, 48, 52, 14, 6, 0.34, 1.4);
          impactDomeGeo.translate(0, 26, 0);
          const impactDomeMat = this.createBioPlasmaMaterial(0xffffff, 0xf43f5e, 0x9333ea, 2.2, 0.9, false, true);
          const impactDome = new THREE.Mesh(impactDomeGeo, impactDomeMat);
          impactDome.frustumCulled = false;
          impactDome.renderOrder = 304;
          laserGrp.add(impactDome);

          const flareTex = this.textures['energy_flare'];
          const impactGeo = new THREE.PlaneGeometry(168, 168);
          const impactMat = new THREE.MeshBasicMaterial({
            map: flareTex || null,
            color: flareTex ? 0xe879f9 : 0xdc2626,
            transparent: true,
            opacity: flareTex ? 0.88 : 0.35,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
          });
          const impactDisc = new THREE.Mesh(impactGeo, impactMat);
          impactDisc.rotation.x = -Math.PI / 2;
          impactDisc.frustumCulled = false;
          impactDisc.renderOrder = 302;
          laserGrp.add(impactDisc);

          const impactRingGeo = new THREE.PlaneGeometry(195, 195);
          const impactRingMat = this.vfx.createOrganicRippleShader(0xf43f5e, 0xe879f9, 17.0);
          const impactRing = new THREE.Mesh(impactRingGeo, impactRingMat);
          impactRing.rotation.x = -Math.PI / 2;
          impactRing.frustumCulled = false;
          impactRing.renderOrder = 301;
          laserGrp.add(impactRing);

          laserGrp.visible = false;
          this.scene.add(laserGrp);

          // Titan Elemental Orbs (Attack 3: 10 3D turbulent bio-plasma plumes on live dorsal tentacle tips)
          const elementalOrbs: THREE.Group[] = [];
          const elemCoreGeo = this.vfx.createOrganicPlumeColumnGeo(7, 15, 26, 12, 5, 0.36, 1.5);
          const elemHaloGeo = this.vfx.createOrganicPlumeColumnGeo(12, 23, 38, 12, 5, 0.42, -1.4);
          const elemOrbMat = this.createBioPlasmaMaterial(0xffffff, 0xf472b6, 0x7e22ce, 1.35, 0.98, false, false);
          const elemHaloMat = this.createBioPlasmaMaterial(0xf5d0fe, 0xe879f9, 0x9333ea, 1.7, 0.92, true, true);
          for (let k = 0; k < 10; k++) {
            const orbGrp = new THREE.Group();
            orbGrp.name = `titan_orb_grp_${k}`;
            orbGrp.userData = { isTitanPart: true };

            const coreMesh = new THREE.Mesh(elemCoreGeo, elemOrbMat);
            coreMesh.userData = { isSharedGeo: k > 0, isSharedMat: true };
            coreMesh.renderOrder = 306;
            orbGrp.add(coreMesh);

            const haloMesh = new THREE.Mesh(elemHaloGeo, elemHaloMat);
            haloMesh.userData = { isSharedGeo: k > 0, isSharedMat: true };
            haloMesh.renderOrder = 307;
            orbGrp.add(haloMesh);

            orbGrp.visible = false;
            this.scene.add(orbGrp);
            elementalOrbs.push(orbGrp);
          }

          // Titan Tentacle Strike Group (Attack 2: 4 Articulated Volumetric Tapered Tentacles + Ground Telegraph Reticle)
          const tentacleGrp = new THREE.Group();
          tentacleGrp.name = 'titan_tentacle_grp';
          tentacleGrp.userData = { isTitanPart: true };

          // Ground Telegraph Reticle Group
          const markerGrp = new THREE.Group();
          markerGrp.name = 'titan_tentacle_marker_grp';

          const strikeRad = STAGE1_BOSS_CONFIG.tentacle.strikeRadius;
          const { geo: markerRingGeo, origXZ: ringOrigXZ } = this.createConformalRingGeo(0, strikeRad, 24, 1);
          const markerRingMat = this.vfx.createOrganicRippleShader(0xc084fc, 0xf43f5e, 11.0);
          markerRingMat.uniforms.uProgress.value = 0.65;
          markerRingMat.uniforms.uAlpha.value = 0.85;
          const markerRingMesh = new THREE.Mesh(markerRingGeo, markerRingMat);
          markerGrp.add(markerRingMesh);

          const { geo: markerFillGeo, origXZ: fillOrigXZ } = this.createConformalRingGeo(0, strikeRad * 0.88, 24, 1);
          const markerFillMat = this.vfx.createOrganicRippleShader(0xd946ef, 0xbe123c, 27.0);
          markerFillMat.uniforms.uProgress.value = 0.35;
          markerFillMat.uniforms.uAlpha.value = 0.32;
          const markerFillMesh = new THREE.Mesh(markerFillGeo, markerFillMat);
          markerGrp.add(markerFillMesh);

          const { geo: markerCoreGeo, origXZ: coreOrigXZ } = this.createConformalRingGeo(0, 18, 12, 0);
          const markerCoreMat = this.vfx.createOrganicRippleShader(0xfda4af, 0xffffff, 5.0);
          markerCoreMat.uniforms.uProgress.value = 0.15;
          markerCoreMat.uniforms.uAlpha.value = 0.65;
          const markerCoreMesh = new THREE.Mesh(markerCoreGeo, markerCoreMat);
          markerGrp.add(markerCoreMesh);

          // 4 Orbiting Bio-Seismic Tremor Tendril Flame Shards (zero triangle arrows)
          const chevronGrp = new THREE.Group();
          const chevGeo = this.vfx.createJaggedShardGeo(4.2, 16, 5, 91);
          chevGeo.rotateX(-Math.PI / 2);
          const chevMat = new THREE.MeshBasicMaterial({
            color: 0xf43f5e,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          });
          for (let c = 0; c < 4; c++) {
            const chevMesh = new THREE.Mesh(chevGeo, chevMat);
            const ang = (c / 4) * Math.PI * 2;
            const dist = strikeRad * 0.72;
            chevMesh.position.set(Math.cos(ang) * dist, 1.8, Math.sin(ang) * dist);
            chevMesh.rotation.y = Math.atan2(-Math.cos(ang), -Math.sin(ang));
            chevronGrp.add(chevMesh);
          }
          markerGrp.add(chevronGrp);
          tentacleGrp.add(markerGrp);

          // 4 Volumetric Tapered 3D Alien Tentacles
          const tentacleMeshes: THREE.Mesh[] = [];
          const tentacleSpines: THREE.Line[] = [];
          const tentacleStingers: THREE.Mesh[] = [];
          const tentacleImpactRings: THREE.Mesh[] = [];

          const tentacleMat = new THREE.MeshStandardMaterial({
            map: tSkinTex,
            emissiveMap: tEmissiveTex,
            emissive: 0xd946ef,
            emissiveIntensity: 0.85,
            roughness: 0.28,
            metalness: 0.35,
            side: THREE.DoubleSide
          });

          const spineMat = new THREE.LineBasicMaterial({
            color: 0xff2a6d,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending
          });

          const stingerGeo = this.vfx.createJaggedShardGeo(3.6, 28, 5, 41);
          stingerGeo.rotateX(Math.PI / 2); // Orient forward along +Z axis
          const stingerMat = new THREE.MeshStandardMaterial({
            color: 0x9f1239,
            emissive: 0xf43f5e,
            emissiveIntensity: 1.1,
            roughness: 0.20,
            metalness: 0.45
          });

          const tentacleImpactRingGeo = new THREE.PlaneGeometry(24, 24);
          tentacleImpactRingGeo.rotateX(-Math.PI / 2);
          const tentacleImpactRingMat = new THREE.MeshBasicMaterial({
            map: this.textures['energy_flare'] || null,
            color: 0xf43f5e,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
          });

          for (let a = 0; a < 4; a++) {
            // Fleshy volumetric tube (28 segments x 10 radial for ultra smooth curve)
            const tGeo = this.createTentacleBufferGeo(28, 10);
            const tMesh = new THREE.Mesh(tGeo, tentacleMat);
            tMesh.frustumCulled = false;
            tMesh.renderOrder = 310;
            tentacleGrp.add(tMesh);
            tentacleMeshes.push(tMesh);

            // Glowing dorsal bio-vein arc
            const spGeo = new THREE.BufferGeometry();
            const spLine = new THREE.Line(spGeo, spineMat);
            spLine.frustumCulled = false;
            spLine.renderOrder = 312;
            tentacleGrp.add(spLine);
            tentacleSpines.push(spLine);

            // Chitinous razor stinger tip
            const stMesh = new THREE.Mesh(stingerGeo, stingerMat);
            stMesh.frustumCulled = false;
            stMesh.renderOrder = 311;
            tentacleGrp.add(stMesh);
            tentacleStingers.push(stMesh);

            // Ground impact ring
            const impMesh = new THREE.Mesh(tentacleImpactRingGeo, tentacleImpactRingMat);
            impMesh.frustumCulled = false;
            impMesh.renderOrder = 305;
            impMesh.visible = false;
            tentacleGrp.add(impMesh);
            tentacleImpactRings.push(impMesh);
          }

          tentacleGrp.visible = false;
          this.scene.add(tentacleGrp);

          // Titan Soft Contact Shadow Decal (shared geometry + material)
          const titanShadow = new THREE.Mesh(this.sharedUnitPlaneGeo, this.getSharedEnemyShadowMat());
          titanShadow.name = 'titan_shadow';
          titanShadow.userData = { isTitanPart: true, isSharedGeo: true, isSharedMat: true };
          titanShadow.rotation.x = -Math.PI / 2;
          titanShadow.scale.set(STAGE1_BOSS_CONFIG.baseWidth * 0.85, STAGE1_BOSS_CONFIG.baseWidth * 0.85, 1);
          this.scene.add(titanShadow);

          // Minimal dummy objects for type safety
          const dummyMat = this.create25DBillboardMaterial(undefined);
          const dummyMesh = new THREE.Mesh(this.sharedUnitPlaneGeo, dummyMat);
          dummyMesh.visible = false;
          const dummyHpGroup = new THREE.Group();
          dummyHpGroup.visible = false;
          const dummyFill = new THREE.Mesh(this.sharedUnitPlaneGeo, this.sharedHpBgMat);

          record = {
            mesh: dummyMesh,
            material: dummyMat,
            aspectWidth: STAGE1_BOSS_CONFIG.baseWidth,
            aspectHeight: STAGE1_BOSS_CONFIG.baseHeight,
            aspectResolved: true,
            shadow: titanShadow,
            hpBarGroup: dummyHpGroup,
            hpBarFill: dummyFill,
            lastHealth: e.health,
            hitFlashTimer: 0,
            baseScale: STAGE1_BOSS_CONFIG.baseHeight,
            isTitan: true,
            titan3D: boss3D,
            titanAnimTime: 0,
            titanLastWalkFrame: -1,
            titanLaserGroup: laserGrp,
            titanLaserBeamCore: beamCore,
            titanLaserBeamAura: beamAura,
            titanLaserMouthFunnel: mouthFunnel,
            titanLaserMouthOrb: mouthOrb,
            titanLaserHelixTubes: helixTubes,
            titanLaserHelixSpinePts: helixSpinePts,
            titanLaserImpactDome: impactDome,
            titanLaserImpactDisc: impactDisc,
            titanLaserImpactRing: impactRing,
            titanLaserJitterTimer: 0,
            titanElementalOrbs: elementalOrbs,
            titanElementalMat: elemOrbMat,
            titanElementalHaloMat: elemHaloMat,
            titanTentacleGroup: tentacleGrp,
            titanTentacleMarkerGroup: markerGrp,
            titanTentacleMarkerRing: markerRingMesh,
            titanTentacleMarkerFill: markerFillMesh,
            titanTentacleMarkerCore: markerCoreMesh,
            titanTentacleMarkerChevrons: chevronGrp,
            titanTentacleRingOrigXZ: ringOrigXZ,
            titanTentacleFillOrigXZ: fillOrigXZ,
            titanTentacleCoreOrigXZ: coreOrigXZ,
            titanTentacleChevronAngle: 0,
            titanTentacleMeshes: tentacleMeshes,
            titanTentacleSpines: tentacleSpines,
            titanTentacleStingers: tentacleStingers,
            titanTentacleImpactRings: tentacleImpactRings
          };
          this.enemyMap.set(e.id, record);
        } else {
          const def = ENEMY_VISUAL_CATALOG[e.type as EnemyType] || ENEMY_VISUAL_CATALOG.crawler;
          const enemyTex = this.textures[def.textureKey] || this.textures[def.fallbackKey] || this.textures['void_crawler'];
          const aspect = this.computeSpriteAspectScale(enemyTex, def.frameCount, def.baseHeight);
          const isFlyer = def.hoverHeight > 0;
          const puppetMode =
            e.type === 'wasp' || e.type === 'boss'
              ? 3.0
              : e.type === 'spitter'
                ? 2.0
                : 1.0;
          const defaultRim =
            e.type === 'spitter'
              ? 0x84cc16
              : e.type === 'wasp'
                ? 0xe879f9
                : e.type === 'elite'
                  ? 0xc084fc
                  : 0xa855f7;

          const mat = this.create25DBillboardMaterial(enemyTex, {
            alphaTest: 0.18,
            rimColor: def.auraColor ?? defaultRim,
            rimStrength: e.isBoss ? 0.56 : e.isElite ? 0.48 : 0.38,
            footAOStrength: isFlyer ? 0.0 : 0.34,
            bioPulseStrength: 0.30,
            puppetMode,
            phase: (i * 1.73) % 6.28,
            bounceStrength: isFlyer ? 0.35 : 0.72
          });
          mat.uniforms.uFrameWidth.value = 1 / Math.max(1, def.frameCount);
          mat.uniforms.uTexelSize.value.set(1 / aspect.imgW, 1 / aspect.imgH);

          const mesh = new THREE.Mesh(this.sharedEnemyPuppetGeo, mat);
          mesh.scale.set(aspect.width, aspect.height, 1);
          mesh.userData = { isSharedGeo: true };
          this.scene.add(mesh);

          // Shared Shadow Decal (unit plane scaled per enemy radius)
          const shadowSize = e.radius * 2.4;
          const shadow = new THREE.Mesh(this.sharedUnitPlaneGeo, this.getSharedEnemyShadowMat());
          shadow.rotation.x = -Math.PI / 2;
          shadow.scale.set(shadowSize, shadowSize, 1);
          shadow.userData = { isSharedGeo: true, isSharedMat: true, baseShadowSize: shadowSize };
          this.scene.add(shadow);

          // Elite & Boss Aura Ring (cached geometry & material)
          let auraRing: THREE.Mesh | undefined;
          if (def.auraColor !== undefined || e.isBoss || e.isElite) {
            const auraColor = def.auraColor ?? (e.isBoss ? 0xe11d48 : 0x00f0ff);
            const ringRad = e.radius * 1.35;
            auraRing = new THREE.Mesh(
              this.getSharedAuraRingGeo(ringRad),
              this.getSharedAuraMistMat(auraColor)
            );
            auraRing.userData = { isSharedGeo: true, isSharedMat: true };
            this.scene.add(auraRing);
          }

          // 3D HP Bar (shared unit planes + cached color materials)
          const hpBarGroup = new THREE.Group();
          const bgMesh = new THREE.Mesh(this.sharedUnitPlaneGeo, this.sharedHpBgMat);
          bgMesh.scale.set(def.hpWidth, def.hpHeight, 1);
          bgMesh.userData = { isSharedGeo: true, isSharedMat: true };
          hpBarGroup.add(bgMesh);

          const borderMesh = new THREE.Mesh(
            this.sharedUnitPlaneGeo,
            this.getSharedColorMat(this.sharedHpMatCache, def.hpBorderColor)
          );
          borderMesh.scale.set(def.hpWidth + 2, def.hpHeight + 2, 1);
          borderMesh.position.z = -0.05;
          borderMesh.userData = { isSharedGeo: true, isSharedMat: true };
          hpBarGroup.add(borderMesh);

          const hpBarFill = new THREE.Mesh(
            this.sharedUnitPlaneGeo,
            this.getSharedColorMat(this.sharedHpMatCache, def.hpColor)
          );
          hpBarFill.scale.set(def.hpWidth, def.hpHeight, 1);
          hpBarFill.position.z = 0.1;
          hpBarFill.userData = { isSharedGeo: true, isSharedMat: true };
          hpBarGroup.add(hpBarFill);
          this.scene.add(hpBarGroup);

          record = {
            mesh,
            material: mat,
            visualDef: def,
            aspectWidth: aspect.width,
            aspectHeight: aspect.height,
            aspectResolved: aspect.resolved,
            shadow,
            auraRing,
            hpBarGroup,
            hpBarFill,
            lastHealth: e.health,
            hitFlashTimer: 0,
            baseScale: def.baseHeight
          };
          this.enemyMap.set(e.id, record);
        }
      }

      // 1. Damage Hit Flash & Status Tint Uniforms
      if (e.health < record.lastHealth) {
        record.hitFlashTimer = 0.14;
        record.lastHealth = e.health;
      }
      if (record.hitFlashTimer > 0) {
        record.hitFlashTimer -= dt;
      }
      const hitFlashAmt = record.hitFlashTimer > 0 ? 1.0 : 0.0;
      record.material.uniforms.uTime.value = elapsedSec;
      record.material.uniforms.uHitFlash.value = hitFlashAmt;
      const statusTint = record.material.uniforms.uStatusTint.value as THREE.Color;
      if (e.isChilled) {
        statusTint.setRGB(0.45, 0.85, 1.4);
      } else if (e.isElectrified) {
        statusTint.setRGB(1.5, 0.65, 1.85);
      } else if (e.isToxic) {
        statusTint.setRGB(0.55, 1.35, 0.4);
      } else if (e.isStunned) {
        statusTint.setRGB(1.5, 1.4, 0.35);
      } else if ((e.rangedWindupTimer ?? 0) > 0) {
        const wPulse = 1.32 + 0.25 * Math.sin(elapsedSec * 24.0);
        if (e.isBoss) statusTint.setRGB(wPulse * 1.15, 0.72, 0.78);
        else if (e.isElite) statusTint.setRGB(wPulse * 1.15, 0.92, 0.65);
        else statusTint.setRGB(wPulse, 0.85, 1.25);
      } else {
        statusTint.setRGB(1.0, 1.0, 1.0);
      }

      if (record.isTitan) {
        // --- STAGE 1 TITAN MAIN BOSS 3D ARTICULATED RENDERING ---
        record.mesh.visible = false;
        if (record.auraRing) record.auraRing.visible = false;
        record.hpBarGroup.visible = false; // Main boss health bar is on top HUD

        if (record.titan3D) {
          const { footstepTriggered } = record.titan3D.update(
            e,
            dt,
            this.simulation.state.player.pos,
            elapsedSec
          );

          if (footstepTriggered) {
            this.vfx.spawnTitanFootstepPuff(e.pos, e.groundZ);
            const playerDist = Math.hypot(
              this.simulation.state.player.pos.x - e.pos.x,
              this.simulation.state.player.pos.y - e.pos.y
            );
            if (playerDist < 950) {
              const prox = 1.0 - playerDist / 950;
              this.addCameraTrauma(0.08 + 0.14 * prox);
            }
          }
        }

        record.shadow.position.set(e.pos.x, e.groundZ + 0.25, e.pos.y);
        record.shadow.scale.set(540, 540, 1);
        record.shadow.visible = (e.titanState !== 'emerging' && e.titanState !== 'dying');

        // Synchronized Red Boss Crystal emergence glow & energy pulse
        if (this.activeRedCrystalMaterials.length > 0) {
          let targetPulseBoost = 0;
          if (e.titanState === 'emerging') {
            const emergeProg = Math.min(1.0, Math.max(0.0, 1.0 - (e.titanTimer ?? 3.6) / 3.6));
            const flicker = 0.85 + 0.15 * Math.sin(elapsedSec * 22.0);
            targetPulseBoost =
              emergeProg < 0.22
                ? (emergeProg / 0.22) * 1.45 * flicker
                : emergeProg < 0.55
                  ? (1.45 + ((emergeProg - 0.22) / 0.33) * 0.9) * flicker
                  : Math.max(0, 2.35 * (1.0 - (emergeProg - 0.55) / 0.45));
          }
          for (let ci = 0; ci < this.activeRedCrystalMaterials.length; ci++) {
            const entry = this.activeRedCrystalMaterials[ci];
            const desiredEmissive = entry.baseEmissiveIntensity + targetPulseBoost;
            entry.material.emissiveIntensity += (desiredEmissive - entry.material.emissiveIntensity) * Math.min(1, dt * 10);
          }
        }

        // ATTACK 1: Volumetric 3D Bio-Plasma Beam with Swirling Helical Tendrils & Terrain Impact Dome
        if (record.titanLaserGroup) {
          if (e.titanState === 'laser_sweep' && record.titan3D) {
            record.titanLaserGroup.visible = true;
            record.titan3D.getMouthWorldPos(this.titanMouthScratch);

            const beamAngle = e.titanLaserAngle ?? 0;
            const beamRange = STAGE1_BOSS_CONFIG.laser.range;
            const rawEndX = e.pos.x + Math.cos(beamAngle) * beamRange;
            const rawEndY = e.pos.y + Math.sin(beamAngle) * beamRange;
            const targetZ = this.simulation.state.player.z + 52;

            // 3D Terrain Obstruction Raycast: check if beam impacts terrain or cliffs
            const raySteps = 32;
            this.titanEndScratch.set(rawEndX, targetZ, rawEndY);
              for (let r = 1; r <= raySteps; r++) {
                const rt = r / raySteps;
                const rx = this.titanMouthScratch.x + (rawEndX - this.titanMouthScratch.x) * rt;
                const ry = this.titanMouthScratch.z + (rawEndY - this.titanMouthScratch.z) * rt;
                const rz = this.titanMouthScratch.y + (targetZ - this.titanMouthScratch.y) * rt;
                const th = this.simulation.state.terrain.getFastVisualHeight(rx, ry, undefined, 56);
              if (r > 2 && rz <= th) {
                this.titanEndScratch.set(rx, th + 0.5, ry);
                break;
              }
            }

            this.titanBeamVecScratch.subVectors(this.titanEndScratch, this.titanMouthScratch);
            const beamLen = Math.max(1.0, this.titanBeamVecScratch.length());
            this.titanBeamDirScratch.copy(this.titanBeamVecScratch).multiplyScalar(1 / beamLen);

            if (Math.abs(this.titanBeamDirScratch.y) < 0.9) {
              this.titanV1Scratch.crossVectors(this.titanUpScratch, this.titanBeamDirScratch).normalize();
            } else {
              this.titanV1Scratch.set(1, 0, 0).cross(this.titanBeamDirScratch).normalize();
            }
            this.titanV2Scratch.crossVectors(this.titanBeamDirScratch, this.titanV1Scratch).normalize();

            const beamPulse = 1.0 + 0.08 * Math.sin(elapsedSec * 28.0);

            // Orient Volumetric Inner Core & Outer Plasma Sheath along beam axis
            if (record.titanLaserBeamCore) {
              record.titanLaserBeamCore.position.lerpVectors(this.titanMouthScratch, this.titanEndScratch, 0.5);
              record.titanLaserBeamCore.quaternion.setFromUnitVectors(this.titanUpScratch, this.titanBeamDirScratch);
              record.titanLaserBeamCore.scale.set(beamPulse, beamLen, beamPulse);
              (record.titanLaserBeamCore.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsedSec;
            }
            if (record.titanLaserBeamAura) {
              record.titanLaserBeamAura.position.lerpVectors(this.titanMouthScratch, this.titanEndScratch, 0.5);
              record.titanLaserBeamAura.quaternion.setFromUnitVectors(this.titanUpScratch, this.titanBeamDirScratch);
              record.titanLaserBeamAura.scale.set(beamPulse, beamLen, beamPulse);
              (record.titanLaserBeamAura.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsedSec;
            }

            // Maw Nozzle Funnel & Molten Core Orb at 3D Boss Jaw
            if (record.titanLaserMouthFunnel) {
              record.titanLaserMouthFunnel.position.copy(this.titanMouthScratch);
              record.titanLaserMouthFunnel.quaternion.setFromUnitVectors(this.titanUpScratch, this.titanBeamDirScratch);
              record.titanLaserMouthFunnel.scale.setScalar(beamPulse);
              (record.titanLaserMouthFunnel.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsedSec;
            }
            if (record.titanLaserMouthOrb) {
              record.titanLaserMouthOrb.position.copy(this.titanMouthScratch);
              record.titanLaserMouthOrb.scale.setScalar(0.95 + 0.14 * Math.sin(elapsedSec * 22.0));
              (record.titanLaserMouthOrb.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsedSec;
            }

            // Twin 3D Articulated Helical Bio-Energy Tendrils Coiling Along Beam
            if (record.titanLaserHelixTubes && record.titanLaserHelixSpinePts) {
              for (let a = 0; a < record.titanLaserHelixTubes.length; a++) {
                const pts = record.titanLaserHelixSpinePts[a];
                const basePhase = a * Math.PI;
                for (let s = 0; s <= 26; s++) {
                  const u = s / 26;
                  const t = u * 0.985;
                  const env = Math.sin(Math.min(1.0, u * 1.15) * Math.PI);
                  const rad = 14.0 + 10.0 * env + 3.0 * Math.sin(u * 14.0 - elapsedSec * 12.0 + a);
                  const ang = basePhase + u * Math.PI * 9.0 - elapsedSec * 15.0;
                  pts[s]
                    .copy(this.titanMouthScratch)
                    .addScaledVector(this.titanBeamVecScratch, t)
                    .addScaledVector(this.titanV1Scratch, Math.cos(ang) * rad)
                    .addScaledVector(this.titanV2Scratch, Math.sin(ang) * rad);
                }
                this.updateTentacleGeo(record.titanLaserHelixTubes[a].geometry, pts, 6.0, 10);
              }
            }

            // Boiling 3D Hemispherical Impact Dome & Ground Shockwaves at strike termination
            if (record.titanLaserImpactDome) {
              record.titanLaserImpactDome.position.copy(this.titanEndScratch);
              record.titanLaserImpactDome.scale.setScalar(0.92 + 0.14 * Math.sin(elapsedSec * 20.0));
              (record.titanLaserImpactDome.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsedSec;
            }
            if (record.titanLaserImpactDisc) {
              record.titanLaserImpactDisc.position.set(this.titanEndScratch.x, this.titanEndScratch.y + 0.45, this.titanEndScratch.z);
              record.titanLaserImpactDisc.rotation.z += dt * 4.5;
            }
            if (record.titanLaserImpactRing) {
              record.titanLaserImpactRing.position.set(this.titanEndScratch.x, this.titanEndScratch.y + 0.55, this.titanEndScratch.z);
              record.titanLaserImpactRing.rotation.z -= dt * 3.5;
              record.titanLaserImpactRing.scale.setScalar(0.95 + 0.1 * Math.sin(elapsedSec * 16.0));
            }
          } else {
            record.titanLaserGroup.visible = false;
          }
        }

        // ATTACK 2: Articulated Tentacle Strike (4 High-Reach Bio-Tentacles extending up to 900 units to player)
        if (record.titanTentacleGroup) {
          if (e.titanState === 'tentacle_strike' && record.titan3D) {
            record.titanTentacleGroup.visible = true;
            const target = e.titanTentacleTarget ?? e.pos;
            const tZ = this.simulation.state.terrain.getElevation(target.x, target.y).height;
            const phase = e.titanTentaclePhase || 'telegraph';
            const timer = e.titanTimer ?? 0;
            const nowSec = elapsedSec;

            // 1. UPDATE GROUND TELEGRAPH RETICLE (Conformal to 3D terrain slopes)
            if (record.titanTentacleMarkerGroup) {
              const isTelegraph = (phase === 'telegraph');
              record.titanTentacleMarkerGroup.visible = isTelegraph;
              if (isTelegraph) {
                record.titanTentacleMarkerGroup.position.set(target.x, tZ, target.y);
                const teleElapsed = STAGE1_BOSS_CONFIG.tentacle.telegraphDuration - timer;

                // Conform outer danger ring, inner core ring & fill disc to actual terrain slopes
                if (record.titanTentacleMarkerRing && record.titanTentacleRingOrigXZ) {
                  this.updateConformalMarkerGeo(record.titanTentacleMarkerRing.geometry, record.titanTentacleRingOrigXZ, target.x, target.y, tZ, 1.6);
                }
                if (record.titanTentacleMarkerFill && record.titanTentacleFillOrigXZ) {
                  this.updateConformalMarkerGeo(record.titanTentacleMarkerFill.geometry, record.titanTentacleFillOrigXZ, target.x, target.y, tZ, 1.0);
                }
                if (record.titanTentacleMarkerCore && record.titanTentacleCoreOrigXZ) {
                  this.updateConformalMarkerGeo(record.titanTentacleMarkerCore.geometry, record.titanTentacleCoreOrigXZ, target.x, target.y, tZ, 1.9);
                }

                // Rotate and conform each inward-pointing danger chevron individually to terrain surface
                if (record.titanTentacleMarkerChevrons) {
                  record.titanTentacleChevronAngle = (record.titanTentacleChevronAngle ?? 0) + dt * 3.5;
                  const chevDist = STAGE1_BOSS_CONFIG.tentacle.strikeRadius * 0.72;
                  const chevs = record.titanTentacleMarkerChevrons.children;
                  for (let c = 0; c < chevs.length; c++) {
                    const ang = (c / Math.max(1, chevs.length)) * Math.PI * 2 + record.titanTentacleChevronAngle;
                    const lx = Math.cos(ang) * chevDist;
                    const lz = Math.sin(ang) * chevDist;
                    const ch = this.simulation.state.terrain.getFastVisualHeight(target.x + lx, target.y + lz, tZ, 56);
                    chevs[c].position.set(lx, (ch - tZ) + 2.2, lz);
                    // -Z local axis points inward (-lx, -lz) toward reticle center
                    chevs[c].rotation.y = Math.atan2(lx, lz);
                  }
                }

                // Pulse turbulent crimson-magenta danger mist during lock-on phase (elapsed >= 0.35s)
                const isLocked = teleElapsed >= 0.35;
                if (record.titanTentacleMarkerRing && record.titanTentacleMarkerFill) {
                  const ringMat = record.titanTentacleMarkerRing.material as THREE.ShaderMaterial;
                  const fillMat = record.titanTentacleMarkerFill.material as THREE.ShaderMaterial;
                  const prog = Math.min(1.0, teleElapsed / Math.max(0.1, STAGE1_BOSS_CONFIG.tentacle.telegraphDuration));
                  if (ringMat.uniforms?.uPrimary) {
                    ringMat.uniforms.uProgress.value = 0.25 + prog * 0.65;
                    fillMat.uniforms.uProgress.value = 0.15 + prog * 0.55;
                    if (isLocked) {
                      const flash = Math.sin(nowSec * 24) > 0;
                      ringMat.uniforms.uPrimary.value.setHex(flash ? 0xff2255 : 0xf43f5e);
                      fillMat.uniforms.uPrimary.value.setHex(flash ? 0xff2255 : 0xbe123c);
                      fillMat.uniforms.uAlpha.value = 0.45 + Math.sin(nowSec * 20) * 0.18;
                    } else {
                      ringMat.uniforms.uPrimary.value.setHex(0xc084fc);
                      fillMat.uniforms.uPrimary.value.setHex(0xd946ef);
                      fillMat.uniforms.uAlpha.value = 0.28 + Math.sin(nowSec * 10) * 0.12;
                    }
                  }
                }
              }
            }

            // 2. COMPUTE 4 INDEPENDENT ARTICULATED VOLUMETRIC EXTENDING TENTACLES
            if (record.titanTentacleMeshes) {
              // Lower-mid Flank & Dorsal Carapace Sockets anchored directly on the 3D boss carapace
              const tentacleConfigs = [
                // Outer Left Tentacle: Sweeps wide left flank with sinuous S-bend
                { groundOffX: -42, groundOffY: -18, whipHeight: 105, lateralFlare: -175, sCurve: -68, coilWave: 1.0 },
                // Inner Left Tentacle: Arches from left dorsal flank
                { groundOffX: -16, groundOffY: 26, whipHeight: 135, lateralFlare: -78, sCurve: 48, coilWave: -0.9 },
                // Inner Right Tentacle: Arches from right dorsal flank
                { groundOffX: 16, groundOffY: 26, whipHeight: 135, lateralFlare: 78, sCurve: -48, coilWave: 0.9 },
                // Outer Right Tentacle: Sweeps wide right flank with sinuous S-bend
                { groundOffX: 42, groundOffY: -18, whipHeight: 105, lateralFlare: 175, sCurve: 68, coilWave: -1.0 }
              ];

              // Extension progress E in [0, 1] and tip hover height (poised in front of danger zone during telegraph)
              let extProgress = 0;
              let tipHoverY = 0;
              let isImpaled = false;

              if (phase === 'telegraph') {
                const teleElapsed = STAGE1_BOSS_CONFIG.tentacle.telegraphDuration - timer;
                const teleNorm = Math.min(1.0, Math.max(0, teleElapsed / STAGE1_BOSS_CONFIG.tentacle.telegraphDuration));
                // Surges visibly across battlefield out to 78% of reach, coiling right over the danger perimeter!
                extProgress = 0.34 + 0.44 * (1.0 - Math.pow(1.0 - teleNorm, 1.8));
                tipHoverY = 42.0 + 10.0 * Math.sin(nowSec * 6.0);
              } else if (phase === 'strike') {
                const strikeElapsed = STAGE1_BOSS_CONFIG.tentacle.strikeDuration - timer;
                const strikeNorm = Math.min(1.0, Math.max(0, strikeElapsed / STAGE1_BOSS_CONFIG.tentacle.strikeDuration));
                // Explosively lashes the final gap into the ground by strikeNorm = 0.45
                if (strikeNorm < 0.45) {
                  const t = strikeNorm / 0.45;
                  const ease = t * t * (3 - 2 * t);
                  extProgress = 0.78 + 0.22 * ease;
                  tipHoverY = 42.0 * (1.0 - ease);
                } else {
                  extProgress = 1.0;
                  tipHoverY = 0;
                  isImpaled = true;
                }
              } else if (phase === 'retract') {
                const retractElapsed = STAGE1_BOSS_CONFIG.tentacle.retractDuration - timer;
                const retractNorm = Math.min(1.0, Math.max(0, retractElapsed / STAGE1_BOSS_CONFIG.tentacle.retractDuration));
                // First 0.18s: remains impaled in cracked ground, trembling with violent bio-force
                if (retractNorm < 0.28) {
                  extProgress = 1.0;
                  isImpaled = true;
                } else {
                  const t = (retractNorm - 0.28) / 0.72;
                  extProgress = 1.0 - (t * t);
                  tipHoverY = 24.0 * Math.sin(t * Math.PI * 0.5);
                }
              }

              const spineSegments = 28;
              for (let a = 0; a < 4; a++) {
                const cfg = tentacleConfigs[a];
                const mesh = record.titanTentacleMeshes[a];
                const spineLine = record.titanTentacleSpines?.[a];
                const stinger = record.titanTentacleStingers?.[a];
                const impactRing = record.titanTentacleImpactRings?.[a];

                if (!mesh) continue;

                // Root socket anchored directly on the 3D boss carapace
                const rootWorld = record.titan3D.getCarapaceStrikeSocket(a, this.tentacleRootScratch);

                // Ground landing point
                const targetGroundX = target.x + cfg.groundOffX;
                const targetGroundY = target.y + cfg.groundOffY;
                const targetGroundZ = this.simulation.state.terrain.getElevation(targetGroundX, targetGroundY).height;
                const targetWorld = this.tentacleTargetScratch.set(targetGroundX, targetGroundZ + tipHoverY, targetGroundY);

                // Direction towards target
                const fullVec = this.tentacleFullVecScratch.subVectors(targetWorld, rootWorld);
                const horizDir = this.tentacleHorizDirScratch.set(fullVec.x, 0, fullVec.z).normalize();
                const horizPerp = this.tentacleHorizPerpScratch.set(-horizDir.z, 0, horizDir.x);

                // Lazily allocate reusable 29-point spine buffers per tentacle
                if (!record.titanTentacleSpinePts) {
                  record.titanTentacleSpinePts = [];
                  record.titanTentacleSpineLinePts = [];
                }
                let spinePoints = record.titanTentacleSpinePts[a];
                if (!spinePoints || spinePoints.length !== spineSegments + 1) {
                  spinePoints = [];
                  for (let s = 0; s <= spineSegments; s++) spinePoints.push(new THREE.Vector3());
                  record.titanTentacleSpinePts[a] = spinePoints;
                }
                let spineLinePoints = record.titanTentacleSpineLinePts![a];
                if (!spineLinePoints || spineLinePoints.length !== spineSegments + 1) {
                  spineLinePoints = [];
                  for (let s = 0; s <= spineSegments; s++) spineLinePoints.push(new THREE.Vector3());
                  record.titanTentacleSpineLinePts![a] = spineLinePoints;
                }

                // Low-slung cobra-coil apex during telegraph (stays inside combat camera!), high overhead whip during strike!
                const apexHeight = phase === 'telegraph'
                  ? Math.max(rootWorld.y, targetWorld.y) + 28 + 14 * Math.sin(nowSec * 6 + a)
                  : isImpaled
                    ? Math.max(rootWorld.y, targetWorld.y) + cfg.whipHeight * 0.42
                    : Math.max(rootWorld.y, targetWorld.y) + cfg.whipHeight;

                for (let s = 0; s <= spineSegments; s++) {
                  const u = s / spineSegments; // 0 (root) to 1 (current tip)
                  const effU = u * extProgress; // Fraction along full trajectory

                  // Base interpolation between root and target
                  const curPos = this.tentacleCurPosScratch.lerpVectors(rootWorld, targetWorld, effU);

                  // Graceful whip arch peaking across the span
                  const arcEnvelope = Math.pow(Math.sin(effU * Math.PI), 0.78);
                  curPos.y += (apexHeight - curPos.y) * arcEnvelope;

                  // Wide lateral kraken claw flare (sweeps wide around boss flanks, whips inward to spearhead)
                  curPos.addScaledVector(horizPerp, cfg.lateralFlare * arcEnvelope);

                  // Sinuous double-bend S-curve so tentacles look truly serpentine and curved (never rigid rods)
                  const sCurveEnv = Math.sin(effU * Math.PI * 2.0) * Math.sin(effU * Math.PI);
                  curPos.addScaledVector(horizPerp, cfg.sCurve * sCurveEnv);
                  curPos.y += Math.abs(cfg.sCurve) * 0.35 * Math.sin(effU * Math.PI * 2.0);

                  // Living predator sinusoidal undulation waves
                  const waveFreq = 8.0;
                  const wavePhase = nowSec * waveFreq - u * 5.5 + a * 1.57;
                  const waveAmp = (s > 0 && s < spineSegments) ? (22.0 * Math.sin(u * Math.PI)) : 0;
                  curPos.addScaledVector(horizPerp, Math.sin(wavePhase) * waveAmp * cfg.coilWave);
                  curPos.y += Math.cos(wavePhase * 0.9) * (waveAmp * 0.45);

                  // Impaled trembling vibration in earth
                  if (isImpaled && s >= spineSegments - 4) {
                    const tremor = (Math.random() - 0.5) * 3.0;
                    curPos.x += tremor;
                    curPos.z += tremor;
                  }

                  // Ensure spine glides cleanly above terrain bumps without burying until actual ground contact at tip
                  if (s < spineSegments || !isImpaled) {
                    const terrH = this.simulation.state.terrain.getFastVisualHeight(curPos.x, curPos.z, undefined, 56);
                    const minClearance = phase === 'telegraph' ? 14.0 : 4.0;
                    if (curPos.y < terrH + minClearance) {
                      curPos.y = terrH + minClearance;
                    }
                  } else {
                    curPos.y = targetGroundZ + 0.2;
                  }

                  spinePoints[s].copy(curPos);

                  // Outer glowing bio-vein highlight strictly outside tapered flesh radius
                  const curRad = (21.0 * Math.pow(1.0 - u * 0.92, 1.35) + 1.6) * (1.0 + 0.08 * Math.sin(u * Math.PI * 16.0));
                  const crestPt = spineLinePoints[s].copy(curPos);
                  crestPt.y += curRad + 2.0;
                  crestPt.addScaledVector(horizPerp, Math.sin(nowSec * 3 + u * 6) * 1.2);
                }

                // Update volumetric tapered tube geometry (21.0 base radius -> 2.4 razor tip)
                this.updateTentacleGeo(mesh.geometry, spinePoints, 21.0, 10);
                mesh.visible = true;

                // Update dorsal glowing vein line in-place once allocated
                if (spineLine) {
                  const linePos = spineLine.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
                  if (linePos && linePos.count === spineLinePoints.length) {
                    for (let s = 0; s < spineLinePoints.length; s++) {
                      const lp = spineLinePoints[s];
                      linePos.setXYZ(s, lp.x, lp.y, lp.z);
                    }
                    linePos.needsUpdate = true;
                  } else {
                    spineLine.geometry.setFromPoints(spineLinePoints);
                  }
                  spineLine.geometry.computeBoundingSphere();
                  spineLine.visible = true;
                }

                // Update tip razor stinger (+Z oriented via ConeGeometry rotation)
                if (stinger) {
                  const lastPt = spinePoints[spineSegments];
                  const prevPt = spinePoints[spineSegments - 1];
                  stinger.position.copy(lastPt);
                  this.tentacleStingerDirScratch.subVectors(lastPt, prevPt).normalize();
                  stinger.quaternion.setFromUnitVectors(this.titanPosZScratch, this.tentacleStingerDirScratch);
                  stinger.visible = true;
                }

                // Update small crisp ground impact crater ring at each impaled stinger
                if (impactRing) {
                  impactRing.visible = isImpaled;
                  if (isImpaled) {
                    impactRing.position.set(targetGroundX, targetGroundZ + 1.1, targetGroundY);
                    impactRing.rotation.z += dt * 4.0;
                    const ringPulse = 0.65 + 0.35 * Math.sin(nowSec * 14 + a);
                    (impactRing.material as THREE.MeshBasicMaterial).opacity = ringPulse;
                  }
                }
              }
            }
          } else {
            record.titanTentacleGroup.visible = false;
          }
        }

        // ATTACK 3: Ten 3D Turbulent Bio-Plasma Orbs Charging on Live Dorsal Tentacle Tips
        if (record.titanElementalOrbs && record.titan3D) {
          if (e.titanState === 'elemental_barrage') {
            const chargeDur = STAGE1_BOSS_CONFIG.elemental.chargeDuration;
            const chargeProg = Math.min(1.0, Math.max(0, (chargeDur - (e.titanTimer ?? 0)) / chargeDur));
            const baseScale = (0.18 + 0.98 * Math.pow(chargeProg, 0.72)) * (1.0 + 0.08 * Math.sin(elapsedSec * 16.0));

            if (record.titanElementalMat) record.titanElementalMat.uniforms.uTime.value = elapsedSec;
            if (record.titanElementalHaloMat) record.titanElementalHaloMat.uniforms.uTime.value = elapsedSec;

            for (let k = 0; k < 10; k++) {
              const orb = record.titanElementalOrbs[k];
              record.titan3D.getTentacleTipWorldPos(k, orb.position);
              orb.scale.setScalar(baseScale);
              orb.rotation.y += dt * 2.8;
              orb.rotation.x += dt * 1.4;
              orb.visible = true;
            }
          } else {
            for (let k = 0; k < 10; k++) {
              record.titanElementalOrbs[k].visible = false;
            }
          }
        }

        continue;
      }

      // Refresh natural image aspect ratio once async texture load finishes
      const def = record.visualDef || ENEMY_VISUAL_CATALOG.crawler;
      if (!record.aspectResolved) {
        const tex = record.material.uniforms.uMap.value as THREE.Texture | null;
        const resolvedAspect = this.computeSpriteAspectScale(tex ?? undefined, def.frameCount, def.baseHeight);
        if (resolvedAspect.resolved) {
          record.aspectWidth = resolvedAspect.width;
          record.aspectHeight = resolvedAspect.height;
          record.aspectResolved = true;
          record.material.uniforms.uTexelSize.value.set(1 / resolvedAspect.imgW, 1 / resolvedAspect.imgH);
        }
      }

      // Crystalline Ice Cluster Aura for frozen/chilled enemies
      if (e.isChilled) {
        if (!record.encasedIceGroup) {
          const iceGrp = new THREE.Group();
          const shardMat = new THREE.MeshBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
          });

          const count = 5;
          for (let k = 0; k < count; k++) {
            const h = e.radius * (0.8 + (k % 3) * 0.25);
            const r = e.radius * 0.24;
            const cGeo = this.vfx.createJaggedShardGeo(r, h, 5, 50 + k);
            const shard = new THREE.Mesh(cGeo, shardMat);
            const ang = (k / count) * Math.PI * 2 + (k * 0.3);
            const dist = e.radius * 0.85;
            shard.position.set(Math.cos(ang) * dist, -2, Math.sin(ang) * dist);
            shard.rotation.set((k % 2 ? 0.15 : -0.15), ang, (k % 2 ? -0.12 : 0.12));
            iceGrp.add(shard);
          }

          const frostMistGeo = new THREE.PlaneGeometry(e.radius * 2.4, e.radius * 2.4);
          frostMistGeo.rotateX(-Math.PI / 2);
          const frostMistMat = new THREE.MeshBasicMaterial({
            map: this.textures['energy_flare'] || null,
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
          });
          const frostMist = new THREE.Mesh(frostMistGeo, frostMistMat);
          frostMist.position.y = 1.0;
          iceGrp.add(frostMist);

          this.scene.add(iceGrp);
          record.encasedIceGroup = iceGrp;
        }

        record.encasedIceGroup.visible = true;
        record.encasedIceGroup.position.set(e.pos.x, e.z ?? 0, e.pos.y);
        record.encasedIceGroup.rotation.y += dt * 0.8;
      } else if (record.encasedIceGroup) {
        record.encasedIceGroup.visible = false;
      }

      // 2. Subdivided 2.5D Mesh-Puppet Animation & Crawling Emergence
      const animTime = elapsedSec * 8.0;
      const isMoving = e.speed > 0;
      if (record.material.uniforms.uMoveFactor) {
        record.material.uniforms.uMoveFactor.value = isMoving ? 1.0 : 0.25;
      }
      const squish = Math.sin(animTime * 1.6 + i) * (isMoving ? 0.032 : 0.015);

      const emergeProgress = e.isSpawning ? Math.min(1, Math.max(0, e.spawnProgress || 0)) : 1.0;
      const emergeScale = e.isSpawning ? (0.2 + 0.8 * emergeProgress) : 1.0;
      const crawlJitter = e.isSpawning ? (Math.random() - 0.5) * 2.2 : 0;

      record.mesh.scale.set(
        record.aspectWidth * (1 + squish) * emergeScale,
        record.aspectHeight * (1 - squish) * emergeScale,
        1
      );

      // 3. Position (Foot anchored or hovering for flyers) + Cylindrical Y-Axis Billboarding
      let yOffset = (record.aspectHeight * (1 - squish) * emergeScale) * 0.46;
      if (def.hoverHeight > 0) {
        const hover = Math.sin(animTime * def.hoverFreq + i) * def.hoverAmp;
        yOffset = (def.hoverHeight + hover) * emergeScale;
      }
      record.mesh.position.set(e.pos.x + crawlJitter, e.z + yOffset, e.pos.y + crawlJitter);
      this.setCylindricalYaw(record.mesh, e.pos.x, e.pos.y);

      // Terrain-conforming ground contact shadow (cached slope gradient across 14u movement steps)
      const baseShadowSize = (record.shadow.userData.baseShadowSize as number) || (e.radius * 2.6);
      if (
        record.lastTiltX === undefined ||
        record.lastTiltY === undefined ||
        Math.abs(e.pos.x - record.lastTiltX) > 14 ||
        Math.abs(e.pos.y - record.lastTiltY) > 14
      ) {
        const hL = this.simulation.state.terrain.getFastVisualHeight(e.pos.x - 12, e.pos.y, e.groundZ, 56);
        const hR = this.simulation.state.terrain.getFastVisualHeight(e.pos.x + 12, e.pos.y, e.groundZ, 56);
        const hD = this.simulation.state.terrain.getFastVisualHeight(e.pos.x, e.pos.y - 12, e.groundZ, 56);
        const hU = this.simulation.state.terrain.getFastVisualHeight(e.pos.x, e.pos.y + 12, e.groundZ, 56);
        record.cachedSlopeX = Math.atan2(hU - hD, 24);
        record.cachedSlopeZ = Math.atan2(hR - hL, 24);
        record.lastTiltX = e.pos.x;
        record.lastTiltY = e.pos.y;
      }
      record.shadow.position.set(e.pos.x, e.groundZ + 0.4, e.pos.y);
      record.shadow.rotation.set(-Math.PI / 2 + (record.cachedSlopeX || 0), 0, -(record.cachedSlopeZ || 0));
      record.shadow.scale.set(
        baseShadowSize * def.shadowScale * emergeScale,
        baseShadowSize * def.shadowScale * emergeScale,
        1
      );
      record.shadow.visible = !e.isSpawning;

      // 4. Aura Ring
      if (record.auraRing) {
        record.auraRing.position.set(e.pos.x, e.groundZ + 0.5, e.pos.y);
        record.auraRing.rotation.y += (e.isBoss ? 0.03 : 0.015);
        record.auraRing.visible = !e.isSpawning;
      }

      // 5. Sleek HP Bar billboarding (shown when damaged or for Elite/Mini-Boss units to reduce visual clutter)
      const hpPct = Math.max(0, e.health / e.maxHealth);
      const isVisible = Boolean(!e.isSpawning && (hpPct < 0.995 || e.isElite || e.isBoss));
      record.hpBarGroup.visible = isVisible;
      if (isVisible) {
        const hpY = e.z + Math.max(def.hpYOffset, record.aspectHeight * 1.04);
        record.hpBarGroup.position.set(e.pos.x, hpY, e.pos.y);
        record.hpBarGroup.quaternion.copy(this.camera.quaternion);
        record.hpBarFill.scale.set(def.hpWidth * hpPct, def.hpHeight, 1);
        record.hpBarFill.position.x = -(def.hpWidth * 0.5) * (1 - hpPct);
      }
    }

    // Cleanup dead enemies (disposing per-instance WebGL resources while preserving shared caches)
    for (const [id, record] of this.enemyMap.entries()) {
      if (!currentIds.has(id)) {
        this.disposeEnemyRenderEntry(record);
        this.enemyMap.delete(id);
      }
    }
  }

  public toggleInvertCameraPan(): boolean {
    this.invertCameraPan = !this.invertCameraPan;
    return this.invertCameraPan;
  }

  public setInvertCameraPan(inv: boolean): void {
    this.invertCameraPan = inv;
  }

  public setInvertCameraPitch(inv: boolean): void {
    this.invertCameraPitch = inv;
  }

  public setMouseSensitivity(sens: number): void {
    this.mouseSensitivity = Math.max(0.2, Math.min(3.0, sens));
  }

  public setUse3DCommander(use3D: boolean): void {
    this.use3DCommander = use3D;
    this.playerSprite.visible = !use3D;
    this.commander3D.group.visible = use3D;
  }

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.graphicsQuality = quality;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;

    if (quality === 'low') {
      this.renderer.setPixelRatio(1.0);
      this.useComposer = false;
      this.bloomPass.enabled = false;
      this.animateClouds = false;
      this.maxDynamicLights = 4;
    } else if (quality === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.useComposer = true;
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.32;
      this.bloomPass.radius = 0.44;
      this.bloomPass.threshold = 0.84;
      this.bloomPass.setSize(Math.max(1, Math.floor(w * 0.75)), Math.max(1, Math.floor(h * 0.75)));
      this.animateClouds = true;
      this.maxDynamicLights = 10;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.25));
      this.useComposer = true;
      this.bloomPass.enabled = true;
      this.bloomPass.strength = 0.24;
      this.bloomPass.radius = 0.36;
      this.bloomPass.threshold = 0.88;
      this.bloomPass.setSize(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));
      this.animateClouds = true;
      this.maxDynamicLights = 8;
    }

    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.applyQualityToHorizon();
  }

  public getGraphicsQuality(): GraphicsQuality {
    return this.graphicsQuality;
  }

  public getMaxDynamicLights(): number {
    return this.maxDynamicLights;
  }

  private applyQualityToHorizon(): void {
    const isLow = this.graphicsQuality === 'low';
    for (let i = 0; i < this.horizonCloudMeshes.length; i++) {
      const m = this.horizonCloudMeshes[i];
      m.visible = !isLow || m.userData.cloudLayer !== 2;
    }

    // Respect graphics-preset dynamic light cap (Low=4, Medium=8 with 2 headroom, High=10 with 2 headroom)
    const allowedFlora = isLow ? 1 : this.graphicsQuality === 'high' ? 5 : 3;
    let floraIdx = 0;
    for (let i = 0; i < this.testMapDynamicLights.length; i++) {
      const entry = this.testMapDynamicLights[i];
      if (entry.kind === 'flora') {
        const active = floraIdx < allowedFlora;
        entry.light.visible = active;
        if (!active) entry.light.intensity = 0;
        floraIdx++;
      } else {
        entry.light.visible = true;
      }
    }

    if (this.snowSporePoints) {
      const count = isLow ? Math.min(250, this.snowSporeCount) : this.graphicsQuality === 'high' ? this.snowSporeCount : Math.min(500, this.snowSporeCount);
      this.snowSporePoints.geometry.setDrawRange(0, count);
    }
  }

  private updateHorizonClouds(nowMs: number): void {
    if (!this.animateClouds) return;
    const tSec = nowMs * 0.001;
    if (this.skyCloudUniforms) {
      this.skyCloudUniforms.uTime.value = tSec;
    }
    for (let i = 0; i < this.horizonCloudMeshes.length; i++) {
      const m = this.horizonCloudMeshes[i];
      if (!m.visible) continue;
      const baseY = m.userData.baseY as number | undefined;
      const phase = (m.userData.cloudPhase as number | undefined) ?? 0;
      if (baseY !== undefined) {
        m.position.y = baseY + Math.sin(tSec * 0.14 + phase) * 18;
      }
    }
  }

  private getOrCreateProjectileTemplate(projType: string, hand?: 'left' | 'right'): THREE.Group {
    const key = projType === 'medical_pulse' ? `medical_pulse:${hand === 'right' ? 'r' : 'l'}` : projType;
    const cached = this.projTemplateCache.get(key);
    if (cached) return cached;

    const grp = new THREE.Group();
    const markShared = <T extends THREE.Object3D>(obj: T): T => {
      obj.userData = { isSharedGeo: true, isSharedMat: true };
      return obj;
    };

    if (projType === 'medical_pulse') {
      const boltColor = hand === 'right' ? 0x2dd4bf : 0x10b981;
      const laserGeo = this.vfx.createOrganicPlumeColumnGeo(1.0, 2.2, 24, 6, 4, 0.25, 0.9);
      laserGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: boltColor, side: THREE.DoubleSide }))));

      const coreGeo = this.vfx.createOrganicPlumeColumnGeo(0.5, 1.2, 26, 6, 4, 0.22, -0.8);
      coreGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xecfdf5, side: THREE.DoubleSide }))));
    } else if (projType === 'sedative_dart') {
      const bodyGeo = this.vfx.createOrganicPlumeColumnGeo(1.4, 2.6, 22, 6, 4, 0.26, 1.0);
      bodyGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }))));

      const tipGeo = this.vfx.createJaggedShardGeo(1.6, 12, 5, 13);
      tipGeo.rotateX(Math.PI / 2);
      const tipMesh = markShared(new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xf8fafc })));
      tipMesh.position.z = 8;
      grp.add(tipMesh);

      const trailPts = [new THREE.Vector3(-4, 0, -9), new THREE.Vector3(0, 0, -3), new THREE.Vector3(4, 0, -9)];
      grp.add(
        markShared(
          new THREE.Mesh(
            this.vfx.createJaggedRibbonGeometry(trailPts, 2.6),
            new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
          )
        )
      );
    } else if (projType === 'wave') {
      const outerGeo = this.vfx.createCrescentBladeGeometry(14, 14, Math.PI * 0.85, 18);
      outerGeo.rotateY(-Math.PI * 0.5);
      grp.add(
        markShared(
          new THREE.Mesh(
            outerGeo,
            new THREE.MeshBasicMaterial({
              color: 0xa855f7,
              transparent: true,
              opacity: 0.88,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending
            })
          )
        )
      );

      const innerGeo = this.vfx.createCrescentBladeGeometry(16, 7, Math.PI * 0.72, 16);
      innerGeo.rotateY(-Math.PI * 0.5);
      grp.add(
        markShared(
          new THREE.Mesh(
            innerGeo,
            new THREE.MeshBasicMaterial({
              color: 0x67e8f9,
              transparent: true,
              opacity: 0.92,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending
            })
          )
        )
      );
    } else if (projType === 'scatter') {
      const flameGeo = this.vfx.createOrganicPlumeColumnGeo(1.2, 5.2, 18, 8, 4, 0.34, 1.3);
      flameGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff4500, side: THREE.DoubleSide }))));

      const coreGeo = this.vfx.createJaggedShardGeo(3.6, 12, 5, 29);
      coreGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xff7a33 }))));
    } else if (projType === 'gatling') {
      const streakGeo = this.vfx.createOrganicPlumeColumnGeo(0.6, 2.2, 28, 6, 4, 0.25, 1.2);
      streakGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }))));

      const tipGeo = this.vfx.createJaggedShardGeo(2.0, 9, 5, 31);
      tipGeo.rotateX(Math.PI / 2);
      const tipMesh = markShared(new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })));
      tipMesh.position.z = 8;
      grp.add(tipMesh);
    } else if (projType === 'grenade') {
      const podGeo = this.vfx.createOrganicPlumeColumnGeo(3.0, 6.2, 15, 8, 5, 0.38, 1.6);
      grp.add(markShared(new THREE.Mesh(podGeo, new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }))));

      const shardGeo = this.vfx.createJaggedShardGeo(4.8, 18, 5, 37);
      const shardMesh = markShared(new THREE.Mesh(shardGeo, new THREE.MeshBasicMaterial({ color: 0xe0f2fe })));
      shardMesh.position.y = -9;
      grp.add(shardMesh);
    } else if (projType === 'vortex') {
      const coreGeo = this.vfx.createOrganicPlumeColumnGeo(4.5, 9.5, 16, 10, 5, 0.35, 1.8);
      grp.add(markShared(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x0f051d, side: THREE.DoubleSide }))));

      const swirlGeo = this.vfx.createOrganicPlumeColumnGeo(18, 12, 8, 12, 4, 0.44, 2.2);
      swirlGeo.rotateX(Math.PI * 0.35);
      grp.add(
        markShared(
          new THREE.Mesh(
            swirlGeo,
            new THREE.MeshBasicMaterial({
              color: 0xa855f7,
              transparent: true,
              opacity: 0.78,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending
            })
          )
        )
      );
    } else if (projType === 'acid') {
      const acidGeo = this.vfx.createOrganicPlumeColumnGeo(5.0, 7.8, 15, 10, 5, 0.42, 1.3);
      const acidMat = new THREE.MeshStandardMaterial({
        map: this.textures['caustic_fluid'],
        color: 0x84cc16,
        emissive: 0x65a30d,
        emissiveIntensity: 1.2,
        roughness: 0.3,
        side: THREE.DoubleSide
      });
      grp.add(markShared(new THREE.Mesh(acidGeo, acidMat)));

      const mistGeo = new THREE.PlaneGeometry(24, 24);
      grp.add(
        markShared(
          new THREE.Mesh(
            mistGeo,
            new THREE.MeshBasicMaterial({
              map: this.textures['energy_flare'] || null,
              color: 0xa3e635,
              transparent: true,
              opacity: 0.45,
              blending: THREE.AdditiveBlending,
              side: THREE.DoubleSide,
              depthWrite: false
            })
          )
        )
      );
    } else if (projType === 'wasp_sting') {
      const needleGeo = this.vfx.createJaggedShardGeo(3.6, 24, 5, 53);
      needleGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(needleGeo, new THREE.MeshBasicMaterial({ color: 0xc084fc }))));

      const sheathGeo = this.vfx.createOrganicPlumeColumnGeo(1.5, 4.8, 22, 8, 4, 0.36, 1.5);
      sheathGeo.rotateX(Math.PI / 2);
      grp.add(
        markShared(
          new THREE.Mesh(
            sheathGeo,
            new THREE.MeshBasicMaterial({
              color: 0x22d3ee,
              transparent: true,
              opacity: 0.65,
              blending: THREE.AdditiveBlending,
              side: THREE.DoubleSide
            })
          )
        )
      );

      if (this.textures['energy_flare']) {
        const flareSpr = markShared(
          new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: this.textures['energy_flare'],
              color: 0xc084fc,
              transparent: true,
              opacity: 0.75,
              blending: THREE.AdditiveBlending
            })
          )
        );
        flareSpr.scale.set(16, 16, 1);
        grp.add(flareSpr);
      }
    } else if (projType === 'seismic_shard') {
      const shardGeo = this.vfx.createJaggedShardGeo(9.5, 28, 6, 59);
      shardGeo.rotateX(Math.PI / 2);
      const shardMat = new THREE.MeshStandardMaterial({
        map: this.textures['rock_texture'],
        color: 0x334155,
        emissive: 0xef4444,
        emissiveIntensity: 1.1,
        roughness: 0.5,
        metalness: 0.7,
        flatShading: true
      });
      grp.add(markShared(new THREE.Mesh(shardGeo, shardMat)));
    } else if (projType === 'queen_stinger') {
      const lanceGeo = this.vfx.createJaggedShardGeo(5.2, 30, 5, 67);
      lanceGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(lanceGeo, new THREE.MeshBasicMaterial({ color: 0xe11d48 }))));

      const haloGeo = this.vfx.createOrganicPlumeColumnGeo(3.0, 6.5, 22, 8, 4, 0.38, -1.6);
      haloGeo.rotateX(Math.PI / 2);
      grp.add(
        markShared(
          new THREE.Mesh(
            haloGeo,
            new THREE.MeshBasicMaterial({
              color: 0xfacc15,
              transparent: true,
              opacity: 0.75,
              blending: THREE.AdditiveBlending,
              side: THREE.DoubleSide
            })
          )
        )
      );

      if (this.textures['energy_flare']) {
        const flareSpr = markShared(
          new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: this.textures['energy_flare'],
              color: 0xf43f5e,
              transparent: true,
              opacity: 0.8,
              blending: THREE.AdditiveBlending
            })
          )
        );
        flareSpr.scale.set(24, 24, 1);
        grp.add(flareSpr);
      }
    } else if (projType === 'spore_bomb') {
      const bulbGeo = this.vfx.createOrganicPlumeColumnGeo(7.5, 11.5, 22, 10, 6, 0.42, 1.4);
      const bulbMat = new THREE.MeshStandardMaterial({
        map: this.textures['void_hive_texture'],
        color: 0x701a75,
        emissiveMap: this.textures['void_hive_texture'],
        emissive: 0xd946ef,
        emissiveIntensity: 1.2,
        roughness: 0.6,
        side: THREE.DoubleSide
      });
      grp.add(markShared(new THREE.Mesh(bulbGeo, bulbMat)));
    } else if (projType === 'toxic_chain') {
      const boltGeo = this.vfx.createOrganicPlumeColumnGeo(1.0, 2.6, 24, 6, 4, 0.34, 1.3);
      boltGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0x84cc16, side: THREE.DoubleSide }))));

      const coreGeo = this.vfx.createOrganicPlumeColumnGeo(0.5, 1.2, 26, 6, 4, 0.25, -1.2);
      coreGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xecfccb, side: THREE.DoubleSide }))));
    } else if (projType === 'cryo_scalpel') {
      const arcGeo = this.vfx.createCrescentBladeGeometry(7, 9, Math.PI * 1.15, 16);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.85,
        metalness: 0.75,
        roughness: 0.2,
        side: THREE.DoubleSide
      });
      grp.add(markShared(new THREE.Mesh(arcGeo, bladeMat)));

      const counterArc = arcGeo.clone();
      counterArc.rotateY(Math.PI);
      grp.add(
        markShared(
          new THREE.Mesh(
            counterArc,
            new THREE.MeshBasicMaterial({
              color: 0x7dd3fc,
              transparent: true,
              opacity: 0.85,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending
            })
          )
        )
      );
    } else if (projType === 'toxic_grenade' || projType === 'cluster_main') {
      const scale = projType === 'cluster_main' ? 1.45 : 1.0;
      const podGeo = this.vfx.createOrganicPlumeColumnGeo(3.2 * scale, 5.4 * scale, 14 * scale, 8, 5, 0.42, 1.4);
      grp.add(
        markShared(
          new THREE.Mesh(
            podGeo,
            new THREE.MeshStandardMaterial({
              color: 0x365314,
              emissive: 0x84cc16,
              emissiveIntensity: 1.0,
              roughness: 0.4,
              metalness: 0.35,
              side: THREE.DoubleSide
            })
          )
        )
      );
    } else if (projType === 'cluster_sub') {
      const subGeo = this.vfx.createOrganicPlumeColumnGeo(2.2, 4.6, 10, 8, 4, 0.45, 1.2);
      grp.add(markShared(new THREE.Mesh(subGeo, new THREE.MeshBasicMaterial({ color: 0xa3e635, side: THREE.DoubleSide }))));
    } else if (projType === 'drone_bio_bolt') {
      const shellGeo = this.vfx.createOrganicPlumeColumnGeo(0.9, 2.3, 22, 6, 4, 0.32, 1.2);
      shellGeo.rotateX(Math.PI / 2);
      grp.add(
        markShared(
          new THREE.Mesh(
            shellGeo,
            new THREE.MeshBasicMaterial({
              color: 0x10b981,
              transparent: true,
              opacity: 0.78,
              blending: THREE.AdditiveBlending,
              side: THREE.DoubleSide,
              depthWrite: false
            })
          )
        )
      );

      const coreGeo = this.vfx.createOrganicPlumeColumnGeo(0.5, 1.1, 24, 6, 4, 0.25, -1.0);
      coreGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xecfdf5, side: THREE.DoubleSide }))));
    } else if (projType === 'angel_bolt') {
      const lanceGeo = this.vfx.createOrganicPlumeColumnGeo(0.6, 2.6, 28, 6, 5, 0.30, 1.3);
      lanceGeo.rotateX(Math.PI / 2);
      grp.add(markShared(new THREE.Mesh(lanceGeo, new THREE.MeshBasicMaterial({ color: 0x6ee7b7, side: THREE.DoubleSide }))));

      const tipGeo = this.vfx.createJaggedShardGeo(2.2, 11, 5, 71);
      tipGeo.rotateX(Math.PI / 2);
      const tip = markShared(new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xfef08a })));
      tip.position.z = 11;
      grp.add(tip);
    }

    this.projTemplateCache.set(key, grp);
    return grp;
  }

  private syncProjectiles(): void {
    const projectiles = this.simulation.state.projectiles;
    const currentIds = this.scratchProjIds;
    currentIds.clear();

    for (let i = 0; i < projectiles.length; i++) {
      const proj = projectiles[i];
      currentIds.add(proj.id);

      let obj = this.projMap.get(proj.id);
      if (!obj) {
        let poolKey: string;
        if (proj.type === 'bomb') {
          poolKey = `proj_twin_${proj.extraLayers || 0}`;
        } else if (proj.type === 'elemental_ball') {
          poolKey = 'proj_void_orb';
        } else if (
          proj.type === 'pulse' ||
          proj.type === 'missile' ||
          (proj.type as string) === 'bolt' ||
          (proj.type as string) === 'lance' ||
          !proj.type
        ) {
          poolKey = 'proj_blaster';
        } else {
          poolKey = `proj_tpl_${proj.type}_${proj.hand || ''}`;
        }

        const poolArr = this.projectileGroupPool.get(poolKey);
        let grp: THREE.Group;

        if (poolArr && poolArr.length > 0) {
          grp = poolArr.pop()!;
          grp.visible = true;
          grp.rotation.set(0, 0, 0);
          grp.quaternion.identity();
          if (grp.userData.slashGrp?.userData) {
            grp.userData.slashGrp.userData.elapsed = 0;
            grp.userData.slashGrp.userData.trailTimer = 0;
          }
        } else if (proj.type === 'bomb') {
          grp = new THREE.Group();
          const slashGrp = this.vfx.createTwinSlashProjectileGroup(proj.extraLayers || 0);
          grp.add(slashGrp);
          grp.userData.slashGrp = slashGrp;
          grp.userData.poolKey = poolKey;
        } else if (proj.type === 'elemental_ball') {
          grp = new THREE.Group();
          const assets = this.getSharedElementalProjectileAssets();
          const coreMesh = new THREE.Mesh(assets.orbGeo, assets.orbMat);
          coreMesh.userData = { isSharedGeo: true, isSharedMat: true };
          grp.add(coreMesh);

          const haloMesh = new THREE.Mesh(assets.haloGeo, assets.haloMat);
          haloMesh.userData = { isSharedGeo: true, isSharedMat: true };
          grp.add(haloMesh);

          const wakeMesh = new THREE.Mesh(assets.wakeGeo, assets.wakeMat);
          wakeMesh.userData = { isSharedGeo: true, isSharedMat: true };
          grp.add(wakeMesh);
          grp.userData.isPooled = true;
          grp.userData.poolKey = poolKey;
        } else if (poolKey === 'proj_blaster') {
          grp = new THREE.Group();
          const boltGrp = this.vfx.createGoldenBlasterBoltGroup();
          grp.add(boltGrp);
          grp.userData.isPooled = true;
          grp.userData.poolKey = poolKey;
        } else {
          const template = this.getOrCreateProjectileTemplate(proj.type, proj.hand);
          if (template.children.length > 0) {
            grp = template.clone();
            grp.userData.isPooled = true;
            grp.userData.poolKey = poolKey;
          } else {
            grp = new THREE.Group();
            const boltGrp = this.vfx.createGoldenBlasterBoltGroup();
            grp.add(boltGrp);
            grp.userData.isPooled = true;
            grp.userData.poolKey = poolKey;
          }
        }

        grp.scale.setScalar(2.0);
        obj = grp;
        this.scene.add(obj);
        this.projMap.set(proj.id, obj);
      }

      // Track latest state on userData so we can trigger a crisp impact spark if a pulse bolt hits terrain or enemy
      obj.userData.projType = proj.type;
      obj.userData.lastPos = { x: proj.pos.x, y: proj.pos.y };
      obj.userData.lastZ = proj.z ?? 16;
      obj.userData.distanceTraveled = proj.distanceTraveled;
      obj.userData.maxDistance = proj.maxDistance;

      // True 3D Positioning: NO ground snapping, NO slope crawling!
      // In Three.js: X = proj.pos.x, Y = proj.z, Z = proj.pos.y
      obj.position.set(proj.pos.x, proj.z ?? 16, proj.pos.y);
      // Keep pistol shot hidden in barrel until Frame 2 (Firing Frame / Muzzle Flash)
      obj.visible = (proj.spawnDelayRemaining ?? 0) <= 0;

      if (proj.type === 'bomb') {
        // Orient Twin Converging Slashes horizontally along flight direction and animate Phase 1 -> Phase 2 convergence
        const groundH = this.simulation.state.terrain.getElevation(proj.pos.x, proj.pos.y).height;
        obj.position.set(proj.pos.x, groundH + 8, proj.pos.y);
        obj.rotation.set(0, Math.atan2(proj.velocity.x, proj.velocity.y), 0);
        if (obj.userData.slashGrp) {
          const progress = proj.distanceTraveled / Math.max(1, proj.maxDistance);
          this.vfx.updateTwinSlashProjectileGroup(obj.userData.slashGrp, progress, 0.016, proj.pos, groundH);
        }
      } else if (
        proj.type === 'grenade' ||
        proj.type === 'spore_bomb' ||
        proj.type === 'toxic_grenade' ||
        proj.type === 'cluster_main' ||
        proj.type === 'cluster_sub'
      ) {
        obj.rotation.x += 0.16;
        obj.rotation.z += 0.12;
      } else if (proj.type === 'cryo_scalpel') {
        // High-RPM flat boomerang rotation along both outgoing & return paths
        obj.rotation.set(0, (obj.rotation.y || 0) + 0.42, 0);
      } else if (proj.type === 'seismic_shard') {
        // Tumble violently through the air
        obj.rotation.x += 0.18;
        obj.rotation.z += 0.14;
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
      } else if (proj.type === 'wasp_sting') {
        // Rapid spinning along flight vector
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
        obj.rotation.z += 0.32;
      } else if (proj.type === 'queen_stinger') {
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
        obj.rotation.z += 0.24;
      } else if (proj.type === 'vortex') {
        obj.rotation.y += 0.14;
      } else if (proj.type === 'acid') {
        const pulse = 2.0 * (1 + Math.sin(performance.now() * 0.012) * 0.18);
        obj.scale.set(pulse, pulse, pulse);
        obj.rotation.x += 0.09;
        obj.rotation.y += 0.09;
      } else {
        // Align directional projectiles along their true 3D flight velocity vector!
        const vx = proj.velocity.x;
        const vy = proj.vz ?? 0;
        const vz = proj.velocity.y; // Three.js Z is sim Y
        const dir3D = this.titanBeamDirScratch.set(vx, vy, vz);
        if (dir3D.lengthSq() > 0.001) {
          dir3D.normalize();
          obj.quaternion.setFromUnitVectors(this.titanPosZScratch, dir3D);
        }
      }
    }

    const nowSec = performance.now() * 0.001;
    if (this.sharedElementalOrbMat) this.sharedElementalOrbMat.uniforms.uTime.value = nowSec;
    if (this.sharedElementalHaloMat) this.sharedElementalHaloMat.uniforms.uTime.value = nowSec;
    if (this.sharedElementalWakeMat) this.sharedElementalWakeMat.uniforms.uTime.value = nowSec;

    for (const [id, obj] of this.projMap.entries()) {
      if (!currentIds.has(id)) {
        if (obj.userData?.projType === 'pulse' && obj.userData?.lastPos) {
          // Spawn brief golden impact spark when the blaster bolt hits an enemy or terrain
          this.vfx.spawnBlasterImpactSpark(obj.userData.lastPos, obj.userData.lastZ || 20);
        } else if (
          (obj.userData?.projType === 'medical_pulse' || obj.userData?.projType === 'toxic_chain') &&
          obj.userData?.lastPos
        ) {
          this.vfx.spawnShockwaveRing(
            obj.userData.lastPos,
            obj.userData?.projType === 'toxic_chain' ? 44 : 32,
            obj.userData?.projType === 'toxic_chain' ? 0xa3e635 : 0x34d399,
            obj.userData.lastZ || 36,
            0.22
          );
        }
        this.scene.remove(obj);
        this.projMap.delete(id);
        const poolKey = obj.userData?.poolKey as string | undefined;
        if (poolKey && (obj as THREE.Group).isGroup) {
          let poolArr = this.projectileGroupPool.get(poolKey);
          if (!poolArr) {
            poolArr = [];
            this.projectileGroupPool.set(poolKey, poolArr);
          }
          if (poolArr.length < 160) {
            obj.visible = false;
            poolArr.push(obj as THREE.Group);
            continue;
          }
        }
        if (!obj.userData?.isPooled) {
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const m = child as THREE.Mesh;
              if (!m.userData?.isPooled) {
                if (!m.userData?.isSharedGeo) m.geometry?.dispose();
                if (!m.userData?.isSharedMat) {
                  if (Array.isArray(m.material)) {
                    m.material.forEach(mat => mat.dispose());
                  } else {
                    m.material?.dispose();
                  }
                }
              }
            } else if ((child as THREE.Sprite).isSprite) {
              const s = child as THREE.Sprite;
              if (!s.userData?.isPooled && !s.userData?.isSharedMat) {
                s.material?.dispose();
              }
            }
          });
        }
      }
    }
  }

  private syncDrops(): void {
    // Physical Currency Shards
    const drops = this.simulation.state.currencyDrops;
    const currentDropIds = this.scratchDropIds;
    currentDropIds.clear();

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      currentDropIds.add(d.id);

      let mesh = this.dropMap.get(d.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.sharedDropGeo, this.sharedDropMat);
        this.scene.add(mesh);
        this.dropMap.set(d.id, mesh);
      }
      mesh.position.set(d.pos.x, d.z + 6, d.pos.y);
      mesh.rotation.y += 0.05;
    }

    for (const [id, mesh] of this.dropMap.entries()) {
      if (!currentDropIds.has(id)) {
        this.scene.remove(mesh);
        this.dropMap.delete(id);
      }
    }

    // Passive Item & Augment Capsule Drops (Zero-Lag Pooled Spawning)
    const itemDrops = this.simulation.state.itemDrops;
    const currentItemIds = this.scratchItemDropIds;
    currentItemIds.clear();

    for (let i = 0; i < itemDrops.length; i++) {
      const it = itemDrops[i];
      currentItemIds.add(it.id);

      let grp = this.itemDropMap.get(it.id);
      if (!grp) {
        // Recycle compatible instance from pool if available
        const isBuff = !!(it.isBuffDrop || it.isDoubleJumpTestPickup);
        const poolIdx = this.itemDropPool.findIndex(g => (g.userData.isBuffDrop ?? false) === isBuff);
        if (poolIdx !== -1) {
          grp = this.itemDropPool.splice(poolIdx, 1)[0];
          grp.visible = true;
        } else {
          grp = new THREE.Group();
          grp.userData.isBuffDrop = isBuff;

          if (isBuff) {
            const coreMesh = new THREE.Mesh(this.sharedBuffCoreGeo, this.sharedBuffCoreMat);
            grp.add(coreMesh);
            const cageMesh = new THREE.Mesh(this.sharedBuffCageGeo, this.sharedBuffCageMat);
            grp.add(cageMesh);
            const beacon = new THREE.Mesh(this.sharedBuffBeamGeo, this.sharedBuffBeamMat);
            beacon.position.y = 64;
            grp.add(beacon);
          } else {
            const orbMesh = new THREE.Mesh(this.sharedItemOrbGeo, this.sharedItemOrbMat);
            grp.add(orbMesh);
          }
        }

        this.scene.add(grp);
        this.itemDropMap.set(it.id, grp);
      }
      grp.position.set(it.pos.x, it.z + 18, it.pos.y);
      grp.rotation.y += it.isBuffDrop ? 0.06 : 0.04;
    }

    for (const [id, grp] of this.itemDropMap.entries()) {
      if (!currentItemIds.has(id)) {
        grp.visible = false;
        this.scene.remove(grp);
        this.itemDropMap.delete(id);
        this.itemDropPool.push(grp);
      }
    }
  }

  private syncVFX(dt: number, time: number): void {
    this.vfx.update(dt, this.camera);

    // Pulse Artifact Beacon
    if (this.artifactBeacon) {
      const bPulse = 0.35 + Math.sin(time * 0.003) * 0.15;
      (this.artifactBeacon.material as THREE.MeshBasicMaterial).opacity = bPulse;
    }
  }

  private processEvents(events: SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'pulse_fired':
          if (this.use3DCommander) {
            this.soundManager.playPulse();
            this.commander3D.triggerAttack();
          } else {
            if (this.simulation.state.player.heroId !== 'commander' && e.data?.variant !== 'drone_overcharge') {
              this.soundManager.playPulse();
            }
            if (e.data?.variant !== 'drone_overcharge') {
              this.spriteAnimator.triggerAttack(
                e.data?.duration || 0.24,
                e.data?.facing,
                e.data?.fps,
                e.data?.hand
              );
            }
          }
          break;
        case 'pistol_shot_released':
          this.soundManager.playPulse();
          if (e.data?.from) {
            this.vfx.spawnBlasterMuzzleFlash(
              e.data.from,
              e.data.z ?? this.simulation.state.player.z + 52,
              e.data.vx ?? 1,
              e.data.vy ?? 0
            );
          }
          break;
        case 'beam_charging':
          {
            const elev = this.simulation.state.terrain.getElevation(e.data.from.x, e.data.from.y).height;
            this.vfx.spawnLaserCharge(e.data.from, e.data.to, elev, e.data.duration || 0.20);
          }
          break;
        case 'beam_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnLaserBeam(e.data.from, e.data.to, e.data.z || 0);
          break;
        case 'chill_beam_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnChillBeam(
            e.data.from,
            e.data.to,
            e.data.fromZ || this.simulation.state.player.z,
            e.data.boltCount || 1
          );
          break;
        case 'piercing_laser_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnPiercingElectricLaser(
            e.data.from,
            e.data.to,
            e.data.fromZ ?? (this.simulation.state.player.z + 52),
            e.data.branches || [],
            e.data.toZ
          );
          break;
        case 'extended_slash_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnExtendedSlash(
            e.data.pos,
            e.data.z,
            e.data.angle,
            e.data.step,
            e.data.range,
            e.data.slashCount || 1
          );
          break;
        case 'scissor_slash_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnScissorSlash(
            e.data.pos,
            e.data.z,
            e.data.angle,
            e.data.focusPos,
            e.data.radius,
            e.data.totalSlashes || 1
          );
          break;
        case 'frost_burst_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnFrostBurst(
            e.data.pos,
            e.data.z,
            e.data.radius,
            e.data.extraEruptions || 0,
            e.data.spikePositions || []
          );
          break;
        case 'orbiting_blade_hit':
        case 'floating_sword_hit':
          this.vfx.spawnBlasterImpactSpark({ x: e.data.x, y: e.data.y }, e.data.z ?? (this.simulation.state.player.z + 44));
          this.soundManager.playChainSpark();
          break;
        case 'teleport_executed':
          this.soundManager.playDash();
          this.vfx.spawnTeleportPortals(e.data.from, e.data.fromZ, e.data.to, e.data.toZ, e.data.radius);
          break;
        case 'dash_shockwave_impact':
          this.soundManager.playWave();
          this.vfx.spawnDashKineticImpact(e.data.pos, e.data.z, e.data.radius, e.data.dir);
          this.addCameraTrauma(0.35);
          break;
        case 'scatter_fired':
          this.soundManager.playPulse();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          this.vfx.spawnScatterBlast(e.data.from, e.data.to, e.data.z || 0);
          break;
        case 'blink_used':
          this.soundManager.playDash();
          this.vfx.spawnBlinkVFX(
            e.data.from,
            e.data.fromZ || 0,
            e.data.to,
            e.data.toZ || 0,
            e.data.radius || 95
          );
          break;
        case 'orbital_impact':
          this.soundManager.playWave();
          {
            const elev = this.simulation.state.terrain.getElevation(
              e.data.target.x,
              e.data.target.y,
              e.data.z
            ).height;
            if (e.data.variant === 'bomb') {
              this.vfx.spawnTwinSlashConvergence(
                e.data.target,
                elev,
                e.data.radius || 125,
                e.data.angle ?? 0
              );
            } else {
              this.vfx.spawnOrbitalBlast(
                e.data.target,
                e.data.radius || 95,
                elev,
                e.data.variant || 'cryo',
                e.data.z
              );
            }
          }
          break;
        case 'wave_fired':
          this.soundManager.playWave();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          break;
        case 'recovery_field_deployed':
          this.soundManager.playDash();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerDash();
            this.vfx.spawnDashGhost(
              this.simulation.state.player.pos,
              this.playerSprite.material.map || this.textures['doctor_front'] || this.textures['commander_front'],
              this.simulation.state.player.z
            );
          }
          this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, 0x10b981, e.data.z, 0.8);
          break;
        case 'ultimate_fired':
          if (!this.use3DCommander && this.simulation.state.player.heroId === 'commander') {
            this.spriteAnimator.triggerUltimate(
              e.data?.duration || 0.60,
              e.data?.facing,
              e.data?.fps || 10
            );
          }
          if (e.data.variant === 'emergency_protocol') {
            this.soundManager.playOrbitalStrike();
            const elev = this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, 0x10b981, elev, 1.2);
            this.vfx.spawnOrbitalBlast(e.data.pos, e.data.radius, elev, 'cryo');
            this.addCameraTrauma(0.6);
          } else {
            const targetPos = e.data.pos || e.data.target;
            if (targetPos) {
              const elev = this.simulation.state.terrain.getElevation(targetPos.x, targetPos.y).height;
              const strikeDelay = e.data.strikeDelay ?? 0.40;
              this.vfx.spawnOrbitalTargetLock(
                targetPos,
                e.data.radius || 260,
                elev,
                strikeDelay,
                e.data.variant || 'judgment'
              );
              if (e.data.enhancement === 'convergence_barrage' && Array.isArray(e.data.subStrikes)) {
                const subRadius = Math.round((e.data.radius || 260) * 0.65);
                for (let sIdx = 0; sIdx < e.data.subStrikes.length; sIdx++) {
                  const sp = e.data.subStrikes[sIdx];
                  const subElev = this.simulation.state.terrain.getElevation(sp.x, sp.y).height;
                  this.vfx.spawnOrbitalTargetLock(sp, subRadius, subElev, strikeDelay, 'judgment');
                }
              }
            }
          }
          break;
        case 'ultimate_singularity_spawned':
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnSingularityVFX(
              e.data.pos,
              e.data.radius || 358,
              elev,
              e.data.duration || 2.8
            );
          }
          break;
        case 'ultimate_singularity_detonated':
          this.soundManager.playOrbitalStrike();
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnSingularityDetonationVFX(e.data.pos, e.data.radius || 358, elev);
            this.addCameraTrauma(0.65);
          }
          break;
        case 'ultimate_convergence_started':
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnConvergenceBarrageVFX(
              e.data.pos,
              e.data.subStrikes || [],
              e.data.radius || 260,
              elev,
              e.data.duration || 0.95
            );
          }
          break;
        case 'ultimate_convergence_detonated':
          this.soundManager.playOrbitalStrike();
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnConvergenceDetonationVFX(e.data.pos, e.data.radius || 312, elev);
            this.addCameraTrauma(0.70);
          }
          break;
        case 'ultimate_cryo_field_spawned':
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnCryogenicFieldVFX(
              e.data.pos,
              e.data.radius || 325,
              elev,
              e.data.duration || 3.1
            );
          }
          break;
        case 'dash_used':
          this.soundManager.playDash();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerDash(
              e.data?.duration || 0.24,
              e.data?.facing
            );
            if (this.simulation.state.player.heroId === 'doctor') {
              this.doctorDashGhostTimer = 0;
            } else {
              this.vfx.spawnDashGhost(
                this.simulation.state.player.pos,
                this.playerSprite.material.map || this.textures['commander_front'],
                this.simulation.state.player.z
              );
            }
          }
          if (e.data?.variant === 'medical_rush') {
            this.vfx.spawnShockwaveRing(
              this.simulation.state.player.pos,
              130,
              0x10b981,
              this.simulation.state.player.z,
              0.55
            );
          } else {
            this.vfx.spawnDashChargeTrail(
              this.simulation.state.player.pos,
              this.simulation.state.player.z,
              e.data?.dir || this.simulation.state.player.dashDir,
              0.22
            );
          }
          break;
        case 'dash_shockwave':
          this.soundManager.playWave();
          this.vfx.spawnDashKineticImpact(
            e.data.pos,
            e.data.z || 0,
            e.data.radius || 225,
            e.data.dir || this.simulation.state.player.dashDir
          );
          this.addCameraTrauma(0.28);
          break;
        case 'medical_rush_hit':
          this.vfx.spawnShockwaveRing(e.data.pos, 84, 0x34d399, e.data.z || 0, 0.45);
          break;
        case 'scalpel_thrown':
          this.soundManager.playPulse();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerAttack(
              0.30,
              e.data?.facing || this.simulation.state.player.facing,
              18
            );
          }
          break;
        case 'grenade_thrown':
          this.soundManager.playWave();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerSecondary(
              0.36,
              e.data?.facing || this.simulation.state.player.facing
            );
          }
          break;
        case 'toxic_field_deployed':
          this.soundManager.playWave();
          this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius || 115, 0x84cc16, e.data.z || 0, 0.7);
          break;
        case 'toxic_chain_bounce':
          this.vfx.spawnToxicChainArc(
            e.data.from,
            e.data.fromZ ?? 18,
            e.data.to,
            e.data.toZ ?? 18
          );
          break;
        case 'toxic_chain_explosion':
          this.soundManager.playWave();
          this.vfx.spawnToxicExplosion(
            e.data.pos,
            e.data.z ?? 2,
            e.data.radius || DOCTOR_CONFIG.toxicChain.explosionRadius
          );
          this.addCameraTrauma(0.18);
          break;
        case 'cluster_fragmented':
          this.soundManager.playOrbitalStrike();
          this.vfx.spawnToxicExplosion(
            e.data.pos,
            e.data.z ?? 2,
            e.data.radius || DOCTOR_CONFIG.toxicClusterBomb.scatterMaxRadius
          );
          this.addCameraTrauma(0.24);
          break;
        case 'decoy_spawned':
          this.soundManager.playWave();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerSecondary(
              0.36,
              e.data?.facing || this.simulation.state.player.facing
            );
          }
          this.vfx.spawnShockwaveRing(e.data.pos, 125, 0x34d399, e.data.z || 0, 0.55);
          break;
        case 'decoy_detonated':
          this.soundManager.playOrbitalStrike();
          this.vfx.spawnRealisticExplosion(
            e.data.pos,
            e.data.z ?? 2,
            e.data.radius || DOCTOR_CONFIG.holographicDecoy.explosionRadius,
            'emerald'
          );
          this.addCameraTrauma(0.28);
          break;
        case 'therapeutic_heal':
          this.vfx.spawnHealMoteBurst(e.data.pos, e.data.z ?? 4, 4);
          break;
        case 'drone_bolt_impact':
          this.vfx.spawnDroneImpactBurst(e.data.pos, e.data.z ?? 36);
          break;
        case 'phase_barrier_activated':
          this.vfx.spawnShockwaveRing(e.data.pos, 115, 0x34d399, e.data.z || 0, 0.55);
          break;
        case 'adrenaline_activated':
          this.vfx.spawnShockwaveRing(e.data.pos, 100, 0x22c55e, e.data.z || 0, 0.45);
          break;
        case 'sanctuary_cross_deployed':
          this.soundManager.playOrbitalStrike();
          if (!this.use3DCommander && this.simulation.state.player.heroId === 'doctor') {
            this.spriteAnimator.triggerUltimate(
              DOCTOR_CONFIG.sacredField.castAnimDuration,
              e.data?.facing || this.simulation.state.player.facing,
              DOCTOR_CONFIG.sacredField.castAnimFps
            );
          }
          this.vfx.spawnShockwaveRing(e.data.pos, e.data.armHalfLength || 440, 0x10b981, e.data.z || 0, 1.3);
          this.vfx.spawnHeavenlyLightBeam(e.data.pos, e.data.z || 0, 1.0, 0x34d399);
          this.addCameraTrauma(0.45);
          break;
        case 'angel_summoned':
          this.soundManager.playOrbitalStrike();
          if (Array.isArray(e.data?.positions)) {
            for (const ap of e.data.positions) {
              this.vfx.spawnHeavenlyLightBeam(ap, ap.z ?? 0, 1.2, 0xa7f3d0);
            }
          }
          break;
        case 'rain_crosses_started':
          this.soundManager.playOrbitalStrike();
          if (!this.use3DCommander && this.simulation.state.player.heroId === 'doctor') {
            this.spriteAnimator.triggerUltimate(
              DOCTOR_CONFIG.sacredField.castAnimDuration,
              e.data?.facing || this.simulation.state.player.facing,
              DOCTOR_CONFIG.sacredField.castAnimFps
            );
          }
          this.vfx.spawnHeavenlyLightBeam(e.data.pos, e.data.z || 0, 1.15, 0x6ee7b7);
          this.vfx.spawnShockwaveRing(e.data.pos, 360, 0x34d399, e.data.z || 0, 0.9);
          this.addCameraTrauma(0.35);
          break;
        case 'falling_cross_impact':
          this.soundManager.playOrbitalStrike();
          this.vfx.spawnRealisticExplosion(
            e.data.pos,
            e.data.z || 0,
            e.data.radius || 172,
            'emerald'
          );
          this.vfx.spawnHeavenlyLightBeam(e.data.pos, e.data.z || 0, 0.65, 0x34d399);
          this.addCameraTrauma(0.22);
          break;
        case 'sanctuary_pulse':
          this.vfx.spawnShockwaveRing(e.data.pos, (e.data.armHalfLength || 440) * 0.85, 0x34d399, e.data.z || 0, 0.65);
          break;
        case 'player_hit':
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerHit();
          }
          break;
        case 'game_over':
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerDeath();
          }
          break;
        case 'jump_started':
          this.soundManager.playJump();
          break;
        case 'glide_started':
          this.soundManager.playGlide();
          break;
        case 'landed':
          this.soundManager.playLand();
          this.vfx.spawnLandingRing(this.simulation.state.player.pos, e.data.z);
          break;
        case 'damage_dealt':
          if (e.data.isOrbitalBlast) {
            this.soundManager.playOrbitalStrike();
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnOrbitalBlast(
              e.data.pos,
              e.data.radius,
              elev,
              e.data.variant || 'judgment'
            );
            this.addCameraTrauma(0.55); // Visceral camera shockwave shake
          } else {
            const elev = this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            const isCrit = !!e.data.isCrit;
            let col = isCrit ? '#fbbf24' : '#ffffff';
            if (!isCrit) {
              if (e.data.element === 'ignite') col = '#ff4500';
              else if (e.data.element === 'lightning') col = '#c084fc';
              else if (e.data.element === 'frost') col = '#38bdf8';
              else if (e.data.element === 'void') col = '#e879f9';
              else if (e.data.element === 'medical') col = '#34d399';
              else if (e.data.element === 'acid') col = '#a3e635';
            }
            this.vfx.spawnDamageNumber(e.data.pos, e.data.damage, col, elev, isCrit);
          }
          break;
        case 'chain_spark':
          this.soundManager.playChainSpark();
          if (this.use3DCommander) {
            this.commander3D.triggerAttack();
          } else {
            this.spriteAnimator.triggerAttack();
          }
          {
            const elev = this.simulation.state.terrain.getElevation(e.data.to.x, e.data.to.y).height;
            this.vfx.drawChainLightning(e.data.from, e.data.to, elev + 52);
            if (e.data.damage > 0) {
              this.vfx.spawnDamageNumber(e.data.to, e.data.damage, '#c084fc', elev);
            }
          }
          break;
        case 'enemy_killed':
          this.soundManager.playEnemyHit();
          {
            const elev = e.data.z ?? this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnEnemyInternalSplatterBurst(
              e.data.pos,
              elev,
              e.data.type || 'crawler',
              e.data.radius || 42,
              Boolean(e.data.isElite || e.data.isBoss)
            );
          }
          break;
        case 'buff_capsule_collected':
          this.soundManager.playItemAcquired();
          break;
        case 'currency_collected':
          this.soundManager.playCurrencyPickup?.();
          if (e.data?.pos) {
            const elev = e.data.z ?? this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnBlasterImpactSpark(e.data.pos, elev + 8);
          }
          break;
        case 'level_up':
          this.soundManager.playItemAcquired();
          this.uiManager.showPickupNotification(`Rank Up! Level ${e.data.level}`);
          this.commander3D.triggerRallyVFX();
          break;
        case 'item_acquired':
        case 'buff_selected':
        case 'pod_opened':
          this.soundManager.playItemAcquired();
          if (e.type === 'item_acquired') {
            this.uiManager.showPickupNotification(`${e.data.name} Acquired (Stack x${e.data.stackCount})`);
          } else if (e.type === 'buff_selected') {
            if (e.data.source === 'enemy_drop') {
              this.uiManager.showPickupNotification(`Random Buff: ${e.data.name} (x${e.data.stackCount})`);
            } else if (e.data.source === 'chest') {
              this.uiManager.showPickupNotification(`Buff Acquired: ${e.data.name} (x${e.data.stackCount})`);
            } else {
              this.uiManager.showPickupNotification(`Augment Active: ${e.data.name}`);
            }
          }
          break;
        case 'difficulty_advanced':
          this.soundManager.playThreatAlert();
          this.uiManager.showDifficultyAlert(e.data.name, e.data.color, e.data.description);
          break;
        case 'world_event_activated':
          this.soundManager.playThreatAlert();
          this.addCameraTrauma(0.35);
          this.vfx.spawnShockwaveRing(this.simulation.state.player.pos, 140, 0xc084fc);
          {
            const evMsg =
              e.data.type === 'primal_totem'
                ? `${e.data.name}: Fight within range until synchronized!`
                : e.data.type === 'secondary_totem'
                  ? `${e.data.name}: Defeat 3 Elites one after another!`
                  : e.data.type === 'dash_totem'
                    ? `${e.data.name}: Jump across the 5 Phase Platforms to the top!`
                    : e.data.type === 'orbital_uplink'
                      ? `${e.data.name}: Follow the Vertical Light Beam to retrieve & deliver the Core!`
                      : `${e.data.name} Activated!`;
            this.uiManager.showPickupNotification(evMsg);
          }
          break;
        case 'overseer_comm':
          if (e.data?.text) {
            this.uiManager.showOverseerTacticalComm(e.data.text, e.data.durationSec ?? 6.5);
          }
          break;
        case 'tower_locked_interact':
          this.uiManager.showPickupNotification(
            `Tower safeguards offline — resolve all 4 anomalies (${e.data?.recovered ?? 0}/${e.data?.required ?? 4})`
          );
          break;
        case 'tower_unlocked':
          this.soundManager.playWorldEventComplete?.();
          this.uiManager.showPickupNotification('★ Artifact Tower Activation Unlocked — Return to the Tower!');
          break;
        case 'stage1_refreeze_started':
          {
            if (this.regionalFreezeActive) break;
            const origin = e.data?.pos || e.data?.origin || this.simulation.state.artifact.pos;
            this.regionalFreezeOrigin = { x: origin.x, y: origin.y };
            this.regionalFreezeDuration = Math.max(4.0, Number(e.data?.durationSec) || 20.0);
            this.regionalFreezeElapsed = 0;
            this.regionalFreezeActive = true;
            this.regionalFreezeMoteAccum = 0;
            const elev = this.simulation.state.terrain.getElevation(origin.x, origin.y, 1e6, 22).height;
            this.vfx.spawnShockwaveRing(origin, 360, 0x7dd3fc, elev + 16, 2.2);
            this.uiManager.showPickupNotification('★ Concealment Restored — Regional Stasis Reactivated!');
          }
          break;
        case 'world_event_pulse':
          this.soundManager.playWorldEventPulse(!!e.data.isEmp);
          this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, e.data.isEmp ? 0xc084fc : 0x38bdf8);
          if (e.data.isEmp) this.addCameraTrauma(0.25);
          break;
        case 'enemy_emerging':
          {
            const elev = this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnShockwaveRing(e.data.pos, 48, 0x84cc16, elev + 2, 0.35);
          }
          break;
        case 'enemy_attack_windup':
          if (e.data?.pos && e.data?.aimDir) {
            this.vfx.spawnEnemyAttackTelegraph(
              e.data.pos,
              e.data.z ?? 24,
              e.data.aimDir,
              e.data.variant || 'stinger',
              e.data.duration || 0.6
            );
          }
          break;
        case 'boss_spawned':
          this.soundManager.playThreatAlert();
          this.addCameraTrauma(0.75);
          this.vfx.spawnShockwaveRing(
            e.data?.pos || this.simulation.state.artifact.pos,
            420,
            0xd946ef,
            e.data?.z ?? 0,
            2.0
          );
          this.uiManager.showPickupNotification(`⚠ ALERT: ${e.data.name} HAS EMERGED! SLAY IT TO ESCAPE!`);
          break;
        case 'stage1_boss_emerge':
          this.soundManager.playThreatAlert();
          this.addCameraTrauma(0.55);
          this.vfx.spawnShockwaveRing(e.data.pos, 160, 0xe11d48, e.data.groundZ, 2.5);
          if (e.data.crystalPos) {
            this.vfx.spawnCrystalFractureFX(e.data.crystalPos);
          }
          this.uiManager.showPickupNotification('⚠ SEISMIC ANOMALY: STAGE 1 BOSS EMERGING FROM THE RED CRYSTAL!');
          break;
        case 'stage1_boss_rumble':
          this.addCameraTrauma(e.data.intensity || 0.25);
          if (e.data.isCrystalActivation) {
            this.vfx.spawnCrystalFractureFX({ x: e.data.pos.x, y: e.data.pos.y, z: e.data.z });
          } else if (e.data.isCrystalShatter) {
            const bPos = this.simulation.state.terrain.isCustomTestMap && this.simulation.state.terrain.testBossSpawnPos
              ? this.simulation.state.terrain.testBossSpawnPos
              : this.simulation.state.bossSpawnPos;
            const fwdX = bPos.x - e.data.pos.x;
            const fwdY = bPos.y - e.data.pos.y;
            this.vfx.spawnCrystalShatterBurst(
              { x: e.data.pos.x, y: e.data.pos.y, z: e.data.z },
              Math.hypot(fwdX, fwdY) > 1 ? { x: fwdX, y: fwdY } : { x: 0, y: -1 }
            );
          } else if (e.data.isEmergeTrail) {
            this.vfx.spawnCrystalEmergeTrail(e.data.pos, e.data.z);
          } else if (e.data.isFootstep) {
            this.vfx.spawnLandingRing(e.data.pos, e.data.z);
          } else if (e.data.isFinalBurst) {
            this.vfx.spawnTitanFootstepPuff(e.data.pos, e.data.z);
            this.vfx.spawnShockwaveRing(e.data.pos, 260, 0xe11d48, e.data.z, 1.8);
          }
          break;
        case 'stage1_boss_death':
          this.vfx.spawnEnemyInternalSplatterBurst(e.data.pos, e.data.z ?? 0, 'boss', 120, true);
          this.vfx.spawnRealisticExplosion(e.data.pos, e.data.z ?? 0, 320, 'void', (e.data.z ?? 0) + 40);
          break;
        case 'stage1_boss_tentacle_strike':
          if (e.data.phase === 'impact') {
            this.soundManager.playOrbitalStrike?.();
            this.addCameraTrauma(0.50);
            const elev = this.simulation.state.terrain.getElevation(e.data.target.x, e.data.target.y).height;
            this.vfx.spawnTentacleImpact(e.data.target, STAGE1_BOSS_CONFIG.tentacle.strikeRadius, elev);
          }
          break;
        case 'boss_defeated':
          this.soundManager.playWorldEventComplete();
          this.addCameraTrauma(0.85);
          this.vfx.spawnShockwaveRing(
            e.data.pos || this.simulation.state.player.pos,
            500,
            0x38bdf8,
            e.data.z ?? 0,
            2.5
          );
          this.uiManager.showPickupNotification(`★ ${e.data.name || 'STAGE 1 BOSS'} DEFEATED! TOWER RESTORATION ACTIVE!`);
          break;
        case 'world_event_completed':
          this.soundManager.playWorldEventComplete();
          this.addCameraTrauma(0.5);
          this.vfx.spawnShockwaveRing(e.data.pos, 220, 0xfacc15, 0, 1.2);
          this.uiManager.showPickupNotification(`★ ${e.data.name} COMPLETE! Select Evolution Augment`);
          break;
        case 'stage_earthquake':
          if (this.earthquakeTimer <= 0.1) {
            this.triggerEarthquake(e.data?.severity === 'major' ? 'major' : 'moderate');
          }
          break;
      }
    }
  }

  public selectHero(heroId: HeroId): void {
    this.resetRegionalFreeze();
    this.simulation.selectHero(heroId);
    const prefix = heroId === 'doctor' ? 'doctor' : 'commander';
    const textures = {
      front: this.textures[`${prefix}_front`],
      back: this.textures[`${prefix}_back`],
      left: this.textures[`${prefix}_left`],
      right: this.textures[`${prefix}_right`]
    };
    this.spriteAnimator.setHeroTextures(textures, heroId);
    if (this.playerSprite) {
      this.playerSprite.material.map = textures.front;
      this.playerSprite.material.needsUpdate = true;
      if (heroId === 'doctor') {
        if (this.commander3D) this.commander3D.group.visible = false;
        this.playerSprite.visible = true;
      } else if (heroId === 'commander') {
        this.playerSprite.visible = !this.use3DCommander;
        if (this.commander3D) this.commander3D.group.visible = this.use3DCommander;
      }
    }
  }

  private syncRecoveryFields(dt: number): void {
    const fields = this.simulation.state.recoveryFields;
    const currentIds = this.scratchRecoveryIds;
    currentIds.clear();

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      currentIds.add(field.id);

      let record = this.recoveryFieldMap.get(field.id);
      if (!record) {
        const grp = new THREE.Group();
        const elev = this.simulation.state.terrain.getElevation(field.pos.x, field.pos.y).height;
        grp.position.set(field.pos.x, elev + 1.8, field.pos.y);

        // Terrain-conformed organic bioluminescent healing mist patch (zero concentric geometric rings or blocks)
        const size = field.radius * 2.3;
        const planeGeo = new THREE.PlaneGeometry(size, size, 14, 14);
        planeGeo.rotateX(-Math.PI / 2);
        const pAttr = planeGeo.attributes.position as THREE.BufferAttribute;
        for (let v = 0; v < pAttr.count; v++) {
          const lx = pAttr.getX(v);
          const lz = pAttr.getZ(v);
          const gh = this.simulation.state.terrain.getElevation(field.pos.x + lx, field.pos.y + lz, elev, 40).height;
          pAttr.setY(v, Math.max(-18, Math.min(18, gh - elev)) + 1.2);
        }
        planeGeo.computeVertexNormals();

        const mistMat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uAlpha: { value: 0.75 }
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv * 2.0 - 1.0;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform float uAlpha;
            varying vec2 vUv;
            float rfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float rfNoise(vec2 p) {
              vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(rfHash(i), rfHash(i + vec2(1.0, 0.0)), f.x), mix(rfHash(i + vec2(0.0, 1.0)), rfHash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            float rfFbm(vec2 p) {
              return 0.55 * rfNoise(p) + 0.30 * rfNoise(p * 2.1 + vec2(5.1, 8.7)) + 0.15 * rfNoise(p * 4.3 + vec2(2.3, 1.9));
            }
            void main() {
              float r = length(vUv);
              float ang = atan(vUv.y, vUv.x);
              float w1 = rfFbm(vec2(cos(ang - uTime * 0.45), sin(ang - uTime * 0.45)) * r * 3.0 + vUv * 2.4 + vec2(uTime * 0.35));
              float w2 = rfFbm(vUv * 4.2 - vec2(uTime * 0.6));
              float dr = r - (w1 - 0.5) * 0.42;
              if (dr > 0.96) discard;
              vec2 cw = vUv + (vec2(w1, w2) - 0.5) * 0.14;
              float cBarH = exp(-pow(abs(cw.y) / 0.15, 2.2)) * smoothstep(0.56, 0.20, abs(cw.x));
              float cBarV = exp(-pow(abs(cw.x) / 0.15, 2.2)) * smoothstep(0.56, 0.20, abs(cw.y));
              float crossEmblem = clamp(max(cBarH, cBarV), 0.0, 1.0) * (0.60 + 0.40 * w2);
              float body = smoothstep(0.95, 0.12, dr) * (0.35 + 0.65 * w1);
              float coreGlow = smoothstep(0.55, 0.0, dr) * w2 * 0.65;
              float edgeDrift = exp(-pow((dr - 0.72) / 0.14, 2.0)) * smoothstep(0.28, 0.85, w2) * 0.55;
              float alpha = clamp((body * 0.44 + coreGlow * 0.85 + edgeDrift + crossEmblem * 0.36) * uAlpha, 0.0, 0.62);
              if (alpha < 0.015) discard;
              vec3 col = mix(vec3(0.06, 0.68, 0.46), vec3(0.58, 0.99, 0.84), clamp(coreGlow * 1.1 + edgeDrift + crossEmblem * 0.85, 0.0, 1.0));
              gl_FragColor = vec4(col, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(planeGeo, mistMat);
        ring.renderOrder = 2;
        grp.add(ring);

        this.scene.add(grp);
        record = { group: grp, ring };
        this.recoveryFieldMap.set(field.id, record);
      }

      // Gently swirl & breathe organic healing mist
      const mat = record.ring.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uTime) {
        mat.uniforms.uTime.value = performance.now() * 0.001;
        mat.uniforms.uAlpha.value = 0.72 + 0.22 * Math.sin(performance.now() * 0.004);
      }
    }

    // Cleanup expired fields
    for (const [id, record] of this.recoveryFieldMap.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(record.group);
        record.group.traverse((child) => {
          if ((child as any).geometry) (child as any).geometry.dispose();
          if ((child as any).material) {
            if (Array.isArray((child as any).material)) {
              (child as any).material.forEach((m: any) => m.dispose());
            } else {
              (child as any).material.dispose();
            }
          }
        });
        this.recoveryFieldMap.delete(id);
      }
    }

    // --- 2. Sync Doctor Toxic Contamination Zones (Clean Subtle Translucent Bio-Hazard Ring, Strictly Terrain-Clamped) ---
    const toxicFields = this.simulation.state.toxicFields;
    const currentToxicIds = this.scratchToxicIds;
    currentToxicIds.clear();
    for (let i = 0; i < toxicFields.length; i++) {
      const tf = toxicFields[i];
      currentToxicIds.add(tf.id);

      let rec = this.toxicFieldMap.get(tf.id);
      if (!rec) {
        const grp = new THREE.Group();
        grp.position.set(tf.pos.x, tf.z, tf.pos.y);

        // Gently terrain-conformed plane with strict vertical clamp (±14u) so it never stretches down cliffs
        const planeSize = tf.radius * 2.1;
        const gooGeo = new THREE.PlaneGeometry(planeSize, planeSize, 12, 12);
        gooGeo.rotateX(-Math.PI / 2);
        const posAttr = gooGeo.attributes.position;
        for (let v = 0; v < posAttr.count; v++) {
          const lx = posAttr.getX(v);
          const lz = posAttr.getZ(v);
          const groundH = this.simulation.state.terrain.getElevation(tf.pos.x + lx, tf.pos.y + lz, tf.z, 32).height;
          const relY = Math.max(-14, Math.min(14, groundH - tf.z));
          posAttr.setY(v, relY + 1.8);
        }
        gooGeo.computeVertexNormals();

        const gooMat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0.45 }
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            float tfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float tfNoise(vec2 p) {
              vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(tfHash(i), tfHash(i + vec2(1.0, 0.0)), f.x), mix(tfHash(i + vec2(0.0, 1.0)), tfHash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            void main() {
              vec2 p = (vUv - 0.5) * 2.1;
              float n1 = tfNoise(p * 3.8 + vec2(uTime * 0.7, -uTime * 0.5));
              float n2 = tfNoise(p * 7.5 - vec2(uTime * 1.1, n1 * 1.8));
              float r = length(p) - (n1 - 0.45) * 0.42;
              if (r > 0.96) discard;

              float vapor = smoothstep(0.95, 0.14, r) * (0.45 + 0.55 * n2);
              float bubbles = smoothstep(0.58, 0.88, n2) * smoothstep(0.85, 0.1, r) * 0.65;
              float alpha = (vapor * 0.48 + bubbles * 0.45) * uOpacity;
              if (alpha < 0.015) discard;

              vec3 mistCol = vec3(0.20, 0.76, 0.38);
              vec3 rimCol = vec3(0.62, 0.96, 0.42);
              vec3 col = mix(mistCol, rimCol, clamp(bubbles * 1.4, 0.0, 1.0));
              gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.48));
            }
          `,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide
        });

        const gooMesh = new THREE.Mesh(gooGeo, gooMat);
        gooMesh.renderOrder = 2;
        grp.add(gooMesh);

        this.scene.add(grp);
        rec = { group: grp, ring: gooMesh, gooMat };
        this.toxicFieldMap.set(tf.id, rec);
      }

      const fade = tf.durationRemaining < 0.65 ? Math.max(0, tf.durationRemaining / 0.65) : 1.0;
      if (rec.gooMat) {
        rec.gooMat.uniforms.uTime.value = performance.now() * 0.001;
        rec.gooMat.uniforms.uOpacity.value = 0.48 * fade;
      }
    }

    for (const [id, rec] of this.toxicFieldMap.entries()) {
      if (!currentToxicIds.has(id)) {
        this.disposeObject3D(rec.group);
        this.toxicFieldMap.delete(id);
      }
    }

    // --- 3. Sync Doctor Ultimate: Sanctuary Cross (Borderless Terrain-Conformed Medical Energy Field) ---
    const crosses = this.simulation.state.sanctuaryCrosses;
    const currentCrossIds = this.scratchCrossIds;
    currentCrossIds.clear();
    const crossTimeSec = performance.now() * 0.001;
    for (let i = 0; i < crosses.length; i++) {
      const cross = crosses[i];
      currentCrossIds.add(cross.id);

      let rec = this.sanctuaryCrossMap.get(cross.id);
      if (!rec) {
        const grp = new THREE.Group();
        grp.position.set(cross.pos.x, cross.z, cross.pos.y);

        const halfExt = cross.armHalfLength * 1.28;
        const size = halfExt * 2;
        const geo = new THREE.PlaneGeometry(size, size, 18, 18);
        geo.rotateX(-Math.PI / 2);
        this.conformCrossPlaneToTerrain(geo, cross.pos.x, cross.pos.y, cross.z);

        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uArmLen: { value: cross.armHalfLength },
            uArmWidth: { value: cross.armHalfWidth },
            uPulsePhase: { value: 0 },
            uFade: { value: 1 },
            uTime: { value: 0 }
          },
          vertexShader: `
            varying vec2 vLocal;
            void main() {
              vLocal = position.xz;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uArmLen;
            uniform float uArmWidth;
            uniform float uPulsePhase;
            uniform float uFade;
            uniform float uTime;
            varying vec2 vLocal;

            float scHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float scNoise(vec2 p) {
              vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(scHash(i), scHash(i + vec2(1.0, 0.0)), f.x), mix(scHash(i + vec2(0.0, 1.0)), scHash(i + vec2(1.0, 1.0)), f.x), f.y);
            }

            void main() {
              vec2 pNorm = vLocal / max(1.0, uArmLen);
              float n1 = scNoise(pNorm * 5.2 + vec2(uTime * 0.55, -uTime * 0.42));
              float n2 = scNoise(pNorm * 10.6 - vec2(uTime * 0.95, uTime * 0.65));
              float n = n1 * 0.62 + n2 * 0.38;

              // Feathered FBM-turbulent cross arms matching armWidth/armLen proportions (zero hard box borders)
              float armRatio = clamp(uArmWidth / max(1.0, uArmLen), 0.16, 0.42);
              vec2 wLocal = pNorm + (vec2(n1, n2) - 0.5) * 0.11;
              float lenCutoffX = smoothstep(1.04, 0.72, abs(wLocal.x) - (n1 - 0.5) * 0.16);
              float lenCutoffY = smoothstep(1.04, 0.72, abs(wLocal.y) - (n2 - 0.5) * 0.16);
              float hArm = exp(-pow(abs(wLocal.y) / (armRatio * 0.85), 2.2)) * lenCutoffX;
              float vArm = exp(-pow(abs(wLocal.x) / (armRatio * 0.85), 2.2)) * lenCutoffY;
              float crossMask = clamp(max(hArm, vArm), 0.0, 1.0);

              float hSpine = exp(-pow(abs(wLocal.y) / (armRatio * 0.30), 2.0)) * lenCutoffX;
              float vSpine = exp(-pow(abs(wLocal.x) / (armRatio * 0.30), 2.0)) * lenCutoffY;
              float coreSpine = clamp(max(hSpine, vSpine), 0.0, 1.0);

              float radial = length(pNorm) - (n - 0.5) * 0.34;
              if (radial > 1.20) discard;

              float armDist = max(abs(wLocal.x), abs(wLocal.y));
              float pulseWave = exp(-pow((armDist - uPulsePhase) * 6.0, 2.0)) * crossMask * (0.65 + 0.35 * n);
              float ambientAura = smoothstep(1.05, 0.10, radial) * (0.14 + 0.20 * n);
              float armWisp = crossMask * (0.48 + 0.52 * n);

              float alpha = (armWisp * 0.52 + coreSpine * 0.32 + pulseWave * 0.36 + ambientAura * 0.24) * uFade;
              if (alpha < 0.008) discard;

              vec3 baseGreen = vec3(0.06, 0.72, 0.50);
              vec3 brightMint = vec3(0.45, 0.96, 0.78);
              vec3 whiteCore = vec3(0.86, 1.0, 0.94);
              vec3 col = mix(baseGreen, brightMint, clamp(crossMask * 0.75 + pulseWave, 0.0, 1.0));
              col = mix(col, whiteCore, clamp(coreSpine * 0.82 + pulseWave * 0.5, 0.0, 1.0));
              gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.76));
            }
          `,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 3;
        grp.add(mesh);

        this.scene.add(grp);
        rec = { group: grp, mesh, mat, snapX: cross.pos.x, snapY: cross.pos.y, snapZ: cross.z };
        this.sanctuaryCrossMap.set(cross.id, rec);
      }

      // Sync live position (Mobile Sanctuary) & re-conform terrain only when moved meaningfully
      rec.group.position.set(cross.pos.x, cross.z, cross.pos.y);
      rec.group.rotation.y = -(cross.rotation ?? 0);
      if (Math.hypot(cross.pos.x - rec.snapX, cross.pos.y - rec.snapY) >= 14 || Math.abs(cross.z - rec.snapZ) >= 4) {
        this.conformCrossPlaneToTerrain(rec.mesh.geometry as THREE.PlaneGeometry, cross.pos.x, cross.pos.y, cross.z);
        rec.snapX = cross.pos.x;
        rec.snapY = cross.pos.y;
        rec.snapZ = cross.z;
      }

      const fade = cross.durationRemaining < 0.4 ? Math.max(0.02, cross.durationRemaining / 0.4) : 1.0;
      const phase = Math.max(0, Math.min(1, 1.0 - (cross.pulseTimer / Math.max(0.1, cross.pulseInterval))));
      rec.mat.uniforms.uPulsePhase.value = phase;
      rec.mat.uniforms.uFade.value = fade;
      rec.mat.uniforms.uTime.value = crossTimeSec;
    }

    for (const [id, rec] of this.sanctuaryCrossMap.entries()) {
      if (!currentCrossIds.has(id)) {
        this.disposeObject3D(rec.group);
        this.sanctuaryCrossMap.delete(id);
      }
    }
  }

  private ensureSharedDroneResources() {
    if (!this.sharedDroneRes) {
      const hullGeo = this.vfx.createOrganicPlumeColumnGeo(3.8, 5.8, 4.4, 8, 4, 0.24, 0.8);
      const capGeo = this.vfx.createOrganicPlumeColumnGeo(2.8, 4.4, 8.8, 8, 4, 0.20, 0.5);
      capGeo.rotateX(Math.PI / 2);
      const podGeo = this.vfx.createOrganicPlumeColumnGeo(1.0, 2.2, 6.4, 6, 4, 0.25, 0.9);
      podGeo.rotateX(Math.PI / 2);
      const rotorGeo = this.vfx.createCrescentBladeGeometry(1.4, 2.4, Math.PI * 1.4, 12);
      const barrelGeo = this.vfx.createOrganicPlumeColumnGeo(0.7, 1.1, 5.4, 6, 3, 0.22, 0.8);
      barrelGeo.rotateX(Math.PI / 2);
      const coreGeo = this.vfx.createJaggedShardGeo(2.2, 4.2, 5, 7);
      const chargeGeo = this.vfx.createJaggedShardGeo(1.6, 3.2, 5, 11);
      const muzzleConeGeo = this.vfx.createOrganicPlumeColumnGeo(2.8, 0.5, 8.0, 8, 4, 0.34, 1.2);
      muzzleConeGeo.rotateX(Math.PI / 2);

      this.sharedDroneRes = {
        hullGeo,
        capGeo,
        podGeo,
        rotorGeo,
        barrelGeo,
        coreGeo,
        chargeGeo,
        muzzleConeGeo,
        armorMat: new THREE.MeshStandardMaterial({
          color: 0xf1f5f9,
          emissive: 0x064e3b,
          emissiveIntensity: 0.25,
          roughness: 0.28,
          metalness: 0.55
        }),
        trimMat: new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.32,
          metalness: 0.78
        }),
        darkFrameMat: new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.45,
          metalness: 0.65
        }),
        ventMat: new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending
        }),
        muzzleMat: new THREE.MeshBasicMaterial({
          color: 0xa7f3d0,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      };
    }
    return this.sharedDroneRes;
  }

  private ensureSharedAngelResources() {
    if (!this.sharedAngelRes) {
      const featherPts = (len: number) => [
        new THREE.Vector3(-len * 0.5, 0, 0),
        new THREE.Vector3(-len * 0.18, 1.6, 0.5),
        new THREE.Vector3(len * 0.22, 1.1, -0.4),
        new THREE.Vector3(len * 0.52, -0.5, 0)
      ];
      this.sharedAngelRes = {
        coreGeo: this.vfx.createOrganicPlumeColumnGeo(3.2, 6.8, 18, 10, 6, 0.35, 1.4),
        cageGeo: this.vfx.createOrganicPlumeColumnGeo(5.8, 9.8, 22, 10, 6, 0.42, -1.6),
        haloGeo: this.vfx.createCrescentBladeGeometry(9.0, 2.8, Math.PI * 1.55, 16),
        gimbalGeo: this.vfx.createCrescentBladeGeometry(12.5, 2.2, Math.PI * 1.45, 16),
        bladeOuterGeo: this.vfx.createJaggedRibbonGeometry(featherPts(19), 4.6),
        bladeMidGeo: this.vfx.createJaggedRibbonGeometry(featherPts(15), 3.8),
        bladeInnerGeo: this.vfx.createJaggedRibbonGeometry(featherPts(11), 3.2),
        moteGeo: this.vfx.createJaggedShardGeo(1.6, 3.6, 5, 19),
        goldMat: new THREE.MeshBasicMaterial({ color: 0xfef08a, side: THREE.DoubleSide }),
        emeraldCageMat: new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.52,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        }),
        wingGoldMat: new THREE.MeshBasicMaterial({
          color: 0xfef9c3,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        }),
        wingEmeraldMat: new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.62,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        }),
        moteMat: new THREE.MeshBasicMaterial({
          color: 0xecfdf5,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending
        })
      };
    }
    return this.sharedAngelRes;
  }

  private conformCrossPlaneToTerrain(geo: THREE.PlaneGeometry, cx: number, cy: number, cz: number): void {
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < posAttr.count; v++) {
      const lx = posAttr.getX(v);
      const lz = posAttr.getZ(v);
      const h = this.simulation.state.terrain.getElevation(cx + lx, cy + lz, cz, 56).height;
      const rel = Math.max(-28, Math.min(28, h - cz));
      posAttr.setY(v, rel + 2.2);
    }
    posAttr.needsUpdate = true;
  }

  private disposeObject3D(obj: THREE.Object3D): void {
    this.scene.remove(obj);
    obj.traverse((child) => {
      const ud = (child as any).userData || {};
      if ((child as any).geometry && !ud.isSharedGeo) {
        (child as any).geometry.dispose();
      }
      if ((child as any).material && !ud.isSharedMat) {
        if (Array.isArray((child as any).material)) {
          (child as any).material.forEach((m: any) => m.dispose());
        } else {
          (child as any).material.dispose();
        }
      }
    });
  }

  private syncDoctorEntities(dt: number, now: number): void {
    const state = this.simulation.state;
    const p = state.player;

    // 1. Frost Trails (LMB Augment 2: Cryogenic Scalpel terrain-conformed 3s ice trails)
    const activeFrostIds = this.scratchDocFrostIds;
    activeFrostIds.clear();
    for (let i = 0; i < state.frostTrails.length; i++) {
      const ft = state.frostTrails[i];
      activeFrostIds.add(ft.id);
      let rec = this.frostTrailMap.get(ft.id);
      if (!rec) {
        const grp = new THREE.Group();
        grp.position.set(ft.pos.x, ft.z, ft.pos.y);

        const size = ft.radius * 2.25;
        const geo = new THREE.PlaneGeometry(size, size, 6, 6);
        geo.rotateX(-Math.PI / 2);
        const posAttr = geo.attributes.position;
        for (let v = 0; v < posAttr.count; v++) {
          const lx = posAttr.getX(v);
          const lz = posAttr.getZ(v);
          const groundH = state.terrain.getElevation(ft.pos.x + lx, ft.pos.y + lz, ft.z, 32).height;
          const relY = Math.max(-14, Math.min(14, groundH - ft.z));
          posAttr.setY(v, relY + 1.2);
        }

        const mat = new THREE.ShaderMaterial({
          uniforms: { uOpacity: { value: 0.78 } },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uOpacity;
            varying vec2 vUv;
            float ftHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float ftNoise(vec2 p) {
              vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(ftHash(i), ftHash(i + vec2(1.0, 0.0)), f.x), mix(ftHash(i + vec2(0.0, 1.0)), ftHash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            void main() {
              vec2 c = (vUv - 0.5) * 2.2;
              float n = ftNoise(c * 4.5) * 0.65 + ftNoise(c * 9.0 + vec2(2.3, 5.1)) * 0.35;
              float r = length(c) - (n - 0.5) * 0.45;
              if (r > 0.92) discard;
              float rim = smoothstep(0.55, 0.92, r) * n;
              vec3 iceCol = mix(vec3(0.18, 0.72, 0.96), vec3(0.84, 0.95, 1.0), clamp(rim * 1.4, 0.0, 1.0));
              gl_FragColor = vec4(iceCol, clamp((0.48 - r * 0.35) * (0.55 + 0.55 * n) * uOpacity, 0.0, 0.75));
            }
          `,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 2;
        grp.add(mesh);

        this.scene.add(grp);
        rec = { group: grp, mesh };
        this.frostTrailMap.set(ft.id, rec);
      }

      const ratio = Math.max(0, Math.min(1, ft.durationRemaining / Math.max(0.1, ft.maxDuration)));
      const frostMat = rec.mesh.material as THREE.ShaderMaterial;
      frostMat.uniforms.uOpacity.value = 0.68 * Math.min(1, ratio * 2.0);
    }
    for (const [id, rec] of this.frostTrailMap.entries()) {
      if (!activeFrostIds.has(id)) {
        this.disposeObject3D(rec.group);
        this.frostTrailMap.delete(id);
      }
    }

    // 2. Vital Extraction Tethers (LMB Augment 3: Luminous beams with energy flowing enemy -> Doctor)
    const activeTetherIds = this.scratchDocTetherIds;
    activeTetherIds.clear();
    const startVec = this.tetherStartScratch.set(p.pos.x, p.z + 50, p.pos.y);
    const zAxis = this.titanPosZScratch;
    for (let i = 0; i < state.vitalTethers.length; i++) {
      const vt = state.vitalTethers[i];
      activeTetherIds.add(vt.id);
      let rec = this.vitalTetherMap.get(vt.id);
      if (!rec) {
        const outerGeo = this.vfx.createOrganicPlumeColumnGeo(2.8, 3.8, 1, 8, 6, 0.34, 1.8);
        outerGeo.rotateX(Math.PI / 2);
        const outerMat = new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.62,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(outerGeo, outerMat);

        const coreGeo = this.vfx.createOrganicPlumeColumnGeo(1.2, 1.8, 1, 6, 6, 0.28, -2.1);
        coreGeo.rotateX(Math.PI / 2);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0xecfdf5,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);

        const pulseOrb = new THREE.Mesh(
          this.vfx.createJaggedShardGeo(5.2, 14, 5, 83),
          new THREE.MeshBasicMaterial({
            color: 0x6ee7b7,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          })
        );

        this.scene.add(mesh, coreMesh, pulseOrb);
        rec = { mesh, coreMesh, pulseOrb, flowT: 1.0 - ((i * 0.27) % 1.0) };
        this.vitalTetherMap.set(vt.id, rec);
      }

      const endVec = this.tetherEndScratch.set(vt.targetPos.x, vt.targetZ + 12, vt.targetPos.y);
      const delta = this.tetherDeltaScratch.subVectors(endVec, startVec);
      const dist = Math.max(1, delta.length());
      const mid = this.tetherMidScratch.addVectors(startVec, endVec).multiplyScalar(0.5);
      const dir = this.tetherDirScratch.copy(delta).divideScalar(dist);

      const pulseScale = 1.0 + 0.25 * Math.sin(now * 0.015 + i);
      rec.mesh.position.copy(mid);
      rec.mesh.quaternion.setFromUnitVectors(zAxis, dir);
      rec.mesh.scale.set(pulseScale, pulseScale, dist);

      rec.coreMesh.position.copy(mid);
      rec.coreMesh.quaternion.copy(rec.mesh.quaternion);
      rec.coreMesh.scale.set(1, 1, dist);

      // Animate energy mote flowing FROM enemy (t=1) TOWARD Doctor (t=0)
      rec.flowT -= dt * 2.2;
      if (rec.flowT < 0) rec.flowT += 1.0;
      rec.pulseOrb.position.lerpVectors(startVec, endVec, rec.flowT);
    }
    for (const [id, rec] of this.vitalTetherMap.entries()) {
      if (!activeTetherIds.has(id)) {
        this.disposeObject3D(rec.mesh);
        this.disposeObject3D(rec.coreMesh);
        this.disposeObject3D(rec.pulseOrb);
        this.vitalTetherMap.delete(id);
      }
    }

    // 3. Experimental Drones (RMB Augment 1: 1..7 Detailed Mechanical Medical Combat Drones)
    const activeDroneIds = this.scratchDocDroneIds;
    activeDroneIds.clear();
    const drRes = this.ensureSharedDroneResources();
    for (let i = 0; i < state.doctorDrones.length; i++) {
      const dr = state.doctorDrones[i];
      activeDroneIds.add(dr.id);
      let rec = this.doctorDroneMap.get(dr.id);
      if (!rec) {
        const grp = new THREE.Group();
        grp.scale.setScalar(2.6);
        const tagShared = <T extends THREE.Object3D>(m: T, matShared: boolean = true): T => {
          m.userData.isSharedGeo = true;
          if (matShared) m.userData.isSharedMat = true;
          return m;
        };

        // Main armored hexagonal fuselage + top white med-casing
        grp.add(tagShared(new THREE.Mesh(drRes.hullGeo, drRes.darkFrameMat)));
        const cap = tagShared(new THREE.Mesh(drRes.capGeo, drRes.armorMat));
        cap.position.y = 1.9;
        grp.add(cap);

        // Exposed dorsal green energy core window
        const coreMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
        const coreMesh = tagShared(new THREE.Mesh(drRes.coreGeo, coreMat), false);
        coreMesh.position.set(0, 1.5, 2.2);
        grp.add(coreMesh);

        // Side weapon/thruster pods + spinning hover rotors
        const podL = tagShared(new THREE.Mesh(drRes.podGeo, drRes.trimMat));
        podL.position.set(-6.4, 0, 0);
        const podR = tagShared(new THREE.Mesh(drRes.podGeo, drRes.trimMat));
        podR.position.set(6.4, 0, 0);
        grp.add(podL, podR);

        const rotorL = tagShared(new THREE.Mesh(drRes.rotorGeo, drRes.ventMat));
        rotorL.position.set(-6.4, 2.1, 0);
        const rotorR = tagShared(new THREE.Mesh(drRes.rotorGeo, drRes.ventMat));
        rotorR.position.set(6.4, 2.1, 0);
        grp.add(rotorL, rotorR);

        // Underslung gimballed injector turret + twin barrels + charge orb + muzzle flash cone
        const turret = new THREE.Group();
        turret.position.set(0, -1.8, 1.6);
        const barrelL = tagShared(new THREE.Mesh(drRes.barrelGeo, drRes.darkFrameMat));
        barrelL.position.set(-1.3, 0, 3.4);
        const barrelR = tagShared(new THREE.Mesh(drRes.barrelGeo, drRes.darkFrameMat));
        barrelR.position.set(1.3, 0, 3.4);
        turret.add(barrelL, barrelR);

        const chargeMat = new THREE.MeshBasicMaterial({
          color: 0x6ee7b7,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending
        });
        const chargeOrb = tagShared(new THREE.Mesh(drRes.chargeGeo, chargeMat), false);
        chargeOrb.position.set(0, 0, 6.2);
        turret.add(chargeOrb);

        const muzzleFlash = new THREE.Group();
        muzzleFlash.position.set(0, 0, 6.8);
        const cone = tagShared(new THREE.Mesh(drRes.muzzleConeGeo, drRes.muzzleMat));
        cone.position.z = 3.2;
        const flare = tagShared(new THREE.Mesh(drRes.chargeGeo, drRes.muzzleMat));
        flare.scale.setScalar(1.8);
        muzzleFlash.add(cone, flare);
        muzzleFlash.visible = false;
        turret.add(muzzleFlash);
        grp.add(turret);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, 1)
        ]);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x6ee7b7,
          transparent: true,
          opacity: 0.78
        });
        const beamLine = new THREE.Line(lineGeo, lineMat);
        beamLine.visible = false;
        this.scene.add(beamLine);

        this.scene.add(grp);
        rec = { group: grp, turret, coreMesh, coreMat, chargeOrb, chargeMat, muzzleFlash, rotorL, rotorR, beamLine };
        this.doctorDroneMap.set(dr.id, rec);
      }

      const bob = Math.sin(now * 0.006 + dr.index * 1.1) * 3.5;
      const fireKick = dr.beamVisualTimer > 0.08 ? Math.sin(((dr.beamVisualTimer - 0.08) / 0.12) * Math.PI) : 0;
      rec.group.position.set(dr.pos.x, dr.z + bob, dr.pos.y);
      rec.rotorL.rotation.y += dt * 14;
      rec.rotorR.rotation.y -= dt * 14;

      if (dr.lastTargetPos) {
        rec.group.rotation.y = Math.atan2(dr.lastTargetPos.x - dr.pos.x, dr.lastTargetPos.y - dr.pos.y);
      } else {
        rec.group.rotation.y = dr.orbitAngle + Math.PI * 0.5;
      }

      // Firing recoil & muzzle flare
      rec.turret.position.z = 1.6 - fireKick * 2.4;
      rec.group.rotation.x = -fireKick * 0.16;
      const charge = Math.max(0, Math.min(1, dr.chargeRatio ?? 0));
      rec.coreMesh.scale.setScalar(1.0 + charge * 0.35 + fireKick * 0.3);
      rec.coreMat.color.setHex(charge > 0.4 || fireKick > 0.2 ? 0xa7f3d0 : 0x34d399);

      if (charge > 0.02) {
        rec.chargeOrb.visible = true;
        rec.chargeOrb.scale.setScalar(0.35 + charge * 1.05);
        rec.chargeMat.opacity = 0.25 + charge * 0.72;
      } else {
        rec.chargeOrb.visible = false;
      }

      rec.muzzleFlash.visible = dr.beamVisualTimer > 0.07;
      if (rec.muzzleFlash.visible) {
        const s = 0.8 + fireKick * 0.7;
        rec.muzzleFlash.scale.set(s, s, 0.9 + fireKick * 0.8);
      }

      if (rec.beamLine) {
        if (dr.beamVisualTimer > 0.05 && dr.lastTargetPos) {
          const targetGround = state.terrain.getElevation(dr.lastTargetPos.x, dr.lastTargetPos.y).height;
          const posAttr = rec.beamLine.geometry.attributes.position as THREE.BufferAttribute;
          posAttr.setXYZ(0, dr.pos.x, dr.z + bob - 3.0, dr.pos.y);
          posAttr.setXYZ(1, dr.lastTargetPos.x, targetGround + 42, dr.lastTargetPos.y);
          posAttr.needsUpdate = true;
          rec.beamLine.visible = true;
        } else {
          rec.beamLine.visible = false;
        }
      }
    }
    for (const [id, rec] of this.doctorDroneMap.entries()) {
      if (!activeDroneIds.has(id)) {
        this.disposeObject3D(rec.group);
        if (rec.beamLine) this.disposeObject3D(rec.beamLine);
        this.doctorDroneMap.delete(id);
      }
    }

    // 4. Holographic Decoys (RMB Augment 3: Straight-Running 2-Hit Hologram Doctor Projections)
    const activeDecoyIds = this.scratchDocDecoyIds;
    activeDecoyIds.clear();
    for (let i = 0; i < state.holographicDecoys.length; i++) {
      const dec = state.holographicDecoys[i];
      activeDecoyIds.add(dec.id);
      let rec = this.holographicDecoyMap.get(dec.id);
      if (!rec) {
        const grp = new THREE.Group();
        const runTex = this.textures[`doctor_run_${dec.facing}`] || this.textures['doctor_run_front'] || this.textures['doctor_front'];
        const holoMat = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: runTex },
            uUvOffset: { value: new THREE.Vector2(0, 0.5) },
            uUvRepeat: { value: new THREE.Vector2(0.25, 0.5) },
            uTime: { value: 0 },
            uAlpha: { value: 0.84 },
            uDamaged: { value: 0 }
          },
          vertexShader: `
            varying vec2 vLocalUv;
            void main() {
              vLocalUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D uMap;
            uniform vec2 uUvOffset;
            uniform vec2 uUvRepeat;
            uniform float uTime;
            uniform float uAlpha;
            uniform float uDamaged;
            varying vec2 vLocalUv;
            void main() {
              vec2 atlasUv = uUvOffset + vLocalUv * uUvRepeat;
              vec4 texel = texture2D(uMap, atlasUv);
              if (texel.a < 0.12) discard;
              float scan = 0.72 + 0.28 * sin(vLocalUv.y * 85.0 - uTime * 10.0);
              float flicker = mix(1.0, 0.72 + 0.28 * sin(uTime * 28.0), uDamaged);
              float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
              vec3 baseCol = mix(vec3(0.06, 0.65, 0.48), vec3(0.65, 0.98, 0.85), lum);
              vec3 holoCol = mix(baseCol, vec3(0.85, 1.0, 0.90), uDamaged * 0.25);
              gl_FragColor = vec4(holoCol * scan, texel.a * uAlpha * flicker * (0.85 + 0.15 * scan));
            }
          `,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide
        });
        const billboard = new THREE.Mesh(new THREE.PlaneGeometry(104, 104), holoMat);
        billboard.position.y = 52;
        grp.add(billboard);

        const baseRing = new THREE.Mesh(
          new THREE.PlaneGeometry(78, 78),
          this.vfx.createOrganicRippleShader(0x34d399, 0xa7f3d0, 9.0)
        );
        baseRing.rotation.x = -Math.PI / 2;
        baseRing.position.y = 1.2;
        grp.add(baseRing);

        this.scene.add(grp);
        rec = { group: grp, billboard, holoMat };
        this.holographicDecoyMap.set(dec.id, rec);
      }

      rec.group.position.set(dec.pos.x, dec.z, dec.pos.y);
      rec.billboard.quaternion.copy(this.camera.quaternion);
      const runTex = this.textures[`doctor_run_${dec.facing}`] || this.textures['doctor_run_front'] || this.textures['doctor_front'];
      if (runTex && rec.holoMat.uniforms.uMap.value !== runTex) {
        rec.holoMat.uniforms.uMap.value = runTex;
      }
      const frameIdx = Math.floor((now * 0.012 + i * 1.7) % 8);
      const col = frameIdx % 4;
      const row = Math.floor(frameIdx / 4);
      rec.holoMat.uniforms.uUvOffset.value.set(col / 4, 1 - (row + 1) / 2);
      rec.holoMat.uniforms.uTime.value = now * 0.001;
      rec.holoMat.uniforms.uDamaged.value = dec.hitsRemaining < dec.maxHits ? 1.0 : 0.0;
    }
    for (const [id, rec] of this.holographicDecoyMap.entries()) {
      if (!activeDecoyIds.has(id)) {
        this.disposeObject3D(rec.group);
        this.holographicDecoyMap.delete(id);
      }
    }

    // 5. Divine Angels (Ult Augment 2: 4 Invincible Non-Humanoid Celestial Seraphic Constructs)
    const activeAngelIds = this.scratchDocAngelIds;
    activeAngelIds.clear();
    const angRes = this.ensureSharedAngelResources();
    for (let i = 0; i < state.divineAngels.length; i++) {
      const ang = state.divineAngels[i];
      activeAngelIds.add(ang.id);
      let rec = this.divineAngelMap.get(ang.id);
      if (!rec) {
        const grp = new THREE.Group();
        const bodyGroup = new THREE.Group();
        bodyGroup.position.y = 52;
        grp.add(bodyGroup);

        const tagShared = <T extends THREE.Object3D>(m: T): T => {
          m.userData.isSharedGeo = true;
          m.userData.isSharedMat = true;
          return m;
        };

        // Radiant white-gold crystalline core + counter-rotating emerald filigree cage
        const coreMesh = tagShared(new THREE.Mesh(angRes.coreGeo, angRes.goldMat));
        coreMesh.scale.set(0.85, 1.35, 0.85);
        bodyGroup.add(coreMesh);

        const outerCage = tagShared(new THREE.Mesh(angRes.cageGeo, angRes.emeraldCageMat));
        outerCage.scale.set(1.0, 1.45, 1.0);
        bodyGroup.add(outerCage);

        // Two orthogonal gimbal filigree rings + overhead celestial crown halo (360-deg cohesive silhouette)
        const gimbalA = tagShared(new THREE.Mesh(angRes.gimbalGeo, angRes.goldMat));
        gimbalA.rotation.x = Math.PI * 0.34;
        gimbalA.rotation.y = Math.PI * 0.18;
        const gimbalB = tagShared(new THREE.Mesh(angRes.gimbalGeo, angRes.emeraldCageMat));
        gimbalB.rotation.x = -Math.PI * 0.34;
        gimbalB.rotation.y = -Math.PI * 0.18;
        bodyGroup.add(gimbalA, gimbalB);

        const haloCrown = tagShared(new THREE.Mesh(angRes.haloGeo, angRes.goldMat));
        haloCrown.rotation.x = Math.PI / 2;
        haloCrown.position.y = 20;
        bodyGroup.add(haloCrown);

        // Integrated multi-tiered sweeping energy wing structures (left & right + cross-axis depth fins)
        const buildWingRig = (sign: number) => {
          const rig = new THREE.Group();
          rig.position.set(sign * 9, 4, -2);
          const b1 = tagShared(new THREE.Mesh(angRes.bladeOuterGeo, angRes.wingGoldMat));
          b1.position.set(sign * 10, 6, 0);
          b1.rotation.z = sign * 0.42;
          b1.rotation.y = -sign * 0.22;

          const b2 = tagShared(new THREE.Mesh(angRes.bladeMidGeo, angRes.wingEmeraldMat));
          b2.position.set(sign * 8, 0, -1.2);
          b2.rotation.z = sign * 0.18;
          b2.rotation.y = -sign * 0.28;

          const b3 = tagShared(new THREE.Mesh(angRes.bladeInnerGeo, angRes.wingEmeraldMat));
          b3.position.set(sign * 6, -6, 1.0);
          b3.rotation.z = -sign * 0.12;
          b3.rotation.y = -sign * 0.16;
          rig.add(b1, b2, b3);
          return rig;
        };
        const wingRigL = buildWingRig(-1);
        const wingRigR = buildWingRig(1);
        bodyGroup.add(wingRigL, wingRigR);

        // Orbiting divine light motes
        const motesGroup = new THREE.Group();
        for (let m = 0; m < 4; m++) {
          const ma = (m / 4) * Math.PI * 2;
          const mote = tagShared(new THREE.Mesh(angRes.moteGeo, angRes.moteMat));
          mote.position.set(Math.cos(ma) * 19, (m % 2 === 0 ? 5 : -5), Math.sin(ma) * 19);
          motesGroup.add(mote);
        }
        bodyGroup.add(motesGroup);

        this.scene.add(grp);
        rec = { group: grp, bodyGroup, coreMesh, outerCage, haloCrown, gimbalA, gimbalB, wingRigL, wingRigR, motesGroup };
        this.divineAngelMap.set(ang.id, rec);
      }

      const hover = Math.sin(now * 0.005 + ang.quadrantIndex * 1.57) * 4.5;
      const fade = ang.durationRemaining < 0.7 ? Math.max(0.05, ang.durationRemaining / 0.7) : 1.0;
      rec.group.position.set(ang.pos.x, ang.z + hover, ang.pos.y);
      rec.bodyGroup.scale.setScalar(2.0 * fade * (ang.attackAnimTimer > 0 ? 1.12 : 1.0));
      rec.group.rotation.y += dt * 0.55;

      rec.coreMesh.rotation.y += dt * 1.8;
      rec.outerCage.rotation.y -= dt * 1.4;
      rec.gimbalA.rotation.z += dt * 2.1;
      rec.gimbalB.rotation.z -= dt * 1.7;
      rec.haloCrown.rotation.z += dt * 2.4;
      rec.motesGroup.rotation.y -= dt * 2.6;

      const sweep = Math.sin(now * 0.007 + ang.quadrantIndex) * 0.14;
      rec.wingRigL.rotation.y = 0.16 + sweep;
      rec.wingRigR.rotation.y = -0.16 - sweep;
    }
    for (const [id, rec] of this.divineAngelMap.entries()) {
      if (!activeAngelIds.has(id)) {
        this.disposeObject3D(rec.group);
        this.divineAngelMap.delete(id);
      }
    }

    // 6. Rain of Crosses (Ult Augment 3: Falling Glowing Sanctuary Crosses with Borderless Ground Marker)
    const activeFallingIds = this.scratchDocFallingIds;
    activeFallingIds.clear();
    for (let i = 0; i < state.fallingCrosses.length; i++) {
      const fc = state.fallingCrosses[i];
      activeFallingIds.add(fc.id);
      let rec = this.fallingCrossMap.get(fc.id);
      if (!rec) {
        const grp = new THREE.Group();

        const warnSize = fc.impactRadius * 2.1;
        const warningMat = new THREE.ShaderMaterial({
          uniforms: { uProgress: { value: 0.4 }, uFade: { value: 0.85 } },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv * 2.0 - 1.0;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uProgress;
            uniform float uFade;
            varying vec2 vUv;
            float fcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float fcNoise(vec2 p) {
              vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(fcHash(i), fcHash(i + vec2(1.0, 0.0)), f.x), mix(fcHash(i + vec2(0.0, 1.0)), fcHash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
            void main() {
              float n = fcNoise(vUv * 4.5) * 0.65 + fcNoise(vUv * 9.0 + vec2(uProgress * 3.0)) * 0.35;
              vec2 wUv = vUv + (vec2(n, fcNoise(vUv * 6.2 - vec2(uProgress * 2.5))) - 0.5) * 0.12;
              float hBar = exp(-pow(abs(wUv.y) / 0.16, 2.2)) * smoothstep(0.86, 0.42, abs(wUv.x));
              float vBar = exp(-pow(abs(wUv.x) / 0.16, 2.2)) * smoothstep(0.86, 0.42, abs(wUv.y));
              float crossHint = clamp(max(hBar, vBar), 0.0, 1.0) * (0.62 + 0.38 * n);

              float d = length(vUv) - (n - 0.5) * 0.32;
              if (d > 0.98) discard;
              float softMist = smoothstep(0.95, 0.08, d) * (0.18 + 0.24 * n);
              float focusGlow = smoothstep(0.48, 0.0, d) * uProgress * 0.38;
              float alpha = clamp((softMist + focusGlow + crossHint * (0.48 + 0.32 * uProgress)) * uFade, 0.0, 0.85);
              if (alpha < 0.008) discard;
              vec3 col = mix(vec3(0.06, 0.72, 0.50), vec3(0.75, 1.0, 0.88), clamp(crossHint * 0.85 + focusGlow, 0.0, 1.0));
              gl_FragColor = vec4(col, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide
        });
        const warnGeo = new THREE.PlaneGeometry(warnSize, warnSize);
        warnGeo.rotateX(-Math.PI / 2);
        const warningMesh = new THREE.Mesh(warnGeo, warningMat);
        warningMesh.position.set(fc.targetPos.x, fc.targetZ + 1.5, fc.targetPos.y);
        grp.add(warningMesh);

        const crossGroup = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({
          color: 0x6ee7b7,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        crossGroup.add(new THREE.Mesh(this.vfx.createOrganicPlumeColumnGeo(6, 18, 96, 10, 6, 0.34, 1.4), mat));
        const crossArm = new THREE.Mesh(
          this.vfx.createOrganicPlumeColumnGeo(7, 15, 68, 8, 5, 0.26, -1.2),
          mat.clone()
        );
        crossArm.rotation.z = Math.PI / 2;
        crossArm.position.y = 14;
        crossGroup.add(crossArm);
        grp.add(crossGroup);

        this.scene.add(grp);
        rec = { group: grp, warningMesh, warningMat, crossGroup };
        this.fallingCrossMap.set(fc.id, rec);
      }

      rec.crossGroup.position.set(fc.targetPos.x, fc.z + 48, fc.targetPos.y);
      rec.crossGroup.rotation.y += dt * 3.0;
      const distFactor = Math.max(0.15, Math.min(1, 1.0 - (fc.z - fc.targetZ) / 440));
      rec.warningMesh.scale.setScalar(0.65 + distFactor * 0.35);
      rec.warningMat.uniforms.uProgress.value = distFactor;
      rec.warningMat.uniforms.uFade.value = 0.45 + distFactor * 0.5;
    }
    for (const [id, rec] of this.fallingCrossMap.entries()) {
      if (!activeFallingIds.has(id)) {
        this.disposeObject3D(rec.group);
        this.fallingCrossMap.delete(id);
      }
    }
  }

  public setNarrativeSystems(observer: NarrativeObserver, director: DialogueDirector): void {
    this.narrativeObserver = observer;
    this.dialogueDirector = director;
  }

  public startRun(skipPointerLock: boolean = false): void {
    this.soundManager.unlock();
    this.resetRegionalFreeze();
    this.earthquakeTimer = 0;
    this.earthquakeDuration = 0;
    this.earthquakeIntensity = 0;
    this.earthquakeIsMajor = false;
    this.cameraTrauma = 0;
    this.selectHero(this.simulation.state.selectedHeroId);
    this.simulation.startRun();
    this.narrativeObserver?.resetRun(this.simulation.state);
    this.dialogueDirector?.startRun(this.simulation.state);
    (window as any).__sim = this.simulation;
    this.uiManager.initGame(this.simulation);
    this.clearRenderEntities();
    this.createPods();
    this.createWorldEvents();
    this.createObstacles();
    this.syncArtifactTransform();
    this.spriteAnimator.reset();
    this.commander3D.resetDeath();
    if (this.orbitingBladeGroup) this.orbitingBladeGroup.visible = false;
    const p = this.simulation.state.player;
    this.cameraFocus.set(p.pos.x, p.z, p.pos.y);
    this.targetYaw = 0;
    this.targetPitch = 0.62;
    this.camCollisionDistFrac = 1.0;
    this.uiManager.update(this.simulation.state);
    if (!skipPointerLock && !this.simulation.state.isPaused) {
      this.requestPointerLock();
    }
  }

  public restartRun(skipPointerLock: boolean = false): void {
    this.soundManager.unlock();
    this.resetRegionalFreeze();
    this.earthquakeTimer = 0;
    this.earthquakeDuration = 0;
    this.earthquakeIntensity = 0;
    this.earthquakeIsMajor = false;
    this.cameraTrauma = 0;
    const curHero = this.simulation.state.selectedHeroId;
    this.selectHero(curHero);
    this.simulation.startRun();
    this.narrativeObserver?.resetRun(this.simulation.state);
    this.dialogueDirector?.startRun(this.simulation.state);
    (window as any).__sim = this.simulation;
    this.uiManager.initGame(this.simulation);
    this.clearRenderEntities();
    this.createPods();
    this.createWorldEvents();
    this.createObstacles();
    this.syncArtifactTransform();
    this.spriteAnimator.reset();
    this.commander3D.resetDeath();
    if (this.orbitingBladeGroup) this.orbitingBladeGroup.visible = false;
    const p = this.simulation.state.player;
    this.cameraFocus.set(p.pos.x, p.z, p.pos.y);
    this.targetYaw = 0;
    this.targetPitch = 0.62;
    this.camCollisionDistFrac = 1.0;
    this.uiManager.update(this.simulation.state);
    if (!skipPointerLock && !this.simulation.state.isPaused) {
      this.requestPointerLock();
    }
  }

  private clearRenderEntities(): void {
    // 1. Clean up enemies including Stage 1 Titan Colossus components
    for (const record of this.enemyMap.values()) {
      this.disposeEnemyRenderEntry(record);
    }
    this.enemyMap.clear();

    // 2. Failsafe scene scan: purge any orphaned titan components
    const orphanedTitans: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj.userData && obj.userData.isTitanPart) {
        orphanedTitans.push(obj);
      }
    });
    for (const obj of orphanedTitans) {
      this.scene.remove(obj);
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
          const m = child as THREE.Mesh;
          if (!m.userData?.isSharedGeo) m.geometry?.dispose();
          if (!m.userData?.isSharedMat) {
            if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
            else m.material?.dispose();
          }
        }
      });
    }

    // 3. Clear active VFX
    if (this.vfx) {
      this.vfx.clear();
    }

    for (const mesh of this.projMap.values()) {
      this.scene.remove(mesh);
      if (!mesh.userData?.isPooled) {
        mesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            if (!m.userData?.isPooled && !m.userData?.isSharedGeo) m.geometry?.dispose();
            if (!m.userData?.isPooled && !m.userData?.isSharedMat) {
              if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
              else m.material?.dispose();
            }
          }
        });
      }
    }
    this.projMap.clear();
    for (const poolArr of this.projectileGroupPool.values()) {
      for (let g = 0; g < poolArr.length; g++) {
        const obj = poolArr[g];
        if (!obj.userData?.isPooled) {
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const m = child as THREE.Mesh;
              if (!m.userData?.isPooled && !m.userData?.isSharedGeo) m.geometry?.dispose();
              if (!m.userData?.isPooled && !m.userData?.isSharedMat) {
                if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
                else m.material?.dispose();
              }
            }
          });
        }
      }
    }
    this.projectileGroupPool.clear();

    for (const record of this.recoveryFieldMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.recoveryFieldMap.clear();

    for (const record of this.toxicFieldMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.toxicFieldMap.clear();

    for (const record of this.sanctuaryCrossMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.sanctuaryCrossMap.clear();

    for (const record of this.frostTrailMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.frostTrailMap.clear();

    for (const record of this.vitalTetherMap.values()) {
      this.disposeObject3D(record.mesh);
      this.disposeObject3D(record.coreMesh);
      this.disposeObject3D(record.pulseOrb);
    }
    this.vitalTetherMap.clear();

    for (const record of this.doctorDroneMap.values()) {
      this.disposeObject3D(record.group);
      if (record.beamLine) this.disposeObject3D(record.beamLine);
    }
    this.doctorDroneMap.clear();

    for (const record of this.holographicDecoyMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.holographicDecoyMap.clear();

    for (const record of this.divineAngelMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.divineAngelMap.clear();

    for (const record of this.fallingCrossMap.values()) {
      this.disposeObject3D(record.group);
    }
    this.fallingCrossMap.clear();

    for (const mesh of this.dropMap.values()) {
      this.scene.remove(mesh);
    }
    this.dropMap.clear();

    for (const group of this.itemDropMap.values()) {
      this.scene.remove(group);
    }
    this.itemDropMap.clear();

    for (const entry of this.worldEventMap.values()) {
      this.scene.remove(entry.group);
      if (entry.dashPlatformGroup) this.scene.remove(entry.dashPlatformGroup);
      if (entry.payloadBeaconGroup) this.scene.remove(entry.payloadBeaconGroup);
    }
    this.worldEventMap.clear();

    for (const entry of this.podMap.values()) {
      if (entry.group) {
        entry.group.visible = false;
        this.scene.remove(entry.group);
      }
    }
    this.podMap.clear();
  }

  public async loadTestMap(file: File, scaleMode: TestMapScaleMode = 'auto'): Promise<LoadedTestMap> {
    const loaded = await loadTestMapFromFile(file, scaleMode);
    const applied = this.applyLoadedTestMap(loaded);
    this.isCustomUploadedMap = true;
    this.activeMapFileName = applied.fileName;
    return applied;
  }

  public async loadTestMapUrl(url: string, fileName: string, scaleMode: TestMapScaleMode = 'auto'): Promise<LoadedTestMap> {
    const loaded = await loadTestMapFromUrl(url, fileName, scaleMode);
    return this.applyLoadedTestMap(loaded);
  }

  public async loadDefaultStage1Map(scaleMode: TestMapScaleMode = 'auto'): Promise<LoadedTestMap> {
    const loaded = await this.loadTestMapUrl(DEFAULT_STAGE1_MAP_URL, DEFAULT_STAGE1_MAP_NAME, scaleMode);
    this.isCustomUploadedMap = false;
    this.activeMapFileName = loaded.fileName;
    return loaded;
  }

  private applyLoadedTestMap(loaded: LoadedTestMap): LoadedTestMap {
    if (!this.savedStage1Obstacles) {
      this.savedStage1Obstacles = [...this.simulation.state.obstacles];
    }
    if (!this.savedStage1ArtifactPos && this.simulation.state.artifact) {
      this.savedStage1ArtifactPos = { ...this.simulation.state.artifact.pos };
    }
    if (!this.savedStage1EventPositions) {
      this.savedStage1EventPositions = this.simulation.state.worldEvents.map((ev) => ({
        pos: { ...ev.pos },
        elevation: ev.elevation ?? 0
      }));
    }
    if (!this.savedStage1PodPositions) {
      this.savedStage1PodPositions = this.simulation.state.pods.map((pod) => ({ ...pod.pos }));
    }

    this.isTestMapActive = true;
    if (this.stage1SceneryGroup) this.stage1SceneryGroup.visible = false;
    this.simulation.state.worldWidth = loaded.worldWidth;
    this.simulation.state.worldHeight = loaded.worldHeight;
    this.simulation.state.obstacles = [...loaded.shipObstacles, ...loaded.propObstacles];
    this.simulation.state.stageName = `Custom Map: ${loaded.fileName}`;
    this.simulation.state.terrain.setCustomHeightGrid(
      loaded.heightGrid,
      loaded.spawnPos,
      loaded.bossSpawnPos,
      loaded.walkableBounds,
      loaded.circularBounds,
      {
        allowTestMapNarrative: loaded.allowTestMapNarrative,
        meshCollider: loaded.meshCollider,
        worldWidth: loaded.worldWidth,
        worldHeight: loaded.worldHeight,
        testDoubleJumpPos: loaded.doubleJumpPos,
        testRedCrystalMouthPos: loaded.redCrystalMouthPos,
        testShipBox: loaded.shipBox
      }
    );
    this.activeRedCrystalMaterials = loaded.redCrystalMaterials || [];
    this.customMapFreezeSetter = loaded.setRegionalFreeze || null;
    this.resetRegionalFreeze();
    this.terrain.setTestMapGroup(loaded.root, loaded.animatedUniforms);
    this.camera.far = Math.max(26000, Math.hypot(loaded.worldWidth, loaded.worldHeight) * 3.8);
    this.camera.updateProjectionMatrix();
    const mapCx = loaded.worldWidth * 0.5;
    const mapCz = loaded.worldHeight * 0.5;
    this.sunLight.position.set(mapCx + 1400, 3600, mapCz - 1400);
    this.rimLight.position.set(mapCx - 1600, 1800, mapCz + 1600);
    this.rebuildMountaintopHorizon(loaded.worldWidth, loaded.worldHeight, loaded.terrainBounds || {
      minX: loaded.walkableBounds.minX,
      maxX: loaded.walkableBounds.maxX,
      minZ: loaded.walkableBounds.minY,
      maxZ: loaded.walkableBounds.maxY
    });
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = loaded.worldWidth > 6500 ? 0.000078 : 0.00013;
      this.scene.fog.color.setHex(0x192942);
    }
    this.scene.background = new THREE.Color(0x101c30);

    // Position Teleporter (Artifact)
    const art = this.simulation.state.artifact;
    art.pos = { ...loaded.artifactPos };
    const artElev = this.simulation.state.terrain.getElevation(art.pos.x, art.pos.y, 1e6, 22).height;
    this.artifactGroup.position.set(art.pos.x, artElev, art.pos.y);

    // Position Events
    for (let i = 0; i < this.simulation.state.worldEvents.length && i < loaded.worldEventPositions.length; i++) {
      const ev = this.simulation.state.worldEvents[i];
      ev.pos = { ...loaded.worldEventPositions[i] };
      ev.elevation = this.simulation.state.terrain.getElevation(ev.pos.x, ev.pos.y, 1e6, 22).height;
    }

    // Position Organic Pods
    for (let i = 0; i < this.simulation.state.pods.length && i < loaded.podPositions.length; i++) {
      this.simulation.state.pods[i].pos = { ...loaded.podPositions[i] };
    }

    // Position Player & Boss
    const p = this.simulation.state.player;
    this.simulation.state.playerSpawnPos = { ...loaded.spawnPos };
    this.simulation.state.bossSpawnPos = { ...loaded.bossSpawnPos };

    // Apply saved custom_map profile overrides if present and matching the loaded map
    const savedCustomProf = this.simulation.state.activeStageConfig?.profiles?.custom_map;
    if (
      savedCustomProf &&
      (!savedCustomProf.environment?.stageName || savedCustomProf.environment.stageName === this.simulation.state.stageName)
    ) {
      this.simulation.state.applyStageConfig(this.simulation.state.activeStageConfig!, 'custom_map');
      // Prevent any legacy stage config bossSpawn tucked inside the Red Crystal cavity from overriding open-ground emergence
      if (loaded.redCrystalBox && loaded.redCrystalMouthPos) {
        const curBoss = this.simulation.state.bossSpawnPos;
        if (
          curBoss.x >= loaded.redCrystalBox.minX - 60 &&
          curBoss.x <= loaded.redCrystalBox.maxX + 60 &&
          curBoss.y >= loaded.redCrystalBox.minZ - 120 &&
          curBoss.y <= loaded.redCrystalBox.maxZ + 60
        ) {
          this.simulation.state.bossSpawnPos = { ...loaded.bossSpawnPos };
          this.simulation.state.terrain.testBossSpawnPos = { ...loaded.bossSpawnPos };
        }
      }
      this.syncArtifactTransform();
    }

    // Ensure guaranteed free Double Jump pickup is present at the first step of the teleporter tower
    this.simulation.state.itemDrops = this.simulation.state.itemDrops.filter((d) => !d.isDoubleJumpTestPickup);
    if (loaded.doubleJumpPos) {
      const rawDj = loaded.doubleJumpPos;
      const djPos = rawDj.z !== undefined ? { x: rawDj.x, y: rawDj.y } : this.simulation.resolvePickupClearSpot(rawDj);
      const djElev =
        rawDj.z !== undefined
          ? rawDj.z
          : this.simulation.state.terrain.getElevation(djPos.x, djPos.y, 1e6, 22).height;
      this.simulation.state.itemDrops.push({
        id: 'double_jump_test_pickup',
        isDoubleJumpTestPickup: true,
        pos: { ...djPos },
        vel: { x: 0, y: 0 },
        z: djElev,
        vz: 0,
        settled: true,
        lifetime: 999999
      });
    }

    const spawnPos = this.simulation.state.playerSpawnPos;
    const spawnElev = this.simulation.state.terrain.getElevation(spawnPos.x, spawnPos.y, 1e6, 22).height;
    p.pos.x = spawnPos.x;
    p.pos.y = spawnPos.y;
    p.z = spawnElev;
    p.groundZ = spawnElev;
    this.cameraFocus.set(spawnPos.x, spawnElev, spawnPos.y);

    if (this.simulation.state.isGameStarted) {
      this.simulation.regenerateRuntimePodLayout(this.simulation.state.pinnedLayoutSeed);
    }
    this.createPods();
    this.createWorldEvents();
    this.createObstacles();
    this.rebuildTestMapEnvironmentDressing(loaded);
    return loaded;
  }

  private clearTestMapEnvironmentDressing(): void {
    if (this.testMapDressingGroup) {
      this.disposeObject3D(this.testMapDressingGroup);
      this.testMapDressingGroup = null;
    }
    this.testMapDynamicLights = [];
    this.floraLightAnchors = [];
    this.simulation.state.terrain.testFloraAnchors = [];
    this.snowSporePoints = null;
    this.snowSporeCount = 0;
    this.snowSporeKinds = null;
    this.snowSporePhases = null;
    this.shipSparkPoints = null;
    this.shipSparkBasePos = null;
    this.shipSparkPhases = null;
    this.summitBeaconMesh = null;
    this.floraLightUpdateAccum = 0;
  }

  private rebuildTestMapEnvironmentDressing(loaded: LoadedTestMap): void {
    this.clearTestMapEnvironmentDressing();
    if (!loaded.meshCollider) return;

    const grp = new THREE.Group();
    grp.name = 'Stage1_Environment_Dressing';
    const col = loaded.meshCollider;
    const rng = new SeededRandom(948271);
    const floraResult = buildStage1ProceduralFlora(col, loaded, 948271);
    grp.add(floraResult.group);
    for (let i = 0; i < floraResult.lightAnchors.length; i++) {
      this.floraLightAnchors.push(floraResult.lightAnchors[i]);
    }
    this.simulation.state.terrain.testFloraAnchors = floraResult.floraPositions.map((fp) => ({
      x: fp.x,
      y: fp.y,
      z: fp.z
    }));

    // 4. Overseer Tower Summit Resonance Beacon (Light + Organic Aurora Sky Wisp)
    const artElev = this.simulation.state.terrain.getElevation(loaded.artifactPos.x, loaded.artifactPos.y, 1e6, 22).height;
    const beaconLight = new THREE.PointLight(0x38bdf8, 3.2, 1450, 1.2);
    beaconLight.position.set(loaded.artifactPos.x, artElev + 190, loaded.artifactPos.y);
    grp.add(beaconLight);
    this.testMapDynamicLights.push({
      light: beaconLight,
      kind: 'tower',
      baseIntensity: 3.2,
      phase: 0
    });

    const auroraGeo = new THREE.PlaneGeometry(150, 2200, 14, 24);
    const aPos = auroraGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < aPos.count; i++) {
      const px = aPos.getX(i);
      const py = aPos.getY(i);
      const wave = Math.sin((py / 2200) * Math.PI * 3.0 + (px / 150) * 2.4) * 28;
      aPos.setZ(i, wave);
    }
    auroraGeo.computeVertexNormals();
    const auroraMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        float wHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float wNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x),
            mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        void main() {
          float hMask = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
          float vMask = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
          float w1 = wNoise(vec2(vUv.x * 5.2 + sin(vUv.y * 4.0 - uTime * 0.65) * 0.5, vUv.y * 6.0 - uTime * 0.85));
          float w2 = wNoise(vec2(vUv.x * 11.0 - uTime * 0.35, vUv.y * 12.0 - uTime * 1.4));
          float wisps = pow(clamp(w1 * 0.65 + w2 * 0.35, 0.0, 1.0), 1.6);
          float alpha = hMask * hMask * vMask * wisps * 0.24;
          if (alpha < 0.005) discard;
          vec3 col = mix(vec3(0.16, 0.56, 0.88), vec3(0.45, 0.82, 0.98), w2);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const beamMesh = new THREE.Mesh(auroraGeo, auroraMat);
    beamMesh.position.set(loaded.artifactPos.x, artElev + 1100, loaded.artifactPos.y);
    grp.add(beamMesh);
    this.summitBeaconMesh = beamMesh;

    // 5. Crashed Colony Shipwreck Warm Emergency Fire & Sparks
    const shipPos = loaded.shipCenter || {
      x: loaded.spawnPos.x - 360,
      y: loaded.spawnPos.y,
      z: spawnElevSafe(col, loaded.spawnPos.x, loaded.spawnPos.y)
    };
    const fireLight = new THREE.PointLight(0xff8c3b, 3.6, 1050, 1.35);
    fireLight.position.set(shipPos.x + 120, shipPos.z + 115, shipPos.y - 60);
    grp.add(fireLight);
    this.testMapDynamicLights.push({
      light: fireLight,
      kind: 'ship',
      baseIntensity: 3.6,
      phase: 0.4
    });

    const emergLight = new THREE.PointLight(0xffd27d, 2.8, 950, 1.35);
    emergLight.position.set(shipPos.x - 110, shipPos.z + 150, shipPos.y + 85);
    grp.add(emergLight);
    this.testMapDynamicLights.push({
      light: emergLight,
      kind: 'ship',
      baseIntensity: 2.8,
      phase: 2.2
    });

    const sparkCount = 64;
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkPhases = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i++) {
      sparkPhases[i] = rng.next();
      sparkPos[i * 3] = shipPos.x + rng.range(-180, 180);
      sparkPos[i * 3 + 1] = shipPos.z + 30 + sparkPhases[i] * 260;
      sparkPos[i * 3 + 2] = shipPos.y + rng.range(-160, 160);
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffa94d,
      size: 10,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    grp.add(sparks);
    this.shipSparkPoints = sparks;
    this.shipSparkBasePos = new THREE.Vector3(shipPos.x, shipPos.z + 25, shipPos.y);
    this.shipSparkPhases = sparkPhases;

    // 6. Pooled Nearest-Flora PointLights (repositioned dynamically around the player)
    for (let i = 0; i < 5; i++) {
      const fl = new THREE.PointLight(0x38bdf8, 2.2, 680, 1.45);
      const anchor = this.floraLightAnchors[i];
      if (anchor) {
        fl.position.copy(anchor.pos);
        fl.color.setHex(anchor.color);
      } else {
        fl.position.set(loaded.spawnPos.x, 600, loaded.spawnPos.y);
      }
      grp.add(fl);
      this.testMapDynamicLights.push({
        light: fl,
        kind: 'flora',
        baseIntensity: 2.2,
        phase: i * 1.15,
        homePos: fl.position.clone()
      });
    }

    // 7. Single-Batch Drifting Mountain Snowflakes & Bioluminescent Spores (wrapped around camera)
    const particleCount = 700;
    const pPos = new Float32Array(particleCount * 3);
    const pCol = new Float32Array(particleCount * 3);
    const pKinds = new Uint8Array(particleCount);
    const pPhases = new Float32Array(particleCount);
    const focus = this.cameraFocus;
    const cSnow = new THREE.Color(0xdbeafe);
    const cCyanSpore = new THREE.Color(0x5eead4);
    const cVioletSpore = new THREE.Color(0xc084fc);

    for (let i = 0; i < particleCount; i++) {
      pPos[i * 3] = focus.x + rng.range(-900, 900);
      pPos[i * 3 + 1] = focus.y + rng.range(-120, 560);
      pPos[i * 3 + 2] = focus.z + rng.range(-900, 900);
      pPhases[i] = rng.range(0, Math.PI * 2);
      const isSpore = rng.next() < 0.35;
      pKinds[i] = isSpore ? 1 : 0;
      const colChoice = isSpore ? (i % 2 === 0 ? cCyanSpore : cVioletSpore) : cSnow;
      pCol[i * 3] = colChoice.r;
      pCol[i * 3 + 1] = colChoice.g;
      pCol[i * 3 + 2] = colChoice.b;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    snowGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const snowMat = new THREE.PointsMaterial({
      size: 7.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const snowPts = new THREE.Points(snowGeo, snowMat);
    snowPts.frustumCulled = false;
    grp.add(snowPts);
    this.snowSporePoints = snowPts;
    this.snowSporeCount = particleCount;
    this.snowSporeKinds = pKinds;
    this.snowSporePhases = pPhases;

    this.scene.add(grp);
    this.testMapDressingGroup = grp;
    this.applyQualityToHorizon();

    function spawnElevSafe(c: typeof col, wx: number, wy: number): number {
      const s = c.querySupport(wx, wy, 1e6, 56);
      return s.hit ? s.height : 565;
    }
  }

  private updateTestMapEnvironment(dt: number, nowMs: number): void {
    if (!this.isTestMapActive) return;
    const tSec = nowMs * 0.001;

    // Pulse Summit beacon sky aurora wisp
    if (this.summitBeaconMesh) {
      const mat = this.summitBeaconMesh.material as THREE.ShaderMaterial;
      if (mat.uniforms?.uTime) {
        mat.uniforms.uTime.value = tSec;
      }
      this.summitBeaconMesh.rotation.y += dt * 0.28;
    }

    // Flicker crashed ship lights & gentle flora glow
    for (let i = 0; i < this.testMapDynamicLights.length; i++) {
      const entry = this.testMapDynamicLights[i];
      if (!entry.light.visible) continue;
      if (entry.kind === 'ship') {
        const flicker =
          0.78 +
          0.16 * Math.sin(tSec * 11.3 + entry.phase) +
          0.10 * Math.sin(tSec * 23.7 + entry.phase * 2.1);
        entry.light.intensity = entry.baseIntensity * flicker;
      } else if (entry.kind === 'flora') {
        entry.light.intensity = entry.baseIntensity * (0.85 + 0.15 * Math.sin(tSec * 2.1 + entry.phase));
      } else {
        entry.light.intensity = entry.baseIntensity * (0.88 + 0.12 * Math.sin(tSec * 2.6));
      }
    }

    // Re-home pooled flora lights onto nearest anchors every 0.25s without changing .visible
    this.floraLightUpdateAccum += dt;
    if (this.floraLightUpdateAccum >= 0.25 && this.floraLightAnchors.length > 0) {
      this.floraLightUpdateAccum = 0;
      const fx = this.cameraFocus.x;
      const fz = this.cameraFocus.z;
      const floraEntries = this.testMapDynamicLights.filter((e) => e.kind === 'flora' && e.light.visible);
      if (floraEntries.length > 0) {
        const nearest = this.floraLightAnchors
          .map((a) => ({
            a,
            d2: (a.pos.x - fx) * (a.pos.x - fx) + (a.pos.z - fz) * (a.pos.z - fz)
          }))
          .sort((u, v) => u.d2 - v.d2);
        for (let k = 0; k < floraEntries.length && k < nearest.length; k++) {
          const target = nearest[k].a;
          floraEntries[k].light.position.lerp(target.pos, 0.65);
          floraEntries[k].light.color.setHex(target.color);
        }
      }
    }

    // Animate rising ship fire sparks
    if (this.shipSparkPoints && this.shipSparkBasePos && this.shipSparkPhases) {
      const attr = this.shipSparkPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const bx = this.shipSparkBasePos.x;
      const by = this.shipSparkBasePos.y;
      const bz = this.shipSparkBasePos.z;
      for (let i = 0; i < this.shipSparkPhases.length; i++) {
        let p = this.shipSparkPhases[i] + dt * (0.28 + (i % 5) * 0.05);
        if (p > 1) p -= 1;
        this.shipSparkPhases[i] = p;
        const ang = i * 2.39996 + p * 3.1;
        const rad = 50 + ((i * 37) % 160);
        arr[i * 3] = bx + Math.cos(ang) * rad;
        arr[i * 3 + 1] = by + p * 270;
        arr[i * 3 + 2] = bz + Math.sin(ang) * rad;
      }
      attr.needsUpdate = true;
    }

    // Animate & wrap falling mountain snow + rising bioluminescent spores around cameraFocus
    if (this.snowSporePoints && this.snowSporeKinds && this.snowSporePhases) {
      const attr = this.snowSporePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const drawCount = this.graphicsQuality === 'low'
        ? Math.min(250, this.snowSporeCount)
        : this.graphicsQuality === 'high'
          ? this.snowSporeCount
          : Math.min(500, this.snowSporeCount);
      const cx = this.cameraFocus.x;
      const cy = this.cameraFocus.y;
      const cz = this.cameraFocus.z;

      for (let i = 0; i < drawCount; i++) {
        const idx = i * 3;
        const phase = this.snowSporePhases[i];
        const isSpore = this.snowSporeKinds[i] === 1;
        arr[idx] += Math.sin(tSec * 0.9 + phase) * 18 * dt + (isSpore ? 0 : 12 * dt);
        arr[idx + 1] += (isSpore ? 26 : -44) * dt;
        arr[idx + 2] += Math.cos(tSec * 0.8 + phase) * 18 * dt;

        // Wrap within 1800x680x1800 box centered on camera focus
        if (arr[idx] < cx - 900) arr[idx] += 1800;
        else if (arr[idx] > cx + 900) arr[idx] -= 1800;
        if (arr[idx + 2] < cz - 900) arr[idx + 2] += 1800;
        else if (arr[idx + 2] > cz + 900) arr[idx + 2] -= 1800;
        if (arr[idx + 1] < cy - 120) arr[idx + 1] += 680;
        else if (arr[idx + 1] > cy + 560) arr[idx + 1] -= 680;
      }
      attr.needsUpdate = true;
    }
  }

  private rebuildMountaintopHorizon(
    worldWidth: number,
    worldHeight: number,
    terrainBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  ): void {
    if (this.mountaintopHorizonGroup) {
      this.disposeObject3D(this.mountaintopHorizonGroup);
      this.mountaintopHorizonGroup = null;
    }
    this.skyCloudUniforms = null;
    this.horizonCloudMeshes = [];

    const grp = new THREE.Group();
    grp.name = 'Mountaintop_Horizon_Vista';
    const cx = worldWidth * 0.5;
    const cz = worldHeight * 0.5;
    const mapRadius = Math.hypot(worldWidth * 0.5, worldHeight * 0.5);
    const skyRadius = Math.max(16500, Math.round(mapRadius * 3.4));

    // 1. Overcast Cloudy Night Sky Dome (strictly dark sky + clouds for mountain-top crest; no stars or moons)
    const skyGeo = new THREE.SphereGeometry(skyRadius, 32, 20);
    this.skyCloudUniforms = {
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(0x192942) }
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyCloudUniforms,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      vertexShader: `
        varying vec3 vSkyDir;
        void main() {
          vSkyDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uFogColor;
        varying vec3 vSkyDir;

        float sHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        float sNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = sHash(i);
          float b = sHash(i + vec2(1.0, 0.0));
          float c = sHash(i + vec2(0.0, 1.0));
          float d = sHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float sFbm(vec2 p) {
          float sum = 0.0;
          sum += 0.56 * sNoise(p);
          sum += 0.30 * sNoise(p * 2.07 + vec2(5.1, 2.3));
          sum += 0.14 * sNoise(p * 4.19 - vec2(3.4, 7.2));
          return sum;
        }

        void main() {
          vec3 dir = normalize(vSkyDir);
          float y = dir.y;

          // Readable moonlit overcast night sky gradient into horizon fog
          vec3 zenithCol = uFogColor * 0.36;
          vec3 midCol = uFogColor * 0.78;
          vec3 skyCol = y >= 0.0
            ? mix(uFogColor, mix(midCol, zenithCol, smoothstep(0.08, 0.72, y)), smoothstep(0.0, 0.45, y))
            : mix(uFogColor, uFogColor * 0.62, smoothstep(0.0, -0.45, y));

          // Drifting clouds above the mountain peak
          vec2 cloudUv = dir.xz / (max(0.08, abs(y)) + 0.18);
          vec2 drift = cloudUv * 1.35 + vec2(uTime * 0.0055, uTime * 0.0032);
          float cShape = sFbm(drift);
          float cDetail = sNoise(drift * 2.6 - vec2(uTime * 0.008, 0.0));
          float cloudDensity = smoothstep(0.36, 0.78, cShape * 0.8 + cDetail * 0.2);
          float aboveHorizon = smoothstep(-0.04, 0.18, y);

          vec3 cloudBelly = uFogColor * 0.48;
          vec3 cloudWisp = mix(uFogColor * 1.18, vec3(0.08, 0.14, 0.24), 0.58);
          vec3 cloudCol = mix(cloudBelly, cloudWisp, smoothstep(0.45, 0.82, cDetail * 0.65 + cShape * 0.35));

          vec3 finalCol = mix(skyCol, cloudCol, cloudDensity * aboveHorizon * 0.88);
          // Seamless blend right at horizon ring so distant mountain silhouettes fade into night mist
          finalCol = mix(uFogColor, finalCol, smoothstep(-0.08, 0.12, abs(y)));

          gl_FragColor = vec4(finalCol, 1.0);
        }
      `
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.position.set(cx, 0, cz);
    grp.add(skyMesh);

    // 2. Sheer Vertical Cliff Wall stitched directly along the exact outer map perimeter (moonlit basalt)
    const minX = terrainBounds.minX;
    const maxX = terrainBounds.maxX;
    const minZ = terrainBounds.minZ;
    const maxZ = terrainBounds.maxZ;
    const segsPerSide = 80;
    const totalPerimSegs = segsPerSide * 4;
    const rings = 9;
    const cliffDepth = 3400;

    const rimEarthCol = new THREE.Color(0x283344);
    const upperRockCol = new THREE.Color(0x1c2536);
    const midSlateCol = new THREE.Color(0x121926);
    const abyssRockCol = new THREE.Color(0x0a101b);
    const tmpC = new THREE.Color();

    // Pre-sample exact perimeter coordinates, outward normals, and rim elevations
    const perimPts: Array<{ x: number; z: number; nx: number; nz: number; rimY: number }> = [];
    for (let s = 0; s <= totalPerimSegs; s++) {
      const idx = s % totalPerimSegs;
      const side = Math.floor(idx / segsPerSide);
      const u = (idx % segsPerSide) / segsPerSide;
      let px = minX;
      let pz = minZ;
      let nx = 0;
      let nz = -1;
      if (side === 0) {
        // North edge (minZ): West -> East
        px = minX + (maxX - minX) * u;
        pz = minZ;
        nx = 0;
        nz = -1;
      } else if (side === 1) {
        // East edge (maxX): North -> South
        px = maxX;
        pz = minZ + (maxZ - minZ) * u;
        nx = 1;
        nz = 0;
      } else if (side === 2) {
        // South edge (maxZ): East -> West
        px = maxX - (maxX - minX) * u;
        pz = maxZ;
        nx = 0;
        nz = 1;
      } else {
        // West edge (minX): South -> North
        px = minX;
        pz = maxZ - (maxZ - minZ) * u;
        nx = -1;
        nz = 0;
      }
      // Sample terrain elevation slightly inside the perimeter so the cliff lip seals flush with the ground
      const sampleX = Math.max(minX + 6, Math.min(maxX - 6, px - nx * 8));
      const sampleZ = Math.max(minZ + 6, Math.min(maxZ - 6, pz - nz * 8));
      const sup = this.simulation.state.terrain.getElevation(sampleX, sampleZ, 1e6, 22);
      const rimY = (sup && Number.isFinite(sup.height) && sup.height > 0 ? sup.height : 10) + 1.0;
      perimPts.push({ x: px, z: pz, nx, nz, rimY });
    }

    const dropPos: number[] = [];
    const dropCols: number[] = [];
    const dropIdx: number[] = [];

    for (let r = 0; r <= rings; r++) {
      const rt = r / rings;
      for (let s = 0; s <= totalPerimSegs; s++) {
        const pt = perimPts[s];
        const isSeam = s === 0 || s === totalPerimSegs || s % segsPerSide === 0;
        // Subtle vertical crag faceting on the sheer cliff wall (0 at the top rim so there is never a gap)
        const cragNoise =
          r === 0 || isSeam
            ? 0
            : (Math.sin(s * 0.85 + r * 1.9) * 14 + Math.cos(s * 0.37 - r * 2.4) * 12) * Math.min(1, rt * 2.2);
        const slightLedge = r === 0 ? 0 : rt * 18 + Math.max(0, cragNoise);
        const wx = pt.x + pt.nx * slightLedge;
        const wz = pt.z + pt.nz * slightLedge;
        const wy = pt.rimY - rt * cliffDepth + (r === 0 ? 0 : Math.sin(s * 0.55 + r * 1.3) * 16);
        dropPos.push(wx, wy, wz);

        if (rt < 0.14) {
          tmpC.copy(rimEarthCol).lerp(upperRockCol, rt / 0.14);
        } else if (rt < 0.55) {
          tmpC.copy(upperRockCol).lerp(midSlateCol, (rt - 0.14) / 0.41);
        } else {
          tmpC.copy(midSlateCol).lerp(abyssRockCol, (rt - 0.55) / 0.45);
        }
        dropCols.push(tmpC.r, tmpC.g, tmpC.b);
      }
    }

    const stride = totalPerimSegs + 1;
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < totalPerimSegs; s++) {
        const a = r * stride + s;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        dropIdx.push(a, c, b, b, c, d);
      }
    }
    const dropGeo = new THREE.BufferGeometry();
    dropGeo.setAttribute('position', new THREE.Float32BufferAttribute(dropPos, 3));
    dropGeo.setAttribute('color', new THREE.Float32BufferAttribute(dropCols, 3));
    dropGeo.setIndex(dropIdx);
    dropGeo.computeVertexNormals();
    const dropMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: false,
      side: THREE.DoubleSide
    });
    grp.add(new THREE.Mesh(dropGeo, dropMat));

    // 3. Layered Sea of Night Clouds Well Below Playable Altitude (Y = -480, -920, -1420)
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 256;
    cloudCanvas.height = 256;
    const cctx = cloudCanvas.getContext('2d')!;
    const grad = cctx.createRadialGradient(128, 128, 16, 128, 128, 124);
    grad.addColorStop(0, 'rgba(88, 118, 158, 0.72)');
    grad.addColorStop(0.55, 'rgba(42, 64, 96, 0.34)');
    grad.addColorStop(1, 'rgba(18, 30, 50, 0.0)');
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, 256, 256);
    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    cloudTex.colorSpace = THREE.SRGBColorSpace;

    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const cloudGeo = new THREE.PlaneGeometry(1, 1);
    const cloudHeights = [-480, -920, -1420];
    const cloudMinDist = Math.max(2900, mapRadius * 0.88);
    const cloudSpanDist = Math.max(6200, mapRadius * 1.45);
    for (let layer = 0; layer < cloudHeights.length; layer++) {
      const cy = cloudHeights[layer];
      const count = 34;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + layer * 0.4;
        const dist = cloudMinDist + ((i * 397 + layer * 613) % Math.round(cloudSpanDist));
        const cw = 2600 + ((i * 211) % 2400);
        const mesh = new THREE.Mesh(cloudGeo, cloudMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(cx + Math.cos(ang) * dist, cy, cz + Math.sin(ang) * dist);
        mesh.scale.set(cw, cw * 0.72, 1);
        mesh.userData.cloudPhase = i * 0.7 + layer;
        mesh.userData.cloudLayer = layer;
        mesh.userData.baseY = cy;
        grp.add(mesh);
        this.horizonCloudMeshes.push(mesh);
      }
    }

    // 4. Distant Alpine Mountain Silhouettes Rising Out of the Night Cloud Sea Beyond the Cliff Abyss
    const peakGeo = new THREE.ConeGeometry(1, 1, 8);
    const peakMat = new THREE.MeshLambertMaterial({ color: 0x1b2940, flatShading: false });
    const snowMat = new THREE.MeshLambertMaterial({ color: 0x46638a, flatShading: false });
    const peakCount = 32;
    const peakMinDist = Math.max(5600, mapRadius + 2400);
    const peakSpanDist = Math.max(4200, Math.round(mapRadius * 0.95));
    for (let i = 0; i < peakCount; i++) {
      const ang = (i / peakCount) * Math.PI * 2 + 0.11;
      const dist = peakMinDist + ((i * 541) % peakSpanDist);
      const rad = 1350 + ((i * 269) % 1400);
      const h = 2500 + ((i * 463) % 2800);
      const px = cx + Math.cos(ang) * dist;
      const pz = cz + Math.sin(ang) * dist;

      const peak = new THREE.Mesh(peakGeo, peakMat);
      peak.position.set(px, -1550 + h * 0.5, pz);
      peak.scale.set(rad, h, rad * 0.85);
      peak.rotation.y = ang * 1.3;
      grp.add(peak);

      const cap = new THREE.Mesh(peakGeo, snowMat);
      cap.position.set(px, -1550 + h * 0.78, pz);
      cap.scale.set(rad * 0.48, h * 0.36, rad * 0.42);
      cap.rotation.y = ang * 1.3;
      grp.add(cap);
    }

    this.scene.add(grp);
    this.mountaintopHorizonGroup = grp;
    this.applyQualityToHorizon();
  }

  public clearTestMap(): void {
    this.isTestMapActive = false;
    if (this.stage1SceneryGroup) this.stage1SceneryGroup.visible = true;
    this.clearTestMapEnvironmentDressing();
    if (this.mountaintopHorizonGroup) {
      this.disposeObject3D(this.mountaintopHorizonGroup);
      this.mountaintopHorizonGroup = null;
    }
    this.skyCloudUniforms = null;
    this.horizonCloudMeshes = [];
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = 0.00022;
      this.scene.fog.color.setHex(0x192942);
    }
    this.scene.background = new THREE.Color(0x101c30);
    this.camera.far = 22000;
    this.camera.updateProjectionMatrix();
    this.sunLight.position.set(1800 + 800, 2400, 1800 - 800);
    this.rimLight.position.set(1800 - 900, 1200, 1800 + 900);
    this.simulation.state.worldWidth = 3600;
    this.simulation.state.worldHeight = 3600;
    this.simulation.state.itemDrops = this.simulation.state.itemDrops.filter((d) => !d.isDoubleJumpTestPickup);
    if (this.savedStage1Obstacles) {
      this.simulation.state.obstacles = [...this.savedStage1Obstacles];
      this.savedStage1Obstacles = null;
    }
    if (this.savedStage1ArtifactPos && this.simulation.state.artifact) {
      this.simulation.state.artifact.pos = { ...this.savedStage1ArtifactPos };
      this.savedStage1ArtifactPos = null;
    }
    if (this.savedStage1EventPositions) {
      for (let i = 0; i < this.simulation.state.worldEvents.length && i < this.savedStage1EventPositions.length; i++) {
        this.simulation.state.worldEvents[i].pos = { ...this.savedStage1EventPositions[i].pos };
        this.simulation.state.worldEvents[i].elevation = this.savedStage1EventPositions[i].elevation;
      }
      this.savedStage1EventPositions = null;
    }
    if (this.savedStage1PodPositions) {
      for (let i = 0; i < this.simulation.state.pods.length && i < this.savedStage1PodPositions.length; i++) {
        this.simulation.state.pods[i].pos = { ...this.savedStage1PodPositions[i] };
      }
      this.savedStage1PodPositions = null;
    }

    this.simulation.state.stageName = 'The Wreckage';
    this.activeRedCrystalMaterials = [];
    this.customMapFreezeSetter = null;
    this.resetRegionalFreeze();
    this.simulation.state.terrain.setCustomHeightGrid(null);
    this.terrain.setTestMapGroup(null);

    if (this.simulation.state.activeStageConfig?.profiles?.procedural) {
      this.simulation.state.applyStageConfig(this.simulation.state.activeStageConfig, 'procedural');
    } else {
      this.simulation.state.playerSpawnPos = { x: 1800, y: 2480 };
      this.simulation.state.bossSpawnPos = { x: 1800, y: 2600 };
    }

    this.syncArtifactTransform();

    const p = this.simulation.state.player;
    const sp = this.simulation.state.playerSpawnPos;
    const spawnElev = this.simulation.state.terrain.getElevation(sp.x, sp.y).height;
    p.pos.x = sp.x;
    p.pos.y = sp.y;
    p.z = spawnElev;
    p.groundZ = spawnElev;
    this.cameraFocus.set(sp.x, spawnElev, sp.y);

    if (this.simulation.state.isGameStarted) {
      this.simulation.regenerateRuntimePodLayout(this.simulation.state.pinnedLayoutSeed);
    }
    this.createPods();
    this.createWorldEvents();
    this.createObstacles();
  }

  // --- Developer Mode / Visual Stage Editor & Performance Hooks ---

  public setEditorMode(enabled: boolean, tickCallback?: ((dt: number, now: number) => void) | null): void {
    this.isEditorMode = enabled;
    this.editorTickCallback = enabled ? (tickCallback ?? null) : null;
    if (enabled) {
      this.exitPointerLock();
    } else {
      const p = this.simulation.state.player;
      this.cameraFocus.set(p.pos.x, p.z, p.pos.y);
    }
  }

  public setPostRenderCallback(cb: ((dt: number, now: number, info: THREE.WebGLInfo) => void) | null): void {
    this.postRenderCallback = cb;
  }

  public rebuildStageVisualsFromState(): void {
    this.syncArtifactTransform();
    this.createPods();
    this.createWorldEvents();
    this.createObstacles();

    // Keep player preview aligned with playerSpawnPos while in editor
    if (this.isEditorMode) {
      const sp = this.simulation.state.playerSpawnPos;
      const elev = this.simulation.state.terrain.getElevation(sp.x, sp.y).height;
      this.playerGroup.position.set(sp.x, elev, sp.y);
      this.playerShadow.position.set(sp.x, elev + 0.15, sp.y);
    }
  }

  public getEditorObjectMesh(category: string, id: string): THREE.Object3D | null {
    if (category === 'teleporter') return this.artifactGroup;
    if (category === 'pod') return this.podMap.get(id)?.group || null;
    if (category === 'world_event') return this.worldEventMap.get(id)?.group || null;
    if (category === 'obstacle') {
      return this.obstacleEntries.find((e) => e.id === id)?.mesh || null;
    }
    return null;
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getThreeTerrain(): ThreeTerrain {
    return this.terrain;
  }

  public getDialogueDirector(): DialogueDirector | null {
    return this.dialogueDirector;
  }

  public getSimulation(): Simulation {
    return this.simulation;
  }

  public getInputManager(): InputManager {
    return this.inputManager;
  }

  public getVFXCounts(): { projectiles: number; particles: number; envObjects: number } {
    return {
      projectiles: this.simulation.state.projectiles.length,
      particles: this.vfx.getActiveParticleCount(),
      envObjects: this.podMap.size + this.worldEventMap.size + this.obstacleEntries.length + (this.artifactGroup ? 1 : 0)
    };
  }

  public resetRegionalFreeze(): void {
    this.regionalFreezeActive = false;
    this.regionalFreezeElapsed = 0;
    this.regionalFreezeMoteAccum = 0;
    this.terrain.setRegionalFreeze(0);
    if (this.customMapFreezeSetter) {
      this.customMapFreezeSetter(0);
    }
  }

  private updateRegionalFreeze(dt: number): void {
    if (!this.regionalFreezeActive) return;
    if (!this.simulation.state.isGameStarted || this.simulation.state.isPaused) return;
    const prevElapsed = this.regionalFreezeElapsed;
    this.regionalFreezeElapsed = Math.min(this.regionalFreezeDuration, this.regionalFreezeElapsed + dt);
    const t = Math.min(1, this.regionalFreezeElapsed / Math.max(0.01, this.regionalFreezeDuration));
    const eased = t < 1 ? 1 - Math.pow(1 - t, 1.8) : 1;
    const worldSpan = Math.max(3600, Math.hypot(this.simulation.state.worldWidth, this.simulation.state.worldHeight));

    if (this.isTestMapActive && this.customMapFreezeSetter) {
      this.customMapFreezeSetter(eased, this.regionalFreezeOrigin.x, this.regionalFreezeOrigin.y);
    } else {
      this.terrain.setRegionalFreeze(
        eased,
        this.regionalFreezeOrigin.x,
        this.regionalFreezeOrigin.y,
        worldSpan
      );
    }

    if (prevElapsed < this.regionalFreezeDuration && this.vfx) {
      this.regionalFreezeMoteAccum += dt;
      if (this.regionalFreezeMoteAccum >= 0.18) {
        this.regionalFreezeMoteAccum = 0;
        const frontRadius = eased * worldSpan * 0.65;
        this.vfx.spawnRegionalFrostMotes(this.regionalFreezeOrigin, frontRadius, 3);
      }
    }
  }

  public stopPlaytestAndClear(): void {
    this.exitPointerLock();
    this.resetRegionalFreeze();
    this.simulation.state.isGameStarted = false;
    this.simulation.state.isPaused = false;
    this.simulation.state.enemies = [];
    this.simulation.state.projectiles = [];
    this.clearRenderEntities();
  }
}
