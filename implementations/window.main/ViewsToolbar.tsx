// @archigraph toolbar.views
import React from 'react';
import { useApp } from './AppContext';
import { RenderMode } from '../../src/core/types';

const views = [
  { label: 'Front', action: 'front' },
  { label: 'Back', action: 'back' },
  { label: 'Left', action: 'left' },
  { label: 'Right', action: 'right' },
  { label: 'Top', action: 'top' },
  { label: 'Bottom', action: 'bottom' },
  { label: 'Iso', action: 'iso' },
] as const;

const renderModes: Array<{ label: string; mode: RenderMode }> = [
  { label: 'Wire', mode: 'wireframe' },
  { label: 'Shaded', mode: 'shaded' },
  { label: 'Textured', mode: 'textured' },
  { label: 'X-Ray', mode: 'xray' },
];

export function ViewsToolbar() {
  const { renderMode, setRenderMode, gridVisible, axesVisible, toggleGrid, toggleAxes, gridSnapEnabled, toggleGridSnap, app } = useApp();
  const [hiddenGeo, setHiddenGeo] = React.useState(false);
  const [profiles, setProfiles] = React.useState(true);
  const [sky, setSky] = React.useState(false);

  const toggleProfiles = () => {
    const bridge = (app as any)?.sceneBridge;
    if (!bridge) return;
    bridge.profileEdgesEnabled = !bridge.profileEdgesEnabled;
    setProfiles(bridge.profileEdgesEnabled);
    bridge.sync(true);
  };

  const [shadows, setShadows] = React.useState(false);
  const [sunDay, setSunDay] = React.useState(172);  // June 21
  const [sunHour, setSunHour] = React.useState(10);

  const toggleShadows = () => {
    const renderer = (app as any)?.viewport?.renderer;
    if (!renderer?.setShadowsEnabled) return;
    const next = !shadows;
    renderer.setShadowsEnabled(next);
    if (next) renderer.setSunPosition(sunDay, sunHour);
    setShadows(next);
  };

  const updateSun = (day: number, hour: number) => {
    setSunDay(day);
    setSunHour(hour);
    (app as any)?.viewport?.renderer?.setSunPosition?.(day, hour);
  };

  const toggleSky = () => {
    const renderer = (app as any)?.viewport?.renderer;
    if (!renderer?.setBackgroundMode) return;
    const next = !sky;
    renderer.setBackgroundMode(next ? 'sky' : 'solid');
    setSky(next);
  };

  const toggleHiddenGeometry = () => {
    const bridge = (app as any)?.sceneBridge;
    if (!bridge) return;
    bridge.showHiddenGeometry = !bridge.showHiddenGeometry;
    setHiddenGeo(bridge.showHiddenGeometry);
    bridge.sync(true); // full resync so suppressed edges re-materialize dashed
  };

  const handleView = (view: string) => {
    app?.viewport.camera.setView(view as 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso');
  };

  const handleZoomExtents = () => {
    const box = app?.document.geometry.getBoundingBox();
    if (box) app?.viewport.camera.fitToBox(box);
  };

  return (
    <div className="views-toolbar">
      <div className="views-group">
        {views.map(v => (
          <button
            key={v.action}
            className="view-btn"
            onClick={() => handleView(v.action)}
            title={`${v.label} View`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="toolbar-separator" />

      <div className="views-group">
        {renderModes.map(rm => (
          <button
            key={rm.mode}
            className={`view-btn ${renderMode === rm.mode ? 'active' : ''}`}
            onClick={() => setRenderMode(rm.mode)}
            title={`${rm.label} Mode`}
          >
            {rm.label}
          </button>
        ))}
      </div>

      <div className="toolbar-separator" />

      <div className="views-group">
        <button onClick={handleZoomExtents} title="Zoom Extents">Extents</button>
        <button
          className={gridVisible ? 'active' : ''}
          onClick={toggleGrid}
          title="Toggle Grid"
        >Grid</button>
        <button
          className={gridSnapEnabled ? 'active' : ''}
          onClick={toggleGridSnap}
          title="Snap free points to the grid increment (configure in Preferences)"
        >Grid Snap</button>
        <button
          className={axesVisible ? 'active' : ''}
          onClick={toggleAxes}
          title="Toggle Axes"
        >Axes</button>
        <button
          className={hiddenGeo ? 'active' : ''}
          onClick={toggleHiddenGeometry}
          title="View Hidden Geometry (soft/hidden edges shown dashed)"
        >Hidden</button>
        <button
          className={profiles ? 'active' : ''}
          onClick={toggleProfiles}
          title="Profile edges (outlines drawn thicker)"
        >Profiles</button>
        <button
          className={sky ? 'active' : ''}
          onClick={toggleSky}
          title="Sky/ground gradient background"
        >Sky</button>
        <button
          className={shadows ? 'active' : ''}
          onClick={toggleShadows}
          title="Sun shadows"
        >Shadows</button>
        {shadows && (
          <span className="sun-sliders" title="Sun date / time">
            <input type="range" min={1} max={365} value={sunDay}
              onChange={(e) => updateSun(parseInt(e.target.value, 10), sunHour)} />
            <input type="range" min={6} max={18} step={0.25} value={sunHour}
              onChange={(e) => updateSun(sunDay, parseFloat(e.target.value))} />
          </span>
        )}
      </div>

      <style>{`
        .views-toolbar {
          display: flex;
          align-items: center;
          height: var(--toolbar-height);
          padding: 0 4px;
          gap: 4px;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-color);
        }
        .views-group {
          display: flex;
          gap: 1px;
          align-items: center;
        }
        .sun-sliders { display: inline-flex; gap: 4px; margin-left: 6px; }
        .sun-sliders input { width: 70px; }
        .view-btn {
          font-size: var(--font-size-small);
          padding: 2px 6px;
          height: 24px;
        }
        .toolbar-separator {
          width: 1px;
          height: 20px;
          background: var(--border-color);
          margin: 0 4px;
        }
      `}</style>
    </div>
  );
}
