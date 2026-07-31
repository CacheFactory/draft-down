// @archigraph core-events
// Simple typed event emitter

export class SimpleEventEmitter<TEvents extends Record<string, unknown[]> = Record<string, unknown[]>> {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on<K extends keyof TEvents & string>(event: K, handler: (...args: TEvents[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
  }

  off<K extends keyof TEvents & string>(event: K, handler: (...args: TEvents[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof TEvents & string>(event: K, ...args: TEvents[K]): void {
    this.listeners.get(event)?.forEach(handler => {
      try {
        handler(...args);
      } catch (e) {
        console.error(`Error in event handler for '${event}':`, e);
      }
    });
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
