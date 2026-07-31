// @archigraph plugin.system.draftdown.attribute-dictionary
// DraftDown.AttributeDictionary + DraftDown.AttributeDictionaries
// References:
//   
//   

import type { AttributeStore, AttrValue } from './AttributeStore';

/**
 * DraftDown.AttributeDictionary. Behaves like a Hash — keys are strings, values are
 * JSON-safe scalars or nested arrays/objects.
 */
export class AttributeDictionary {
  constructor(public readonly entityId: string, public readonly name: string, private store: AttributeStore) {}

  /** AttributeDictionary#length */
  get length(): number { return this.store.keys(this.entityId, this.name).length; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  /** AttributeDictionary#each_pair / #each */
  each(fn: (key: string, value: AttrValue) => void): void {
    for (const k of this.store.keys(this.entityId, this.name)) fn(k, this.store.get(this.entityId, this.name, k) as AttrValue);
  }
  eachPair(fn: (key: string, value: AttrValue) => void): void { this.each(fn); }

  /** AttributeDictionary#keys / #values */
  keys(): string[] { return this.store.keys(this.entityId, this.name); }
  values(): AttrValue[] { return this.keys().map(k => this.get(k) as AttrValue); }

  /** AttributeDictionary#[] */
  get(key: string, fallback?: AttrValue): AttrValue | undefined {
    return this.store.get(this.entityId, this.name, key, fallback);
  }

  /** AttributeDictionary#[]= */
  set(key: string, value: AttrValue): void { this.store.set(this.entityId, this.name, key, value); }

  /** AttributeDictionary#delete_key */
  deleteKey(key: string): AttrValue | undefined {
    const v = this.get(key);
    this.store.delete(this.entityId, this.name, key);
    return v;
  }

  /** AttributeDictionary#include? */
  includes(key: string): boolean { return this.store.keys(this.entityId, this.name).indexOf(key) >= 0; }

  toHash(): { [k: string]: AttrValue } {
    const out: { [k: string]: AttrValue } = {};
    this.each((k, v) => { out[k] = v; });
    return out;
  }
}

/**
 * DraftDown.AttributeDictionaries — collection of dictionaries on a single entity.
 */
export class AttributeDictionaries {
  constructor(public readonly entityId: string, private store: AttributeStore) {}

  get length(): number { return this.store.dictionaryNames(this.entityId).length; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  /** AttributeDictionaries#each */
  each(fn: (dict: AttributeDictionary) => void): void {
    for (const name of this.store.dictionaryNames(this.entityId)) fn(new AttributeDictionary(this.entityId, name, this.store));
  }

  /** AttributeDictionaries#[] — returns an existing dictionary, or undefined. */
  at(name: string): AttributeDictionary | undefined {
    if (this.store.dictionaryNames(this.entityId).indexOf(name) < 0) return undefined;
    return new AttributeDictionary(this.entityId, name, this.store);
  }

  /** AttributeDictionaries#delete(name) */
  delete(name: string): boolean { return this.store.deleteDict(this.entityId, name); }

  toArray(): AttributeDictionary[] {
    return this.store.dictionaryNames(this.entityId).map(n => new AttributeDictionary(this.entityId, n, this.store));
  }
}
