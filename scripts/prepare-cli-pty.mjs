// node-pty 1.1.0 ships the macOS spawn-helper without executable mode in npm.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chmodSync, existsSync } from 'node:fs';
if (process.platform === 'darwin') {
  let root;
  try { root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json')); } catch { /* optional */ }
  if (root) {
    for (const relative of [['prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'], ['build', 'Release', 'spawn-helper']]) {
      const helper = join(root, ...relative);
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
}
