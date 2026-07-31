// @archigraph panel.properties
import React, { useState } from 'react';
import { useApp } from './AppContext';
import { parseDistanceExpr } from '../../src/core/units';
import { toDisplay, unitLabel, getCurrentUnit } from '../../src/core/units';

interface EntitySummary {
  id: string;
  type: string;
  label: string;
  detail: string;
}

/** Area label for the current unit (e.g. m² / ft² / in²). cm/mm fall back to m². */
function areaUnitLabel(u: ReturnType<typeof getCurrentUnit>): string {
  if (u === 'inches') return 'in²';
  if (u === 'feet') return 'ft²';
  if (u === 'cm') return 'cm²';
  if (u === 'mm') return 'mm²';
  return 'm²';
}

/** Convert area from internal m² to display unit². */
function areaToDisplay(internalArea: number, u: ReturnType<typeof getCurrentUnit>): number {
  // 1 internal unit = 1 m. 1 m = (1 / metersPerUnit) display units.
  // Area scales by the square.
  const metersPerUnit = u === 'mm' ? 0.001 : u === 'cm' ? 0.01 : u === 'inches' ? 0.0254 : u === 'feet' ? 0.3048 : 1;
  return internalArea / (metersPerUnit * metersPerUnit);
}

export function EntityInfoPanel() {
  const { selectedCount, selectedEntityIds, app } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const u = getCurrentUnit();
  const lenLabel = unitLabel(u);
  const arLabel = areaUnitLabel(u);

  const fmtLen = (internal: number, decimals = 3): string =>
    `${toDisplay(internal, u).toFixed(decimals)}${lenLabel}`;
  const fmtArea = (internal: number, decimals = 3): string =>
    `${areaToDisplay(internal, u).toFixed(decimals)} ${arLabel}`;
  const fmtCoord = (internal: number): string =>
    toDisplay(internal, u).toFixed(2);

  // ── Editable dimensions ────────────────────────────────────────

  /** Resize the selected edge to an exact typed length (scaled about its
   *  midpoint). Curve edges (curveId) resize the whole circle/arc radially. */
  const applyEdgeLength = (entityId: string, text: string) => {
    if (!app) return;
    const geo = app.document.geometry;
    const edge = geo.getEdge(entityId);
    if (!edge) return;
    const target = parseDistanceExpr(text, u);
    if (isNaN(target) || target <= 0) return;

    const hist = app.document.history;
    const v1 = geo.getVertex(edge.startVertexId)!;
    const v2 = geo.getVertex(edge.endVertexId)!;

    if (edge.curveId) {
      // Radius edit: scale every vertex of the curve about its center.
      const curveEdges = geo.getCurveEdges(edge.curveId);
      const vertexIds = new Set<string>();
      for (const e of curveEdges) { vertexIds.add(e.startVertexId); vertexIds.add(e.endVertexId); }
      const pts = [...vertexIds].map(id => geo.getVertex(id)!.position);
      const center = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length, z: acc.z + p.z / pts.length }), { x: 0, y: 0, z: 0 });
      const currentR = Math.hypot(pts[0].x - center.x, pts[0].y - center.y, pts[0].z - center.z);
      if (currentR < 1e-9) return;
      const k = target / currentR;
      hist.beginTransaction('Edit Radius');
      for (const id of vertexIds) {
        const v = geo.getVertex(id)!;
        v.position.x = center.x + (v.position.x - center.x) * k;
        v.position.y = center.y + (v.position.y - center.y) * k;
        v.position.z = center.z + (v.position.z - center.z) * k;
      }
      hist.commitTransaction();
    } else {
      const len = Math.hypot(v2.position.x - v1.position.x, v2.position.y - v1.position.y, v2.position.z - v1.position.z);
      if (len < 1e-9) return;
      const k = target / len;
      const mid = {
        x: (v1.position.x + v2.position.x) / 2,
        y: (v1.position.y + v2.position.y) / 2,
        z: (v1.position.z + v2.position.z) / 2,
      };
      hist.beginTransaction('Edit Length');
      for (const v of [v1, v2]) {
        v.position.x = mid.x + (v.position.x - mid.x) * k;
        v.position.y = mid.y + (v.position.y - mid.y) * k;
        v.position.z = mid.z + (v.position.z - mid.z) * k;
      }
      hist.commitTransaction();
    }
    (app as any).syncScene?.() ?? (app as any).sceneBridge?.sync();
  };

  const getEntitySummary = (entityId: string): EntitySummary | null => {
    if (!app) return null;

    const face = app.document.geometry.getFace(entityId);
    if (face) {
      const area = app.document.geometry.computeFaceArea(entityId);
      const verts = face.vertexIds.length;
      return {
        id: entityId,
        type: 'Face',
        label: `Face (${verts} vertices)`,
        detail: `Area: ${fmtArea(area)}`,
      };
    }

    const edge = app.document.geometry.getEdge(entityId);
    if (edge) {
      const length = app.document.geometry.computeEdgeLength(entityId);
      return {
        id: entityId,
        type: 'Edge',
        label: 'Edge',
        detail: `Length: ${fmtLen(length)}`,
      };
    }

    return { id: entityId, type: 'Unknown', label: 'Entity', detail: entityId.substring(0, 8) };
  };

  const getDetailedInfo = (entityId: string): Record<string, string> | null => {
    if (!app) return null;

    const face = app.document.geometry.getFace(entityId);
    if (face) {
      const area = app.document.geometry.computeFaceArea(entityId);
      const verts = app.document.geometry.getFaceVertices(entityId);
      return {
        'Vertices': `${verts.length}`,
        'Area': fmtArea(area, 4),
        'Normal': `(${face.normal.x.toFixed(2)}, ${face.normal.y.toFixed(2)}, ${face.normal.z.toFixed(2)})`,
      };
    }

    const edge = app.document.geometry.getEdge(entityId);
    if (edge) {
      const length = app.document.geometry.computeEdgeLength(entityId);
      const v1 = app.document.geometry.getVertex(edge.startVertexId);
      const v2 = app.document.geometry.getVertex(edge.endVertexId);
      const info: Record<string, string> = { 'Length': fmtLen(length, 4) };
      if (v1) info['Start'] = `(${fmtCoord(v1.position.x)}, ${fmtCoord(v1.position.y)}, ${fmtCoord(v1.position.z)}) ${lenLabel}`;
      if (v2) info['End']   = `(${fmtCoord(v2.position.x)}, ${fmtCoord(v2.position.y)}, ${fmtCoord(v2.position.z)}) ${lenLabel}`;
      return info;
    }

    return null;
  };

  const summaries = selectedEntityIds.map(id => getEntitySummary(id)).filter(Boolean) as EntitySummary[];
  const singleInfo = selectedCount === 1 ? getDetailedInfo(selectedEntityIds[0]) : null;

  // Solid check for a selected component (async via main-process Manifold)
  const [solidInfo, setSolidInfo] = React.useState<{ id: string; isSolid: boolean; volume: number } | null>(null);
  // Component info
  const sm = app?.document?.scene as any;
  const selectedComponentId = selectedCount === 1 && sm?.components?.has(selectedEntityIds[0]) ? selectedEntityIds[0] : null;
  const selectedComponent = selectedComponentId ? sm.components.get(selectedComponentId) : null;

  React.useEffect(() => {
    if (!selectedComponentId || !app || typeof (window as any).api === 'undefined') {
      setSolidInfo(null);
      return;
    }
    const geo = app.document.geometry;
    const comp = sm.components.get(selectedComponentId);
    if (!comp) { setSolidInfo(null); return; }
    // Triangulated JSON mesh from the component's faces
    const vmap = new Map<string, number>();
    const vertices: Array<{ x: number; y: number; z: number }> = [];
    const faces: number[][] = [];
    const take = (vid: string) => {
      let i = vmap.get(vid);
      if (i === undefined) {
        i = vertices.length;
        vmap.set(vid, i);
        vertices.push({ ...geo.getVertex(vid)!.position });
      }
      return i;
    };
    for (const id of comp.entityIds) {
      const face = geo.getFace(id);
      if (!face) continue;
      for (let i = 1; i < face.vertexIds.length - 1; i++) {
        faces.push([take(face.vertexIds[0]), take(face.vertexIds[i]), take(face.vertexIds[i + 1])]);
      }
    }
    if (faces.length < 4) { setSolidInfo({ id: selectedComponentId, isSolid: false, volume: 0 }); return; }
    let cancelled = false;
    (window as any).api.invoke('native:solid-check', { mesh: { vertices, faces } })
      .then((r: any) => {
        if (!cancelled) setSolidInfo({ id: selectedComponentId, isSolid: !!r?.isSolid, volume: r?.volume ?? 0 });
      })
      .catch(() => { if (!cancelled) setSolidInfo(null); });
    return () => { cancelled = true; };
  }, [selectedComponentId, app, sm]);
  const isEditingComponent = sm?.isEditingComponent ?? false;
  const editingComponentId = sm?.editingComponentId ?? null;

  // Build breadcrumb trail: Scene > ComponentA > ComponentB > ...
  const componentBreadcrumb: Array<{ id: string | null; name: string }> = [{ id: null, name: 'Scene' }];
  if (sm?.editingComponentStack) {
    for (const compId of sm.editingComponentStack) {
      const comp = sm.components.get(compId);
      componentBreadcrumb.push({ id: compId, name: comp?.name ?? 'Component' });
    }
  }
  if (editingComponentId) {
    const comp = sm.components.get(editingComponentId);
    componentBreadcrumb.push({ id: editingComponentId, name: comp?.name ?? 'Component' });
  }
  // Also show selected component in the trail if it's selected but not being edited
  if (selectedComponent && !isEditingComponent) {
    componentBreadcrumb.push({ id: selectedComponentId, name: selectedComponent.name });
  } else if (selectedComponent && selectedComponentId !== editingComponentId) {
    componentBreadcrumb.push({ id: selectedComponentId, name: selectedComponent.name });
  }

  const handleMakeComponent = () => {
    if (!sm || selectedEntityIds.length === 0) return;
    const name = `Component ${(sm.components?.size ?? 0) + 1}`;
    sm.createComponent(name, selectedEntityIds);
    app?.document?.selection?.clear();
    (app as any)?.syncScene?.();
  };

  const handleEditComponent = () => {
    if (!sm || !selectedComponentId) return;
    sm.enterComponent(selectedComponentId);
    app?.document?.selection?.clear();
    (app as any)?.syncScene?.();
  };

  const handleExitComponent = () => {
    if (!sm) return;
    sm.exitComponent();
    app?.document?.selection?.clear();
    (app as any)?.syncScene?.();
  };

  const handleBreadcrumbClick = (crumb: { id: string | null; name: string }, index: number) => {
    if (!sm) return;
    // Clicking the last (active) breadcrumb does nothing
    if (index === componentBreadcrumb.length - 1) return;
    // Exit editing levels until we reach the target
    // If clicking "Scene" (id=null), exit all levels
    // If clicking a component, exit until editingComponentId matches
    while (sm.editingComponentId) {
      if (crumb.id && sm.editingComponentId === crumb.id) break;
      sm.exitComponent();
    }
    // Select the component that was clicked (if it's not Scene)
    app?.document?.selection?.clear();
    if (crumb.id) {
      app?.document?.selection?.select(crumb.id);
    }
    (app as any)?.syncScene?.();
    (app as any)?.syncSelection?.();
  };

  const handleExplodeComponent = () => {
    if (!sm || !selectedComponentId) return;
    sm.explodeComponent(selectedComponentId);
    app?.document?.selection?.clear();
    (app as any)?.syncScene?.();
  };

  return (
    <div className="panel entity-info-panel">
      <div className="panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="panel-collapse">{collapsed ? '▸' : '▾'}</span>
        <span className="panel-title">Entity Info</span>
        {selectedCount > 0 && <span className="panel-badge">{selectedCount}</span>}
      </div>

      {!collapsed && (
        <div className="panel-body">
          {/* Component hierarchy breadcrumb */}
          {componentBreadcrumb.length > 1 && (
            <div className="component-breadcrumb">
              {componentBreadcrumb.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="breadcrumb-sep">›</span>}
                  <span
                    className={`breadcrumb-item${i === componentBreadcrumb.length - 1 ? ' active' : ' clickable'}`}
                    onClick={() => handleBreadcrumbClick(crumb, i)}
                  >
                    {crumb.name}
                  </span>
                </React.Fragment>
              ))}
              {isEditingComponent && (
                <button className="component-exit-btn" onClick={handleExitComponent}>↑ Exit</button>
              )}
            </div>
          )}

          {selectedCount === 0 ? (
            <div className="panel-empty">{isEditingComponent ? 'Click geometry in this component' : 'No selection'}</div>
          ) : selectedComponent ? (
            <div className="entity-props">
              <div className="entity-type-badge">
                <span className="type-icon" style={{color: '#9c27b0'}}>🧩</span>
                <span className="type-label">{selectedComponent.name}</span>
              </div>
              <div className="prop-row">
                <span className="prop-label">Entities</span>
                <span className="prop-value">{selectedComponent.entityIds.size}</span>
              </div>
              <div className="component-actions">
                {solidInfo && solidInfo.id === selectedComponentId && (
                  <div className="prop-row">
                    <span className="prop-label">Solid</span>
                    <span className="prop-value">
                      {solidInfo.isSolid
                        ? `✓ watertight · ${solidInfo.volume.toFixed(3)} m³`
                        : '✗ not a solid'}
                    </span>
                  </div>
                )}
                <button className="component-btn edit" onClick={handleEditComponent}>Edit Component</button>
                <button className="component-btn explode" onClick={handleExplodeComponent}>Explode</button>
              </div>
            </div>
          ) : selectedCount === 1 && singleInfo ? (
            <div className="entity-props">
              <div className="entity-type-badge">
                <span className={`type-icon type-${summaries[0]?.type.toLowerCase()}`}>
                  {summaries[0]?.type === 'Face' ? '▢' : summaries[0]?.type === 'Edge' ? '╱' : '◇'}
                </span>
                <span className="type-label">{summaries[0]?.type}</span>
              </div>
              {Object.entries(singleInfo).map(([key, value]) => (
                key === 'Length' && summaries[0]?.type === 'Edge' ? (
                  <div key={key} className="prop-row">
                    <span className="prop-label">{app?.document.geometry.getEdge(selectedEntityIds[0])?.curveId ? 'Radius' : 'Length'}</span>
                    <input
                      className="prop-input"
                      defaultValue={value.replace(/[^0-9.'"\/ a-z-]/gi, m => m)}
                      key={`len-${selectedEntityIds[0]}-${value}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          applyEdgeLength(selectedEntityIds[0], (e.target as HTMLInputElement).value);
                        }
                        e.stopPropagation();
                      }}
                      title="Type an exact value and press Enter (units OK: 8'10 1/2, 30cm)"
                    />
                  </div>
                ) : (
                  <div key={key} className="prop-row">
                    <span className="prop-label">{key}</span>
                    <span className="prop-value">{value}</span>
                  </div>
                )
              ))}
              <button className="component-btn make" onClick={handleMakeComponent}>Make Component</button>
            </div>
          ) : (
            <div className="entity-list">
              <div className="entity-list-header">{selectedCount} entities selected</div>
              <button className="component-btn make" onClick={handleMakeComponent}>Make Component</button>
              {summaries.map((s, i) => (
                <div key={s.id} className="entity-list-item">
                  <span className="entity-list-icon">
                    {s.type === 'Face' ? '▢' : s.type === 'Edge' ? '╱' : '◇'}
                  </span>
                  <span className="entity-list-label">{s.label}</span>
                  <span className="entity-list-detail">{s.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .panel { border-bottom: 1px solid var(--border-color); }
        .panel-header {
          display: flex; align-items: center; padding: 6px 8px;
          cursor: pointer; background: var(--bg-tertiary); gap: 4px; font-weight: 500;
        }
        .panel-header:hover { background: var(--bg-hover); }
        .panel-collapse { font-size: 10px; color: var(--text-muted); }
        .panel-title { flex: 1; }
        .panel-badge {
          font-size: 10px; background: var(--accent); color: white;
          border-radius: 8px; padding: 0 6px; min-width: 16px; text-align: center;
        }
        .panel-body { padding: 8px; }
        .panel-empty {
          color: var(--text-muted); font-style: italic;
          text-align: center; padding: 12px;
        }
        .entity-props { display: flex; flex-direction: column; gap: 4px; }
        .entity-type-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 8px; margin-bottom: 4px;
          background: var(--bg-tertiary); border-radius: 4px;
        }
        .type-icon { font-size: 16px; width: 20px; text-align: center; }
        .type-icon.type-face { color: #4488ff; }
        .type-icon.type-edge { color: #44cc44; }
        .type-label { font-weight: 600; font-size: 13px; }
        .prop-row {
          display: flex; justify-content: space-between; align-items: center; padding: 2px 0;
        }
        .prop-label { color: var(--text-secondary); font-size: var(--font-size-small); }
        .prop-input {
          width: 110px; font-size: 11px; padding: 2px 6px;
          background: var(--bg-primary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 3px;
        }
        .prop-value { font-family: monospace; font-size: var(--font-size-small); }

        .entity-list { display: flex; flex-direction: column; gap: 2px; }
        .entity-list-header {
          font-size: var(--font-size-small); color: var(--text-secondary);
          padding: 2px 0 4px; border-bottom: 1px solid var(--border-color); margin-bottom: 4px;
        }
        .entity-list-item {
          display: flex; align-items: center; gap: 6px;
          padding: 3px 4px; border-radius: 3px;
          font-size: var(--font-size-small);
        }
        .entity-list-item:hover { background: var(--bg-hover); }
        .entity-list-icon { width: 16px; text-align: center; font-size: 12px; }
        .entity-list-label { flex: 1; }
        .entity-list-detail {
          color: var(--text-muted); font-family: monospace; font-size: 10px;
        }
        .component-breadcrumb {
          display: flex; align-items: center; flex-wrap: wrap;
          padding: 6px 8px; margin-bottom: 8px; gap: 2px;
          background: var(--bg-tertiary); border-radius: 4px;
          font-size: 11px; font-weight: 500;
        }
        .breadcrumb-sep {
          color: var(--text-muted); margin: 0 2px; font-size: 12px;
        }
        .breadcrumb-item {
          color: var(--text-secondary); font-size: 11px;
        }
        .breadcrumb-item.active {
          color: #9c27b0; font-weight: 600;
        }
        .breadcrumb-item.clickable {
          cursor: pointer; text-decoration: underline; text-decoration-color: transparent;
          transition: text-decoration-color 0.15s;
        }
        .breadcrumb-item.clickable:hover {
          text-decoration-color: currentColor; color: var(--accent);
        }
        .component-exit-btn {
          margin-left: auto;
          background: rgba(156,39,176,0.15); color: #9c27b0;
          padding: 2px 8px; border-radius: 3px; font-size: 10px;
          font-weight: 500;
        }
        .component-exit-btn:hover { background: rgba(156,39,176,0.25); }
        .component-actions {
          display: flex; gap: 6px; margin-top: 8px;
        }
        .component-btn {
          flex: 1; padding: 5px 8px; border-radius: 4px;
          font-size: 11px; font-weight: 500; text-align: center;
        }
        .component-btn.make {
          background: #9c27b0; color: white; margin-top: 8px;
        }
        .component-btn.make:hover { background: #7b1fa2; }
        .component-btn.edit {
          background: var(--accent); color: white;
        }
        .component-btn.edit:hover { background: var(--accent-hover); }
        .component-btn.explode {
          background: var(--bg-tertiary); color: var(--text-primary);
          border: 1px solid var(--border-color);
        }
        .component-btn.explode:hover { background: var(--bg-hover); }
      `}</style>
    </div>
  );
}
