// @archigraph plugin.system.draftdown.options
// DraftDown.OptionsManager + DraftDown.OptionsProvider.
//
// References:
//   
//   
//
// Each provider is a key/value bag for one feature group. Real DraftDown ships
// providers for "UnitsOptions", "PageOptions", "PrintOptions", "SlideshowOptions",
// "NamedOptions". We seed those with sensible defaults backed by the document's
// length unit + standard view settings, and let plugins read/write any other key.

import type { IModelDocument } from '../../../src/core/interfaces';
import type { LengthUnit } from '../../../src/core/types';

export interface OptionsProviderObserver {
  onOptionsProviderChanged?(provider: OptionsProvider, name: string): void;
}

export class OptionsProvider {
  private store = new Map<string, unknown>();
  private observers = new Set<OptionsProviderObserver>();

  constructor(public readonly name: string, defaults: Record<string, unknown>) {
    for (const k of Object.keys(defaults)) this.store.set(k, defaults[k]);
  }

  /** OptionsProvider#[] / #[]= */
  get(key: string): unknown { return this.store.has(key) ? this.store.get(key) : null; }
  set(key: string, value: unknown): boolean { this.store.set(key, value); this.emit(key); return true; }
  /** OptionsProvider#has_key? */
  hasKey(key: string): boolean { return this.store.has(key); }
  /** OptionsProvider#count */
  count(): number { return this.store.size; }
  /** OptionsProvider#each_pair / .each_key */
  each(fn: (key: string, value: unknown) => void): void { for (const [k, v] of this.store) fn(k, v); }
  eachPair(fn: (key: string, value: unknown) => void): void { this.each(fn); }
  eachKey(fn: (key: string) => void): void { for (const k of this.store.keys()) fn(k); }
  keys(): string[] { return Array.from(this.store.keys()); }

  /** OptionsProvider#add_observer / remove_observer */
  addObserver(o: OptionsProviderObserver): void { this.observers.add(o); }
  removeObserver(o: OptionsProviderObserver): void { this.observers.delete(o); }

  private emit(key: string): void {
    for (const o of this.observers) try { o.onOptionsProviderChanged?.(this, key); } catch (e) { console.error(e); }
  }
}

export class OptionsManager {
  private providers = new Map<string, OptionsProvider>();

  constructor(private doc: IModelDocument) {
    this.providers.set('UnitsOptions', new OptionsProvider('UnitsOptions', {
      LengthUnit: lengthUnitToCode(doc.metadata.units),
      LengthFormat: 0,
      LengthPrecision: 4,
      LengthSnapEnabled: true,
      LengthSnapLength: 0.01,
      AngleUnit: 0,
      AnglePrecision: 1,
      AngleSnapEnabled: true,
      SnapAngle: 15,
      SuppressUnitsDisplay: false,
      ForceInchDisplay: false,
    }));
    this.providers.set('PageOptions', new OptionsProvider('PageOptions', {
      ShowTransition: true,
      TransitionTime: 1,
      DelayTime: 0,
    }));
    this.providers.set('PrintOptions', new OptionsProvider('PrintOptions', {
      PrintScaleEnabled: false,
      PrintScale: 1,
      PrintQuality: 0,
    }));
    this.providers.set('SlideshowOptions', new OptionsProvider('SlideshowOptions', {
      LoopSlideshow: true,
      SlideTime: 1,
    }));
    this.providers.set('NamedOptions', new OptionsProvider('NamedOptions', {}));
  }

  /** OptionsManager#count */
  count(): number { return this.providers.size; }
  /** OptionsManager#[] */
  at(key: number | string): OptionsProvider | null {
    if (typeof key === 'number') {
      const arr = Array.from(this.providers.values());
      return arr[key] ?? null;
    }
    return this.providers.get(key) ?? null;
  }
  /** OptionsManager#each */
  each(fn: (provider: OptionsProvider) => void): void { for (const p of this.providers.values()) fn(p); }
  /** OptionsManager#keys */
  keys(): string[] { return Array.from(this.providers.keys()); }
}

function lengthUnitToCode(u: LengthUnit): number {
  switch (u) {
    case 'inches': return 0;
    case 'feet': return 1;
    case 'mm': return 2;
    case 'cm': return 3;
    case 'm': return 4;
    default: return 4;
  }
}
