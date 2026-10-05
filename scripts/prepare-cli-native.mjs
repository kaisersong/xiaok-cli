import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-cli-pty.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// npm treats bundled modules as already installed and skips their lifecycle.
// The published CLI bundles source, so its install hook owns this optional build.
if (manifest.bundleDependencies?.includes('nodejieba')) {
  try {
    const moduleDir = dirname(require.resolve('nodejieba'));
    try {
      require(join(moduleDir, 'build', 'Release', 'nodejieba.node'));
    } catch {
      const local = createRequire(join(moduleDir, 'package.json'));
      const installer = local.resolve('@mapbox/node-pre-gyp/bin/node-pre-gyp');
      const result = spawnSync(process.execPath, [installer, 'install', '--fallback-to-build'], {
        cwd: moduleDir, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`nodejieba installer exited ${result.status ?? result.signal}`);
      require(join(moduleDir, 'build', 'Release', 'nodejieba.node'));
    }
  } catch (error) {
    console.warn(`[xiaok] Optional Chinese segmentation unavailable: ${error.message}`);
  }
}
