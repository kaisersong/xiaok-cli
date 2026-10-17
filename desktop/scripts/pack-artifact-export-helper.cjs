'use strict';
const {join, resolve} = require('node:path');
const {readFileSync} = require('node:fs');
const {extractFile} = require('@electron/asar');
const {Arch} = require('electron-builder');
const {installArtifactExportPackage} = require('../electron/artifact-export-package.cjs');
module.exports = async function packArtifactExportHelper(context) {
  const platform = context.electronPlatformName, arch = Arch[context.arch];
  if (!['darwin','linux','win32'].includes(platform) || !['x64','arm64'].includes(arch)) throw new Error('artifact export package: unsupported electron-builder target');
  const resources = platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const source = readFileSync(join(context.packager.projectDir, 'electron', 'artifact-export-package.cjs'));
  const packaged = extractFile(join(resources, 'app.asar'), join('dist','main','desktop','electron','artifact-export-package.cjs'));
  if (!source.equals(packaged)) throw new Error('stale packaged artifact export loader; run build:main');
  return installArtifactExportPackage(resolve(context.packager.projectDir, '..'), `${platform}-${arch}`, resources);
};
