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
import { load } from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

// NOTE: No fetch mock — these tests use real HTTP to verify end-to-end resolution

describe('RefResolver integration', () => {
  it('should resolve external refs from multi-file spec fixture', async () => {
    const fixturePath = path.join(__dirname, '..', '..', 'fixtures', 'remote-refs', 'multi-file-spec.yaml');
    const yaml = fs.readFileSync(fixturePath, 'utf-8');
    const spec = load(yaml) as Record<string, any>;

    const resolver = new RefResolver({ timeout: 15000 });
    const result = await resolver.resolve(spec);

    // External refs should be resolved to local component refs
    expect(result.components).toBeDefined();
    expect(result.components.parameters).toBeDefined();
    expect(result.components.parameters['X-Request-Id']).toBeDefined();
    expect(result.components.parameters['X-Request-Id'].name).toBe('X-Request-Id');
    expect(result.components.parameters['X-Request-Id'].in).toBe('header');

    expect(result.components.parameters['X-Correlation-Id']).toBeDefined();

    expect(result.components.schemas).toBeDefined();
    expect(result.components.schemas['BookingList']).toBeDefined();
    expect(result.components.schemas['Booking']).toBeDefined();

    // Verify local refs replaced external ones
    const orderParams = result.paths['/orders'].get.parameters;
    expect(orderParams[0].$ref).toBe('#/components/parameters/X-Request-Id');
    expect(orderParams[1].$ref).toBe('#/components/parameters/X-Correlation-Id');
  }, 30000);

  it('should resolve and bundle a self-contained spec', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Integration Test', version: '1.0.0' },
      paths: {
        '/vehicles': {
          get: {
            parameters: [
              { $ref: 'https://api-schemas.playmobility.dev/common/v2/headers.yaml#/components/parameters/X-Request-Id' },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: 'https://api-schemas.playmobility.dev/fleet/v1/schemas.yaml#/components/schemas/VehicleList' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const resolver = new RefResolver({ timeout: 15000 });
    const result = await resolver.resolve(spec);

    // Headers should be resolved
    expect(result.components.parameters['X-Request-Id']).toBeDefined();

    // Fleet schemas should be resolved
    expect(result.components.schemas['VehicleList']).toBeDefined();
    expect(result.components.schemas['VehicleList'].properties.items).toBeDefined();
  }, 30000);
});
