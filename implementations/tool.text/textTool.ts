// @archigraph tool.text
// Text tool: click to place vector text as real geometry (edges + faces).
// Uses Three.js Font to generate shape outlines, then creates edges/faces
// in the geometry engine so the text can be selected, moved, push/pulled.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';

// Load all available Three.js fonts
import helvetikerRegular from 'three/examples/fonts/helvetiker_regular.typeface.json';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import gentilisRegular from 'three/examples/fonts/gentilis_regular.typeface.json';
import gentilisBold from 'three/examples/fonts/gentilis_bold.typeface.json';
import optimerRegular from 'three/examples/fonts/optimer_regular.typeface.json';
import optimerBold from 'three/examples/fonts/optimer_bold.typeface.json';

export interface TextPlacementRequest {
  screenX: number;
  screenY: number;
  worldPoint: Vec3;
}

export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
}

const FONTS: Record<string, Font> = {
  'Helvetica': new Font(helvetikerRegular as any),
  'Helvetica Bold': new Font(helvetikerBold as any),
  'Arial': new Font(helvetikerRegular as any), // Map Arial → Helvetiker
  'Gentilis': new Font(gentilisRegular as any),
  'Gentilis Bold': new Font(gentilisBold as any),
  'Times New Roman': new Font(gentilisRegular as any), // Map Times → Gentilis (serif)
  'Georgia': new Font(gentilisBold as any),
  'Optimer': new Font(optimerRegular as any),
  'Optimer Bold': new Font(optimerBold as any),
  'Verdana': new Font(optimerRegular as any),
  'Impact': new Font(helvetikerBold as any),
  'Courier New': new Font(optimerRegular as any),
};

function getFont(name: string): Font {
  return FONTS[name] || FONTS['Helvetica'];
}

export class TextTool extends BaseTool {
  readonly id = 'tool.text';
  readonly name = 'Text';
  readonly icon = 'type';
  readonly shortcut = 'Shift+T';
  readonly category = 'construct' as const;
  readonly cursor = 'text';

  onRequestTextInput: ((request: TextPlacementRequest) => void) | null = null;
  private pendingPoint: Vec3 | null = null;

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus('Click to place text.');
  }

  deactivate(): void {
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    this.pendingPoint = point;

    if (this.onRequestTextInput) {
      this.onRequestTextInput({
        screenX: event.screenX,
        screenY: event.screenY,
        worldPoint: point,
      });
      this.setPhase('active');
    } else {
      this.setPhase('active');
      this.setStatus('Type text in VCB and press Enter.');
    }
  }

  onMouseMove(): void {}

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.reset();
      this.setStatus('Click to place text.');
    }
  }

  onVCBInput(value: string): void {
    if (!this.pendingPoint || !value.trim()) return;
    this.placeText({
      text: value.trim(),
      fontFamily: 'Helvetica',
      fontSize: 48,
      color: '#333333',
    });
  }

  placeText(style: TextStyle): void {
    if (!this.pendingPoint) return;
    this.createTextGeometry(style, this.pendingPoint);
    this.setStatus(`Text "${style.text}" placed.`);
    this.reset();
  }

  cancelPlacement(): void {
    this.reset();
    this.setStatus('Click to place text.');
  }

  getVCBLabel(): string {
    return this.phase === 'active' ? 'Text' : '';
  }

  getPreview(): ToolPreview | null {
    return null;
  }

  private reset(): void {
    this.pendingPoint = null;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private createTextGeometry(style: TextStyle, origin: Vec3): void {
    const { text, fontFamily, fontSize } = style;
    const font = getFont(fontFamily);
    const worldSize = fontSize / 100;

    // Low segment count for speed — 4 is enough for readable curves
    const shapes = font.generateShapes(text, worldSize);
    if (shapes.length === 0) return;

    this.beginTransaction('Text');

    try {
      for (const shape of shapes) {
        const outerPoints = shape.getPoints(4);
        const holes = (shape.holes || []).map(h => h.getPoints(4));
        this.createShapeWithHoles(outerPoints, holes, origin);
      }
      this.commitTransaction();
    } catch (e) {
      this.abortTransaction();
      console.error('Failed to create text geometry:', e);
    }
  }

  private filterPoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (points.length < 2) return points;
    const filtered: Array<{ x: number; y: number }> = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = filtered[filtered.length - 1];
      const dx = points[i].x - prev.x;
      const dy = points[i].y - prev.y;
      if (dx * dx + dy * dy > 1e-8) {
        filtered.push(points[i]);
      }
    }
    return filtered;
  }

  private createShapeWithHoles(
    outerPoints: Array<{ x: number; y: number }>,
    holes: Array<Array<{ x: number; y: number }>>,
    origin: Vec3,
  ): void {
    const outer = this.filterPoints(outerPoints);
    if (outer.length < 3) return;

    const geo = this.document.geometry;
    const allVertexIds: string[] = [];
    const holeStartIndices: number[] = [];

    // Helper to create vertices and edges for a contour
    const addContour = (points: Array<{ x: number; y: number }>) => {
      const startIdx = allVertexIds.length;
      for (const pt of points) {
        const worldPos: Vec3 = {
          x: origin.x + pt.x,
          y: origin.y,
          z: origin.z - pt.y,
        };
        const v = this.findOrCreateVertex(worldPos);
        allVertexIds.push(v.id);
      }
      // Create edges for this contour
      const count = points.length;
      for (let i = 0; i < count; i++) {
        const a = startIdx + i;
        const b = startIdx + (i + 1) % count;
        if (allVertexIds[a] !== allVertexIds[b]) {
          geo.createEdge(allVertexIds[a], allVertexIds[b]);
        }
      }
    };

    // Add outer contour
    addContour(outer);

    // Add hole contours
    for (const hole of holes) {
      const filtered = this.filterPoints(hole);
      if (filtered.length < 3) continue;
      holeStartIndices.push(allVertexIds.length);
      addContour(filtered);
    }

    // Create single face with hole metadata
    if (allVertexIds.length >= 3) {
      const face = geo.createFace(allVertexIds);
      if (holeStartIndices.length > 0) {
        face.holeStartIndices = holeStartIndices;
      }
    }
  }
}
