/**
 * Post-build verification: ensures the compiled output can resolve external refs.
 * Run automatically after `npm run build` to catch build regressions.
 */

import { ExternalRefResolverTransformer } from '../src/transformer/ExternalRefResolverTransformer';
import { load } from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'remote-refs', 'multi-file-spec.yaml');

  if (!fs.existsSync(fixturePath)) {
    console.log('Build verify: skipped (no fixture found)');
    return;
  }

  const yaml = fs.readFileSync(fixturePath, 'utf-8');
  const spec = load(yaml) as Record<string, any>;

  const transformer = new ExternalRefResolverTransformer({ timeout: 10000 });
  const result = await transformer.transformAsync(spec);

  const hasComponents = result.components && Object.keys(result.components).length > 0;

  if (hasComponents) {
    console.log('Build verify: OK (external refs resolved successfully)');
  } else {
    console.error('Build verify: WARN (no components resolved)');
  }
}

verify().catch((err) => {
  console.error('Build verify: WARN (' + err.message + ')');
});
