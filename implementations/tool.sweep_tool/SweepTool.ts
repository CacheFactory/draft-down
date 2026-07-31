// @archigraph tool.sweep_tool
// Sweep tool: select a face profile, then click a path edge to sweep along connected edges.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, IFace, IEdge, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { SweepOperation } from '../op.sweep/SweepOperation';

export class SweepTool extends BaseTool {
  readonly id = 'tool.sweep_tool';
  readonly name = 'Follow Me';
  readonly icon = 'git-merge';
  readonly shortcut = 'Shift+F';
  readonly category = 'modify' as const;
  readonly cursor = 'crosshair';

  private profileFaceId: string | null = null;
  private step: 0 | 1 = 0; // 0=select profile face, 1=select path edge
  private hoverPathSegments: Array<{ from: Vec3; to: Vec3 }> = [];

  activate(): void {
    super.activate();
    this.reset();

    // If a face is already selected, use it as the profile
    const ids = this.resolveSelectedEntityIds();
    if (ids.length === 1) {
      const face = this.document.geometry.getFace(ids[0]);
      if (face) {
        this.profileFaceId = face.id;
        this.step = 1;
        this.setStatus(`Profile: face with ${face.vertexIds.length} vertices. Click an edge to sweep along.`);
        return;
      }
    }

    this.setStatus('Click on a face to use as the sweep profile.');
  }

  deactivate(): void {
    if (this.step > 0 && this.profileFaceId) {
      // Don't abort — nothing was started yet
    }
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    if (!event.hitEntityId) return;

    if (this.step === 0) {
      // Select profile face
      const face = this.document.geometry.getFace(event.hitEntityId);
      if (face) {
        this.profileFaceId = face.id;
        this.step = 1;
        this.setStatus(`Profile selected (${face.vertexIds.length} vertices). Click an edge to sweep along.`);
      } else {
        this.setStatus('Click on a face, not an edge.');
      }
    } else if (this.step === 1) {
      // Select path edge — collect connected edges and sweep
      const edge = this.document.geometry.getEdge(event.hitEntityId);
      if (edge) {
        this.performSweep(edge.id);
      } else {
        // Maybe they clicked a face that has edges — try to find adjacent edges
        this.setStatus('Click on an edge to define the sweep path.');
      }
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Pre-selection highlight
    if (event.hitEntityId) {
      this.document.selection.setPreSelection(event.hitEntityId);
    } else {
      this.document.selection.setPreSelection(null);
    }

    // Once the profile is locked in, hovering an edge previews the full path
    // that will be swept — every connected edge highlighted. Gives the user a
    // clear "this is what's about to happen" before clicking.
    this.hoverPathSegments = [];
    if (this.step === 1 && this.profileFaceId && event.hitEntityId) {
      const hoveredEdge = this.document.geometry.getEdge(event.hitEntityId);
      if (hoveredEdge) {
        const pathEdgeIds = this.collectPathEdges(hoveredEdge.id);
        for (const eid of pathEdgeIds) {
          const e = this.document.geometry.getEdge(eid);
          if (!e) continue;
          const v1 = this.document.geometry.getVertex(e.startVertexId);
          const v2 = this.document.geometry.getVertex(e.endVertexId);
          if (v1 && v2) this.hoverPathSegments.push({ from: v1.position, to: v2.position });
        }
      }
    }
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.reset();
      this.setStatus('Cancelled. Click a face for sweep profile.');
    }
  }

  getVCBLabel(): string { return ''; }
  getPreview(): ToolPreview | null {
    if (this.hoverPathSegments.length === 0) return null;
    return { lines: this.hoverPathSegments.map(s => ({ from: s.from, to: s.to })) };
  }

  getEventNeeds(): ToolEventNeeds {
    return { snap: false, raycast: false, edgeRaycast: true, liveSyncOnMove: false, mutatesOnClick: true };
  }

  // ── Private ────────────────────────────────────────────

  private reset(): void {
    this.profileFaceId = null;
    this.step = 0;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  /**
   * Collect connected edges starting from the clicked edge,
   * then sweep the profile face along that path.
   */
  private performSweep(startEdgeId: string): void {
    if (!this.profileFaceId) return;

    // Walk connected edges to build the path
    const pathEdgeIds = this.collectPathEdges(startEdgeId);

    if (pathEdgeIds.length === 0) {
      this.setStatus('No valid path found from this edge.');
      return;
    }

    this.beginTransaction('Sweep');

    try {
      const sweep = new SweepOperation();
      const result = sweep.execute(this.document.geometry, {
        profileFaceId: this.profileFaceId,
        pathEdgeIds,
        alignToPath: true,
      });

      if (result.success) {
        this.commitTransaction();
        this.setStatus(`Sweep complete: ${result.newFaceIds.length} faces created.`);
      } else {
        this.abortTransaction();
        this.setStatus(`Sweep failed: ${result.error}`);
      }
    } catch (e) {
      this.abortTransaction();
      this.setStatus(`Sweep error: ${(e as Error).message}`);
    }

    this.reset();
  }

  /**
   * Walk connected edges starting from startEdgeId to build an ordered path.
   * The path follows edges that share vertices, preferring edges that are
   * adjacent to the profile face (forming a loop around it).
   */
  private collectPathEdges(startEdgeId: string): string[] {
    const mesh = this.document.geometry.getMesh();
    const profileFace = mesh.faces.get(this.profileFaceId!);
    if (!profileFace) return [];

    // Get the set of vertices on the profile face boundary
    const profileVertexSet = new Set(profileFace.vertexIds);

    // Find all edges that share a vertex with the profile but are NOT part of the profile
    const profileEdgeIds = new Set<string>();
    for (let i = 0; i < profileFace.vertexIds.length; i++) {
      const next = (i + 1) % profileFace.vertexIds.length;
      const edge = this.document.geometry.findEdgeBetween(
        profileFace.vertexIds[i], profileFace.vertexIds[next]
      );
      if (edge) profileEdgeIds.add(edge.id);
    }

    // Start from the clicked edge and walk along connected edges
    const visited = new Set<string>();
    const path: string[] = [];

    let currentEdgeId = startEdgeId;
    const startEdge = mesh.edges.get(startEdgeId);
    if (!startEdge) return [];

    // Determine which end of the start edge to walk from
    // Prefer the end that connects to the profile
    let currentVertexId = profileVertexSet.has(startEdge.startVertexId)
      ? startEdge.endVertexId
      : profileVertexSet.has(startEdge.endVertexId)
        ? startEdge.startVertexId
        : startEdge.endVertexId;

    // Walk forward
    visited.add(startEdgeId);
    path.push(startEdgeId);

    const MAX_PATH = 50;
    for (let i = 0; i < MAX_PATH; i++) {
      // Find the next edge connected to currentVertexId
      const connectedEdges = this.document.geometry.getVertexEdges(currentVertexId);
      let nextEdge: IEdge | null = null;

      for (const edge of connectedEdges) {
        if (visited.has(edge.id)) continue;
        if (profileEdgeIds.has(edge.id)) continue; // Don't walk along profile edges

        nextEdge = edge;
        break;
      }

      if (!nextEdge) break; // Dead end

      visited.add(nextEdge.id);
      path.push(nextEdge.id);

      // Move to the other end of the edge
      currentVertexId = nextEdge.startVertexId === currentVertexId
        ? nextEdge.endVertexId
        : nextEdge.startVertexId;
    }

    return path;
  }
}
