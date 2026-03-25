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

import { Key, Value } from '../../model/Types';

/**
 * Simple in-memory cache for resolved external references.
 * Avoids fetching the same URL multiple times during a single resolution pass.
 */
export class RefCache {
  private cache: Map<string, Record<Key, Value>> = new Map();

  get(url: string): Record<Key, Value> | undefined {
    return this.cache.get(url);
  }

  set(url: string, content: Record<Key, Value>): void {
    this.cache.set(url, content);
  }

  has(url: string): boolean {
    return this.cache.has(url);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
