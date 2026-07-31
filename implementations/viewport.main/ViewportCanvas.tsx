// @archigraph viewport.main
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { setSnapSettings } from '../../src/core/snap-settings';
import { useApp } from '../window.main/AppContext';
import { Application } from '../process.renderer/Application';
import { TextInputDialog, TextInputResult } from '../window.main/TextInputDialog';
import { TextTool, TextPlacementRequest } from '../tool.text/textTool';
import type { ToolMouseEvent, ToolEventNeeds, SnapKind } from '../../src/core/interfaces';
import type { Vec3 } from '../../src/core/types';

interface TextDialogState {
  screenX: number;
  screenY: number;
  worldPoint: Vec3;
}

export function ViewportCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appInstanceRef = useRef<Application | null>(null);
  const { setApp, activateTool, updateState, syncPreviews } = useApp();
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number; mode: string } | null>(null);
  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [snapHint, setSnapHint] = useState<{ label: string; x: number; y: number } | null>(null);

  // Track last highlight state to avoid redundant highlight updates
  const lastHighlightRef = useRef<{ selKey: string; preSelKey: string }>({ selKey: '', preSelKey: '' });

  /** Push selection state from the app into React context. */
  const syncSelectionToUI = useCallback((skipIfUnchanged?: boolean) => {
    const app = appInstanceRef.current;
    if (!app) return;

    // Quick check: if selection + pre-selection haven't changed, skip expensive highlight updates
    if (skipIfUnchanged) {
      const sel = app.document.selection;
      const selKey = Array.from(sel.state.entityIds).join(',');
      const preSelKey = sel.getPreSelectionIds().join(',');
      if (selKey === lastHighlightRef.current.selKey && preSelKey === lastHighlightRef.current.preSelKey) {
        return; // Nothing changed — skip highlight teardown/rebuild
      }
      lastHighlightRef.current.selKey = selKey;
      lastHighlightRef.current.preSelKey = preSelKey;
    } else {
      // Force path — update cached keys
      const sel = app.document.selection;
      lastHighlightRef.current.selKey = Array.from(sel.state.entityIds).join(',');
      lastHighlightRef.current.preSelKey = sel.getPreSelectionIds().join(',');
    }

    const t0_sync = performance.now();
    const { entityIds, count } = app.syncSelection();
    const dt_sync = performance.now() - t0_sync;
    if (dt_sync > 2) console.warn(`[syncSelectionToUI] syncSelection took ${dt_sync.toFixed(1)}ms, sel=${entityIds.length}, skipCheck=${!!skipIfUnchanged}`);

    updateState({
      selectedEntityIds: entityIds,
      selectedCount: count,
    });
  }, [updateState]);

  /** Push tool + selection state into React after any interaction. */
  const syncAfterAction = useCallback(() => {
    const app = appInstanceRef.current;
    if (!app) return;

    // Geometry just changed — a cached hover snap may now point at a deleted
    // vertex/edge. Drop it so the next click can't reuse stale snap data.
    lastHoverSnapRef.current = null;

    const tool = app.toolManager.getActiveTool();
    const dirtyVerts = (tool as any)?._dirtyVertexIds;
    if (dirtyVerts) {
      app.syncScene(dirtyVerts);
      (tool as any)._dirtyVertexIds = null;
    } else {
      app.syncScene();
    }
    syncSelectionToUI();
    syncPreviews();

    if (tool) {
      updateState({
        vcbLabel: tool.getVCBLabel(),
        vcbValue: tool.getVCBValue(),
        statusText: tool.getStatusText(),
      });
    }
  }, [syncSelectionToUI, syncPreviews, updateState]);

  // Tools/plugins can request a preview refresh (e.g., when the right-rail
  // Parameters panel changes a value). Listen at the window level.
  useEffect(() => {
    const handler = () => syncPreviews();
    window.addEventListener('draftdown:tool-preview-changed', handler);
    return () => window.removeEventListener('draftdown:tool-preview-changed', handler);
  }, [syncPreviews]);

  // Initialize the Application when the container mounts
  useEffect(() => {
    const container = containerRef.current;
    if (!container || appInstanceRef.current) return;

    const app = new Application();
    appInstanceRef.current = app;

    app.initialize(container).then(() => {
      setApp(app);
      activateTool('tool.select');
      (window as any).__debugApp = app;

      // Apply persisted snapping + grid prefs now the renderer exists
      // (works in both builds — web serves prefs from localStorage)
      (window as any).api?.invoke('prefs:get')?.then((p: any) => {
        setSnapSettings({
          objectSnapEnabled: p.snapEnabled !== false,
          gridSnapEnabled: !!p.gridSnapEnabled,
          gridSnapSpacing: p.gridSnapSpacing,
        });
        (app.viewport as any).setGridSpacing?.(p.gridSpacing);
        updateState({ gridSnapEnabled: !!p.gridSnapEnabled } as any);
      })?.catch?.(() => {});

      // Wire up text tool dialog callback
      const textTool = app.toolManager.getTool('tool.text') as TextTool | undefined;
      if (textTool) {
        textTool.onRequestTextInput = (req: TextPlacementRequest) => {
          setTextDialog({ screenX: req.screenX, screenY: req.screenY, worldPoint: req.worldPoint });
        };
      }

      console.log('Application fully initialized');
    }).catch(err => {
      console.error('Failed to initialize application:', err);
    });

    // Listen for mouseUp on window to catch releases outside the container
    const onWindowMouseUp = (e: MouseEvent) => {
      // Always clear middle mouse state
      if (e.button === 1) {
        middleMouseRef.current.active = false;
      }
    };
    window.addEventListener('mouseup', onWindowMouseUp);

    // Attach native wheel listener (non-passive) so we can preventDefault
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const a = appInstanceRef.current;
      if (!a?.viewport?.camera) return;

      const delta = -e.deltaY * 0.003;

      // Find the world point under the cursor to zoom toward it
      const canvas = container.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPoint = a.viewport.screenToWorld(screenX, screenY);

        const cam = a.viewport.camera as any;
        if (cam.zoomToward) {
          cam.zoomToward(delta, worldPoint);
        } else {
          cam.zoom(delta);
        }
      } else {
        a.viewport.camera.zoom(delta);
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      container.removeEventListener('wheel', onWheel);
      appInstanceRef.current?.dispose();
      appInstanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Resolve raycast hit through scene manager (layer visibility, components). */
  const resolveHit = useCallback((
    hits: Array<{ entityId: string; point: Vec3; distance: number }>,
    sm: any,
  ): { hitEntityId: string | null; hitPoint: Vec3 | null } => {
    for (const h of hits) {
      if (sm?.isEntityVisible && !sm.isEntityVisible(h.entityId)) continue;
      if (sm?.isEntityLocked && sm.isEntityLocked(h.entityId)) continue;
      if (sm?.getEntityComponent && sm?.isEntityProtected) {
        if (sm.isEntityProtected(h.entityId)) {
          const compId = sm.getEntityComponent(h.entityId);
          if (compId) return { hitEntityId: compId, hitPoint: h.point };
        }
      }
      return { hitEntityId: h.entityId, hitPoint: h.point };
    }
    return { hitEntityId: null, hitPoint: null };
  }, []);

  // Cache the most recent hover-time snap result. When the user clicks, the
  // snap radius can drop the click out of the snap zone — but visually the
  // preview was showing the snap. Reusing the hover-snap when the click is
  // within a small radius of the last hover makes "click while preview shows
  // snap" reliable across all tools.
  const lastHoverSnapRef = useRef<{ screenX: number; screenY: number; worldPoint: Vec3; snapKind: SnapKind | null } | null>(null);

  /** Unified tool event builder. GPU pick runs unless skipPicking is set;
   *  raycast, edge raycast, and snap are additive based on tool-declared needs. */
  const buildToolEvent = useCallback((e: React.MouseEvent, needs: ToolEventNeeds, skipPicking = false): ToolMouseEvent | null => {
    const t0_build = performance.now();
    const app = appInstanceRef.current;
    if (!app?.viewport) return null;
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    let worldPoint = app.viewport.screenToWorld(screenX, screenY);

    const renderer = app.viewport.renderer as any;
    const hasPicking = renderer.hasEntityObjects ? renderer.hasEntityObjects() : false;

    // GPU pick: skip during mousemove when tool doesn't need hit detection
    // (avoids expensive pick buffer re-render during camera orbit/pan)
    let hitEntityId: string | null = null;
    let hitFaceId: string | null = null; // underlying face id, never a component
    let hitPoint: Vec3 | null = worldPoint;
    if (!skipPicking && renderer.gpuPick) {
      const t0_pick = performance.now();
      hitEntityId = renderer.gpuPick(screenX, screenY);
      const dt_pick = performance.now() - t0_pick;
      if (dt_pick > 5) console.warn(`[buildToolEvent] gpuPick took ${dt_pick.toFixed(1)}ms`);
      // Capture the face id BEFORE component resolution overwrites hitEntityId.
      if (hitEntityId && (app.document.geometry as any).getFace?.(hitEntityId)) {
        hitFaceId = hitEntityId;
      }
    }

    // Resolve GPU pick through scene manager (layer visibility, component protection)
    if (hitEntityId) {
      const sm = app.document.scene as any;
      if (sm?.isEntityVisible && !sm.isEntityVisible(hitEntityId)) {
        hitEntityId = null;
      } else if (sm?.isEntityLocked && sm.isEntityLocked(hitEntityId)) {
        hitEntityId = null;
      } else if (sm?.getEntityComponent && sm?.isEntityProtected) {
        if (sm.isEntityProtected(hitEntityId)) {
          const compId = sm.getEntityComponent(hitEntityId);
          if (compId) hitEntityId = compId;
        }
      }
    }

    // Full raycast (additive: refines hitPoint, may find edges/vertices GPU pick misses)
    if (needs.raycast && hasPicking) {
      const t0 = performance.now();
      const hits = app.viewport.raycastScene(screenX, screenY);
      const dt = performance.now() - t0;
      if (dt > 10) console.warn(`[buildToolEvent] raycast took ${dt.toFixed(1)}ms`);
      const sm = app.document.scene as any;
      const resolved = resolveHit(hits, sm);
      if (resolved.hitEntityId) {
        hitEntityId = resolved.hitEntityId;
        hitPoint = resolved.hitPoint;
      }
      // Independently of component resolution, find the topmost FACE hit for face-snap.
      for (const h of hits) {
        if ((app.document.geometry as any).getFace?.(h.entityId)) {
          hitFaceId = h.entityId;
          hitPoint = h.point; // exact ray-face intersection point
          break;
        }
      }
    }

    // Even when no full raycast ran (e.g., tools with snap+gpuPick only), if we
    // know the face under the cursor we MUST project the cursor ray onto that
    // face's plane to get the true hit point. Without this, hitPoint and the
    // worldPoint passed to findSnapPoint stay at the ground projection and the
    // shape ends up on the wrong plane / position.
    if (hitFaceId) {
      const face = (app.document.geometry as any).getFace?.(hitFaceId);
      if (face) {
        const ray = app.viewport.camera.screenToRay(
          screenX, screenY, app.viewport.getWidth(), app.viewport.getHeight(),
        );
        const n = face.plane.normal;
        const denom = ray.direction.x * n.x + ray.direction.y * n.y + ray.direction.z * n.z;
        if (Math.abs(denom) > 1e-10) {
          const t = (face.plane.distance -
            (ray.origin.x * n.x + ray.origin.y * n.y + ray.origin.z * n.z)) / denom;
          if (t > 0) {
            const onFace = {
              x: ray.origin.x + ray.direction.x * t,
              y: ray.origin.y + ray.direction.y * t,
              z: ray.origin.z + ray.direction.z * t,
            };
            hitPoint = onFace;
            // Also lift worldPoint onto the face — vertex/edge snap inside
            // findSnapPoint will still override it if a higher-priority snap
            // fires (vertex/midpoint/edge), but the default is now the face point.
            worldPoint = onFace;
          }
        }
      }
    }

    // Edge-only raycast fallback (for select/paint/eraser when GPU pick missed)
    if (needs.edgeRaycast && !hitEntityId && hasPicking) {
      const vp = app.viewport as any;
      if (vp.raycastEdgesOnly) {
        const edgeHits = vp.raycastEdgesOnly(screenX, screenY);
        const sm = app.document.scene as any;
        const resolved = resolveHit(edgeHits, sm);
        if (resolved.hitEntityId) {
          hitEntityId = resolved.hitEntityId;
          hitPoint = resolved.hitPoint;
        }
      }
    }

    // Snap detection — pass the face hit so SceneBridge can show a face-snap
    // indicator when the user is hovering a face but no point/edge snap fires.
    let snapKind: SnapKind | null = null;
    if (needs.snap && app.sceneBridge) {
      const facePointForSnap = hitFaceId ? hitPoint : null;
      const snapped = (app.sceneBridge as any).findSnapPoint(
        screenX, screenY, worldPoint,
        app.viewport.getWidth(), app.viewport.getHeight(),
        app.viewport.camera, 15,
        hitFaceId, facePointForSnap,
      );
      snapKind = (app.sceneBridge as any).getLastSnapKind?.() ?? null;
      const eventType = (e as any).type as string | undefined;
      if (snapped) {
        worldPoint = snapped;
        // Remember this snap so the next click within tolerance can reuse it.
        if (eventType === 'mousemove') {
          lastHoverSnapRef.current = { screenX, screenY, worldPoint: snapped, snapKind };
        }
      } else {
        // Hover with no snap clears the cache so a stale snap from earlier
        // can't hijack a later click in a different area.
        if (eventType === 'mousemove') {
          lastHoverSnapRef.current = null;
        } else if (eventType === 'mousedown' && lastHoverSnapRef.current) {
          // Click missed the snap by a few pixels — but the immediately previous
          // hover *did* snap. Reuse the hover snap when click is within 8px so
          // the commit matches the preview the user just saw.
          const cache = lastHoverSnapRef.current;
          const dx = screenX - cache.screenX;
          const dy = screenY - cache.screenY;
          if (dx * dx + dy * dy <= 64) {
            worldPoint = cache.worldPoint;
            snapKind = cache.snapKind;
          }
          // Consume the cache so it can't apply twice.
          lastHoverSnapRef.current = null;
        }
      }
    } else if (app.sceneBridge) {
      app.sceneBridge.hideSnapMarker();
    }

    const dt_build = performance.now() - t0_build;
    if (dt_build > 5) console.warn(`[buildToolEvent] total ${dt_build.toFixed(1)}ms, hit=${hitEntityId}, skipPick=${skipPicking}`);

    return {
      screenX, screenY, worldPoint,
      snapKind,
      inference: null,
      hitEntityId, hitFaceId, hitPoint,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey || e.metaKey,
      altKey: e.altKey,
    };
  }, [resolveHit]);

  // Middle mouse button orbit state
  const middleMouseRef = useRef<{ active: boolean; lastX: number; lastY: number; shift: boolean }>({
    active: false, lastX: 0, lastY: 0, shift: false,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) return; // right click = context menu

    // Middle mouse button: orbit (or pan with shift)
    if (e.button === 1) {
      e.preventDefault();
      middleMouseRef.current = {
        active: true,
        lastX: e.clientX,
        lastY: e.clientY,
        shift: e.shiftKey,
      };

      // Set orbit pivot to point under cursor (use screenToWorld, not full raycast)
      const app = appInstanceRef.current;
      if (app && !e.shiftKey) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const worldPoint = app.viewport.screenToWorld(screenX, screenY);
          if (worldPoint) {
            const cam = app.viewport.camera as any;
            if (cam.setOrbitPivot) cam.setOrbitPivot(worldPoint);
          }
        }
      }
      return;
    }

    const app = appInstanceRef.current;
    const tool = app?.toolManager.getActiveTool();
    if (!tool) return;

    const needs = tool.getEventNeeds((tool as any).phase ?? 'idle');
    const ev = buildToolEvent(e, needs);
    if (!ev) return;

    tool.onMouseDown(ev);

    if (needs.mutatesOnClick) {
      syncAfterAction();
    } else {
      syncSelectionToUI();
      syncPreviews();
      updateState({
        vcbLabel: tool.getVCBLabel(),
        vcbValue: tool.getVCBValue(),
        statusText: tool.getStatusText(),
      });
    }
  }, [buildToolEvent, syncAfterAction, syncSelectionToUI, syncPreviews, updateState]);

  // Throttle mouse move for tool events to avoid overwhelming raycasting/snapping
  const lastMoveTimeRef = useRef(0);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const app = appInstanceRef.current;

    // Safety: if we think middle mouse is down but no buttons are pressed, reset
    if (middleMouseRef.current.active && e.buttons === 0) {
      middleMouseRef.current.active = false;
    }

    // Middle mouse orbit/pan — always immediate, no throttle
    if (middleMouseRef.current.active && app) {
      const dx = e.clientX - middleMouseRef.current.lastX;
      const dy = e.clientY - middleMouseRef.current.lastY;
      middleMouseRef.current.lastX = e.clientX;
      middleMouseRef.current.lastY = e.clientY;

      const t0 = performance.now();
      if (middleMouseRef.current.shift) {
        app.viewport.camera.pan(dx, dy);
      } else {
        app.viewport.camera.orbit(dx, dy);
      }
      const dt = performance.now() - t0;
      if (dt > 5) console.warn(`[orbit/pan] took ${dt.toFixed(1)}ms`);
      return;
    }

    // Throttle tool mouse move to ~60fps (16ms) to avoid queueing expensive
    // raycasts/snap checks faster than they can complete on large models
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 16) return;
    lastMoveTimeRef.current = now;

    const tool = app?.toolManager.getActiveTool();
    if (!tool) return;

    const needs = tool.getEventNeeds((tool as any).phase ?? 'idle');
    // Skip GPU pick re-render during mousemove when tool doesn't need hit info
    const needsPicking = needs.raycast || needs.edgeRaycast || needs.snap || needs.mutatesOnClick;
    const ev = buildToolEvent(e, needs, !needsPicking);
    if (!ev) return;

    tool.onMouseMove(ev);

    // classic-CAD-style inference hint near the cursor — for every tool that snaps.
    // A tool's directional inference ("On Red Axis", "Parallel to Edge") takes
    // precedence over the point-snap kind; it is computed in onMouseMove above.
    const inferenceLabel = tool.getInferenceLabel?.() ?? null;
    if ((needs.snap || inferenceLabel) && app?.sceneBridge) {
      const kind = (app.sceneBridge as any).getLastSnapKind?.();
      const snapLabel = kind === 'origin' ? 'Origin'
                  : kind === 'vertex' ? 'Endpoint'
                  : kind === 'midpoint' ? 'Midpoint'
                  : kind === 'intersection' ? 'Intersection'
                  : kind === 'center' ? 'Center'
                  : kind === 'edge' ? 'On Edge'
                  : kind === 'face' ? 'On Face'
                  : null;
      const label = inferenceLabel ?? snapLabel;
      if (label) {
        const rect = containerRef.current?.getBoundingClientRect();
        const cx = e.clientX - (rect?.left ?? 0);
        const cy = e.clientY - (rect?.top ?? 0);
        setSnapHint({ label, x: cx, y: cy });
      } else {
        setSnapHint(null);
      }
    } else {
      setSnapHint(null);
    }

    if (needs.liveSyncOnMove && app) {
      const dirtyVerts = (tool as any)._dirtyVertexIds;
      if (dirtyVerts) {
        app.syncScene(dirtyVerts);
        (tool as any)._dirtyVertexIds = null;
      } else {
        app.syncScene();
      }
    }

    syncPreviews();

    // Update drag box overlay for any tool that exposes one (select, zoom window)
    if ((tool as any).getDragBox) {
      const box = (tool as any).getDragBox();
      if (box) {
        setDragBox({ x: box.x, y: box.y, w: box.width, h: box.height, mode: box.mode });
      } else {
        setDragBox(null);
      }
    }

    syncSelectionToUI(true); // skip if pre-selection unchanged (hot path)

    updateState({
      vcbValue: tool.getVCBValue(),
      statusText: tool.getStatusText(),
    });
  }, [buildToolEvent, syncSelectionToUI, syncPreviews, updateState]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Middle mouse release
    if (e.button === 1) {
      middleMouseRef.current.active = false;
      return;
    }

    const app = appInstanceRef.current;
    const tool = app?.toolManager.getActiveTool();
    if (!tool) return;

    const needs = tool.getEventNeeds((tool as any).phase ?? 'idle');
    const ev = buildToolEvent(e, needs);
    if (!ev) return;

    tool.onMouseUp(ev);
    setDragBox(null);

    if (needs.mutatesOnClick) {
      syncAfterAction();
    } else {
      syncSelectionToUI();
      syncPreviews();
    }
  }, [buildToolEvent, syncAfterAction, syncSelectionToUI, syncPreviews]);

  // Wheel zoom is handled via native event listener (see useEffect above)
  // to allow preventDefault on non-passive listener.

  // Key events are handled globally in App.tsx to avoid double-firing issues.
  // No onKeyDown handler on the container.

  return (
    <div
      ref={containerRef}
      className="viewport-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      tabIndex={0}
    >
      {dragBox && (
        <div
          className={`drag-select-box ${dragBox.mode === 'crossing' ? 'crossing' : 'window'}`}
          style={{
            left: dragBox.x,
            top: dragBox.y,
            width: dragBox.w,
            height: dragBox.h,
          }}
        />
      )}
      {snapHint && (
        <div
          style={{
            position: 'absolute',
            left: snapHint.x + 14,
            top: snapHint.y + 14,
            pointerEvents: 'none',
            background: 'rgba(20, 20, 20, 0.85)',
            color: '#fff',
            font: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            padding: '2px 6px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            zIndex: 50,
          }}
        >
          {snapHint.label}
        </div>
      )}
      {textDialog && (
        <TextInputDialog
          x={textDialog.screenX}
          y={textDialog.screenY}
          onSubmit={(result: TextInputResult) => {
            const app = appInstanceRef.current;
            const textTool = app?.toolManager.getActiveTool() as TextTool | undefined;
            if (textTool?.placeText) {
              textTool.placeText(result);
            }
            setTextDialog(null);
          }}
          onCancel={() => {
            const app = appInstanceRef.current;
            const textTool = app?.toolManager.getActiveTool() as TextTool | undefined;
            if (textTool?.cancelPlacement) {
              textTool.cancelPlacement();
            }
            setTextDialog(null);
          }}
        />
      )}
      <style>{`
        .drag-select-box {
          position: absolute;
          pointer-events: none;
          z-index: 100;
          border: 1.5px solid #0078d4;
        }
        .drag-select-box.window {
          background: rgba(0, 120, 212, 0.1);
          border-style: solid;
        }
        .drag-select-box.crossing {
          background: rgba(0, 200, 100, 0.1);
          border-style: dashed;
          border-color: #00c864;
        }
        .viewport-container {
          width: 100%;
          height: 100%;
          position: relative;
          overflow: hidden;
          outline: none;
          cursor: crosshair;
        }
        .viewport-container canvas {
          display: block;
        }
      `}</style>
    </div>
  );
}
