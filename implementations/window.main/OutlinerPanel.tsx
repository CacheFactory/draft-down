// @archigraph panel.outliner
import React, { useState, useCallback } from 'react';
import { useApp } from './AppContext';

interface TreeNode {
  id: string;
  name: string;
  type: string;
  children: TreeNode[];
  visible: boolean;
  locked: boolean;
}

function buildTree(app: any): TreeNode[] {
  if (!app?.document?.scene) return [];
  const root = app.document.scene.root;
  if (!root) return [];

  const buildNode = (entityId: string): TreeNode | null => {
    const entity = app.document.scene.getEntity(entityId);
    if (!entity) return null;
    const children: TreeNode[] = [];
    if (entity.type === 'group' && entity.children) {
      for (const childId of entity.children) {
        const child = buildNode(childId);
        if (child) children.push(child);
      }
    }
    return {
      id: entity.id,
      name: entity.name || `${entity.type}:${entity.id.substring(0, 6)}`,
      type: entity.type,
      children,
      visible: entity.visible,
      locked: entity.locked,
    };
  };

  if (root.children) {
    return root.children.map((id: string) => buildNode(id)).filter(Boolean) as TreeNode[];
  }
  return [];
}

function TreeItem({ node, depth, selectedIds, onSelect, onToggleVisibility }: {
  node: TreeNode;
  depth: number;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedIds.includes(node.id);

  return (
    <div className="tree-item-wrapper">
      <div
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          <span className="tree-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? '▾' : '▸'}
          </span>
        ) : <span className="tree-expand-spacer" />}
        <span className="tree-type-icon">
          {node.type === 'group' ? '📁' : node.type === 'component_instance' ? '🧩' : '◇'}
        </span>
        <span className="tree-name">{node.name}</span>
        <button
          className={`tree-vis-btn ${!node.visible ? 'hidden-entity' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleVisibility(node.id); }}
          title={node.visible ? 'Hide' : 'Show'}
        >
          {node.visible ? '👁' : '·'}
        </button>
      </div>
      {expanded && node.children.map(child => (
        <TreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onToggleVisibility={onToggleVisibility}
        />
      ))}
    </div>
  );
}

export function OutlinerPanel() {
  const { app, selectedEntityIds } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('');

  const tree = buildTree(app);

  const handleSelect = useCallback((id: string) => {
    app?.document.selection.select(id);
  }, [app]);

  const handleToggleVisibility = useCallback((id: string) => {
    const entity = app?.document.scene.getEntity(id);
    if (entity) {
      entity.visible = !entity.visible;
      // Visibility is applied to Three.js groups during sync — without this
      // the eye toggle changed state but the viewport never updated.
      (app as any)?.syncScene?.();
    }
  }, [app]);

  return (
    <div className="panel outliner-panel">
      <div className="panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="panel-collapse">{collapsed ? '▸' : '▾'}</span>
        <span className="panel-title">Outliner</span>
      </div>
      {!collapsed && (
        <div className="panel-body" style={{ padding: 0 }}>
          <div style={{ padding: '4px 8px' }}>
            <input
              className="outliner-search"
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          <div className="outliner-tree">
            {tree.length === 0 ? (
              <div className="panel-empty">Empty scene</div>
            ) : (
              tree.map(node => (
                <TreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedIds={selectedEntityIds}
                  onSelect={handleSelect}
                  onToggleVisibility={handleToggleVisibility}
                />
              ))
            )}
          </div>
        </div>
      )}

      <style>{`
        .outliner-search {
          width: 100%;
          height: 24px;
          font-size: var(--font-size-small);
        }
        .outliner-tree {
          max-height: 200px;
          overflow-y: auto;
        }
        .tree-item {
          display: flex;
          align-items: center;
          height: 22px;
          gap: 4px;
          cursor: pointer;
          padding-right: 4px;
          font-size: var(--font-size-small);
        }
        .tree-item:hover { background: var(--bg-hover); }
        .tree-item.selected { background: var(--bg-active); color: #fff; }
        .tree-expand { font-size: 10px; width: 12px; text-align: center; cursor: pointer; }
        .tree-expand-spacer { width: 12px; }
        .tree-type-icon { font-size: 12px; }
        .tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tree-vis-btn {
          font-size: 10px; width: 18px; height: 18px; padding: 0;
          display: flex; align-items: center; justify-content: center;
          opacity: 0.5;
        }
        .tree-vis-btn:hover { opacity: 1; }
        .hidden-entity { opacity: 0.3; }
      `}</style>
    </div>
  );
}
