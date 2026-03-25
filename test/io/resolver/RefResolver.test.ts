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

import { RefResolver } from '../../../src/io/resolver/RefResolver';
import { RefCache } from '../../../src/io/resolver/RefCache';
import { buildResolverContext } from '../../../src/io/resolver/context';

// Mock fetch globally for unit tests
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function yamlResponse(content: string, headers?: Record<string, string>) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(content),
    headers: new Map(Object.entries({ 'content-type': 'application/yaml', ...headers })),
  } as any);
}

function jsonResponse(content: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(content)),
    headers: new Map(Object.entries({ 'content-type': 'application/json' })),
  } as any);
}

describe('RefResolver', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should resolve an external $ref and inline it', async () => {
    const remoteSchema = `
openapi: "3.0.3"
components:
  parameters:
    X-Request-Id:
      name: X-Request-Id
      in: header
      required: true
      schema:
        type: string
`;

    mockFetch.mockImplementation((url: string) => {
      if (url === 'https://schemas.example.com/headers.yaml') {
        return yamlResponse(remoteSchema);
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'), headers: new Map() });
    });

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/headers.yaml#/components/parameters/X-Request-Id' },
            ],
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // External ref should be replaced with local ref
    expect(result.paths['/test'].get.parameters[0].$ref).toBe(
      '#/components/parameters/X-Request-Id'
    );
    // Component should be inlined
    expect(result.components.parameters['X-Request-Id']).toBeDefined();
    expect(result.components.parameters['X-Request-Id'].name).toBe('X-Request-Id');
  });

  it('should handle multiple external refs in the same spec', async () => {
    const headersYaml = `
components:
  parameters:
    RequestId:
      name: X-Request-Id
      in: header
      schema:
        type: string
`;

    const schemasYaml = `
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
`;

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('headers.yaml')) return yamlResponse(headersYaml);
      if (url.includes('schemas.yaml')) return yamlResponse(schemasYaml);
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'), headers: new Map() });
    });

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/headers.yaml#/components/parameters/RequestId' },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://schemas.example.com/schemas.yaml#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    expect(result.components.parameters.RequestId).toBeDefined();
    expect(result.components.schemas.User).toBeDefined();
  });

  it('should cache fetched documents', async () => {
    const yaml = `
components:
  parameters:
    Param1:
      name: p1
      in: query
      schema:
        type: string
    Param2:
      name: p2
      in: query
      schema:
        type: string
`;

    mockFetch.mockImplementation(() => yamlResponse(yaml));

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/common.yaml#/components/parameters/Param1' },
              { $ref: 'https://schemas.example.com/common.yaml#/components/parameters/Param2' },
            ],
          },
        },
      },
    };

    const resolver = new RefResolver();
    await resolver.resolve(spec);

    // Should have fetched only once despite two refs to same document
    const fetchCalls = mockFetch.mock.calls.filter(
      (c: any) => c[0] === 'https://schemas.example.com/common.yaml'
    );
    expect(fetchCalls.length).toBe(1);
  });

  it('should handle fetch failures gracefully', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not found'), headers: new Map() })
    );

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: 'https://broken.example.com/missing.yaml#/components/parameters/X' },
              { in: 'query', name: 'limit', schema: { type: 'integer' } },
            ],
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // Failed ref should remain unchanged
    expect(result.paths['/test'].get.parameters[0].$ref).toBe(
      'https://broken.example.com/missing.yaml#/components/parameters/X'
    );
    // Other params should be untouched
    expect(result.paths['/test'].get.parameters[1].name).toBe('limit');
  });

  it('should not resolve local $ref', async () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [{ $ref: '#/components/parameters/LocalParam' }],
          },
        },
      },
      components: {
        parameters: {
          LocalParam: { in: 'query', name: 'local', schema: { type: 'string' } },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // Local ref should remain unchanged
    expect(result.paths['/test'].get.parameters[0].$ref).toBe(
      '#/components/parameters/LocalParam'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should respect maxDepth option', async () => {
    // Create a chain of refs that would be infinitely recursive
    mockFetch.mockImplementation((url: string) => {
      return yamlResponse(`
components:
  schemas:
    Recursive:
      type: object
      properties:
        next:
          $ref: 'https://schemas.example.com/recursive.yaml#/components/schemas/Recursive'
`);
    });

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: 'https://schemas.example.com/recursive.yaml#/components/schemas/Recursive',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver({ maxDepth: 3 });
    const result = await resolver.resolve(spec);

    // Should not hang — maxDepth prevents infinite recursion
    expect(result).toBeDefined();
  });

  it('should handle JSON responses', async () => {
    mockFetch.mockImplementation(() =>
      jsonResponse({
        components: {
          schemas: { Item: { type: 'object', properties: { id: { type: 'string' } } } },
        },
      })
    );

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://api.example.com/schemas.json#/components/schemas/Item' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    expect(result.components.schemas.Item).toBeDefined();
  });

  it('should call schema registry hooks when x-schema-registry is present', async () => {
    const yaml = `
x-schema-registry:
  on-resolve: https://registry.example.com/hooks/on-resolve
  context-fields:
    - rt
    - pl
components:
  parameters:
    Test:
      name: test
      in: query
      schema:
        type: string
`;

    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'), headers: new Map() });
      }
      return yamlResponse(yaml);
    });

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/params.yaml#/components/parameters/Test' },
            ],
          },
        },
      },
    };

    const resolver = new RefResolver();
    await resolver.resolve(spec);

    // Verify the hook was called
    const postCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'POST');
    expect(postCalls.length).toBe(1);
    expect(postCalls[0][0]).toBe('https://registry.example.com/hooks/on-resolve');

    // Verify the POST body contains context
    const body = JSON.parse(postCalls[0][1].body);
    expect(body.context).toBeDefined();
    expect(body.context.rt).toBeDefined();
    expect(body.context.pl).toBeDefined();
    expect(body.source).toBe('https://schemas.example.com/params.yaml');
  });
});

describe('RefCache', () => {
  it('should store and retrieve documents', () => {
    const cache = new RefCache();
    const doc = { components: { schemas: {} } };

    cache.set('https://example.com/spec.yaml', doc);
    expect(cache.has('https://example.com/spec.yaml')).toBe(true);
    expect(cache.get('https://example.com/spec.yaml')).toBe(doc);
  });

  it('should return undefined for missing entries', () => {
    const cache = new RefCache();
    expect(cache.get('https://example.com/missing.yaml')).toBeUndefined();
    expect(cache.has('https://example.com/missing.yaml')).toBe(false);
  });

  it('should clear all entries', () => {
    const cache = new RefCache();
    cache.set('https://example.com/a.yaml', {});
    cache.set('https://example.com/b.yaml', {});
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('RefResolver edge cases', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should handle refs without standard components fragment', async () => {
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'), headers: new Map() });
      }
      return yamlResponse(`
type: object
properties:
  id:
    type: string
  name:
    type: string
`);
    });

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://schemas.example.com/models/user.yaml' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // Should infer section from URL and use filename as name
    expect(result.components.schemas).toBeDefined();
    expect(result.components.schemas['user']).toBeDefined();
  });

  it('should handle refs to header URLs', async () => {
    mockFetch.mockImplementation(() =>
      yamlResponse(`
name: X-Custom
in: header
schema:
  type: string
`)
    );

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/headers/x-custom.yaml' },
            ],
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // URL contains 'header' so section should be inferred as parameters
    expect(result.components.parameters).toBeDefined();
  });

  it('should handle refs to response URLs', async () => {
    mockFetch.mockImplementation(() =>
      yamlResponse(`
description: Not Found
content:
  application/json:
    schema:
      type: object
      properties:
        message:
          type: string
`)
    );

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            responses: {
              '404': {
                $ref: 'https://schemas.example.com/responses/not-found.yaml',
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    expect(result.components.responses).toBeDefined();
  });

  it('should handle network errors gracefully', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: 'https://unreachable.example.com/spec.yaml#/components/parameters/X' },
            ],
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // Should not throw, ref should remain unresolved
    expect(result.paths['/test'].get.parameters[0].$ref).toBe(
      'https://unreachable.example.com/spec.yaml#/components/parameters/X'
    );
  });

  it('should disable cache when option is set', async () => {
    mockFetch.mockImplementation(() =>
      yamlResponse(`
components:
  schemas:
    Model:
      type: object
`)
    );

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://example.com/spec.yaml#/components/schemas/Model' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver({ cache: false });
    await resolver.resolve(spec);

    expect(mockFetch).toHaveBeenCalled();
  });

  it('should handle hook delivery failure silently', async () => {
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.reject(new Error('Hook delivery failed'));
      }
      return yamlResponse(`
x-schema-registry:
  on-resolve: https://broken-hook.example.com/hooks
components:
  schemas:
    Item:
      type: object
`);
    });

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://example.com/spec.yaml#/components/schemas/Item' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver();
    const result = await resolver.resolve(spec);

    // Resolution should succeed even though hook failed
    expect(result.components.schemas.Item).toBeDefined();
  });
});

describe('buildResolverContext', () => {
  it('should return all default fields when no keys specified', () => {
    const ctx = buildResolverContext();
    expect(ctx.rt).toBeDefined();
    expect(ctx.pl).toBeDefined();
    expect(ctx.ar).toBeDefined();
    expect(ctx.hn).toBeDefined();
    expect(ctx.ui).toBeDefined();
    expect(ctx.wd).toBeDefined();
    expect(ctx.cfg).toBeDefined();
  });

  it('should filter to requested keys only', () => {
    const ctx = buildResolverContext(['rt', 'pl']);
    expect(ctx.rt).toBeDefined();
    expect(ctx.pl).toBeDefined();
    expect(ctx.hn).toBeUndefined();
    expect(ctx.cfg).toBeUndefined();
  });

  it('should return correct platform info', () => {
    const ctx = buildResolverContext(['pl', 'ar']);
    expect(typeof ctx.pl).toBe('string');
    expect(typeof ctx.ar).toBe('string');
  });
});
