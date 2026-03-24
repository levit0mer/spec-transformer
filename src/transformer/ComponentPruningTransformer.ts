/**
 * Copyright (C) 2023 Expedia, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Transformer from './Transformer';
import { Key, Value } from '../model/Types';

/**
 * Removes unused component definitions from the spec.
 *
 * After other transformers remove paths, parameters, or headers, the `components` section
 * may contain orphaned definitions that are no longer referenced by any `$ref`. This
 * transformer walks the spec, collects all `$ref` targets, and removes any component
 * definitions that are not referenced.
 */
export class ComponentPruningTransformer implements Transformer {
  private preservePatterns: RegExp[];

  constructor(options?: { preserve?: string[] }) {
    this.preservePatterns = (options?.preserve ?? []).map((p) => new RegExp(p));
  }

  transform(specs: Record<Key, Value>): Record<Key, Value> {
    if (!specs.components) return specs;

    const usedRefs = this.collectRefs(specs);
    const prunedComponents = this.pruneComponents(specs.components, usedRefs);

    return {
      ...specs,
      components: prunedComponents,
    };
  }

  private collectRefs(obj: unknown, refs: Set<string> = new Set()): Set<string> {
    if (obj === null || obj === undefined) return refs;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.collectRefs(item, refs);
      }
      return refs;
    }

    if (typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      if (typeof record['$ref'] === 'string') {
        refs.add(record['$ref']);
      }
      for (const value of Object.values(record)) {
        this.collectRefs(value, refs);
      }
    }

    return refs;
  }

  private pruneComponents(
    components: Record<Key, Value>,
    usedRefs: Set<string>
  ): Record<Key, Value> {
    const pruned: Record<Key, Value> = {};

    for (const [section, definitions] of Object.entries(components)) {
      if (!definitions || typeof definitions !== 'object') {
        pruned[section] = definitions;
        continue;
      }

      const kept: Record<Key, Value> = {};
      for (const [name, definition] of Object.entries(definitions)) {
        const refPath = `#/components/${section}/${name}`;
        if (usedRefs.has(refPath) || this.isPreserved(name)) {
          kept[name] = definition;
        }
      }

      if (Object.keys(kept).length > 0) {
        pruned[section] = kept;
      }
    }

    return pruned;
  }

  private isPreserved(name: string): boolean {
    return this.preservePatterns.some((pattern) => pattern.test(name));
  }
}
