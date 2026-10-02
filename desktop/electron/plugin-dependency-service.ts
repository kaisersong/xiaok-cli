import { existsSync, statSync } from 'node:fs';
import { posix as posixPath, win32 as win32Path, type PlatformPath } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { runDependencyProcess } from './dependency-task.js';

/**
 * Selects POSIX vs Windows path semantics for dependency resolution. When a
 * platform is given (tests, or an explicit target) it is honored regardless of
 * the host OS, so macOS dependency resolution stays deterministic when the
 * suite runs on Windows. Without one, the host platform is used.
 */
function pathModuleFor(platform?: NodeJS.Platform | string): PlatformPath {
  const target = platform ?? process.platform;
  return target === 'win32' ? win32Path : posixPath;
}

export type PluginDependencyKind = 'macos_app_cli' | 'native_cli';
export type PluginDependencyState = 'ready' | 'missing' | 'needs_permission' | 'degraded' | 'unsupported';
export type PluginDependencyCode =
  | 'ready'
  | 'unsupported_platform'
  | 'binary_missing'
  | 'invalid_binary_override'
  | 'version_too_old'
  | 'version_unknown'
  | 'permission_accessibility_missing'
  | 'permission_screen_missing'
  | 'health_check_failed';

export interface ExternalPluginDependency {
  id: string;
  kind: PluginDependencyKind;
  supportedPlatforms?: readonly string[];
  exactVersion?: string;
  displayName: string;
  envOverride?: string;
  binaryCandidates: string[];
  minVersion?: string;
  install?: {
    kind: 'official_installer';
    sourceUrl: string;
    sourceAllowlist?: string[];
    requiresUserConfirmation: boolean;
  } | { kind: 'official_release_archive'; requiresUserConfirmation: boolean };
  update?:
    | {
        kind: 'command';
        command: string;
        args?: string[];
        requiresUserConfirmation: boolean;
      }
    | {
        kind: 'official_installer';
        sourceUrl: string;
        sourceAllowlist?: string[];
        requiresUserConfirmation: boolean;
      }
    | { kind: 'official_release_archive'; requiresUserConfirmation: boolean };
  health?: {
    version?: string[];
    status?: string[];
    permissions?: string[];
    doctor?: string[];
  };
  mcp?: {
    serverName: string;
    command: string;
    args?: string[];
    requiresUserActivation?: boolean;
  };
}

export interface PluginDependencyStatus {
  dependencyId: string;
  displayName: string;
  state: PluginDependencyState;
  code: PluginDependencyCode;
  resolvedBinary?: string;
  version?: string;
  detail?: string;
  canInstall: boolean;
  canUpdate: boolean;
  canDiagnose: boolean;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PluginDependencyStatusOptions {
  platform?: NodeJS.Platform | string;
  homeDir?: string;
  pathEnv?: string;
  exists?: (path: string) => boolean;
  isFile?: (path: string) => boolean;
  appArch?: string;
  nativeOsArch?: string;
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>;
}

export interface InstallerExecution {
  command: string;
  args: string[];
}

export function expandHomePath(path: string, homeDir = homedir(), pathModule: PlatformPath = pathModuleFor()): string {
  if (path === '~') return homeDir;
  if (path.startsWith('~/')) return pathModule.join(homeDir, path.slice(2));
  return path;
}

export function resolveDependencyBinary(
  candidates: string[],
  options: Pick<PluginDependencyStatusOptions, 'homeDir' | 'pathEnv' | 'exists' | 'isFile' | 'platform'> = {},
): string | null {
  const exists = filePredicate(options);
  const homeDir = options.homeDir ?? homedir();
  const pathMod = pathModuleFor(options.platform);
  const pathDirs = (options.pathEnv ?? process.env.PATH ?? '')
    .split(pathMod.delimiter)
    .filter(Boolean);

  for (const candidate of candidates) {
    const expanded = expandHomePath(candidate, homeDir, pathMod);
    if (/[\\/]/.test(expanded) || pathMod.isAbsolute(expanded)) {
      if (exists(expanded)) return expanded;
      continue;
    }

    for (const dir of pathDirs) {
      const resolved = pathMod.join(dir, expanded);
      if (exists(resolved)) return resolved;
    }
  }

  return null;
}

function resolveEnvOverrideBinary(
  envName: string | undefined,
  options: Pick<PluginDependencyStatusOptions, 'homeDir' | 'pathEnv' | 'exists' | 'isFile' | 'platform'> = {},
): { binary: string | null; error?: string } {
  if (!envName) return { binary: null };
  const raw = process.env[envName]?.trim();
  if (!raw) return { binary: null };
  const pathMod = pathModuleFor(options.platform);
  const expanded = expandHomePath(raw, options.homeDir ?? homedir(), pathMod);
  const absolute = pathMod.isAbsolute(expanded);
  const isWindows = (options.platform ?? process.platform) === 'win32';
  const extension = pathMod.extname(expanded).toLowerCase();
  if (/[;&|`$<>\r\n\0"]/.test(raw) || (!absolute && /\s/.test(raw))
    || (isWindows && ((absolute && extension !== '.exe') || (extension !== '' && extension !== '.exe')))) {
    return {
      binary: null,
      error: `${envName} must contain a single binary path or command name without shell syntax`,
    };
  }

  const exists = filePredicate(options);
  if (/[\\/]/.test(expanded) || pathMod.isAbsolute(expanded)) {
    if (exists(expanded)) return { binary: expanded };
    return { binary: null, error: `${envName} points to a binary that does not exist: ${expanded}` };
  }

  const pathDirs = (options.pathEnv ?? process.env.PATH ?? '')
    .split(pathMod.delimiter)
    .filter(Boolean);
  for (const dir of pathDirs) {
    const resolved = pathMod.join(dir, isWindows && !extension ? `${expanded}.exe` : expanded);
    if (exists(resolved)) return { binary: resolved };
  }
  return { binary: null, error: `${envName} command was not found on PATH: ${expanded}` };
}

export async function getPluginDependencyStatus(
  dependency: ExternalPluginDependency,
  options: PluginDependencyStatusOptions = {},
): Promise<PluginDependencyStatus> {
  const currentPlatform = options.platform ?? osPlatform();
  const baseStatus = {
    dependencyId: dependency.id,
    displayName: dependency.displayName,
    canInstall: Boolean(dependency.install),
    canUpdate: Boolean(dependency.update),
    canDiagnose: Boolean(dependency.health?.doctor),
  };

  if (!isDependencyPlatformSupported(dependency, options)) {
    return {
      ...baseStatus,
      canInstall: false,
      canUpdate: false,
      canDiagnose: false,
      state: 'unsupported',
      code: 'unsupported_platform',
      detail: 'This dependency is only supported on macOS.',
    };
  }

  const override = resolveEnvOverrideBinary(dependency.envOverride, options);
  if (override.error) {
    return {
      ...baseStatus,
      state: 'degraded',
      code: 'invalid_binary_override',
      detail: override.error,
    };
  }

  const resolvedBinary = override.binary ?? resolveDependencyBinary(dependency.binaryCandidates, options);
  if (!resolvedBinary) {
    return {
      ...baseStatus,
      state: 'missing',
      code: 'binary_missing',
      detail: `${dependency.displayName} is not installed.`,
    };
  }

  const runCommand = options.runCommand ?? runLocalCommand;
  let version: string | undefined;
  if (dependency.minVersion || dependency.exactVersion) {
    let versionResult: CommandResult;
    try {
      versionResult = await runHealthCommand(runCommand, resolvedBinary, dependency.health?.version ?? [resolvedBinary, '--version']);
    } catch (error) {
      return {
        ...baseStatus,
        state: 'degraded',
        code: 'health_check_failed',
        resolvedBinary,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    version = parseVersion(versionResult.stdout || versionResult.stderr);
    if (!version) {
      return {
        ...baseStatus,
        state: 'degraded',
        code: 'version_unknown',
        resolvedBinary,
        detail: 'Could not determine dependency version.',
      };
    }
    if ((dependency.exactVersion && version !== dependency.exactVersion)
      || (dependency.minVersion && compareVersions(version, dependency.minVersion) < 0)) {
      return {
        ...baseStatus,
        state: 'degraded',
        code: 'version_too_old',
        resolvedBinary,
        version,
        detail: `${dependency.displayName} ${version} does not meet the required version ${dependency.exactVersion ?? dependency.minVersion}.`,
      };
    }
  }

  if (dependency.health?.permissions) {
    let permissionResult: CommandResult;
    try {
      permissionResult = await runHealthCommand(runCommand, resolvedBinary, dependency.health.permissions);
    } catch (error) {
      return {
        ...baseStatus,
        state: 'degraded',
        code: 'health_check_failed',
        resolvedBinary,
        version,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    const permissionCode = classifyPermissionOutput(permissionResult.stdout || permissionResult.stderr);
    if (permissionCode) {
      return {
        ...baseStatus,
        state: 'needs_permission',
        code: permissionCode,
        resolvedBinary,
        version,
        detail: permissionResult.stdout || permissionResult.stderr,
      };
    }
  }

  return {
    ...baseStatus,
    state: 'ready',
    code: 'ready',
    resolvedBinary,
    version,
  };
}

export function buildOfficialInstallerExecution(
  dependency: ExternalPluginDependency,
  downloadedInstallerPath: string,
  options: { confirmed: boolean },
): InstallerExecution {
  if (dependency.install?.kind !== 'official_installer') {
    throw new Error(`Dependency "${dependency.id}" does not declare an official installer`);
  }
  const allowlist = dependency.install.sourceAllowlist;
  if (allowlist && !allowlist.includes(dependency.install.sourceUrl)) {
    throw new Error(`Official installer URL is not allowed: ${dependency.install.sourceUrl}`);
  }
  if (dependency.install.requiresUserConfirmation && !options.confirmed) {
    throw new Error('User confirmation is required before installing this dependency');
  }
  return {
    command: '/bin/bash',
    args: [downloadedInstallerPath],
  };
}

async function runHealthCommand(
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
  resolvedBinary: string,
  configuredCommand: string[],
): Promise<CommandResult> {
  const [, ...args] = configuredCommand;
  const result = await runCommand(resolvedBinary, args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Dependency health check failed');
  }
  return result;
}

function parseVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)?.[1];
}

function compareVersions(actual: string, minimum: string): number {
  const toParts = (value: string) => value.split(/[-+]/)[0].split('.').map((part) => Number(part));
  const a = toParts(actual);
  const b = toParts(minimum);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

function classifyPermissionOutput(output: string): Extract<PluginDependencyCode, 'permission_accessibility_missing' | 'permission_screen_missing'> | null {
  const normalized = output.toLowerCase();
  if (/accessibility.*(denied|missing|not granted|false|disabled)/.test(normalized)) {
    return 'permission_accessibility_missing';
  }
  if (/(screen recording|screen capture|screencapture).*(denied|missing|not granted|false|disabled)/.test(normalized)) {
    return 'permission_screen_missing';
  }
  return null;
}

async function runLocalCommand(command: string, args: string[]): Promise<CommandResult> {
  const result = await runDependencyProcess(command, args, { timeoutMs: 30_000 });
  return { exitCode: result.success ? 0 : 1, stdout: result.output ?? '', stderr: result.error ?? '' };
}

function filePredicate(options: Pick<PluginDependencyStatusOptions, 'exists' | 'isFile'>): (path: string) => boolean {
  if (options.isFile) return path => (options.exists ?? existsSync)(path) && options.isFile!(path);
  if (options.exists) return options.exists;
  return path => { try { return statSync(path).isFile(); } catch { return false; } };
}

export function isDependencyPlatformSupported(dependency: ExternalPluginDependency, options: PluginDependencyStatusOptions = {}): boolean {
  const target = options.platform ?? process.platform;
  if (dependency.kind === 'macos_app_cli') return target === 'darwin';
  if (!dependency.supportedPlatforms?.includes(target)) return false;
  return target !== 'win32' || ((options.appArch ?? process.arch) === 'x64' && options.nativeOsArch === 'x64');
}
