import { Vector2 } from '../sim/types';
import { CameraController } from './CameraController';

export class VFXManager {
  private scene: Phaser.Scene;
  private cameraController: CameraController;

  constructor(scene: Phaser.Scene, cameraController: CameraController) {
    this.scene = scene;
    this.cameraController = cameraController;
  }

  public spawnDamageNumber(worldPos: Vector2, amount: number, color: string = '#ffffff', wz: number = 25): void {
    const proj = this.cameraController.project(worldPos.x, worldPos.y, wz);
    if (!proj.visible) return;

    const fontSize = Math.max(12, Math.min(24, Math.round(18 * proj.scale)));
    const text = this.scene.add.text(
      proj.screenX + (Math.random() * 18 - 9),
      proj.screenY,
      `${Math.round(amount)}`,
      {
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: color,
        stroke: '#000000',
        strokeThickness: 3
      }
    );
    text.setOrigin(0.5);
    text.setDepth(4000);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 32 * proj.scale,
      alpha: 0,
      scale: 1.2,
      duration: 600,
      ease: 'Power2',
      onComplete: () => {
        text.destroy();
      }
    });
  }

  public spawnDashGhost(worldPos: Vector2, textureKey: string, screenScale: number, wz: number = 0): void {
    const proj = this.cameraController.project(worldPos.x, worldPos.y, wz);
    if (!proj.visible) return;

    const ghost = this.scene.add.image(proj.screenX, proj.screenY, textureKey);
    ghost.setScale(screenScale);
    ghost.setOrigin(0.5, 0.95);
    ghost.setTint(0x40c4ff);
    ghost.setAlpha(0.6);
    ghost.setDepth(Math.max(10, Math.round(proj.screenY - 2)));

    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      scaleX: screenScale * 1.05,
      duration: 240,
      onComplete: () => ghost.destroy()
    });
  }

  public spawnLandingRing(worldPos: Vector2, groundZ: number): void {
    const proj = this.cameraController.project(worldPos.x, worldPos.y, groundZ);
    if (!proj.visible) return;

    const pitch = this.cameraController.config.pitchAngle;
    const ring = this.scene.add.ellipse(proj.screenX, proj.screenY, 18 * proj.scale, 18 * proj.scale * pitch, 0x64d8ff, 0.25);
    ring.setStrokeStyle(2, 0x80d8ff, 0.85);
    ring.setDepth(Math.max(9, Math.round(proj.screenY - 1)));

    this.scene.tweens.add({
      targets: ring,
      width: 58 * proj.scale,
      height: 58 * proj.scale * pitch,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    });
  }

  public drawChainLightning(fromWorld: Vector2, toWorld: Vector2): void {
    const pFrom = this.cameraController.project(fromWorld.x, fromWorld.y, 18);
    const pTo = this.cameraController.project(toWorld.x, toWorld.y, 18);
    if (!pFrom.visible && !pTo.visible) return;

    const lineG = this.scene.add.graphics();
    lineG.setDepth(3500);

    const segments = 6;
    const points: Vector2[] = [{ x: pFrom.screenX, y: pFrom.screenY }];
    const dx = pTo.screenX - pFrom.screenX;
    const dy = pTo.screenY - pFrom.screenY;
    const len = Math.hypot(dx, dy) || 1;

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const jitter = (Math.random() - 0.5) * 20 * pFrom.scale;
      points.push({
        x: pFrom.screenX + dx * t - (dy / len) * jitter,
        y: pFrom.screenY + dy * t + (dx / len) * jitter
      });
    }
    points.push({ x: pTo.screenX, y: pTo.screenY });

    lineG.lineStyle(3, 0x64d8ff, 1);
    lineG.beginPath();
    lineG.moveTo(points[0].x, points[0].y);
    for (const p of points) lineG.lineTo(p.x, p.y);
    lineG.strokePath();

    lineG.lineStyle(1.5, 0xffffff, 0.9);
    lineG.beginPath();
    lineG.moveTo(points[0].x, points[0].y);
    for (const p of points) lineG.lineTo(p.x, p.y);
    lineG.strokePath();

    this.scene.tweens.add({
      targets: lineG,
      alpha: 0,
      duration: 180,
      onComplete: () => lineG.destroy()
    });
  }

  public spawnOrbitalBlast(worldPos: Vector2, worldRadius: number): void {
    const proj = this.cameraController.project(worldPos.x, worldPos.y, 0);
    if (!proj.visible) return;

    const pitch = this.cameraController.config.pitchAngle;
    const targetRx = worldRadius * proj.scale;

    // Foreshortened ground blast ellipse
    const blastRing = this.scene.add.ellipse(
      proj.screenX,
      proj.screenY,
      24,
      24 * pitch,
      0xffd54f,
      0.75
    );
    blastRing.setStrokeStyle(3, 0xffffff, 0.95);
    blastRing.setDepth(Math.max(12, Math.round(proj.screenY - 5)));

    this.scene.tweens.add({
      targets: blastRing,
      width: targetRx * 2,
      height: targetRx * 2 * pitch,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => blastRing.destroy()
    });

    this.scene.cameras.main.shake(260, 0.012);
  }
}
