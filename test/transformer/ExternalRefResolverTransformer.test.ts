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

import { ExternalRefResolverTransformer } from '../../src/transformer/ExternalRefResolverTransformer';
import { TransformerChain } from '../../src/facade/TransformerChain';
import { HeaderRemovalTransformer } from '../../src/transformer/HeaderRemovalTransformer';
import { ComponentPruningTransformer } from '../../src/transformer/ComponentPruningTransformer';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function yamlResponse(content: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(content),
    headers: new Map(Object.entries({ 'content-type': 'application/yaml' })),
  } as any);
}

describe('ExternalRefResolverTransformer', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should resolve external refs via transformAsync', async () => {
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'), headers: new Map() });
      }
      return yamlResponse(`
x-schema-registry:
  on-resolve: https://registry.example.com/hooks/resolve
components:
  parameters:
    X-Request-Id:
      name: X-Request-Id
      in: header
      required: true
      schema:
        type: string
        format: uuid
`);
    });

    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/common/headers.yaml#/components/parameters/X-Request-Id' },
              { in: 'query', name: 'limit', schema: { type: 'integer' } },
            ],
          },
        },
      },
    };

    const transformer = new ExternalRefResolverTransformer();
    const result = await transformer.transformAsync(spec);

    expect(result.paths['/orders'].get.parameters[0].$ref).toBe(
      '#/components/parameters/X-Request-Id'
    );
    expect(result.components.parameters['X-Request-Id'].name).toBe('X-Request-Id');
    expect(result.paths['/orders'].get.parameters[1].name).toBe('limit');
  });

  it('should work in an async TransformerChain', async () => {
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'), headers: new Map() });
      }
      return yamlResponse(`
x-schema-registry:
  on-resolve: https://registry.example.com/hooks/resolve
components:
  parameters:
    InternalHeader:
      name: x-internal
      in: header
      schema:
        type: string
    PublicParam:
      name: limit
      in: query
      schema:
        type: integer
`);
    });

    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            parameters: [
              { $ref: 'https://schemas.example.com/params.yaml#/components/parameters/InternalHeader' },
              { $ref: 'https://schemas.example.com/params.yaml#/components/parameters/PublicParam' },
            ],
          },
        },
      },
    };

    // Chain: resolve external refs -> remove internal headers -> prune orphans
    const chain = new TransformerChain([
      new ExternalRefResolverTransformer(),
      new HeaderRemovalTransformer(['x-internal']),
      new ComponentPruningTransformer(),
    ]);

    const result = await chain.transformRecordAsync(spec);

    // Internal header should be removed
    expect(result.paths['/items'].get.parameters).not.toContainEqual(
      expect.objectContaining({ $ref: '#/components/parameters/InternalHeader' })
    );
    // Public param should remain
    expect(result.paths['/items'].get.parameters).toContainEqual(
      expect.objectContaining({ $ref: '#/components/parameters/PublicParam' })
    );
    // Orphaned internal header component should be pruned
    expect(result.components.parameters.InternalHeader).toBeUndefined();
    expect(result.components.parameters.PublicParam).toBeDefined();
  });

  it('should pass resolver options through', async () => {
    mockFetch.mockImplementation(() => yamlResponse(`
components:
  schemas:
    Model:
      type: object
`));

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://example.com/schemas.yaml#/components/schemas/Model' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformer = new ExternalRefResolverTransformer({
      timeout: 5000,
      headers: { 'Authorization': 'Bearer test' },
    });

    await transformer.transformAsync(spec);

    // Verify custom headers were passed to fetch
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/schemas.yaml',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization': 'Bearer test' }),
      })
    );
  });
});

describe('TransformerChain async support', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => yamlResponse(`
components:
  schemas:
    Item:
      type: object
      properties:
        id:
          type: string
`));
  });

  it('should handle mixed sync and async transformers', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            parameters: [
              { in: 'header', name: 'accept', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: 'https://example.com/schemas.yaml#/components/schemas/Item' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const chain = new TransformerChain([
      new HeaderRemovalTransformer(['accept']),
      new ExternalRefResolverTransformer(),
    ]);

    const result = await chain.transformRecordAsync(spec);

    // Headers should be removed (sync transformer ran first)
    expect(result.paths['/items'].get.parameters).toEqual([]);
    // External ref should be resolved (async transformer ran second)
    expect(result.components.schemas.Item).toBeDefined();
  });

  it('should still support sync-only transformRecord', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            parameters: [{ in: 'header', name: 'accept', schema: { type: 'string' } }],
          },
        },
      },
    };

    const chain = new TransformerChain([new HeaderRemovalTransformer(['accept'])]);
    const result = chain.transformRecord(spec);

    expect(result.paths['/test'].get.parameters).toEqual([]);
  });
});
