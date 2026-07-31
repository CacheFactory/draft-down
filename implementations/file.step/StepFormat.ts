// @archigraph file.step-format
// STEP (ISO 10303) format stub for DraftDown
// Delegates to OpenCascade WASM via native bridge for actual processing.

import { Vec3 } from '../../src/core/types';

// ─── Types ──────────────────────────────────────────────────────

export interface StepImportResult {
  vertices: Vec3[];
  faces: Array<{
    vertexIndices: number[];
    normal: Vec3;
  }>;
  edges: Array<{
    startIndex: number;
    endIndex: number;
  }>;
  metadata: {
    schema: string;
    description: string;
    author: string;
  };
}

// ─── Import ─────────────────────────────────────────────────────

/**
 * Import a STEP file by delegating to the OpenCascade WASM bridge.
 *
 * This is a stub that sends the data via IPC to the native module.
 * The actual STEP parsing is performed by OpenCascade compiled to WASM.
 *
 * @param data - Raw bytes of the .step or .stp file
 * @returns Parsed mesh data from the STEP B-Rep geometry
 */
export async function importStep(data: ArrayBuffer): Promise<StepImportResult> {
  // Attempt to load the OpenCascade bridge dynamically
  try {
    const { OpenCascadeBridge } = await import('../native.opencascade/OpenCascadeBridge');
    const bridge = new OpenCascadeBridge();
    await bridge.initialize();
    const result = await bridge.importStep(data);
    return result;
  } catch (e) {
    console.error('[StepFormat.import] OpenCascade bridge failed:', e);
    throw new Error(
      'STEP import requires the OpenCascade WASM module. ' +
      'Install @draftdown/opencascade-wasm and ensure the native bridge is configured.',
    );
  }
}

// ─── Export ─────────────────────────────────────────────────────

/**
 * STEP export is not currently supported.
 *
 * Full B-Rep export requires OpenCascade to convert mesh geometry
 * back into STEP solid representations, which is a complex operation
 * not yet implemented.
 */
export function exportStep(): never {
  throw new Error(
    'STEP export is not supported. ' +
    'DraftDown uses faceted mesh geometry internally. ' +
    'Converting mesh data to STEP B-Rep solids requires OpenCascade ' +
    'and is not yet implemented. Consider exporting to glTF or OBJ instead.',
  );
}
