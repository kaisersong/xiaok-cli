#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { extractFile } = require('@electron/asar');

const PACKAGED_MAIN_PATH = 'dist/main/desktop/electron/kb-tools.js';
const DIST_MAIN_PATH = join('main', 'desktop', 'electron', 'kb-tools.js');

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function verifyPackagedMainFreshness({ asarPath, distRoot }) {
  const resolvedAsar = resolve(asarPath);
  const resolvedDistFile = resolve(distRoot, DIST_MAIN_PATH);
  if (!existsSync(resolvedAsar)) throw new Error(`missing app.asar: ${resolvedAsar}`);
  if (!existsSync(resolvedDistFile)) throw new Error(`missing current main build: ${resolvedDistFile}`);

  const packaged = extractFile(resolvedAsar, PACKAGED_MAIN_PATH);
  const current = readFileSync(resolvedDistFile);
  const packagedHash = sha256(packaged);
  const currentHash = sha256(current);
  if (!packaged.equals(current)) {
    throw new Error(
      `stale packaged main: ${PACKAGED_MAIN_PATH} differs from current dist `
      + `(packaged=${packagedHash}, current=${currentHash})`,
    );
  }
  return { packagedHash, currentHash, asarPath: resolvedAsar, distFile: resolvedDistFile };
}

function packagedAsarPath(context) {
  if (context.electronPlatformName === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
      'app.asar',
    );
  }
  return join(context.appOutDir, 'resources', 'app.asar');
}

async function afterPack(context) {
  const result = verifyPackagedMainFreshness({
    asarPath: packagedAsarPath(context),
    distRoot: join(context.packager.projectDir, 'dist'),
  });
  process.stdout.write(`packaged main is fresh: ${result.packagedHash}\n`);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`missing required option: ${name}`);
  return args[index + 1];
}

if (require.main === module) {
  try {
    const result = verifyPackagedMainFreshness({
      asarPath: readOption(process.argv.slice(2), '--asar'),
      distRoot: readOption(process.argv.slice(2), '--dist-root'),
    });
    process.stdout.write(`packaged main is fresh: ${result.packagedHash}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = afterPack;
module.exports.verifyPackagedMainFreshness = verifyPackagedMainFreshness;
