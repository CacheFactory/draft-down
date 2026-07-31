// @archigraph window.main
// classic-CAD-style scene tabs: capture camera + layer visibility + render mode
// as named scenes; clicking a tab animates the camera back to that scene.
import React, { useState, useCallback } from 'react';
import { useApp } from './AppContext';
import type { IScenePage } from '../../src/core/interfaces';

export function SceneTabs() {
  const { app } = useApp();
  const [pages, setPages] = useState<IScenePage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ pageId: string; x: number; y: number } | null>(null);

  const refresh = useCallback(() => {
    const a = app as any;
    setPages([...(a?.document?.scene?.scenePages ?? [])]);
  }, [app]);

  const captureState = useCallback((): Omit<IScenePage, 'id' | 'name'> => {
    const a = app as any;
    const cam = a.viewport.camera;
    const layers = a.document.scene.layers as Map<string, { visible: boolean }>;
    const layerVisibility: Record<string, boolean> = {};
    layers.forEach((layer, id) => { layerVisibility[id] = layer.visible; });
    return {
      cameraPosition: { ...cam.position },
      cameraTarget: { ...cam.target },
      cameraFov: cam.fov ?? 50,
      projection: cam.projection ?? 'perspective',
      renderMode: a.viewport.renderer.getRenderMode?.() ?? 'shaded',
      layerVisibility,
      sectionPlane: a.viewport.renderer.getSectionPlane?.() ?? null,
    };
  }, [app]);

  const addScene = useCallback(() => {
    const a = app as any;
    if (!a) return;
    const page = a.document.scene.addScenePage({
      name: `Scene ${(a.document.scene.scenePages?.length ?? 0) + 1}`,
      ...captureState(),
    });
    setActiveId(page.id);
    refresh();
  }, [app, captureState, refresh]);

  const activateScene = useCallback((page: IScenePage) => {
    const a = app as any;
    if (!a) return;
    setActiveId(page.id);
    // Animated camera transition (classic CAD scene animation)
    a.viewport.camera.animateTo?.(page.cameraPosition, page.cameraTarget);
    if (page.projection) a.viewport.camera.setProjection?.(page.projection);
    // Restore layer visibility
    const layers = a.document.scene.layers as Map<string, { visible: boolean }>;
    let layersChanged = false;
    layers.forEach((layer, id) => {
      const want = page.layerVisibility[id];
      if (want !== undefined && layer.visible !== want) {
        a.document.scene.setLayerVisibility(id, want);
        layersChanged = true;
      }
    });
    if (page.renderMode) a.viewport.renderer.setRenderMode?.(page.renderMode);
    if (page.sectionPlane !== undefined) {
      a.viewport.renderer.setSectionPlane?.(page.sectionPlane);
    }
    if (layersChanged) a.sceneBridge?.sync(true);
  }, [app]);

  const updateScene = useCallback((pageId: string) => {
    const a = app as any;
    const page = a?.document?.scene?.scenePages?.find((p: IScenePage) => p.id === pageId);
    if (!page) return;
    Object.assign(page, captureState());
    setMenu(null);
    refresh();
  }, [app, captureState, refresh]);

  const renameScene = useCallback((pageId: string) => {
    const a = app as any;
    const page = a?.document?.scene?.scenePages?.find((p: IScenePage) => p.id === pageId);
    if (!page) return;
    const name = window.prompt('Scene name:', page.name);
    if (name) { page.name = name; refresh(); }
    setMenu(null);
  }, [app, refresh]);

  const deleteScene = useCallback((pageId: string) => {
    (app as any)?.document?.scene?.removeScenePage(pageId);
    if (activeId === pageId) setActiveId(null);
    setMenu(null);
    refresh();
  }, [app, activeId, refresh]);

  return (
    <div className="scene-tabs">
      {pages.map(page => (
        <button
          key={page.id}
          className={`scene-tab ${activeId === page.id ? 'active' : ''}`}
          onClick={() => activateScene(page)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
          }}
          title={`Scene: ${page.name} (right-click for options)`}
        >{page.name}</button>
      ))}
      <button className="scene-tab add" onClick={addScene} title="Add Scene — captures camera, layers, render mode">+</button>

      {menu && (
        <div className="scene-tab-menu" style={{ left: menu.x, top: menu.y }}
             onMouseLeave={() => setMenu(null)}>
          <div onClick={() => updateScene(menu.pageId)}>Update Scene</div>
          <div onClick={() => renameScene(menu.pageId)}>Rename</div>
          <div onClick={() => deleteScene(menu.pageId)}>Delete</div>
        </div>
      )}

      <style>{`
        .scene-tabs {
          display: flex; align-items: center; gap: 2px;
          padding: 2px 6px; background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          min-height: 24px;
        }
        .scene-tab {
          padding: 2px 12px; font-size: 11px; border: 1px solid var(--border-color);
          border-radius: 3px 3px 0 0; background: var(--bg-primary);
          color: var(--text-primary); cursor: pointer;
        }
        .scene-tab.active { background: var(--accent-color, #4a90d9); color: #fff; }
        .scene-tab.add { font-weight: bold; padding: 2px 8px; }
        .scene-tab:hover { filter: brightness(1.1); }
        .scene-tab-menu {
          position: fixed; z-index: 1000; background: var(--bg-primary);
          border: 1px solid var(--border-color); border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3); font-size: 12px;
        }
        .scene-tab-menu div { padding: 6px 16px; cursor: pointer; }
        .scene-tab-menu div:hover { background: var(--bg-secondary); }
      `}</style>
    </div>
  );
}
