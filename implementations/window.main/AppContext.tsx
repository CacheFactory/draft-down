// @archigraph process.renderer
import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { RenderMode, SelectionMode, LengthUnit } from '../../src/core/types';
import type { IApplication, ITool } from '../../src/core/interfaces';
import type { UserPreferences } from '../../src/core/ipc-types';
import { setCurrentUnit } from '../../src/core/units';
import { setSnapSettings } from '../../src/core/snap-settings';

interface AppState {
  activeTool: ITool | null;
  activeToolId: string | null;
  renderMode: RenderMode;
  selectionMode: SelectionMode;
  selectedCount: number;
  selectedEntityIds: string[];
  documentName: string;
  dirty: boolean;
  units: LengthUnit;
  gridVisible: boolean;
  gridSnapEnabled: boolean;
  axesVisible: boolean;
  theme: 'light' | 'dark';
  vcbLabel: string;
  vcbValue: string;
  statusText: string;
  canUndo: boolean;
  canRedo: boolean;
  undoName: string | null;
  redoName: string | null;
}

interface AppContextValue extends AppState {
  app: IApplication | null;
  setApp: (app: IApplication) => void;
  activateTool: (toolId: string) => void;
  setRenderMode: (mode: RenderMode) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  toggleGrid: () => void;
  toggleGridSnap: () => void;
  toggleAxes: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  handleVCBInput: (value: string) => void;
  undo: () => void;
  redo: () => void;
  updateState: (partial: Partial<AppState>) => void;
  syncToolState: () => void;
  syncPreviews: () => void;
}

const defaultState: AppState = {
  activeTool: null,
  activeToolId: null,
  renderMode: 'shaded',
  selectionMode: 'object',
  selectedCount: 0,
  selectedEntityIds: [],
  documentName: 'Untitled',
  dirty: false,
  units: 'm',
  gridVisible: true,
  gridSnapEnabled: false,
  axesVisible: true,
  theme: 'dark',
  vcbLabel: 'Length',
  vcbValue: '',
  statusText: 'Ready',
  canUndo: false,
  canRedo: false,
  undoName: null,
  redoName: null,
};

const AppContext = createContext<AppContextValue>({
  ...defaultState,
  app: null,
  setApp: () => {},
  activateTool: () => {},
  setRenderMode: () => {},
  setSelectionMode: () => {},
  toggleGrid: () => {},
  toggleGridSnap: () => {},
  toggleAxes: () => {},
  setTheme: () => {},
  handleVCBInput: () => {},
  undo: () => {},
  redo: () => {},
  updateState: () => {},
  syncToolState: () => {},
  syncPreviews: () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);
  const [appInstance, setAppInstance] = useState<IApplication | null>(null);
  const appRef = useRef<IApplication | null>(null);

  const setApp = useCallback((app: IApplication) => {
    appRef.current = app;
    setAppInstance(app); // Trigger re-render so consumers get the app
  }, []);

  // Load user preferences on mount (sync units)
  useEffect(() => {
    if ((window as any).api?.invoke) {
      (window as any).api.invoke('prefs:get').then((prefs: UserPreferences) => {
        if (prefs?.units) {
          setCurrentUnit(prefs.units);
          setState(prev => ({ ...prev, units: prefs.units }));
        }
      }).catch(() => {});
    }
  }, []);

  const updateState = useCallback((partial: Partial<AppState>) => {
    setState(prev => {
      // When units change, also update the global singleton
      if (partial.units) setCurrentUnit(partial.units);
      return { ...prev, ...partial };
    });
  }, []);

  const activateTool = useCallback((toolId: string) => {
    let tool = null;
    if (appRef.current) {
      appRef.current.activateTool(toolId);
      tool = appRef.current.getActiveTool();
    }
    setState(prev => ({
      ...prev,
      activeTool: tool,
      activeToolId: toolId,
      vcbLabel: tool?.getVCBLabel() ?? 'Length',
      vcbValue: tool?.getVCBValue() ?? '',
      statusText: tool?.getStatusText() ?? 'Ready',
    }));
  }, []);

  const setRenderMode = useCallback((mode: RenderMode) => {
    appRef.current?.viewport?.setRenderMode(mode);
    setState(prev => ({ ...prev, renderMode: mode }));
  }, []);

  const setSelectionMode = useCallback((mode: SelectionMode) => {
    appRef.current?.document?.selection?.setMode(mode);
    setState(prev => ({ ...prev, selectionMode: mode }));
  }, []);

  const toggleGrid = useCallback(() => {
    appRef.current?.viewport.toggleGrid();
    setState(prev => ({ ...prev, gridVisible: !prev.gridVisible }));
  }, []);

  const toggleGridSnap = useCallback(() => {
    setState(prev => {
      const next = !prev.gridSnapEnabled;
      setSnapSettings({ gridSnapEnabled: next });
      (window as any).api?.invoke('prefs:set', { gridSnapEnabled: next })?.catch?.(() => {});
      return { ...prev, gridSnapEnabled: next };
    });
  }, []);

  const toggleAxes = useCallback(() => {
    appRef.current?.viewport.toggleAxes();
    setState(prev => ({ ...prev, axesVisible: !prev.axesVisible }));
  }, []);

  const setTheme = useCallback((theme: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', theme);
    setState(prev => ({ ...prev, theme }));
  }, []);

  const handleVCBInput = useCallback((value: string) => {
    const tool = appRef.current?.toolManager?.getActiveTool();
    if (tool) {
      tool.onVCBInput(value);
      // Sync geometry after VCB input (e.g., typed distance creates edge)
      if (appRef.current && 'syncScene' in appRef.current) {
        (appRef.current as any).syncScene();
      }
      setState(prev => ({
        ...prev,
        vcbValue: tool.getVCBValue(),
        statusText: tool.getStatusText(),
      }));
    }
  }, []);

  const undo = useCallback(() => {
    const app = appRef.current;
    if (!app) return;

    // Pop dimension snapshot and remove dimensions added since that snapshot
    const { dimensionStore } = require('../tool.dimension/DimensionStore');
    const toRemove: string[] = dimensionStore.popSnapshot();
    for (const dimId of toRemove) {
      const dim = dimensionStore.remove(dimId);
      if (dim) {
        for (const lineId of dim.guideLineIds) {
          app.viewport.renderer.removeGuideLine(lineId);
        }
        const overlayScene = (app.viewport.renderer as any).getOverlayScene?.();
        if (overlayScene && dim.sprite.parent) {
          dim.sprite.parent.remove(dim.sprite);
          dim.sprite.material.dispose();
          if ((dim.sprite.material as any).map) (dim.sprite.material as any).map.dispose();
        }
        (app.viewport.renderer as any).unregisterEntityObject?.(dim.id);
      }
    }

    app.document.history.undo();
    if ('syncScene' in app) (app as any).syncScene(undefined, true);
    if ('syncSelection' in app) {
      const { entityIds, count } = (app as any).syncSelection();
      setState(prev => ({
        ...prev,
        selectedEntityIds: entityIds,
        selectedCount: count,
        canUndo: app.document.history.canUndo,
        canRedo: app.document.history.canRedo,
        undoName: app.document.history.undoName,
        redoName: app.document.history.redoName,
      }));
    }
  }, []);

  const redo = useCallback(() => {
    const app = appRef.current;
    if (app) {
      app.document.history.redo();
      if ('syncScene' in app) (app as any).syncScene(undefined, true);
      if ('syncSelection' in app) {
        const { entityIds, count } = (app as any).syncSelection();
        setState(prev => ({
          ...prev,
          selectedEntityIds: entityIds,
          selectedCount: count,
          canUndo: app.document.history.canUndo,
          canRedo: app.document.history.canRedo,
          undoName: app.document.history.undoName,
          redoName: app.document.history.redoName,
        }));
      } else {
        setState(prev => ({
          ...prev,
          canUndo: app.document.history.canUndo,
          canRedo: app.document.history.canRedo,
          undoName: app.document.history.undoName,
          redoName: app.document.history.redoName,
        }));
      }
    }
  }, []);

  /** Sync tool VCB/status + undo state into React. */
  const syncToolState = useCallback(() => {
    const app = appRef.current;
    if (!app) return;
    const tool = app.toolManager.getActiveTool();
    setState(prev => ({
      ...prev,
      vcbLabel: tool?.getVCBLabel() ?? 'Length',
      vcbValue: tool?.getVCBValue() ?? '',
      statusText: tool?.getStatusText() ?? 'Ready',
      canUndo: app.document.history.canUndo,
      canRedo: app.document.history.canRedo,
    }));
  }, []);

  /** Clear and re-render tool preview geometry (rubber bands, outlines). */
  const syncPreviews = useCallback(() => {
    const app = appRef.current;
    const sb = (app as any)?.sceneBridge;
    if (!sb) return;
    const tool = app!.toolManager.getActiveTool();
    sb.clearPreviewEdges();
    sb.clearRubberBand();
    if (tool) {
      const preview = tool.getPreview();
      if (preview) {
        if (preview.polygon && preview.polygon.length >= 2) sb.setPreviewRect(preview.polygon);
        if (preview.lines) for (const line of preview.lines) sb.setRubberBand(line.from, line.to, line.color);
      }
    }
  }, []);

  return (
    <AppContext.Provider value={{
      ...state,
      app: appInstance,
      setApp,
      activateTool,
      setRenderMode,
      setSelectionMode,
      toggleGrid,
      toggleGridSnap,
      toggleAxes,
      setTheme,
      handleVCBInput,
      undo,
      redo,
      updateState,
      syncToolState,
      syncPreviews,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
