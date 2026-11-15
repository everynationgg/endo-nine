import { Vector2 } from '../sim/types';

export interface CameraConfig {
  cameraDistance: number;       // Focal distance controlling foreshortening
  pitchAngle: number;           // Apparent viewing pitch factor (ground aspect ratio)
  playerScreenYRatio: number;   // 0.65 - 0.70 down the viewport
  horizonYRatio: number;        // Where the distant horizon sits (e.g. 0.22 from top)
  characterHeightRatio: number; // Character height as fraction of viewport height (0.12 - 0.17)
  perspectiveStrength: number;  // How strongly objects shrink with distance ahead
  followSmoothing: number;      // Camera lerp smoothing factor
  minZoom: number;
  maxZoom: number;
  defaultZoom: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  cameraDistance: 540,
  pitchAngle: 0.52,
  playerScreenYRatio: 0.68,
  horizonYRatio: 0.22,
  characterHeightRatio: 0.145, // 14.5% of viewport height (within 12-17% spec)
  perspectiveStrength: 0.85,
  followSmoothing: 0.14,
  minZoom: 0.75,
  maxZoom: 1.45,
  defaultZoom: 1.0
};

export interface ProjectedPoint {
  screenX: number;
  screenY: number;
  scale: number;
  depthZ: number; // > 0 is ahead toward horizon, < 0 is closer to bottom of screen
  visible: boolean;
  fogFactor: number; // 0 = clear, 1 = distant horizon haze
}

export class CameraController {
  public config: CameraConfig;
  private camera: Phaser.Cameras.Scene2D.Camera;
  private worldWidth: number;
  private worldHeight: number;

  public focusWorldPos: Vector2 = { x: 1600, y: 1600 };
  public currentZoom: number;
  private targetZoom: number;

  // Mouse-movable Orbit Camera (Yaw + Bounded Pitch)
  public currentYaw: number = 0;       // Horizontal rotation in radians (0 = looking North)
  public targetYaw: number = 0;
  public currentPitch: number = 0.52;  // Vertical pitch / foreshortening ratio
  public targetPitch: number = 0.52;
  public currentHorizonRatio: number = 0.22;
  public targetHorizonRatio: number = 0.22;

  constructor(
    camera: Phaser.Cameras.Scene2D.Camera,
    worldWidth: number,
    worldHeight: number,
    config: Partial<CameraConfig> = {}
  ) {
    this.camera = camera;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.config = { ...DEFAULT_CAMERA_CONFIG, ...config };
    this.currentZoom = this.config.defaultZoom;
    this.targetZoom = this.config.defaultZoom;
    this.currentPitch = this.config.pitchAngle;
    this.targetPitch = this.config.pitchAngle;
    this.currentHorizonRatio = this.config.horizonYRatio;
    this.targetHorizonRatio = this.config.horizonYRatio;

    this.camera.setZoom(1.0);
    this.camera.setScroll(0, 0);
  }

  public handleZoom(delta: number): void {
    if (delta !== 0) {
      this.targetZoom = Math.max(
        this.config.minZoom,
        Math.min(this.config.maxZoom, this.targetZoom + delta)
      );
    }
  }

  public rotateYaw(deltaAngle: number): void {
    this.targetYaw += deltaAngle;
  }

  public adjustPitch(deltaPitch: number): void {
    // Bounded pitch so the horizon never flips into unusable angles
    this.targetPitch = Math.max(0.40, Math.min(0.64, this.targetPitch + deltaPitch));
    this.targetHorizonRatio = Math.max(0.16, Math.min(0.30, this.targetHorizonRatio + deltaPitch * 0.4));
  }

  public resetCamera(): void {
    this.targetYaw = 0;
    this.targetPitch = this.config.pitchAngle;
    this.targetHorizonRatio = this.config.horizonYRatio;
    this.targetZoom = this.config.defaultZoom;
  }

  public snapTo(targetPos: Vector2): void {
    this.focusWorldPos.x = targetPos.x;
    this.focusWorldPos.y = targetPos.y;
  }

  public update(targetPos: Vector2, _dt: number): void {
    if (Math.abs(this.currentZoom - this.targetZoom) > 0.001) {
      this.currentZoom += (this.targetZoom - this.currentZoom) * 0.15;
    }

    // Smooth yaw rotation interpolation
    if (Math.abs(this.currentYaw - this.targetYaw) > 0.0005) {
      this.currentYaw += (this.targetYaw - this.currentYaw) * 0.16;
    }

    // Smooth pitch interpolation
    if (Math.abs(this.currentPitch - this.targetPitch) > 0.001) {
      this.currentPitch += (this.targetPitch - this.currentPitch) * 0.16;
      this.config.pitchAngle = this.currentPitch;
    }
    if (Math.abs(this.currentHorizonRatio - this.targetHorizonRatio) > 0.001) {
      this.currentHorizonRatio += (this.targetHorizonRatio - this.currentHorizonRatio) * 0.16;
      this.config.horizonYRatio = this.currentHorizonRatio;
    }

    // Smooth camera tracking in world space
    this.focusWorldPos.x += (targetPos.x - this.focusWorldPos.x) * this.config.followSmoothing;
    this.focusWorldPos.y += (targetPos.y - this.focusWorldPos.y) * this.config.followSmoothing;

    const margin = 120;
    this.focusWorldPos.x = Math.max(margin, Math.min(this.worldWidth - margin, this.focusWorldPos.x));
    this.focusWorldPos.y = Math.max(margin, Math.min(this.worldHeight - margin, this.focusWorldPos.y));
  }

  public getViewportWidth(): number {
    return this.camera.width || window.innerWidth;
  }

  public getViewportHeight(): number {
    return this.camera.height || window.innerHeight;
  }

  public getHorizonScreenY(): number {
    return this.getViewportHeight() * this.currentHorizonRatio;
  }

  public getPlayerScreenY(): number {
    return this.getViewportHeight() * this.config.playerScreenYRatio;
  }

  public getWorldToPixelBase(): number {
    return (this.getViewportHeight() / 720) * this.currentZoom;
  }

  public getCommanderBaseScale(): number {
    const vh = this.getViewportHeight();
    return ((vh * this.config.characterHeightRatio) / 667) * this.currentZoom;
  }

  /**
   * Projects a 2D world position (wx, wy) + vertical elevation (wz)
   * with 360-degree orbit yaw and pitch into screen coordinates.
   */
  public project(wx: number, wy: number, wz: number = 0): ProjectedPoint {
    const vw = this.getViewportWidth();
    const vh = this.getViewportHeight();
    const horizonY = this.getHorizonScreenY();
    const playerY = this.getPlayerScreenY();

    const cosY = Math.cos(this.currentYaw);
    const sinY = Math.sin(this.currentYaw);

    const dx = wx - this.focusWorldPos.x;
    const dy = wy - this.focusWorldPos.y;

    // Rotate horizontal world plane around focus point by current camera yaw
    const rx = dx * cosY - dy * sinY;
    const rz = -(dx * sinY + dy * cosY); // rz > 0 is ahead toward the horizon

    const depthZ = rz;
    const focal = this.config.cameraDistance;
    const kPersp = this.config.perspectiveStrength;

    const denom = focal + depthZ * kPersp;
    if (denom <= 80) {
      // Behind the camera frustum
      return {
        screenX: vw * 0.5,
        screenY: vh + 300,
        scale: 2.5,
        depthZ,
        visible: false,
        fogFactor: 0
      };
    }

    const perspScale = focal / denom;
    const worldToPx = this.getWorldToPixelBase();

    const screenX = vw * 0.5 + rx * perspScale * worldToPx;

    const groundSpan = (playerY - horizonY) * this.currentZoom;
    const screenYGround = horizonY + groundSpan * perspScale;
    const screenY = screenYGround - wz * perspScale * worldToPx;

    const visible =
      depthZ <= 1900 &&
      depthZ >= -450 &&
      screenX >= -240 &&
      screenX <= vw + 240 &&
      screenY >= horizonY - 140 &&
      screenY <= vh + 240;

    const fogFactor = Math.max(0, Math.min(0.75, (depthZ - 500) / 1300));

    return {
      screenX,
      screenY,
      scale: perspScale * worldToPx,
      depthZ,
      visible,
      fogFactor
    };
  }

  /**
   * Exact inverse projection taking camera yaw and pitch into account
   * so mouse aiming and reticle positioning remain 100% accurate.
   */
  public unprojectScreenToWorld(screenX: number, screenY: number): Vector2 {
    const vw = this.getViewportWidth();
    const vh = this.getViewportHeight();
    const horizonY = this.getHorizonScreenY();
    const playerY = this.getPlayerScreenY();

    const clampedSy = Math.max(horizonY + 18, screenY);
    const groundSpan = (playerY - horizonY) * this.currentZoom;

    const perspScale = (clampedSy - horizonY) / groundSpan;
    const focal = this.config.cameraDistance;
    const kPersp = this.config.perspectiveStrength;

    const depthZ = (focal * (1 / perspScale - 1)) / kPersp;
    const rz = depthZ;

    const worldToPx = this.getWorldToPixelBase();
    const rx = (screenX - vw * 0.5) / (perspScale * worldToPx);

    // Inverse 2D rotation by -yaw
    const cosY = Math.cos(this.currentYaw);
    const sinY = Math.sin(this.currentYaw);

    const dx = rx * cosY - rz * sinY;
    const dy = -rx * sinY - rz * cosY;

    return {
      x: Math.max(20, Math.min(this.worldWidth - 20, this.focusWorldPos.x + dx)),
      y: Math.max(20, Math.min(this.worldHeight - 20, this.focusWorldPos.y + dy))
    };
  }
}
