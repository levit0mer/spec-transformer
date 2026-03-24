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

import { Key, Value } from '../model/Types';
import { DiffEntry, DiffReport } from './types';

/**
 * Compares two OpenAPI specs and produces a structured diff report.
 *
 * Useful in CI pipelines to review what a transformation chain actually changed:
 * added/removed paths, modified schemas, changed parameters, etc.
 */
export class SpecDiffReporter {
  diff(before: Record<Key, Value>, after: Record<Key, Value>): DiffReport {
    const changes: DiffEntry[] = [];
    this.compareObjects(before, after, '', changes);

    return {
      summary: {
        added: changes.filter((c) => c.type === 'added').length,
        removed: changes.filter((c) => c.type === 'removed').length,
        modified: changes.filter((c) => c.type === 'modified').length,
        total: changes.length,
      },
      changes,
    };
  }

  formatText(report: DiffReport): string {
    const lines: string[] = [];
    lines.push(`Spec Diff: ${report.summary.total} change(s)`);
    lines.push(`  + ${report.summary.added} added`);
    lines.push(`  - ${report.summary.removed} removed`);
    lines.push(`  ~ ${report.summary.modified} modified`);
    lines.push('');

    for (const change of report.changes) {
      const prefix = change.type === 'added' ? '+' : change.type === 'removed' ? '-' : '~';
      lines.push(`${prefix} ${change.path}`);
    }

    return lines.join('\n');
  }

  private compareObjects(
    before: unknown,
    after: unknown,
    path: string,
    changes: DiffEntry[]
  ): void {
    if (before === after) return;

    if (before === undefined || before === null) {
      if (after !== undefined && after !== null) {
        changes.push({ path: path || '/', type: 'added', after });
      }
      return;
    }

    if (after === undefined || after === null) {
      changes.push({ path: path || '/', type: 'removed', before });
      return;
    }

    if (typeof before !== typeof after) {
      changes.push({ path: path || '/', type: 'modified', before, after });
      return;
    }

    if (Array.isArray(before) || Array.isArray(after)) {
      if (!Array.isArray(before) || !Array.isArray(after)) {
        changes.push({ path, type: 'modified', before, after });
        return;
      }
      this.compareArrays(before, after, path, changes);
      return;
    }

    if (typeof before === 'object' && typeof after === 'object') {
      const beforeObj = before as Record<string, unknown>;
      const afterObj = after as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

      for (const key of allKeys) {
        const childPath = path ? `${path}.${key}` : key;
        if (!(key in beforeObj)) {
          changes.push({ path: childPath, type: 'added', after: afterObj[key] });
        } else if (!(key in afterObj)) {
          changes.push({ path: childPath, type: 'removed', before: beforeObj[key] });
        } else {
          this.compareObjects(beforeObj[key], afterObj[key], childPath, changes);
        }
      }
      return;
    }

    // Primitive comparison
    if (before !== after) {
      changes.push({ path: path || '/', type: 'modified', before, after });
    }
  }

  private compareArrays(
    before: unknown[],
    after: unknown[],
    path: string,
    changes: DiffEntry[]
  ): void {
    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= before.length) {
        changes.push({ path: childPath, type: 'added', after: after[i] });
      } else if (i >= after.length) {
        changes.push({ path: childPath, type: 'removed', before: before[i] });
      } else {
        this.compareObjects(before[i], after[i], childPath, changes);
      }
    }
  }
}
