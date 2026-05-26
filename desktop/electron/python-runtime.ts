import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REQUIRED_MODULES = ['mcp', 'jsonschema', 'pydantic', 'bs4'];
const REQUIRED_DISTRIBUTIONS = ['mcp==1.27.1', 'pydantic==2.13.4', 'jsonschema==4.26.0', 'beautifulsoup4'];
const REQUIRED_NATIVE_WHEEL_PREFIXES = ['pydantic_core-', 'rpds_py-'];
const IMPORT_CHECK_SNIPPET = `import ${REQUIRED_MODULES.join(', ')}`;

export type PythonExecFile = (
  command: string,
  args: string[],
  options: { timeout: number }
) => Promise<unknown>;

export interface EnsureSlideRendererPythonReadyOptions {
  venvPython: string;
  wheelsDir?: string;
  markerPath: string;
  exec?: PythonExecFile;
  writeMarker?: (markerPath: string) => void;
  markerExists?: boolean;
}

export interface PythonRuntimeReadyResult {
  ready: boolean;
  mode: 'existing' | 'offline' | 'online' | 'failed';
}

export function buildPythonServerEnv(
  baseEnv: Record<string, string> = {},
): Record<string, string> {
  return {
    ...baseEnv,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

async function canImportRequiredModules(exec: PythonExecFile, pythonCommand: string): Promise<boolean> {
  try {
    await exec(pythonCommand, ['-c', IMPORT_CHECK_SNIPPET], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export function isCompatibleSlideRendererWheelhouse(
  wheelNames: string[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  const normalized = wheelNames
    .filter(name => name.toLowerCase().endsWith('.whl'))
    .map(name => name.toLowerCase());

  return REQUIRED_NATIVE_WHEEL_PREFIXES.every(prefix =>
    normalized.some(name => name.startsWith(prefix) && isCompatibleNativeWheelName(name, platform, arch))
  );
}

function isCompatibleNativeWheelName(
  wheelName: string,
  platform: NodeJS.Platform,
  arch: string,
): boolean {
  if (wheelName.includes('-none-any.whl')) return true;

  if (platform === 'win32') {
    if (arch === 'arm64') return wheelName.includes('win_arm64');
    if (arch === 'ia32') return wheelName.includes('win32');
    return wheelName.includes('win_amd64');
  }

  if (platform === 'darwin') {
    if (!wheelName.includes('macosx')) return false;
    if (wheelName.includes('universal2')) return true;
    return arch === 'arm64' ? wheelName.includes('arm64') : wheelName.includes('x86_64');
  }

  if (platform === 'linux') {
    if (!/(manylinux|musllinux|linux)/.test(wheelName)) return false;
    return arch === 'arm64' ? /(aarch64|arm64)/.test(wheelName) : /x86_64/.test(wheelName);
  }

  return false;
}

export async function ensureSlideRendererPythonReady(
  options: EnsureSlideRendererPythonReadyOptions,
): Promise<PythonRuntimeReadyResult> {
  const exec = options.exec ?? execFileAsync;
  const writeMarker = options.writeMarker ?? (() => {});

  if (await canImportRequiredModules(exec, options.venvPython)) {
    return { ready: true, mode: 'existing' };
  }

  if (options.wheelsDir) {
    try {
      await exec(options.venvPython, [
        '-m', 'pip', 'install', '--no-index', '--find-links', options.wheelsDir,
        ...REQUIRED_MODULES,
      ], { timeout: 60_000 });
    } catch {
      // Fall through to import check and then online fallback.
    }

    if (await canImportRequiredModules(exec, options.venvPython)) {
      writeMarker(options.markerPath);
      return { ready: true, mode: 'offline' };
    }
  }

  try {
    await exec(options.venvPython, [
      '-m', 'pip', 'install',
      ...REQUIRED_DISTRIBUTIONS,
    ], { timeout: 120_000 });
  } catch {
    // Online fallback failed, final import check below determines ready state.
  }

  if (await canImportRequiredModules(exec, options.venvPython)) {
    writeMarker(options.markerPath);
    return { ready: true, mode: 'online' };
  }

  return { ready: false, mode: 'failed' };
}

export function normalizePythonServerCommand(
  serverCommand: string,
  platform: NodeJS.Platform,
  preferredPython?: string,
): string {
  if (preferredPython) return preferredPython;
  if (platform === 'win32' && serverCommand === 'python3') return 'python';
  return serverCommand;
}
