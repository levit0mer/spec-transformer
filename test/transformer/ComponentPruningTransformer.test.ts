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

import { ComponentPruningTransformer } from '../../src/transformer/ComponentPruningTransformer';

describe('ComponentPruningTransformer', () => {
  it('should remove unreferenced component parameters', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            parameters: [{ $ref: '#/components/parameters/UsedParam' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        parameters: {
          UsedParam: { in: 'query', name: 'used', schema: { type: 'string' } },
          OrphanedParam: { in: 'header', name: 'orphaned', schema: { type: 'string' } },
        },
      },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result.components.parameters.UsedParam).toBeDefined();
    expect(result.components.parameters.OrphanedParam).toBeUndefined();
  });

  it('should remove unreferenced component schemas', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/UsedSchema' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          UsedSchema: { type: 'object', properties: { id: { type: 'string' } } },
          OrphanedSchema: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result.components.schemas.UsedSchema).toBeDefined();
    expect(result.components.schemas.OrphanedSchema).toBeUndefined();
  });

  it('should keep components referenced by other components', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Parent' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Parent: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Child' },
            },
          },
          Child: { type: 'object', properties: { name: { type: 'string' } } },
          Orphan: { type: 'object', properties: { unused: { type: 'string' } } },
        },
      },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result.components.schemas.Parent).toBeDefined();
    expect(result.components.schemas.Child).toBeDefined();
    expect(result.components.schemas.Orphan).toBeUndefined();
  });

  it('should preserve components matching preserve patterns', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          InternalModel: { type: 'object' },
          PublicModel: { type: 'object' },
        },
      },
    };

    const transformer = new ComponentPruningTransformer({ preserve: ['^Public'] });
    const result = transformer.transform(specs);

    expect(result.components.schemas.PublicModel).toBeDefined();
    expect(result.components.schemas.InternalModel).toBeUndefined();
  });

  it('should handle specs with no components', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: { '/test': { get: { responses: { '200': { description: 'OK' } } } } },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result).toEqual(specs);
  });

  it('should remove entire component section if all definitions are pruned', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': { get: { responses: { '200': { description: 'OK' } } } },
      },
      components: {
        parameters: {
          Orphan1: { in: 'header', name: 'orphan1', schema: { type: 'string' } },
          Orphan2: { in: 'query', name: 'orphan2', schema: { type: 'string' } },
        },
        schemas: {
          UsedSchema: { type: 'object' },
        },
      },
    };

    // No $ref to any parameter, but also no $ref to UsedSchema — all orphaned
    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result.components.parameters).toBeUndefined();
    expect(result.components.schemas).toBeUndefined();
  });

  it('should handle $ref in arrays', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: '#/components/parameters/Param1' },
              { $ref: '#/components/parameters/Param2' },
            ],
          },
        },
      },
      components: {
        parameters: {
          Param1: { in: 'query', name: 'p1', schema: { type: 'string' } },
          Param2: { in: 'query', name: 'p2', schema: { type: 'string' } },
          Param3: { in: 'query', name: 'p3', schema: { type: 'string' } },
        },
      },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(Object.keys(result.components.parameters)).toEqual(['Param1', 'Param2']);
  });

  it('should handle deeply nested $ref references', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/DeepRef' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          DeepRef: { type: 'object', properties: { id: { type: 'string' } } },
          Unused: { type: 'object' },
        },
      },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result.components.schemas.DeepRef).toBeDefined();
    expect(result.components.schemas.Unused).toBeUndefined();
  });

  it('should handle response $ref', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            responses: {
              '404': { $ref: '#/components/responses/NotFound' },
            },
          },
        },
      },
      components: {
        responses: {
          NotFound: { description: 'Not Found' },
          ServerError: { description: 'Server Error' },
        },
      },
    };

    const transformer = new ComponentPruningTransformer();
    const result = transformer.transform(specs);

    expect(result.components.responses.NotFound).toBeDefined();
    expect(result.components.responses.ServerError).toBeUndefined();
  });

  it('should work with ComponentPruningTransformer after HeaderRemovalTransformer', () => {
    const { HeaderRemovalTransformer } = require('../../src/transformer/HeaderRemovalTransformer');

    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            parameters: [
              { $ref: '#/components/parameters/AcceptHeader' },
              { $ref: '#/components/parameters/LimitParam' },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Result' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        parameters: {
          AcceptHeader: { in: 'header', name: 'accept', schema: { type: 'string' } },
          LimitParam: { in: 'query', name: 'limit', schema: { type: 'integer' } },
        },
        schemas: {
          Result: { type: 'object', properties: { data: { type: 'string' } } },
        },
      },
    };

    // First remove headers, then prune orphaned components
    const headerRemoval = new HeaderRemovalTransformer(['accept']);
    const pruner = new ComponentPruningTransformer();

    const afterHeaderRemoval = headerRemoval.transform(specs);
    const result = pruner.transform(afterHeaderRemoval);

    // AcceptHeader $ref was removed from paths by HeaderRemovalTransformer
    // ComponentPruningTransformer should detect it's no longer referenced and remove it
    expect(result.components.parameters.LimitParam).toBeDefined();
    expect(result.components.parameters.AcceptHeader).toBeUndefined();
    expect(result.components.schemas.Result).toBeDefined();
  });

  it('should handle multiple preserve patterns', () => {
    const specs = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          ErrorResponse: { type: 'object' },
          ErrorDetail: { type: 'object' },
          UserModel: { type: 'object' },
          InternalModel: { type: 'object' },
        },
      },
    };

    const transformer = new ComponentPruningTransformer({
      preserve: ['^Error', 'Model$'],
    });
    const result = transformer.transform(specs);

    expect(result.components.schemas.ErrorResponse).toBeDefined();
    expect(result.components.schemas.ErrorDetail).toBeDefined();
    expect(result.components.schemas.UserModel).toBeDefined();
    expect(result.components.schemas.InternalModel).toBeDefined();
  });
});
