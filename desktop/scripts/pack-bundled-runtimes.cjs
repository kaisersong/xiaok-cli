#!/usr/bin/env node
/**
 * pack-bundled-runtimes.cjs — electron-builder afterPack step that ships exactly
 * one self-contained interpreter closure per platform target and verifies it.
 *
 * Why afterPack instead of extraResources: the closures are per-target and large
 * (mac arm64 ≈ 190 MB total, win x64 ≈ 150 MB). A static extraResources filter
 * would ship every target into every installer. Here we know
 * electronPlatformName + arch, so we copy only the matching target and then
 * fail the build if its manifest digest does not re-verify.
 *
 * Standalone use (release checklist):
 *   node scripts/pack-bundled-runtimes.cjs --resources <app>/Contents/Resources --target darwin-arm64
 */

const { cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNTIMES = [
  { plugin: 'kai-slide-creator', destDir: 'bundled-python', runtimeKey: 'slide-python' },
  { plugin: 'kai-report-creator', destDir: 'bundled-node', runtimeKey: 'report-node' },
];

function pluginsRepoRoot(projectDir) {
  const candidates = [
    join(projectDir, '..', '..', 'kai-xiaok-plugins'),
    join(projectDir, '..', 'kai-xiaok-plugins'),
  ];
  for (const c of candidates) {
    if (existsSync(join(resolve(c), 'runtime-lock.json'))) return resolve(c);
  }
  throw new Error(`kai-xiaok-plugins repo not found from ${projectDir} (looked for runtime-lock.json)`);
}

function targetKeyFromContext(context) {
  const { Arch } = require('electron-builder');
  const arch = Arch[context.arch];
  const platform = context.electronPlatformName === 'darwin' ? 'darwin'
    : context.electronPlatformName === 'win32' ? 'win32'
      : context.electronPlatformName;
  return `${platform}-${arch}`;
}

function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return join(context.appOutDir, 'resources');
}

function verifyWithSingleSourceOfTruth(repoRoot, runtimeKey, targetKey, root) {
  const r = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'vendor-runtimes.mjs'), '--verify', '--runtime', runtimeKey, '--target', targetKey, '--root', root],
    { encoding: 'utf8', cwd: repoRoot },
  );
  if (r.status !== 0) {
    throw new Error(`runtime verification failed for ${runtimeKey}/${targetKey}:\n${(r.stderr || r.stdout || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

function shipBundledRuntimes({ repoRoot, resources, targetKey }) {
  const results = [];
  for (const { plugin, destDir, runtimeKey } of RUNTIMES) {
    const src = join(repoRoot, 'plugins', plugin, destDir, targetKey);
    if (!existsSync(src)) {
      throw new Error(
        `missing self-contained runtime for ${runtimeKey}/${targetKey}: ${src}\n`
        + `  run: (cd ${repoRoot} && node scripts/vendor-runtimes.mjs --runtime ${runtimeKey} --target ${targetKey})`,
      );
    }
    const dest = join(resources, 'bundled-plugins', plugin, destDir, targetKey);
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
    const other = readdirSync(join(resources, 'bundled-plugins', plugin, destDir)).filter((n) => n !== targetKey);
    if (other.length) throw new Error(`unexpected extra runtime targets packaged for ${plugin}: ${other.join(', ')}`);
    results.push(verifyWithSingleSourceOfTruth(repoRoot, runtimeKey, targetKey, dest));
  }
  return results;
}

async function afterPack(context) {
  const repoRoot = pluginsRepoRoot(context.packager.projectDir);
  const targetKey = targetKeyFromContext(context);
  const resources = resourcesDir(context);
  for (const line of shipBundledRuntimes({ repoRoot, resources, targetKey })) {
    process.stdout.write(`bundled runtime ${line}\n`);
  }
}

function readOption(args, name) {
  const i = args.indexOf(name);
  if (i === -1 || !args[i + 1]) throw new Error(`missing required option: ${name}`);
  return args[i + 1];
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const resources = resolve(readOption(args, '--resources'));
    const targetKey = readOption(args, '--target');
    const repoRoot = pluginsRepoRoot(resolve(__dirname, '..'));
    for (const line of shipBundledRuntimes({ repoRoot, resources, targetKey })) {
      process.stdout.write(`bundled runtime ${line}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = afterPack;
module.exports.shipBundledRuntimes = shipBundledRuntimes;
