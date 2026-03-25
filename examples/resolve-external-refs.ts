/**
 * Example: Resolve external $ref references into a self-contained spec.
 *
 * This demonstrates the ExternalRefResolverTransformer by reading a spec
 * with external $ref URLs, resolving them, and writing the bundled output.
 *
 * Usage:
 *   npm run example:resolve
 *   npm run example:resolve -- --input path/to/spec.yaml
 */

import { load, dump } from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { ExternalRefResolverTransformer } from '../src/transformer/ExternalRefResolverTransformer';
import { HeaderRemovalTransformer } from '../src/transformer/HeaderRemovalTransformer';
import { ComponentPruningTransformer } from '../src/transformer/ComponentPruningTransformer';
import { TransformerChain } from '../src/facade/TransformerChain';

async function main() {
  const inputArg = process.argv.indexOf('--input');
  const inputPath = inputArg !== -1 && process.argv[inputArg + 1]
    ? process.argv[inputArg + 1]
    : path.join(__dirname, '..', 'test', 'fixtures', 'remote-refs', 'multi-file-spec.yaml');

  console.log(`Reading spec from: ${inputPath}`);
  const yaml = fs.readFileSync(inputPath, 'utf-8');
  const spec = load(yaml) as Record<string, any>;

  const externalRefCount = JSON.stringify(spec).match(/https?:\/\//g)?.length ?? 0;
  console.log(`Found ${externalRefCount} external reference(s) to resolve\n`);

  // Build a chain: resolve external refs -> remove internal headers -> prune orphans
  const chain = new TransformerChain([
    new ExternalRefResolverTransformer({ timeout: 15000 }),
    new HeaderRemovalTransformer(['x-internal-trace-id', 'x-internal-auth']),
    new ComponentPruningTransformer(),
  ]);

  console.log('Running transformer chain:');
  console.log('  1. ExternalRefResolverTransformer (resolving remote $ref URLs)');
  console.log('  2. HeaderRemovalTransformer (removing internal headers)');
  console.log('  3. ComponentPruningTransformer (removing orphaned components)\n');

  const result = await chain.transformRecordAsync(spec);

  const outputPath = inputPath.replace(/\.(ya?ml|json)$/i, '.bundled.yaml');
  const output = dump(result, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(outputPath, output, 'utf-8');

  const remainingExternal = JSON.stringify(result).match(/https?:\/\//g)?.length ?? 0;
  const componentSections = Object.keys(result.components ?? {});

  console.log('Done!');
  console.log(`  External refs remaining: ${remainingExternal}`);
  console.log(`  Components bundled: ${componentSections.join(', ')}`);
  console.log(`  Output written to: ${outputPath}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
