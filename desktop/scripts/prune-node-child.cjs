'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { packagedRuntimePaths } = require('./verify-packaged-runtime-dependencies.cjs');

// Include computed paths here when no literal reference reaches the entry.
const entries = Object.freeze({
  activityOwner: 'dist/main/src/runtime/conversation-activity/owner-entry.js',
  credentials: 'dist/main/src/utils/credential-worker.js',
  glob: 'dist/main/src/ai/tools/glob-worker.mjs',
  office: 'dist/main/desktop/electron/office-parser-worker.mjs',
  policy: 'dist/main/desktop/electron/node-child-package.cjs',
  yzjInstaller: 'node_modules/@yunzhijia/cli/scripts/install.js',
});

function readDirectory(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : [];
}

function installedPackages(app) {
  const packages = new Map();

  function visitPackage(directory) {
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest)) return;
    packages.set(directory, JSON.parse(fs.readFileSync(manifest, 'utf8')));
    visitModules(path.join(directory, 'node_modules'));
  }

  function visitModules(directory) {
    for (const entry of readDirectory(directory)) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const target = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of readDirectory(target)) {
          if (scoped.isDirectory()) visitPackage(path.join(target, scoped.name));
        }
      } else {
        visitPackage(target);
      }
    }
  }

  visitModules(path.join(app, 'node_modules'));
  return packages;
}

function packageName(specifier) {
  return /^((?:@[\w.-]+\/)?[\w-][\w.-]*)(?:\/|$)/.exec(specifier)?.[1];
}

function pruneNodeChildDependencies(app, entrypoints = Object.values(entries)) {
  app = path.resolve(app);
  const packages = installedPackages(app);
  const retained = new Set();
  const visited = new Set();

  function retainPackage(directory) {
    if (retained.has(directory)) return;
    retained.add(directory);
    const manifest = packages.get(directory);
    for (const dependency of Object.keys({
      ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies,
    })) {
      retainDependency(directory, dependency);
    }
  }

  function retainDependency(from, specifier) {
    const name = packageName(specifier);
    if (!name) return;
    for (let directory = from; ; directory = path.dirname(directory)) {
      const candidate = path.join(directory, 'node_modules', name);
      if (packages.has(candidate)) {
        retainPackage(candidate);
        return;
      }
      if (directory === app) return;
    }
  }

  function scan(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const relative = path.relative(app, file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Node child source is outside its app: ${relative}`);
    }
    // Executable arguments can point into a package without importing it.
    if (relative.startsWith('node_modules' + path.sep)) {
      const specifier = relative.split(path.sep).slice(1).join('/');
      const target = path.join(app, 'node_modules', packageName(specifier));
      if (!packages.has(target)) throw new Error(`Node child entry package missing: ${relative}`);
      retainPackage(target);
      return;
    }
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    function walk(node) {
      // Literal references also capture createRequire aliases and worker URLs.
      if (ts.isStringLiteralLike(node)) {
        const specifier = node.text;
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          const local = path.resolve(path.dirname(file), specifier);
          if (/\.[cm]?js$/.test(local) && fs.statSync(local, { throwIfNoEntry: false })?.isFile()) scan(local);
        } else {
          retainDependency(path.dirname(file), specifier);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }

  for (const entry of entrypoints) {
    const file = path.resolve(app, entry);
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Node child entry missing: ${entry}`);
    }
    scan(file);
  }

  const removed = [...packages.keys()].filter(directory => !retained.has(directory));
  for (const directory of removed) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }

  function removeSourceMaps(directory) {
    let count = 0;
    for (const item of readDirectory(directory)) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) count += removeSourceMaps(file);
      else if (item.isFile() && /\.(?:[cm]?[jt]sx?|css)\.map$/.test(item.name)) {
        fs.unlinkSync(file);
        count++;
      }
    }
    return count;
  }

  return { keptPackages: retained.size, removedPackages: removed.length, removedMaps: removeSourceMaps(path.join(app, 'node_modules')) };
}

module.exports = async context => {
  const resources = path.dirname(packagedRuntimePaths(context).asarPath);
  const result = pruneNodeChildDependencies(path.join(resources, 'node-child', 'app'));
  console.log('packaged Node child dependency size reduction:', JSON.stringify(result));
};
module.exports.entries = entries;
module.exports.pruneNodeChildDependencies = pruneNodeChildDependencies;
