// @archigraph tool.solid_tools
// Solid tools: boolean operations (union, subtract, intersect) on solid groups
// @archigraph calls|tool.solid_tools|native.manifold|runtime

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, IGeometryEngine, IFace, ToolEventNeeds } from '../../src/core/interfaces';
import { BaseTool } from '../tool.base/BaseTool';
import { ManifoldBridge, ManifoldMesh } from '../native.manifold/ManifoldBridge';
import { getSharedManifoldBridge } from '../op.boolean_union/BooleanUnion';

export type SolidOperation = 'union' | 'subtract' | 'intersect';

export class SolidToolsTool extends BaseTool {
  readonly id = 'tool.solid_tools';
  readonly name = 'Solid Tools';
  readonly icon = 'layers';
  readonly shortcut = 'Shift+O';
  readonly category = 'modify' as const;
  readonly cursor = 'crosshair';

  private operation: SolidOperation = 'union';
  private firstSolidId: string | null = null;
  private step: 0 | 1 = 0;

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus(`Solid ${this.operation}. Click first solid group.`);
  }

  deactivate(): void {
    if (this.step > 0) this.abortTransaction();
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (!event.hitEntityId) return;
    const entityId = event.hitEntityId;
    const entity = this.document.scene.getEntity(entityId);
    if (!entity || entity.type !== 'group') {
      this.setStatus('Click on a solid group.');
      return;
    }

    if (this.step === 0) {
      this.firstSolidId = entityId;
      this.beginTransaction(`Solid ${this.operation}`);
      this.step = 1;
      this.setPhase('drawing');
      this.setStatus(`Click second solid group to ${this.operation}.`);
    } else if (this.step === 1) {
      this.performOperation(entityId);
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (event.hitEntityId) {
      this.document.selection.setPreSelection(event.hitEntityId);
    } else {
      this.document.selection.setPreSelection(null);
    }
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.step > 0) this.abortTransaction();
      this.reset();
      this.setStatus(`Solid ${this.operation}. Click first solid group.`);
    }

    // Tab to cycle operations
    if (event.key === 'Tab') {
      const ops: SolidOperation[] = ['union', 'subtract', 'intersect'];
      const idx = ops.indexOf(this.operation);
      this.operation = ops[(idx + 1) % ops.length];
      this.setStatus(`Solid ${this.operation}. Click first solid group.`);
    }
  }

  getVCBLabel(): string { return ''; }

  getEventNeeds(): ToolEventNeeds {
    return { snap: false, raycast: false, edgeRaycast: false, liveSyncOnMove: false, mutatesOnClick: true };
  }

  setOperation(op: SolidOperation): void {
    this.operation = op;
  }

  // ── Private ────────────────────────────────────────────

  private reset(): void {
    this.firstSolidId = null;
    this.step = 0;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  /**
   * Extract a ManifoldMesh from a group entity by collecting all face geometry
   * from the group's mesh in the geometry engine.
   */
  private extractGroupMesh(groupId: string): ManifoldMesh {
    const group = this.document.scene.getEntity(groupId) as
      { type: 'group'; meshId: string; children: string[] } | undefined;
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }

    const engine = this.document.geometry;
    const mesh = engine.getMesh();

    // Collect all faces that belong to this group's mesh.
    // Walk the group's children to find face/edge/vertex IDs,
    // or use all faces if the group references the main mesh.
    const vertices: Vec3[] = [];
    const faces: number[][] = [];
    const vertexIndexMap = new Map<string, number>();

    // Collect faces from the group's children (face entities)
    const facesToProcess: IFace[] = [];
    for (const childId of group.children) {
      const face = engine.getFace(childId);
      if (face) {
        facesToProcess.push(face);
      }
    }

    // If no direct face children found, try getting faces from the mesh
    if (facesToProcess.length === 0) {
      for (const [, face] of mesh.faces) {
        facesToProcess.push(face);
      }
    }

    for (const face of facesToProcess) {
      const faceVerts = engine.getFaceVertices(face.id);
      if (faceVerts.length < 3) continue;

      // Ensure all vertices are indexed
      for (const v of faceVerts) {
        if (!vertexIndexMap.has(v.id)) {
          vertexIndexMap.set(v.id, vertices.length);
          vertices.push({ x: v.position.x, y: v.position.y, z: v.position.z });
        }
      }

      // Fan-triangulate the face
      for (let i = 1; i < faceVerts.length - 1; i++) {
        faces.push([
          vertexIndexMap.get(faceVerts[0].id)!,
          vertexIndexMap.get(faceVerts[i].id)!,
          vertexIndexMap.get(faceVerts[i + 1].id)!,
        ]);
      }
    }

    return { vertices, faces };
  }

  /**
   * Perform the boolean operation between two solid groups using ManifoldBridge.
   */
  private async performOperation(secondSolidId: string): Promise<void> {
    if (!this.firstSolidId) {
      this.abortTransaction();
      this.reset();
      return;
    }

    if (this.firstSolidId === secondSolidId) {
      this.setStatus('Cannot perform boolean on the same group. Pick a different group.');
      return;
    }

    this.setStatus(`Computing ${this.operation}...`);

    try {
      // Initialize Manifold WASM
      const bridge = getSharedManifoldBridge();
      await bridge.initialize();

      // Extract mesh data from both groups
      const meshA = this.extractGroupMesh(this.firstSolidId);
      const meshB = this.extractGroupMesh(secondSolidId);

      if (meshA.faces.length === 0 || meshB.faces.length === 0) {
        this.setStatus('Both groups must contain geometry. Operation cancelled.');
        this.abortTransaction();
        this.reset();
        return;
      }

      // Perform the boolean operation via Manifold
      let resultMesh: ManifoldMesh;
      switch (this.operation) {
        case 'union':
          resultMesh = await bridge.union(meshA, meshB);
          break;
        case 'subtract':
          resultMesh = await bridge.subtract(meshA, meshB);
          break;
        case 'intersect':
          resultMesh = await bridge.intersect(meshA, meshB);
          break;
      }

      // Remove the original groups from the scene
      this.document.scene.removeEntity(this.firstSolidId);
      this.document.scene.removeEntity(secondSolidId);

      // Import the result mesh into the geometry engine
      const engine = this.document.geometry;
      const { vertexIds: importedIds } = engine.bulkImport(resultMesh.vertices, resultMesh.faces);

      // Create a new group for the result
      const newGroup = this.document.scene.createGroup(
        `${this.operation} result`,
        importedIds,
      );

      // Select the new group
      this.document.selection.clear();
      this.document.selection.select(newGroup.id);

      this.document.markDirty();
      this.commitTransaction();
      this.reset();
      this.setStatus(`Solid ${this.operation} complete. Click first solid group.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus(`Solid ${this.operation} failed: ${message}`);
      this.abortTransaction();
      this.reset();
    }
  }
}
