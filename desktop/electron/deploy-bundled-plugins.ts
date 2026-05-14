/**
 * Deploy Bundled Plugins
 *
 * On app startup, copies bundled plugins from Resources to ~/.xiaok/plugins/
 * with version-aware upgrade logic. Also sets up Python venv for slide-renderer.
 */

import { app } from 'electron';
import { join, dirname } from 'node:path';
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const execFileAsync = promisify(execFile);

const BUNDLED_PLUGINS = ['kai-report-creator', 'kai-slide-creator'];

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

export interface DeployResult {
  deployed: string[];
  pythonAvailable: boolean;
  venvReady: boolean;
}

export async function deployBundledPlugins(): Promise<DeployResult> {
  const result: DeployResult = { deployed: [], pythonAvailable: false, venvReady: false };
  const pluginsDir = join(homedir(), '.xiaok', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });

  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'bundled-plugins')
    : join(__dirname, '..', '..', '..', 'kai-xiaok-plugins', 'plugins');

  if (!existsSync(bundledDir)) return result;

  // 1. Copy plugin files (version-aware)
  for (const name of BUNDLED_PLUGINS) {
    const src = join(bundledDir, name);
    const dest = join(pluginsDir, name);
    if (!existsSync(src)) continue;

    const srcManifest = join(src, 'plugin.json');
    const destManifest = join(dest, 'plugin.json');

    if (existsSync(destManifest)) {
      try {
        const srcVer = JSON.parse(readFileSync(srcManifest, 'utf8')).version || '0.0.0';
        const destMeta = JSON.parse(readFileSync(destManifest, 'utf8'));
        const destVer = destMeta.version || '0.0.0';
        // Skip if installed version >= bundled AND not managed by us
        if (semverGte(destVer, srcVer) && destMeta.source !== 'bundled') continue;
        if (semverGte(destVer, srcVer)) continue;
      } catch {
        // parse error, overwrite
      }
    }

    cpSync(src, dest, { recursive: true });
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

  // 2. Setup Python venv for slide-renderer (if Python available)
  const pythonCmd = detectPython();
  result.pythonAvailable = !!pythonCmd;

  if (pythonCmd) {
    const venvDir = join(homedir(), '.xiaok', 'runtime', 'python-env');
    const venvPython = process.platform === 'win32'
      ? join(venvDir, 'Scripts', 'python.exe')
      : join(venvDir, 'bin', 'python3');

    if (!existsSync(venvPython)) {
      try {
        mkdirSync(join(homedir(), '.xiaok', 'runtime'), { recursive: true });
        await execFileAsync(pythonCmd, ['-m', 'venv', venvDir], { timeout: 30_000 });
      } catch {
        return result;
      }
    }

    // Install from bundled wheels (no network)
    const wheelsDir = app.isPackaged
      ? join(process.resourcesPath, 'bundled-plugins', 'kai-slide-creator', 'bundled-wheels')
      : join(bundledDir, 'kai-slide-creator', 'bundled-wheels');

    if (existsSync(wheelsDir)) {
      const depsMarker = join(venvDir, '.deps-installed');
      if (!existsSync(depsMarker)) {
        try {
          await execFileAsync(venvPython, [
            '-m', 'pip', 'install', '--no-index', '--find-links', wheelsDir,
            'mcp', 'pydantic', 'jsonschema'
          ], { timeout: 60_000 });
          writeFileSync(depsMarker, new Date().toISOString());
          result.venvReady = true;
        } catch {
          // pip install failed, slide won't work but app continues
        }
      } else {
        result.venvReady = true;
      }
    }
  }

  return result;
}
