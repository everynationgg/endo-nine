import { InputSnapshot, Vector2 } from '../sim/types';
import { CameraController } from '../render/CameraController';

export class InputManager {
  public keys: Record<string, boolean> = {};
  public mouseWorldPos: Vector2 = { x: 1600, y: 1500 };
  public mouseWorldPos3D: { x: number; y: number; z: number } = { x: 1600, y: 1500, z: 12 };
  public mouseScreenPos: Vector2 = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  public mouseButtons: { left: boolean; right: boolean; middle: boolean } = {
    left: false,
    right: false,
    middle: false
  };
  public zoomDelta: number = 0;
  public inputSuppressed: boolean = false;

  // Single-frame triggers
  private shiftPressed: boolean = false;
  private rPressed: boolean = false;
  private ePressed: boolean = false;
  private spacePressed: boolean = false;
  private lmbPressed: boolean = false;
  private rmbPressed: boolean = false;

  private isFormElement(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.inputSuppressed || this.isFormElement(e.target)) return;
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (e.key === 'Shift') this.shiftPressed = true;
      if (k === 'r' && !e.repeat) this.rPressed = true;
      if (k === 'e') this.ePressed = true;
      if (e.key === ' ' || k === 'space') {
        if (!e.repeat) this.spacePressed = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      if (e.key === ' ' || k === 'space') {
        this.keys['space'] = false;
        this.keys[' '] = false;
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (this.inputSuppressed) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.interactive, button, .buff-card, .screen-modal')) {
        return;
      }

      if (e.button === 0) {
        this.mouseButtons.left = true;
        this.lmbPressed = true;
      } else if (e.button === 1) {
        this.mouseButtons.middle = true;
      } else if (e.button === 2) {
        // Right click instantly activates Secondary Skill (Defensive Protocol / Piercing Wave)
        this.mouseButtons.right = true;
        this.rmbPressed = true;
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.mouseScreenPos.x = e.clientX;
      this.mouseScreenPos.y = e.clientY;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseButtons.left = false;
      } else if (e.button === 1) {
        this.mouseButtons.middle = false;
      } else if (e.button === 2) {
        this.mouseButtons.right = false;
      }
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    window.addEventListener('wheel', (e) => {
      if (this.inputSuppressed) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.interactive, .screen-modal')) return;
      this.zoomDelta += Math.sign(e.deltaY) * -0.04;
    }, { passive: true });
  }

  private activeCameraController: CameraController | null = null;

  public updateWorldMouse(cameraController: CameraController): void {
    this.activeCameraController = cameraController;

    // Keyboard camera rotation shortcuts (Q rotates left, C resets)
    if (this.keys['q']) {
      cameraController.rotateYaw(-0.032);
    }
    if (this.keys['c']) {
      cameraController.resetCamera();
    }

    const worldPt = cameraController.unprojectScreenToWorld(
      this.mouseScreenPos.x,
      this.mouseScreenPos.y
    );
    this.mouseWorldPos.x = worldPt.x;
    this.mouseWorldPos.y = worldPt.y;
  }

  public getSnapshot(
    playerPos: Vector2,
    cameraYaw: number = 0,
    cameraForward?: Vector2,
    cameraRight?: Vector2
  ): InputSnapshot {
    let dx = 0;
    let dy = 0;

    if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;

    const len = Math.hypot(dx, dy);
    const moveDir: Vector2 = len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };

    const adx = this.mouseWorldPos.x - playerPos.x;
    const ady = this.mouseWorldPos.y - playerPos.y;
    const alen = Math.hypot(adx, ady) || 1;
    const aimDir: Vector2 = { x: adx / alen, y: ady / alen };

    const isSpaceHeld = !!(this.keys[' '] || this.keys['space']);

    const snapshot: InputSnapshot = {
      moveDir,
      wantDash: this.shiftPressed,
      wantUltimate: this.rPressed,
      wantInteract: this.ePressed,
      wantJump: this.spacePressed,
      holdJump: isSpaceHeld,
      cameraYaw,
      cameraForward,
      cameraRight,
      wantPrimaryManual: this.lmbPressed || this.mouseButtons.left,
      wantSecondaryManual: this.rmbPressed,
      mouseWorldPos: { ...this.mouseWorldPos },
      mouseWorldPos3D: { ...this.mouseWorldPos3D },
      aimDir
    };

    this.shiftPressed = false;
    this.rPressed = false;
    this.ePressed = false;
    this.spacePressed = false;
    this.lmbPressed = false;
    this.rmbPressed = false;

    return snapshot;
  }
}
