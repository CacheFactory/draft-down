// @archigraph tool.manager
// Tool manager: registry of all tools, handles activation/deactivation

import type { ITool, IToolManager } from '../../src/core/interfaces';

type ToolChangedHandler = (tool: ITool | null) => void;

export class ToolManager implements IToolManager {
  private tools = new Map<string, ITool>();
  private activeTool: ITool | null = null;
  private listeners: ToolChangedHandler[] = [];

  registerTool(tool: ITool): void {
    this.tools.set(tool.id, tool);
  }

  unregisterTool(toolId: string): void {
    if (this.activeTool?.id === toolId) {
      this.deactivateTool();
    }
    this.tools.delete(toolId);
  }

  activateTool(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;

    if (this.activeTool) {
      this.activeTool.deactivate();
    }

    this.activeTool = tool;
    tool.activate();
    this.emit(tool);
  }

  deactivateTool(): void {
    if (this.activeTool) {
      this.activeTool.deactivate();
      this.activeTool = null;
      this.emit(null);
    }
  }

  getActiveTool(): ITool | null {
    return this.activeTool;
  }

  getTool(toolId: string): ITool | undefined {
    return this.tools.get(toolId);
  }

  getAllTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  on(event: 'tool-changed', handler: ToolChangedHandler): void {
    this.listeners.push(handler);
  }

  off(event: 'tool-changed', handler: ToolChangedHandler): void {
    this.listeners = this.listeners.filter(h => h !== handler);
  }

  private emit(tool: ITool | null): void {
    for (const handler of this.listeners) {
      handler(tool);
    }
  }
}
