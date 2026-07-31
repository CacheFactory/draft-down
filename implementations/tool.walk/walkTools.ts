// @archigraph tool.walk
// classic CAD camera tools: Position Camera (click to stand at a point at eye
// height), Look Around (drag pans/tilts the camera in place), and Walk
// (drag moves forward/back and turns at eye height). VCB = eye height.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';

const DEFAULT_EYE_HEIGHT = 1.68; // meters — the classic modeler's default

/** Shared eye height so switching between the three tools keeps it. */
let eyeHeight = DEFAULT_EYE_HEIGHT;

export class PositionCameraTool extends BaseTool {
  readonly id = 'tool.position_camera';
  readonly name = 'Position Camera';
  readonly icon = 'user';
  readonly shortcut = '';
  readonly category = 'navigate' as const;
  readonly cursor = 'crosshair';

  activate(): void {
    super.activate();
    this.setVCBValue(this.formatDist(eyeHeight));
    this.setStatus('Click where you want to stand — the camera drops to eye height there.');
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    const cam = this.viewport.camera as any;
    const eye: Vec3 = { x: point.x, y: point.y + eyeHeight, z: point.z };
    // Keep the current heading, look horizontally
    const heading = vec3.normalize({
      x: cam.target.x - cam.position.x,
      y: 0,
      z: cam.target.z - cam.position.z,
    });
    const dir = vec3.length(heading) > 1e-6 ? heading : { x: 0, y: 0, z: -1 };
    cam.position = eye;
    cam.target = vec3.add(eye, vec3.mul(dir, 10));
    cam.lookAt(cam.target);
    this.setStatus(`Standing at eye height ${this.formatDist(eyeHeight)}. Use Look Around / Walk to explore.`);
  }

  onVCBInput(value: string): void {
    const h = this.parseDistance(value);
    if (isNaN(h) || h <= 0) return;
    eyeHeight = h;
    this.setVCBValue(this.formatDist(eyeHeight));
    this.setStatus(`Eye height set to ${this.formatDist(eyeHeight)}.`);
  }

  getVCBLabel(): string { return 'Eye Height'; }
  getPreview(): ToolPreview | null { return null; }
}

export class LookAroundTool extends BaseTool {
  readonly id = 'tool.look_around';
  readonly name = 'Look Around';
  readonly icon = 'eye';
  readonly shortcut = '';
  readonly category = 'navigate' as const;
  readonly cursor = 'move';

  private lastX = 0;
  private lastY = 0;

  activate(): void {
    super.activate();
    this.setVCBValue(this.formatDist(eyeHeight));
    this.setStatus('Drag to look around (camera stays in place).');
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.lastX = event.screenX;
    this.lastY = event.screenY;
    this.setPhase('dragging');
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'dragging') return;
    const dx = event.screenX - this.lastX;
    const dy = event.screenY - this.lastY;
    this.lastX = event.screenX;
    this.lastY = event.screenY;

    const cam = this.viewport.camera as any;
    const eye = cam.position;
    let dir = vec3.sub(cam.target, eye);
    const dist = vec3.length(dir);
    if (dist < 1e-9) return;
    dir = vec3.mul(dir, 1 / dist);

    // Yaw around world-Y, pitch around the camera's right axis
    const yaw = -dx * 0.003;
    const pitch = -dy * 0.003;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    dir = vec3.normalize({
      x: dir.x * cosY + dir.z * sinY,
      y: dir.y,
      z: -dir.x * sinY + dir.z * cosY,
    });
    const right = vec3.normalize(vec3.cross(dir, { x: 0, y: 1, z: 0 }));
    if (vec3.length(right) > 1e-6) {
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      const rotated = vec3.add(vec3.mul(dir, cosP), vec3.mul(vec3.cross(right, dir), -sinP));
      // Clamp pitch to avoid flipping over the poles
      if (Math.abs(rotated.y) < 0.98) dir = vec3.normalize(rotated);
    }

    cam.target = vec3.add(eye, vec3.mul(dir, dist));
    cam.lookAt(cam.target);
  }

  onMouseUp(): void {
    this.setPhase('idle');
  }

  onVCBInput(value: string): void {
    const h = this.parseDistance(value);
    if (isNaN(h) || h <= 0) return;
    eyeHeight = h;
    const cam = this.viewport.camera as any;
    const dy = (0 + eyeHeight) - cam.position.y;
    cam.position = { ...cam.position, y: cam.position.y + dy };
    cam.target = { ...cam.target, y: cam.target.y + dy };
    cam.lookAt(cam.target);
    this.setVCBValue(this.formatDist(eyeHeight));
  }

  getVCBLabel(): string { return 'Eye Height'; }
  getPreview(): ToolPreview | null { return null; }
}

export class WalkTool extends BaseTool {
  readonly id = 'tool.walk';
  readonly name = 'Walk';
  readonly icon = 'footprints';
  readonly shortcut = '';
  readonly category = 'navigate' as const;
  readonly cursor = 'move';

  private anchorX = 0;
  private anchorY = 0;
  private rafId: number | null = null;
  private curX = 0;
  private curY = 0;

  activate(): void {
    super.activate();
    this.setVCBValue(this.formatDist(eyeHeight));
    this.setStatus('Drag up/down to walk forward/back, left/right to turn. Stays at eye height.');
  }

  deactivate(): void {
    this.stopWalking();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.anchorX = event.screenX;
    this.anchorY = event.screenY;
    this.curX = event.screenX;
    this.curY = event.screenY;
    this.setPhase('dragging');
    this.startWalking();
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'dragging') return;
    this.curX = event.screenX;
    this.curY = event.screenY;
  }

  onMouseUp(): void {
    this.setPhase('idle');
    this.stopWalking();
  }

  private startWalking(): void {
    const step = () => {
      if (this.phase !== 'dragging') { this.rafId = null; return; }
      const dx = this.curX - this.anchorX;
      const dy = this.curY - this.anchorY;

      const cam = this.viewport.camera as any;
      const eye = cam.position;
      let dir = vec3.sub(cam.target, eye);
      dir.y = 0;
      const flatLen = vec3.length(dir);
      if (flatLen > 1e-9) {
        dir = vec3.mul(dir, 1 / flatLen);

        // Turn from horizontal drag, advance from vertical drag
        const yaw = -dx * 0.00035;
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        dir = {
          x: dir.x * cosY + dir.z * sinY,
          y: 0,
          z: -dir.x * sinY + dir.z * cosY,
        };
        const speed = -dy * 0.0012; // up = forward
        const eyeNew = vec3.add(eye, vec3.mul(dir, speed));
        eyeNew.y = eye.y; // constant eye height
        cam.position = eyeNew;
        cam.target = vec3.add(eyeNew, vec3.mul(dir, Math.max(flatLen, 5)));
        cam.lookAt(cam.target);
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private stopWalking(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  onVCBInput(value: string): void {
    const h = this.parseDistance(value);
    if (isNaN(h) || h <= 0) return;
    eyeHeight = h;
    this.setVCBValue(this.formatDist(eyeHeight));
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.setPhase('idle');
      this.stopWalking();
    }
  }

  getVCBLabel(): string { return 'Eye Height'; }
  getPreview(): ToolPreview | null { return null; }
}
