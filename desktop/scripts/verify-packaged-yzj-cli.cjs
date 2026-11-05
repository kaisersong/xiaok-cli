// Native executable must be outside asar; no install/download is allowed at app startup.
const { openSync, readSync, closeSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function binaryTarget(file) {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(64);
    if (readSync(fd, header, 0, 64, 0) < 8) return 'unknown';
    if (header.readUInt32LE(0) === 0xfeedfacf) {
      return `darwin-${({ 0x01000007: 'x64', 0x0100000c: 'arm64' })[header.readUInt32LE(4)] ?? 'unknown'}`;
    }
    if (header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && header[5] === 1) {
      return `linux-${({ 62: 'x64', 183: 'arm64' })[header.readUInt16LE(18)] ?? 'unknown'}`;
    }
    if (header.toString('ascii', 0, 2) === 'MZ') {
      const pe = Buffer.alloc(6);
      if (readSync(fd, pe, 0, 6, header.readUInt32LE(60)) === 6 && pe.toString('ascii', 0, 4) === 'PE\0\0') {
        return `win32-${({ 0x8664: 'x64', 0xaa64: 'arm64' })[pe.readUInt16LE(4)] ?? 'unknown'}`;
      }
    }
    return 'unknown';
  } finally { closeSync(fd); }
}

function verifyPackagedYzjCli({ packageRoot, platform, arch, run = spawnSync }) {
  if (!existsSync(join(packageRoot, 'scripts', 'install.js'))) throw new Error('missing packaged yzj-cli installer');
  const binaryPath = join(packageRoot, 'bin', platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli');
  if (!existsSync(binaryPath)) throw new Error(`missing packaged yzj-cli binary: ${binaryPath}; run npm rebuild @yunzhijia/cli before packaging`);
  const target = `${platform}-${arch}`;
  if (binaryTarget(binaryPath) !== target) throw new Error(`packaged yzj-cli target mismatch: expected ${target}`);
  const { version } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const runtimeVerified = platform === process.platform && arch === process.arch;
  if (runtimeVerified) {
    const result = run(binaryPath, ['--version'], { shell: false, encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.error || result.status !== 0 || result.stdout?.trim() !== `yzj-cli ${version}`) {
      throw new Error(`packaged yzj-cli version verification failed: ${result.error?.message ?? result.stderr ?? result.stdout ?? result.status}`);
    }
  }
  return { target, version, runtimeVerified };
}

module.exports = async function afterPack(context) {
  const { Arch } = require('electron-builder');
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  if (!existsSync(join(resources, 'yzj-cli', 'runner.cjs'))) throw new Error('missing packaged yzj-cli runner');
  const result = verifyPackagedYzjCli({
    packageRoot: join(resources, 'app.asar.unpacked', 'node_modules', '@yunzhijia', 'cli'),
    platform: context.electronPlatformName, arch: Arch[context.arch],
  });
  process.stdout.write(`packaged yzj-cli ${result.version} ${result.target}: ${result.runtimeVerified ? 'native smoke passed' : 'cross-build target checked; native smoke unverified'}\n`);
};
module.exports.verifyPackagedYzjCli = verifyPackagedYzjCli;
