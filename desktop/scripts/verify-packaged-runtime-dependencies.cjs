#!/usr/bin/env node
// Check the final archive, then resolve/import with the packaged Electron.
// Development node_modules must never satisfy a packaged dependency probe.
const { spawnSync } = require('node:child_process');
const { realpathSync } = require('node:fs');
const { isBuiltin } = require('node:module');
const path = require('node:path');
const { extractFile, listPackage, statFile } = require('@electron/asar');
const ts = require('typescript');

const probe = `
  import path from 'node:path';
  import { fileURLToPath, pathToFileURL } from 'node:url';
  const { asarPath, specifiers } = JSON.parse(process.argv[1]);
  const base = pathToFileURL(path.join(asarPath, 'dist', 'main', '__runtime_probe__.mjs')).href;
  const roots = [asarPath, asarPath + '.unpacked'].map(p => path.join(p, 'node_modules'));
  for (const specifier of specifiers) {
    try {
      const resolved = import.meta.resolve(specifier, base);
      const file = fileURLToPath(resolved);
      if (!roots.some(root => {
        const relative = path.relative(root, file);
        return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      })) throw new Error('resolved outside packaged node_modules: ' + resolved);
      await import(resolved);
    } catch (error) {
      throw new Error('packaged runtime import failed: ' + specifier, { cause: error });
    }
  }
`;

function verifyPackagedRuntimeDependencies({ asarPath, electronPath, platform = process.platform }) {
  asarPath = realpathSync(path.resolve(asarPath));
  const pkg = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
  const specifiers = new Set();
  for (const entry of listPackage(asarPath)) {
    const file = entry.replaceAll('\\', '/').replace(/^\//, '');
    if (!file.startsWith('dist/main/') || !/\.(?:js|mjs|cjs)$/.test(file)) continue;
    const source = ts.createSourceFile(file, extractFile(asarPath, path.normalize(file)).toString('utf8'), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('.')) {
        // Static local imports are just as mandatory as npm dependencies.
        // A package can pass external import smoke while failing at startup
        // because an emitted application module was omitted from the archive.
        const local = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        try {
          const info = statFile(asarPath, path.normalize(local));
          if (info.files) throw new Error('module resolves to a directory');
        } catch (error) {
          throw new Error(`missing packaged local module: ${file}: ${specifier}`, { cause: error });
        }
        continue;
      }
      if (specifier === 'electron' || isBuiltin(specifier)) continue;
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (!pkg.dependencies?.[name]) throw new Error(`${name} is not a production dependency (${file}: ${specifier})`);
      specifiers.add(specifier);
    }
  }
  const sorted = [...specifiers].sort();
  // Cross-build hosts cannot execute the target Electron binary. Target CI
  // executes this same hook; do not claim a runtime smoke for a cross-build.
  const runtimeVerified = platform === process.platform;
  if (runtimeVerified && sorted.length) {
    const result = spawnSync(electronPath, [
      '--experimental-import-meta-resolve', '--input-type=module', '--eval', probe,
      JSON.stringify({ asarPath, specifiers: sorted }),
    ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(
      `packaged runtime verification failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  return { specifiers: sorted, runtimeVerified };
}

function packagedRuntimePaths(context) {
  const name = context.packager.appInfo.productFilename;
  const mac = context.electronPlatformName === 'darwin';
  return {
    asarPath: mac ? path.join(context.appOutDir, `${name}.app`, 'Contents', 'Resources', 'app.asar')
      : path.join(context.appOutDir, 'resources', 'app.asar'),
    electronPath: mac ? path.join(context.appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
      : path.join(context.appOutDir, `${name}${context.electronPlatformName === 'win32' ? '.exe' : ''}`),
  };
}

module.exports = async function afterPack(context) {
  const result = verifyPackagedRuntimeDependencies({ ...packagedRuntimePaths(context), platform: context.electronPlatformName });
  process.stdout.write(`packaged runtime dependencies: ${result.specifiers.length} imports; ${result.runtimeVerified ? 'Electron smoke passed' : 'declaration audit only; cross-build runtime unverified'}\n`);
};
module.exports.verifyPackagedRuntimeDependencies = verifyPackagedRuntimeDependencies;
module.exports.packagedRuntimePaths = packagedRuntimePaths;
