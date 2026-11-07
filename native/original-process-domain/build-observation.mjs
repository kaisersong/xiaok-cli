import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build-only artifact/header locations. Runtime has no selectable addon/path.
const args = process.argv.slice(2);
if (args.length !== 2 || process.platform !== 'darwin') {
  throw Error('OS_DOMAIN_BUILD_UNAVAILABLE');
}
const [headers, output] = args.map((value) => resolve(value));
if (!existsSync(resolve(headers, 'node_api.h')))
  throw Error('OS_DOMAIN_HEADERS_REQUIRED');
mkdirSync(dirname(output), { recursive: true });
const sdk = spawnSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' });
if (sdk.status !== 0) throw Error('OS_DOMAIN_MACOS_SDK_REQUIRED');
const built = spawnSync(
  'cc',
  [
    '-std=c11',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-DNODE_GYP_MODULE_NAME=original_process_domain',
    '-isysroot',
    sdk.stdout.trim(),
    '-I',
    headers,
    resolve(dirname(fileURLToPath(import.meta.url)), 'process_domain.c'),
    '-o',
    output,
  ],
  { encoding: 'utf8' },
);
if (built.status !== 0) {
  process.stderr.write(built.stderr || built.stdout);
  process.exitCode = built.status || 1;
}
