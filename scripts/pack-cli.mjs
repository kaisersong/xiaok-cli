import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { x as extractTar } from 'tar';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceIntegrity = 'sha512-TFiDYgEVmBgQwAr1sVj7err3Cn21qxMxTLA+LTEVqKcGqgwJuonJEW0g6oH2+7FhMKJfkWsvlj1SaTrWXe1Q9w==';
const installerVersion = '2.0.3';
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function findPackage(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    try { await stat(join(candidate, 'package.json')); return candidate; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Missing bundle dependency: ${name}`);
    dir = parent;
  }
}

async function assertSourceOnly(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (/\.(node|dll|exe|dylib)$/i.test(entry.name)) throw new Error(`Refusing native binary in source bundle: ${path}`);
    if (entry.isDirectory()) await assertSourceOnly(path);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in source bundle: ${path}`);
  }
}

function npm(npmCli, args, cwd) {
  if (!npmCli) throw new Error('Run through npm run pack:cli so npm_execpath is available.');
  return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

export async function bundleNativeSource({ root, stage, npmCli }) {
  const installer = await findPackage('@mapbox/node-pre-gyp', root);
  const installerPackage = await readJson(join(installer, 'package.json'));
  if (installerPackage.version !== installerVersion) throw new Error(`Installer expected ${installerVersion}, got ${installerPackage.version}`);
  await assertSourceOnly(installer);
  await mkdir(stage, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'xiaok-jieba-source-'));
  try {
    npm(npmCli, ['pack', 'nodejieba@3.5.8', '--ignore-scripts', '--prefer-offline', '--pack-destination', scratch], root);
    const archive = join(scratch, 'nodejieba-3.5.8.tgz');
    const bytes = await readFile(archive);
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== sourceIntegrity) throw new Error('nodejieba upstream source integrity mismatch');
    const destination = join(stage, 'node_modules', 'nodejieba');
    await mkdir(destination, { recursive: true });
    await extractTar({ file: archive, cwd: destination, strip: 1, strict: true });
    await assertSourceOnly(destination);
    const patched = await readJson(join(destination, 'package.json'));
    patched.dependencies['@mapbox/node-pre-gyp'] = installerVersion;
    // Only the CLI's lifecycle owns the source build, including on npm 11.
    delete patched.scripts.install;
    patched.gypfile = false;
    patched.scripts.rebuild = 'node-pre-gyp rebuild';
    await writeFile(join(destination, 'package.json'), `${JSON.stringify(patched, null, 2)}\n`);

    // Keep each dependency's own layout: different versions may share a name.
    const copyClosure = async (name, from, target) => {
      const source = await findPackage(name, from);
      const metadata = await readJson(join(source, 'package.json'));
      const out = join(target, 'node_modules', name);
      await assertSourceOnly(source);
      await cp(source, out, { recursive: true, filter: (path) => !path.slice(source.length).split(/[\\/]/).includes('node_modules') });
      for (const child of Object.keys(metadata.dependencies ?? {})) await copyClosure(child, source, out);
    };
    for (const name of Object.keys(patched.dependencies)) await copyClosure(name, root, destination);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function packCli({ output = root, npmCli = process.env.npm_execpath } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'xiaok-cli-pack-'));
  try {
    const manifest = await readJson(join(root, 'package.json'));
    for (const file of manifest.files) await cp(join(root, file), join(scratch, file), { recursive: true });
    for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE']) {
      try { await cp(join(root, file), join(scratch, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    // Development-only overrides do not govern an installed published package.
    delete manifest.overrides;
    delete manifest.devDependencies;
    manifest.scripts = { postinstall: manifest.scripts.postinstall };
    manifest.bundleDependencies = ['nodejieba'];
    await writeFile(join(scratch, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await bundleNativeSource({ root, stage: scratch, npmCli });
    await mkdir(resolve(output), { recursive: true });
    const result = JSON.parse(npm(npmCli, ['pack', '--ignore-scripts', '--json', '--pack-destination', resolve(output)], scratch));
    const entry = Array.isArray(result) ? result[0] : Object.values(result)[0];
    return join(resolve(output), entry.filename);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--prepack-check')) {
    console.error('Use npm run pack:cli -- --output <directory>, then publish its .tgz. Source overrides cannot fix consumer installations.');
    process.exitCode = 1;
  } else {
    const index = process.argv.indexOf('--output');
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'verification', 'copy-windows-absence.mjs'), 'cli', '--require-all'], { stdio: 'inherit' });
      console.log(await packCli({ output: index < 0 ? root : process.argv[index + 1] }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
