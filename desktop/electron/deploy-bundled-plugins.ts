/**
 * Deploy Bundled Plugins
 *
 * On app startup, copies bundled plugins from Resources to ~/.xiaok/plugins/
 * with version-aware upgrade logic. Also sets up Python venv for slide-renderer.
 */

import { app } from 'electron';
import { join, dirname } from 'node:path';
import { existsSync, cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { getConfigDir } from '../../src/utils/config.js';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { detectPythonCompatibilityTag, ensureSlideRendererPythonReady, isCompatibleSlideRendererWheelhouse } from './python-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const execFileAsync = promisify(execFile);

const BUNDLED_PLUGINS = ['kai-report-creator', 'kai-slide-creator', 'cua-computer-use', 'kai-canvas-creator'];

/** Semver-aware: returns true if a >= b */
function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true; // equal
}

/** Detect python3 command for current platform */
function detectPython(): string | null {
  const candidates = process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // not found, try next
    }
  }
  return null;
}

function resolveBundledPluginsDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'bundled-plugins')]
    : [
        // Built dev main: desktop/dist/main/desktop/electron -> ../../../../../../kai-xiaok-plugins/plugins
        join(__dirname, '..', '..', '..', '..', '..', '..', 'kai-xiaok-plugins', 'plugins'),
        // Source-tree dev fallback.
        join(__dirname, '..', '..', 'kai-xiaok-plugins', 'plugins'),
        // CWD fallbacks for launching from desktop/ or repo root.
        join(process.cwd(), '..', '..', 'kai-xiaok-plugins', 'plugins'),
        join(process.cwd(), '..', 'kai-xiaok-plugins', 'plugins'),
      ];

  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

export interface DeployResult {
  deployed: string[];
  pythonAvailable: boolean;
  venvReady: boolean;
  dependencyInstallMode?: string;
  bundledWheelsUsable?: boolean;
}

export interface ManagedPythonVenvOptions {
  pythonCmd: string;
  venvDir: string;
  venvPython: string;
  exec?: typeof execFileAsync;
}

export async function ensureManagedPythonVenv(options: ManagedPythonVenvOptions): Promise<boolean> {
  const exec = options.exec ?? execFileAsync;

  try {
    await exec(options.pythonCmd, ['-m', 'venv', options.venvDir], { timeout: 30_000 });
    return existsSync(options.venvPython);
  } catch {
    // Some Windows Python installs have a working global pip but a broken
    // ensurepip payload. Avoid bundling Python by creating the venv without pip
    // and then asking global pip to bootstrap pip into that venv.
  }

  try {
    await exec(options.pythonCmd, ['-m', 'venv', '--without-pip', options.venvDir], { timeout: 30_000 });
    if (!existsSync(options.venvPython)) return false;
    await exec(options.pythonCmd, [
      '-m', 'pip',
      '--python', options.venvPython,
      'install', 'pip',
      '--disable-pip-version-check',
    ], { timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

export function ensureReportRendererCssCompat(pluginDir: string): void {
  const distDir = join(pluginDir, 'mcp-servers', 'report-renderer', 'dist');
  const legacyCssDir = join(distDir, 'css');
  const themedCssDir = join(distDir, 'themes', 'css');

  if (!existsSync(themedCssDir) || existsSync(legacyCssDir)) {
    return;
  }

  mkdirSync(legacyCssDir, { recursive: true });
  cpSync(themedCssDir, legacyCssDir, { recursive: true });
}

export function ensureReportRendererDistCompat(pluginDir: string, bundledPluginDir: string): void {
  const bundledDistDir = join(bundledPluginDir, 'mcp-servers', 'report-renderer', 'dist');
  const installedDistDir = join(pluginDir, 'mcp-servers', 'report-renderer', 'dist');
  if (!existsSync(bundledDistDir)) return;

  const criticalFiles = [
    join(installedDistDir, 'server.bundle.js'),
    join(installedDistDir, 'renderer', 'html-builder.js'),
  ];
  if (criticalFiles.every(file => existsSync(file))) {
    return;
  }

  mkdirSync(dirname(installedDistDir), { recursive: true });
  rmSync(installedDistDir, { recursive: true, force: true });
  cpSync(bundledDistDir, installedDistDir, { recursive: true });
  ensureReportRendererCssCompat(pluginDir);
}

export function ensureSlideRendererWheelhouseCompat(
  pluginDir: string,
  bundledPluginDir: string,
  pythonTag?: string,
): void {
  const bundledWheelsDir = join(bundledPluginDir, 'bundled-wheels');
  if (!existsSync(bundledWheelsDir)) return;

  const bundledWheelNames = readdirSync(bundledWheelsDir);
  if (!isCompatibleSlideRendererWheelhouse(bundledWheelNames, process.platform, process.arch, pythonTag)) {
    return;
  }

  const installedWheelsDir = join(pluginDir, 'bundled-wheels');
  const installedWheelNames = existsSync(installedWheelsDir) ? readdirSync(installedWheelsDir) : [];
  const installedMatchesBundled = sortedWheelNames(installedWheelNames).join('\n')
    === sortedWheelNames(bundledWheelNames).join('\n');

  if (installedMatchesBundled) return;

  rmSync(installedWheelsDir, { recursive: true, force: true });
  cpSync(bundledWheelsDir, installedWheelsDir, { recursive: true });
}

function sortedWheelNames(wheelNames: string[]): string[] {
  return wheelNames
    .filter(name => name.toLowerCase().endsWith('.whl'))
    .map(name => name.toLowerCase())
    .sort();
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function backupExistingPlugin(pluginPath: string, pluginName: string): void {
  const backupRoot = getConfigDir('.symlink-backups');
  mkdirSync(backupRoot, { recursive: true });
  const backupPath = join(backupRoot, `${pluginName}-${Date.now()}`);
  renameSync(pluginPath, backupPath);
}

export async function deployBundledPlugins(): Promise<DeployResult> {
  const result: DeployResult = { deployed: [], pythonAvailable: false, venvReady: false };
  const pluginsDir = getConfigDir('plugins');
  mkdirSync(pluginsDir, { recursive: true });
  const slideWheelhouseCompatTargets: Array<{ dest: string; src: string }> = [];

  const bundledDir = resolveBundledPluginsDir();

  if (!bundledDir) return result;

  // 1. Copy plugin files (version-aware)
  for (const name of BUNDLED_PLUGINS) {
    const src = join(bundledDir, name);
    const dest = join(pluginsDir, name);
    if (!existsSync(src)) continue;

    const srcManifest = join(src, 'plugin.json');
    const destManifest = join(dest, 'plugin.json');
    if (isSymlink(dest)) {
      backupExistingPlugin(dest, name);
    }

    if (existsSync(destManifest)) {
      try {
        const srcVer = JSON.parse(readFileSync(srcManifest, 'utf8')).version || '0.0.0';
        const destMeta = JSON.parse(readFileSync(destManifest, 'utf8'));
        const destVer = destMeta.version || '0.0.0';
        // Skip if installed version >= bundled AND not managed by us
        if (semverGte(destVer, srcVer) && destMeta.source !== 'bundled') continue;
        if (semverGte(destVer, srcVer)) {
          if (name === 'kai-report-creator') {
            ensureReportRendererDistCompat(dest, src);
            ensureReportRendererCssCompat(dest);
          }
          if (name === 'kai-slide-creator') {
            slideWheelhouseCompatTargets.push({ dest, src });
          }
          continue;
        }
      } catch {
        // parse error, overwrite
      }
    }

    cpSync(src, dest, { recursive: true });
    if (name === 'kai-report-creator') {
      ensureReportRendererDistCompat(dest, src);
      ensureReportRendererCssCompat(dest);
    }
    if (name === 'kai-slide-creator') {
      slideWheelhouseCompatTargets.push({ dest, src });
    }
    // Mark as bundled-managed
    try {
      const manifest = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
      manifest.source = 'bundled';
      writeFileSync(join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2));
    } catch {
      // ignore
    }
    result.deployed.push(name);
  }

  // 2. Setup Python venv for slide-renderer.
  // Prefer an existing managed venv even when the launched app cannot see a
  // global Python on PATH; Explorer-launched Windows apps often inherit a
  // different PATH than the user's terminal.
  const pythonCmd = detectPython();
  const venvDir = getConfigDir(join('runtime', 'python-env'));
  const venvPython = process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python3');
  const hasManagedVenv = existsSync(venvPython);
  result.pythonAvailable = !!pythonCmd || hasManagedVenv;

  if (!hasManagedVenv && pythonCmd) {
    mkdirSync(getConfigDir('runtime'), { recursive: true });
    const created = await ensureManagedPythonVenv({ pythonCmd, venvDir, venvPython });
    if (!created) {
      return result;
    }
  }

  if (existsSync(venvPython)) {
    const pythonTag = await detectPythonCompatibilityTag(venvPython);
    for (const target of slideWheelhouseCompatTargets) {
      ensureSlideRendererWheelhouseCompat(target.dest, target.src, pythonTag ?? undefined);
    }

    // Install from bundled wheels (no network), then fall back to online pip
    // only if the environment is not already usable.
    const wheelsDir = app.isPackaged
      ? join(process.resourcesPath, 'bundled-plugins', 'kai-slide-creator', 'bundled-wheels')
      : join(bundledDir, 'kai-slide-creator', 'bundled-wheels');
    const wheelsUsable = existsSync(wheelsDir) && isCompatibleSlideRendererWheelhouse(
      readdirSync(wheelsDir),
      process.platform,
      process.arch,
      pythonTag ?? undefined,
    );
    result.bundledWheelsUsable = wheelsUsable;

    const depsMarker = join(venvDir, '.deps-installed');
    const runtimeReady = await ensureSlideRendererPythonReady({
      venvPython,
      wheelsDir: wheelsUsable ? wheelsDir : undefined,
      markerPath: depsMarker,
      markerExists: existsSync(depsMarker),
      writeMarker: (markerPath) => {
        writeFileSync(markerPath, new Date().toISOString());
      },
    });
    result.venvReady = runtimeReady.ready;
    result.dependencyInstallMode = runtimeReady.mode;
  }

  return result;
}
