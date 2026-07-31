// @archigraph window.main
// classic-CAD-style Instructor: a small collapsible card explaining the active
// tool's steps and modifier keys. Content lives here, keyed by tool id.
import React, { useState } from 'react';
import { useApp } from './AppContext';

interface Instructions {
  steps: string[];
  modifiers?: Array<[string, string]>;
}

const INSTRUCTIONS: Record<string, Instructions> = {
  'tool.select': {
    steps: ['Click to select', 'Drag right = window, left = crossing', 'Double-click face = face+edges, triple = connected'],
    modifiers: [['Shift', 'add/remove from selection'], ['⌫', 'delete selection']],
  },
  'tool.line': {
    steps: ['Click start point', 'Click next points to chain', 'Close a loop to make a face', 'Type a length for exact segments'],
    modifiers: [['↑→←', 'lock axis'], ['Shift', 'hold inference'], ['Esc', 'finish']],
  },
  'tool.rectangle': {
    steps: ['Click first corner', 'Click opposite corner', 'Type W,H for exact size (units OK: 8\'10", 2m)'],
    modifiers: [['Arrows', 'change drawing plane']],
  },
  'tool.circle': {
    steps: ['Click center', 'Click to set radius', 'Type radius, or Ns to change segments (e.g. 32s)'],
    modifiers: [['Arrows', 'change drawing plane']],
  },
  'tool.polygon': {
    steps: ['Click center', 'Click to set radius', 'Type Ns before drawing for N sides'],
  },
  'tool.arc': {
    steps: ['Click start', 'Click end', 'Move to bow, click to commit', 'Type bulge or radius'],
  },
  'tool.pushpull': {
    steps: ['Click a face', 'Drag to extrude, click to commit', 'Type a distance', 'Double-click repeats the last distance'],
    modifiers: [['Ctrl', 'leave the starting face']],
  },
  'tool.move': {
    steps: ['Select, then click a base point', 'Drag and click to place', 'Type a distance mid-drag'],
    modifiers: [['Ctrl', 'copy instead of move'], ['then type 5x or /5', 'linear array'], ['Arrows', 'lock axis']],
  },
  'tool.rotate': {
    steps: ['Click a handle for the center', 'Click the start angle', 'Drag and click to rotate', 'Type degrees for exact'],
    modifiers: [['Ctrl', 'rotate a copy'], ['then type 6x or /6', 'radial array'], ['Arrows', 'change axis']],
  },
  'tool.scale': {
    steps: ['Select geometry', 'Drag a grip', 'Type a factor (e.g. 1.5) for exact'],
  },
  'tool.offset': {
    steps: ['Click a face', 'Drag inward/outward', 'Type a distance'],
  },
  'tool.eraser': {
    steps: ['Click or drag across edges/faces to erase'],
    modifiers: [['Ctrl', 'soften/smooth edge'], ['Shift', 'hide edge']],
  },
  'tool.paint': {
    steps: ['Pick a material in the panel', 'Click faces to paint'],
    modifiers: [['Alt', 'sample material'], ['Shift', 'replace all matching']],
  },
  'tool.tape_measure': {
    steps: ['Click two points to measure', 'Guide Line mode drops an infinite dashed guide', 'Click an edge to extend it as an axis'],
    modifiers: [['Ctrl', 'cycle Guide Line / Guide Point / Measure']],
  },
  'tool.protractor': {
    steps: ['Click the vertex', 'Click the baseline', 'Click or type degrees to place an angled guide'],
  },
  'tool.sweep_tool': {
    steps: ['Click the profile face', 'Click an edge of the path to follow', 'Closed paths make rings; the profile is consumed'],
  },
  'tool.section_plane': {
    steps: ['Click a face to place the cutting plane', 'The cut fill shows where solids are sliced'],
  },
  'tool.position_camera': {
    steps: ['Click where you want to stand', 'Camera drops to eye height looking ahead', 'Type an eye height to change it'],
  },
  'tool.look_around': {
    steps: ['Drag to pan/tilt the camera in place'],
  },
  'tool.walk': {
    steps: ['Drag up/down to walk forward/back', 'Drag left/right to turn'],
  },
};

export function InstructorPanel() {
  const { activeToolId } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  const inst = activeToolId ? INSTRUCTIONS[activeToolId] : null;
  if (!inst) return null;

  return (
    <div className={`instructor ${collapsed ? 'collapsed' : ''}`}>
      <div className="instructor-header" onClick={() => setCollapsed(!collapsed)}>
        <span>Instructor</span>
        <span className="instructor-toggle">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="instructor-body">
          <ol>
            {inst.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {inst.modifiers && (
            <div className="instructor-mods">
              {inst.modifiers.map(([key, does], i) => (
                <div key={i}><kbd>{key}</kbd> {does}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <style>{`
        .instructor {
          position: absolute; right: 12px; bottom: 40px; width: 230px;
          background: var(--bg-secondary); border: 1px solid var(--border-color);
          border-radius: 6px; font-size: 11px; z-index: 50;
          box-shadow: 0 2px 10px rgba(0,0,0,0.25); opacity: 0.94;
        }
        .instructor-header {
          display: flex; justify-content: space-between; padding: 5px 10px;
          font-weight: 600; cursor: pointer; user-select: none;
          border-bottom: 1px solid var(--border-color);
        }
        .instructor.collapsed .instructor-header { border-bottom: none; }
        .instructor-body { padding: 6px 10px 8px; }
        .instructor-body ol { margin: 0; padding-left: 16px; }
        .instructor-body li { margin: 2px 0; }
        .instructor-mods { margin-top: 6px; border-top: 1px dashed var(--border-color); padding-top: 5px; }
        .instructor-mods div { margin: 2px 0; }
        .instructor kbd {
          background: var(--bg-primary); border: 1px solid var(--border-color);
          border-radius: 3px; padding: 0 4px; font-size: 10px;
        }
      `}</style>
    </div>
  );
}
