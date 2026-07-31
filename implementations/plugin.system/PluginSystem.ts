// @archigraph plugin.system
// Plugin system for DraftDown — registration, lifecycle, sandboxing

// ─── Plugin Interface ───────────────────────────────────────────

export interface Plugin {
  /** Unique plugin identifier (reverse-domain style, e.g. "com.example.my-plugin") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version string */
  version: string;
  /** Plugin author */
  author?: string;
  /** Short description */
  description?: string;

  /**
   * Called when the plugin is activated. The plugin receives a host API
   * to register tools, menu items, file formats, etc.
   */
  activate(host: PluginHost): void | Promise<void>;

  /**
   * Called when the plugin is deactivated. Clean up any resources.
   */
  deactivate(): void | Promise<void>;
}

// ─── Plugin Host API ────────────────────────────────────────────

export interface PluginToolDescriptor {
  id: string;
  name: string;
  icon: string;
  shortcut?: string;
  category: 'draw' | 'modify' | 'navigate' | 'measure' | 'construct';
  onActivate: () => void;
  onDeactivate: () => void;
  onMouseDown?: (event: unknown) => void;
  onMouseMove?: (event: unknown) => void;
  onMouseUp?: (event: unknown) => void;
  onKeyDown?: (event: unknown) => void;
}

export interface PluginMenuItemDescriptor {
  id: string;
  label: string;
  parentMenu: string;
  shortcut?: string;
  onClick: () => void;
}

export interface PluginFileFormatDescriptor {
  id: string;
  name: string;
  extensions: string[];
  mimeTypes: string[];
  canImport: boolean;
  canExport: boolean;
  importFn?: (data: ArrayBuffer) => Promise<unknown>;
  exportFn?: (meshData: unknown) => Promise<ArrayBuffer | string>;
}

export interface PluginPanelDescriptor {
  id: string;
  title: string;
  icon?: string;
  position: 'left' | 'right' | 'bottom';
  render: (container: HTMLElement) => void;
  dispose?: () => void;
}

/**
 * The host API provided to plugins during activation.
 * Plugins use this to register their contributions.
 */
export interface PluginHost {
  /** Register a custom tool */
  registerTool(descriptor: PluginToolDescriptor): void;
  /** Unregister a previously registered tool */
  unregisterTool(toolId: string): void;

  /** Register a menu item */
  registerMenuItem(descriptor: PluginMenuItemDescriptor): void;
  /** Unregister a menu item */
  unregisterMenuItem(itemId: string): void;

  /** Register a file format */
  registerFileFormat(descriptor: PluginFileFormatDescriptor): void;
  /** Unregister a file format */
  unregisterFileFormat(formatId: string): void;

  /** Register a UI panel */
  registerPanel(descriptor: PluginPanelDescriptor): void;
  /** Unregister a UI panel */
  unregisterPanel(panelId: string): void;

  /** Get a reference to the application document (read-only facade) */
  getDocument(): unknown;

  /** Show a notification to the user */
  showNotification(message: string, level?: 'info' | 'warning' | 'error'): void;

  /** Log a message to the plugin console */
  log(message: string, ...args: unknown[]): void;
}

// ─── Plugin State ───────────────────────────────────────────────

interface PluginEntry {
  plugin: Plugin;
  active: boolean;
  registeredTools: Set<string>;
  registeredMenuItems: Set<string>;
  registeredFormats: Set<string>;
  registeredPanels: Set<string>;
}

// ─── Plugin Registry ────────────────────────────────────────────

export type PluginEventType =
  | 'plugin-registered'
  | 'plugin-unregistered'
  | 'plugin-activated'
  | 'plugin-deactivated'
  | 'tool-registered'
  | 'menu-item-registered'
  | 'format-registered'
  | 'panel-registered';

export type PluginEventHandler = (event: { type: PluginEventType; pluginId: string; targetId?: string }) => void;

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>();
  private tools = new Map<string, PluginToolDescriptor>();
  private menuItems = new Map<string, PluginMenuItemDescriptor>();
  private fileFormats = new Map<string, PluginFileFormatDescriptor>();
  private panels = new Map<string, PluginPanelDescriptor>();
  private eventHandlers = new Map<PluginEventType, Set<PluginEventHandler>>();

  // Active plugin context (set during activate/deactivate calls)
  private activePluginId: string | null = null;

  /**
   * Register a plugin. Does not activate it.
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin '${plugin.id}' is already registered.`);
    }

    this.plugins.set(plugin.id, {
      plugin,
      active: false,
      registeredTools: new Set(),
      registeredMenuItems: new Set(),
      registeredFormats: new Set(),
      registeredPanels: new Set(),
    });

    this.emit('plugin-registered', plugin.id);
  }

  /**
   * Unregister a plugin. Deactivates it first if active.
   */
  async unregister(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;

    if (entry.active) {
      await this.deactivate(pluginId);
    }

    this.plugins.delete(pluginId);
    this.emit('plugin-unregistered', pluginId);
  }

  /**
   * Activate a registered plugin.
   */
  async activate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin '${pluginId}' is not registered.`);
    if (entry.active) return;

    const host = this.createHost(pluginId);
    this.activePluginId = pluginId;

    try {
      await entry.plugin.activate(host);
      entry.active = true;
      this.emit('plugin-activated', pluginId);
    } catch (err) {
      // Rollback any registrations made during failed activation
      this.cleanupPluginRegistrations(pluginId);
      throw err;
    } finally {
      this.activePluginId = null;
    }
  }

  /**
   * Deactivate an active plugin, removing all its contributions.
   */
  async deactivate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry || !entry.active) return;

    this.activePluginId = pluginId;

    try {
      await entry.plugin.deactivate();
    } catch (e) {
      console.error(`[PluginRegistry.deactivate] plugin '${pluginId}' deactivate threw:`, e);
    } finally {
      this.activePluginId = null;
    }

    this.cleanupPluginRegistrations(pluginId);
    entry.active = false;
    this.emit('plugin-deactivated', pluginId);
  }

  /**
   * Get all registered plugins.
   */
  getAll(): Array<{ plugin: Plugin; active: boolean }> {
    return Array.from(this.plugins.values()).map(e => ({
      plugin: e.plugin,
      active: e.active,
    }));
  }

  /**
   * Get a specific plugin by ID.
   */
  get(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId)?.plugin;
  }

  /**
   * Check if a plugin is active.
   */
  isActive(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.active ?? false;
  }

  /**
   * Get all registered tools (from all active plugins).
   */
  getRegisteredTools(): PluginToolDescriptor[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all registered menu items.
   */
  getRegisteredMenuItems(): PluginMenuItemDescriptor[] {
    return Array.from(this.menuItems.values());
  }

  /**
   * Get all registered file formats.
   */
  getRegisteredFileFormats(): PluginFileFormatDescriptor[] {
    return Array.from(this.fileFormats.values());
  }

  /**
   * Get all registered panels.
   */
  getRegisteredPanels(): PluginPanelDescriptor[] {
    return Array.from(this.panels.values());
  }

  /**
   * Subscribe to plugin events.
   */
  on(event: PluginEventType, handler: PluginEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from plugin events.
   */
  off(event: PluginEventType, handler: PluginEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  // ─── Private ────────────────────────────────────────────────

  private emit(type: PluginEventType, pluginId: string, targetId?: string): void {
    const handlers = this.eventHandlers.get(type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler({ type, pluginId, targetId });
      } catch (e) {
        console.error(`[PluginRegistry] event handler for '${type}' threw:`, e);
      }
    }
  }

  private createHost(pluginId: string): PluginHost {
    const registry = this;

    return {
      registerTool(descriptor: PluginToolDescriptor): void {
        const qualifiedId = `${pluginId}:${descriptor.id}`;
        registry.tools.set(qualifiedId, { ...descriptor, id: qualifiedId });
        registry.plugins.get(pluginId)?.registeredTools.add(qualifiedId);
        registry.emit('tool-registered', pluginId, qualifiedId);
      },

      unregisterTool(toolId: string): void {
        const qualifiedId = toolId.includes(':') ? toolId : `${pluginId}:${toolId}`;
        registry.tools.delete(qualifiedId);
        registry.plugins.get(pluginId)?.registeredTools.delete(qualifiedId);
      },

      registerMenuItem(descriptor: PluginMenuItemDescriptor): void {
        const qualifiedId = `${pluginId}:${descriptor.id}`;
        registry.menuItems.set(qualifiedId, { ...descriptor, id: qualifiedId });
        registry.plugins.get(pluginId)?.registeredMenuItems.add(qualifiedId);
        registry.emit('menu-item-registered', pluginId, qualifiedId);
      },

      unregisterMenuItem(itemId: string): void {
        const qualifiedId = itemId.includes(':') ? itemId : `${pluginId}:${itemId}`;
        registry.menuItems.delete(qualifiedId);
        registry.plugins.get(pluginId)?.registeredMenuItems.delete(qualifiedId);
      },

      registerFileFormat(descriptor: PluginFileFormatDescriptor): void {
        const qualifiedId = `${pluginId}:${descriptor.id}`;
        registry.fileFormats.set(qualifiedId, { ...descriptor, id: qualifiedId });
        registry.plugins.get(pluginId)?.registeredFormats.add(qualifiedId);
        registry.emit('format-registered', pluginId, qualifiedId);
      },

      unregisterFileFormat(formatId: string): void {
        const qualifiedId = formatId.includes(':') ? formatId : `${pluginId}:${formatId}`;
        registry.fileFormats.delete(qualifiedId);
        registry.plugins.get(pluginId)?.registeredFormats.delete(qualifiedId);
      },

      registerPanel(descriptor: PluginPanelDescriptor): void {
        const qualifiedId = `${pluginId}:${descriptor.id}`;
        registry.panels.set(qualifiedId, { ...descriptor, id: qualifiedId });
        registry.plugins.get(pluginId)?.registeredPanels.add(qualifiedId);
        registry.emit('panel-registered', pluginId, qualifiedId);
      },

      unregisterPanel(panelId: string): void {
        const qualifiedId = panelId.includes(':') ? panelId : `${pluginId}:${panelId}`;
        const panel = registry.panels.get(qualifiedId);
        panel?.dispose?.();
        registry.panels.delete(qualifiedId);
        registry.plugins.get(pluginId)?.registeredPanels.delete(qualifiedId);
      },

      getDocument(): unknown {
        // Returns a read-only facade to the current document.
        // In a real implementation, this would return a proxy that
        // restricts mutations to sanctioned operations.
        return null;
      },

      showNotification(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
        const prefix = `[Plugin: ${pluginId}]`;
        switch (level) {
          case 'error':
            console.error(prefix, message);
            break;
          case 'warning':
            console.warn(prefix, message);
            break;
          default:
            console.info(prefix, message);
        }
      },

      log(message: string, ...args: unknown[]): void {
        console.log(`[Plugin: ${pluginId}]`, message, ...args);
      },
    };
  }

  private cleanupPluginRegistrations(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;

    for (const toolId of entry.registeredTools) {
      this.tools.delete(toolId);
    }
    entry.registeredTools.clear();

    for (const itemId of entry.registeredMenuItems) {
      this.menuItems.delete(itemId);
    }
    entry.registeredMenuItems.clear();

    for (const formatId of entry.registeredFormats) {
      this.fileFormats.delete(formatId);
    }
    entry.registeredFormats.clear();

    for (const panelId of entry.registeredPanels) {
      const panel = this.panels.get(panelId);
      panel?.dispose?.();
      this.panels.delete(panelId);
    }
    entry.registeredPanels.clear();
  }
}

// ─── Plugin Sandbox ─────────────────────────────────────────────

/**
 * Sandbox for running untrusted plugin code in an isolated context.
 * Uses a Web Worker for code isolation and message-passing for communication.
 *
 * For full iframe-based sandboxing with DOM access, see PluginIframeSandbox.
 */
export class PluginWorkerSandbox {
  private worker: Worker | null = null;
  private messageHandlers = new Map<string, (data: unknown) => void>();

  /**
   * Load and start a plugin in a sandboxed worker.
   * @param scriptUrl - URL to the plugin's bundled script
   */
  async start(scriptUrl: string): Promise<void> {
    // Create a worker with a wrapper that loads the plugin script
    const workerCode = `
      importScripts('${scriptUrl}');
      self.onmessage = function(e) {
        if (typeof self.pluginMessageHandler === 'function') {
          self.pluginMessageHandler(e.data);
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    this.worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);

    this.worker.onmessage = (event) => {
      const { type, ...data } = event.data;
      const handler = this.messageHandlers.get(type);
      handler?.(data);
    };

    this.worker.onerror = (error) => {
      console.error('[PluginSandbox] Worker error:', error.message);
    };
  }

  /**
   * Send a message to the sandboxed plugin.
   */
  postMessage(type: string, data: unknown): void {
    this.worker?.postMessage({ type, ...data as Record<string, unknown> });
  }

  /**
   * Register a handler for messages from the plugin.
   */
  onMessage(type: string, handler: (data: unknown) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Terminate the sandbox and release resources.
   */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.messageHandlers.clear();
  }
}
