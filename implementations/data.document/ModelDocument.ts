// @archigraph svc.model_document
// Top-level document: owns all managers, metadata, serialization, dirty tracking

import { SimpleEventEmitter } from '../../src/core/events';
import { LengthUnit } from '../../src/core/types';
import {
  IModelDocument, DocumentMetadata,
  ISceneManager, ISelectionManager, IHistoryManager,
  IMaterialManager, IGeometryEngine,
} from '../../src/core/interfaces';
import { SceneManager } from '../data.scene/SceneManager';
import { SelectionManager } from '../data.selection/SelectionManager';
import { HistoryManager } from '../data.history/HistoryManager';
import { MaterialManager } from '../data.materials/MaterialManager';
import { GeometryEngine } from '../engine.geometry/GeometryEngine';

// ─── Event map ───────────────────────────────────────────────────

type DocumentEvents = {
  'dirty-changed': [boolean];
  'metadata-changed': [DocumentMetadata];
};

// ─── Serialization helpers ───────────────────────────────────────

const MAGIC = 0x534B4346; // 'SKCF' — DraftDown File
const VERSION = 1;

function encodeString(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function decodeString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ─── ModelDocument ───────────────────────────────────────────────

export class ModelDocument implements IModelDocument {
  metadata: DocumentMetadata;
  dirty = false;
  filePath: string | null = null;

  scene: ISceneManager;
  selection: ISelectionManager;
  history: IHistoryManager;
  materials: IMaterialManager;
  geometry: IGeometryEngine;

  private emitter = new SimpleEventEmitter<DocumentEvents>();

  constructor(geometryEngine: IGeometryEngine) {
    this.geometry = geometryEngine;

    this.metadata = {
      name: 'Untitled',
      description: '',
      author: '',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      units: 'mm' as LengthUnit,
    };

    this.scene = new SceneManager();
    this.selection = new SelectionManager(this.scene, this.geometry);
    this.history = new HistoryManager();
    this.materials = new MaterialManager(this.geometry);

    // Wire up delta-based undo/redo — records mutations on mesh maps + material assignments
    (this.history as HistoryManager).setTrackedSources(
      (this.geometry as GeometryEngine).getInternalMesh(),
      this.materials as MaterialManager,
    );

    this.wireEvents();
  }

  /**
   * Listen to sub-manager changes to auto-mark dirty.
   */
  private wireEvents(): void {
    // Scene changes mark dirty
    this.scene.on('changed', () => {
      this.markDirty();
    });

    // Material changes mark dirty
    this.materials.on('changed', () => {
      this.markDirty();
    });

    // History changes mark dirty
    this.history.on('changed', () => {
      this.markDirty();
    });
  }

  // ── Dirty tracking ──────────────────────────────────────────

  markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.metadata.modifiedAt = Date.now();
      this.emitter.emit('dirty-changed', true);
    }
  }

  markClean(): void {
    if (this.dirty) {
      this.dirty = false;
      this.emitter.emit('dirty-changed', false);
    }
  }

  // ── New document ─────────────────────────────────────────────

  newDocument(): void {
    // Reset metadata
    this.metadata = {
      name: 'Untitled',
      description: '',
      author: '',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      units: 'mm' as LengthUnit,
    };

    // Reset geometry to empty. Round-tripping the CURRENT geometry
    // (deserialize(serialize())) kept the old model alive — File > New
    // silently preserved everything.
    this.geometry.deserialize(new GeometryEngine().serialize());

    // Recreate scene and selection managers
    this.scene = new SceneManager();
    this.selection = new SelectionManager(this.scene, this.geometry);

    // Clear history and re-wire delta tracking to the new mesh
    this.history.clear();
    (this.history as HistoryManager).setTrackedSources(
      (this.geometry as GeometryEngine).getInternalMesh(),
      this.materials as MaterialManager,
    );

    // Reset materials (keep default)
    if (this.materials instanceof MaterialManager) {
      (this.materials as MaterialManager).reset();
    }

    this.filePath = null;
    this.dirty = false;

    this.wireEvents();
    this.emitter.emit('dirty-changed', false);
    this.emitter.emit('metadata-changed', { ...this.metadata });
  }

  // ── Serialization ────────────────────────────────────────────

  /** Extra app-level state (construction guides, active section) provided by
   *  the Application at save time and re-applied after open. */
  extraStateProvider: (() => unknown) | null = null;
  /** Extra state read from the last deserialize — Application applies it. */
  lastExtraState: unknown = null;

  serialize(): ArrayBuffer {
    const sm = this.scene as SceneManager;
    // Pack document state as JSON inside an ArrayBuffer with a header.
    const payload = {
      metadata: this.metadata,
      scene: {
        entities: sm.getAllEntities(),
        rootId: this.scene.root.id,
        layers: Array.from(this.scene.layers.entries()),
        activeLayerId: (sm as any).activeLayerId,
        componentDefinitions: Array.from(this.scene.componentDefinitions.entries()),
        scenePages: this.scene.scenePages,
        editingContext: this.scene.editingContext,
        // Entity-set components + instance families (classic CAD definitions)
        components: Array.from((sm as any).components.entries()).map((entry: any) => {
          const [id, c] = entry;
          return [id, { id: c.id, name: c.name, entityIds: [...c.entityIds], parentComponentId: c.parentComponentId, quat: c.quat, isGroup: c.isGroup }];
        }),
        componentFamilies: Array.from((sm as any).componentFamilies.entries()).map((entry: any) => {
          const [id, f] = entry;
          return [id, { id: f.id, name: f.name, instanceIds: [...f.instanceIds] }];
        }),
      },
      materials: (this.materials as MaterialManager).getAllMaterials(),
      faceAssignments: Array.from((this.materials as MaterialManager).faceAssignments.entries()),
      extra: this.extraStateProvider ? this.extraStateProvider() : null,
    };

    const jsonBytes = encodeString(JSON.stringify(payload));

    // Geometry engine serializes its own mesh data
    const geometryBuffer = this.geometry.serialize();
    const geoBytes = new Uint8Array(geometryBuffer);

    // Header: magic(4) + version(4) + jsonLen(4) + geoLen(4) = 16 bytes
    const headerSize = 16;
    const totalSize = headerSize + jsonBytes.byteLength + geoBytes.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setUint32(0, MAGIC, false);
    view.setUint32(4, VERSION, false);
    view.setUint32(8, jsonBytes.byteLength, false);
    view.setUint32(12, geoBytes.byteLength, false);

    bytes.set(jsonBytes, headerSize);
    bytes.set(geoBytes, headerSize + jsonBytes.byteLength);

    return buffer;
  }

  deserialize(data: ArrayBuffer): void {
    const view = new DataView(data);
    const bytes = new Uint8Array(data);

    const magic = view.getUint32(0, false);
    if (magic !== MAGIC) {
      throw new Error('Invalid file format — magic number mismatch.');
    }

    const version = view.getUint32(4, false);
    if (version > VERSION) {
      throw new Error(`Unsupported file version ${version}. Max supported: ${VERSION}.`);
    }

    const jsonLen = view.getUint32(8, false);
    const geoLen = view.getUint32(12, false);
    const headerSize = 16;

    const jsonBytes = bytes.slice(headerSize, headerSize + jsonLen);
    const payload = JSON.parse(decodeString(jsonBytes));

    // Restore metadata
    this.metadata = payload.metadata;

    // Restore geometry
    if (geoLen > 0) {
      const geoBytes = bytes.slice(headerSize + jsonLen, headerSize + jsonLen + geoLen);
      this.geometry.deserialize(geoBytes.buffer);
    }

    // Restore scene
    const sceneManager = new SceneManager();

    // Restore layers
    if (payload.scene.layers) {
      for (const [id, layer] of payload.scene.layers) {
        sceneManager.layers.set(id, layer);
      }
    }

    // Restore component definitions
    if (payload.scene.componentDefinitions) {
      for (const [id, def] of payload.scene.componentDefinitions) {
        sceneManager.componentDefinitions.set(id, def);
      }
    }

    // Restore entities
    if (payload.scene.entities) {
      for (const entity of payload.scene.entities) {
        if (entity.id === payload.scene.rootId) {
          // Overwrite root
          Object.assign(sceneManager.root, entity);
        } else {
          sceneManager.addEntity(entity, entity.parentId ?? undefined);
        }
      }
    }

    // Restore scene pages
    if (payload.scene.scenePages) {
      sceneManager.scenePages.length = 0;
      for (const page of payload.scene.scenePages) {
        sceneManager.scenePages.push(page);
      }
    }

    // Restore active layer
    if (payload.scene.activeLayerId) {
      (sceneManager as any).activeLayerId = payload.scene.activeLayerId;
    }

    // Restore entity-set components + instance families
    if (payload.scene.components) {
      for (const [id, c] of payload.scene.components) {
        (sceneManager as any).components.set(id, {
          id: c.id,
          name: c.name,
          entityIds: new Set(c.entityIds),
          parentComponentId: c.parentComponentId ?? null,
          quat: c.quat ?? { x: 0, y: 0, z: 0, w: 1 },
          isGroup: c.isGroup ?? false,
        });
      }
    }
    if (payload.scene.componentFamilies) {
      for (const [id, f] of payload.scene.componentFamilies) {
        (sceneManager as any).componentFamilies.set(id, {
          id: f.id,
          name: f.name,
          instanceIds: new Set(f.instanceIds),
        });
        for (const instId of f.instanceIds) {
          (sceneManager as any).componentFamilyOf?.set?.(instId, id);
        }
      }
    }

    this.scene = sceneManager;

    // Surface extra app-level state (guides/section) for the Application.
    this.lastExtraState = payload.extra ?? null;

    // Restore materials + face assignments
    const matManager = new MaterialManager(this.geometry);
    if (payload.materials) {
      for (const mat of payload.materials) {
        matManager.materials.set(mat.id, mat);
      }
    }
    if (payload.faceAssignments) {
      for (const [faceId, assignment] of payload.faceAssignments) {
        matManager.faceAssignments.set(faceId, assignment);
      }
    }
    this.materials = matManager;

    // Rebuild selection and history
    this.selection = new SelectionManager(this.scene, this.geometry);
    this.history = new HistoryManager();

    // Re-wire delta tracking to the new mesh and materials
    (this.history as HistoryManager).setTrackedSources(
      (this.geometry as GeometryEngine).getInternalMesh(),
      this.materials as MaterialManager,
    );

    this.filePath = null;
    this.dirty = false;

    this.wireEvents();
    this.emitter.emit('dirty-changed', false);
    this.emitter.emit('metadata-changed', { ...this.metadata });
  }

  // ── Events ───────────────────────────────────────────────────

  on(event: 'dirty-changed' | 'metadata-changed', handler: (...args: unknown[]) => void): void {
    this.emitter.on(event, handler as never);
  }

  off(event: 'dirty-changed' | 'metadata-changed', handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler as never);
  }
}
