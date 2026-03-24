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

import { SpecDiffReporter } from '../../src/diff/SpecDiffReporter';

describe('SpecDiffReporter', () => {
  const reporter = new SpecDiffReporter();

  it('should report no changes for identical specs', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: { '/test': { get: { responses: { '200': { description: 'OK' } } } } },
    };

    const report = reporter.diff(spec, spec);

    expect(report.summary.total).toBe(0);
    expect(report.changes).toEqual([]);
  });

  it('should detect added paths', () => {
    const before = {
      openapi: '3.0.0',
      paths: { '/existing': { get: {} } },
    };
    const after = {
      openapi: '3.0.0',
      paths: { '/existing': { get: {} }, '/new': { post: {} } },
    };

    const report = reporter.diff(before, after);

    expect(report.summary.added).toBe(1);
    const added = report.changes.find((c) => c.path === 'paths./new');
    expect(added).toBeDefined();
    expect(added!.type).toBe('added');
  });

  it('should detect removed paths', () => {
    const before = {
      openapi: '3.0.0',
      paths: { '/keep': { get: {} }, '/remove': { delete: {} } },
    };
    const after = {
      openapi: '3.0.0',
      paths: { '/keep': { get: {} } },
    };

    const report = reporter.diff(before, after);

    expect(report.summary.removed).toBe(1);
    const removed = report.changes.find((c) => c.path === 'paths./remove');
    expect(removed).toBeDefined();
    expect(removed!.type).toBe('removed');
  });

  it('should detect modified values', () => {
    const before = { openapi: '3.0.0', info: { title: 'Before', version: '1.0.0' } };
    const after = { openapi: '3.0.0', info: { title: 'After', version: '1.0.0' } };

    const report = reporter.diff(before, after);

    expect(report.summary.modified).toBe(1);
    const modified = report.changes.find((c) => c.path === 'info.title');
    expect(modified).toBeDefined();
    expect(modified!.before).toBe('Before');
    expect(modified!.after).toBe('After');
  });

  it('should detect changes in arrays', () => {
    const before = {
      paths: {
        '/test': {
          get: {
            parameters: [
              { name: 'a', in: 'query' },
              { name: 'b', in: 'query' },
            ],
          },
        },
      },
    };
    const after = {
      paths: {
        '/test': {
          get: {
            parameters: [{ name: 'a', in: 'query' }],
          },
        },
      },
    };

    const report = reporter.diff(before, after);

    expect(report.summary.removed).toBeGreaterThan(0);
  });

  it('should detect added array elements', () => {
    const before = { tags: [{ name: 'users' }] };
    const after = { tags: [{ name: 'users' }, { name: 'orders' }] };

    const report = reporter.diff(before, after);

    expect(report.summary.added).toBe(1);
    expect(report.changes[0].path).toBe('tags[1]');
  });

  it('should handle type changes', () => {
    const before = { info: { version: '1.0.0' } };
    const after = { info: { version: 2 } };

    const report = reporter.diff(before, after);

    expect(report.summary.modified).toBe(1);
    expect(report.changes[0].type).toBe('modified');
  });

  it('should handle null/undefined transitions', () => {
    const before = { info: { title: 'Test', description: null } };
    const after = { info: { title: 'Test', description: 'Added description' } };

    const report = reporter.diff(before, after);

    expect(report.changes.some((c) => c.type === 'added' && c.path === 'info.description')).toBe(true);
  });

  it('should handle removed becoming null', () => {
    const before = { info: { title: 'Test', description: 'Has description' } };
    const after = { info: { title: 'Test', description: null } };

    const report = reporter.diff(before, after);

    expect(report.changes.some((c) => c.type === 'removed' && c.path === 'info.description')).toBe(true);
  });

  it('should handle deeply nested changes', () => {
    const before = {
      components: {
        schemas: {
          User: {
            properties: {
              address: {
                properties: {
                  zip: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };
    const after = {
      components: {
        schemas: {
          User: {
            properties: {
              address: {
                properties: {
                  zip: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    };

    const report = reporter.diff(before, after);

    expect(report.summary.modified).toBe(1);
    expect(report.changes[0].path).toBe(
      'components.schemas.User.properties.address.properties.zip.type'
    );
  });

  it('should handle array to non-array change', () => {
    const before = { tags: ['a', 'b'] };
    const after = { tags: 'single' };

    const report = reporter.diff(before, after);

    expect(report.summary.modified).toBe(1);
  });

  describe('formatText', () => {
    it('should format a report as readable text', () => {
      const before = {
        openapi: '3.0.0',
        paths: { '/users': { get: {} }, '/removed': { delete: {} } },
      };
      const after = {
        openapi: '3.0.0',
        paths: { '/users': { get: {} }, '/added': { post: {} } },
      };

      const report = reporter.diff(before, after);
      const text = reporter.formatText(report);

      expect(text).toContain('Spec Diff:');
      expect(text).toContain('+ ');
      expect(text).toContain('- ');
    });

    it('should show zero changes cleanly', () => {
      const spec = { openapi: '3.0.0' };
      const report = reporter.diff(spec, spec);
      const text = reporter.formatText(report);

      expect(text).toContain('0 change(s)');
    });
  });

  it('should produce a complete real-world diff after header removal', () => {
    const { HeaderRemovalTransformer } = require('../../src/transformer/HeaderRemovalTransformer');

    const spec = {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            parameters: [
              { in: 'header', name: 'accept', schema: { type: 'string' } },
              { in: 'query', name: 'limit', schema: { type: 'integer' } },
            ],
          },
        },
      },
    };

    const transformer = new HeaderRemovalTransformer(['accept']);
    const transformed = transformer.transform(spec);

    const report = reporter.diff(spec, transformed);

    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.removed).toBeGreaterThan(0);
  });
});
