// @archigraph plugin.system.parameters
// Registry-driven, tool/plugin-facing UI for prompting the user for parameters.
// Renders inside the right-rail Parameters panel (mounts under Entity Info).
//
// Plugins / tools register a "section" with declarative field schemas. Field changes
// fire `onChange` immediately; `kind: 'button'` fires `onClick`.

export type ParameterField =
  | { kind: 'header'; text: string }
  | { kind: 'separator' }
  | { kind: 'number'; key: string; label: string; default?: number; min?: number; max?: number; step?: number; unit?: string; help?: string }
  | { kind: 'integer'; key: string; label: string; default?: number; min?: number; max?: number; help?: string }
  | { kind: 'slider'; key: string; label: string; default?: number; min: number; max: number; step?: number; unit?: string }
  | { kind: 'text'; key: string; label: string; default?: string; placeholder?: string; help?: string }
  | { kind: 'boolean'; key: string; label: string; default?: boolean; help?: string }
  | { kind: 'select'; key: string; label: string; options: Array<{ label: string; value: string | number }>; default?: string | number; help?: string }
  | { kind: 'color'; key: string; label: string; default?: string }
  | { kind: 'vec3'; key: string; label: string; default?: { x: number; y: number; z: number }; unit?: string }
  | { kind: 'point3d'; key: string; label: string; default?: { x: number; y: number; z: number } }
  | { kind: 'button'; key?: string; label: string; onClick(): void; primary?: boolean };

export interface ParametersSection {
  /** Unique id (typically `<plugin-id>:<section-id>`). */
  id: string;
  /** Section header — shown as the panel title. */
  title: string;
  /** Form schema. */
  fields: ParameterField[];
  /** Initial / current values keyed by field.key. */
  values?: Record<string, unknown>;
  /** Called whenever any field changes. */
  onChange?(values: Record<string, unknown>, changedKey: string): void;
  /** Optional close button — when present a `✕` is rendered in the section bar. */
  onClose?(): void;
  /** Optional help / footnote text shown below the form. */
  footer?: string;
}

interface InternalSection extends ParametersSection {
  values: Record<string, unknown>;
}

type Listener = () => void;

class Emitter {
  private fns = new Set<Listener>();
  on(fn: Listener): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }
  emit(): void { for (const f of this.fns) try { f(); } catch (e) { console.error(e); } }
}

export class ParametersStore {
  private sections = new Map<string, InternalSection>();
  private order: string[] = [];
  readonly events = new Emitter();

  /** Show or replace a parameters section. */
  show(section: ParametersSection): void {
    const existing = this.sections.get(section.id);
    const values: Record<string, unknown> = { ...(section.values ?? {}) };
    // Seed defaults for any field that doesn't have a value yet.
    for (const f of section.fields) {
      if ('key' in f && f.key && !(f.key in values)) {
        values[f.key] = (f as any).default;
      }
    }
    if (existing) {
      // Preserve user-entered values that aren't being explicitly overridden by `section.values`.
      for (const k of Object.keys(existing.values)) {
        if (!(k in values)) values[k] = existing.values[k];
      }
    }
    this.sections.set(section.id, { ...section, values });
    if (!this.order.includes(section.id)) this.order.push(section.id);
    this.events.emit();
  }

  /** Hide a section. */
  hide(id: string): boolean {
    if (!this.sections.has(id)) return false;
    this.sections.delete(id);
    this.order = this.order.filter(x => x !== id);
    this.events.emit();
    return true;
  }

  /** Programmatically update values for a section. */
  update(id: string, partial: Record<string, unknown>): boolean {
    const s = this.sections.get(id);
    if (!s) return false;
    s.values = { ...s.values, ...partial };
    this.events.emit();
    return true;
  }

  /** Read the current values of a section. */
  values(id: string): Record<string, unknown> | null {
    const s = this.sections.get(id);
    return s ? { ...s.values } : null;
  }

  /** All currently-visible sections in registration order. */
  list(): InternalSection[] {
    return this.order.map(id => this.sections.get(id)).filter((s): s is InternalSection => !!s);
  }

  /** Internal — called by the React panel when a single field changes. */
  setFieldInternal(id: string, key: string, value: unknown): void {
    const s = this.sections.get(id);
    if (!s) return;
    s.values[key] = value;
    this.events.emit();
    try { s.onChange?.({ ...s.values }, key); } catch (e) { console.error(e); }
  }
}

/** Singleton — installed onto window.draftdownParameters by index.ts. */
let _instance: ParametersStore | null = null;
export function getParametersStore(): ParametersStore {
  if (!_instance) _instance = new ParametersStore();
  return _instance;
}
