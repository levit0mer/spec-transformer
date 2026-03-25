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

import { AsyncTransformer } from './Transformer';
import { Key, Value } from '../model/Types';
import { RefResolver } from '../io/resolver/RefResolver';
import { ResolverOptions } from '../io/resolver/types';

/**
 * Resolves external $ref references (URLs) and bundles them into a self-contained spec.
 *
 * External references pointing to http/https URLs are fetched, parsed, and inlined
 * into the spec's `components` section. The original `$ref` is updated to point to
 * the local component path.
 *
 * This transformer implements AsyncTransformer since it needs to perform HTTP requests.
 * Use TransformerChain.transformRecordAsync() when including this transformer.
 */
export class ExternalRefResolverTransformer implements AsyncTransformer {
  private resolver: RefResolver;

  constructor(options?: ResolverOptions) {
    this.resolver = new RefResolver(options);
  }

  async transformAsync(specs: Record<Key, Value>): Promise<Record<Key, Value>> {
    return this.resolver.resolve(specs);
  }
}
