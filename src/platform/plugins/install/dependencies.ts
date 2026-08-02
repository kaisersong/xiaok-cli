import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPluginRelativePath } from './integrity.js';
import type { TrustedInstallStep } from './registry.js';
import { defaultCommandRunner, type CommandRunner, type InstallPaths } from './source.js';

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/';
const STEP_TIMEOUT_MS = 600_000;

export interface NpmInvocation {
  command: string;
  prefixArgs: string[];
}

export interface ResolveNpmOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Windows ships npm as a `.cmd` shim, and spawning it without a shell throws
 * EINVAL, so the install runs npm's JS entry point through the Node binary.
 */
export function resolveNpmInvocation(options: ResolveNpmOptions = {}): NpmInvocation {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;

  if (platform !== 'win32') {
    return { command: 'npm', prefixArgs: [] };
  }

  const explicit = env.XIAOK_NPM_CLI_JS;
  if (explicit) {
    return { command: execPath, prefixArgs: [explicit] };
  }

  const nodeDir = execPath.replace(/[\\/][^\\/]+$/, '');
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Unable to locate npm-cli.js for a shell-free npm invocation. Set XIAOK_NPM_CLI_JS to npm\'s bin/npm-cli.js.',
    );
  }
  return { command: execPath, prefixArgs: [found] };
}

export function resolvePythonCommand(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.XIAOK_PYTHON_CMD) return env.XIAOK_PYTHON_CMD;
  return platform === 'win32' ? 'python' : 'python3';
}

export function resolveVenvPython(runtimeDir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? join(runtimeDir, 'Scripts', 'python.exe')
    : join(runtimeDir, 'bin', 'python');
}

export interface InstallStepResult {
  step: TrustedInstallStep;
  status: 'completed' | 'skipped';
  skippedServerNames?: string[];
}

export interface RunInstallStepsOptions {
  pluginName: string;
  pluginDir: string;
  digest: string;
  steps: TrustedInstallStep[];
  paths: InstallPaths;
  runner?: CommandRunner;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  timeoutMs?: number;
  reusePythonRuntimeDir?: string;
}

export interface RunInstallStepsResult {
  results: InstallStepResult[];
  skippedServerNames: string[];
  runtimeDirs: string[];
}

export function assertHashedRequirements(requirementsPath: string): void {
  const raw = readFileSync(requirementsPath, 'utf8');
  const logicalLines: string[] = [];
  let pending = '';

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    logicalLines.push(`${pending}${line}`.trim());
    pending = '';
  }
  if (pending) logicalLines.push(pending.trim());

  let sawRequirement = false;

  for (const line of logicalLines) {
    if (!line || line.startsWith('#')) continue;

    if (/^(-e\b|--editable\b)/.test(line)) {
      throw new Error(`Refusing editable requirement in ${requirementsPath}: ${line}`);
    }
    if (/(^|\s)(git|hg|svn|bzr)\+/.test(line)) {
      throw new Error(`Refusing VCS requirement in ${requirementsPath}: ${line}`);
    }
    if (/^(-i\b|--index-url\b|--extra-index-url\b|-f\b|--find-links\b|--trusted-host\b)/.test(line)) {
      throw new Error(`Refusing custom package index directive in ${requirementsPath}: ${line}`);
    }
    if (/^(-r\b|--requirement\b|-c\b|--constraint\b)/.test(line)) {
      const target = line.split(/\s+/)[1] ?? '';
      throw new Error(
        `Refusing nested requirements include "${target}" in ${requirementsPath}; it can escape the verified plugin root`,
      );
    }
    if (/^(\.|\/|[A-Za-z]:[\\/]|\.\.)/.test(line)) {
      throw new Error(`Refusing local path requirement in ${requirementsPath}: ${line}`);
    }

    sawRequirement = true;
    if (!line.includes('--hash=sha256:')) {
      throw new Error(
        `Requirement "${line}" in ${requirementsPath} has no --hash pin; declare the step as "external" instead`,
      );
    }
  }

  if (!sawRequirement) {
    throw new Error(`${requirementsPath} declares no hashed requirements`);
  }
}

export async function runInstallSteps(options: RunInstallStepsOptions): Promise<RunInstallStepsResult> {
  const runner = options.runner ?? defaultCommandRunner;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? STEP_TIMEOUT_MS;
  const results: InstallStepResult[] = [];
  const skippedServerNames: string[] = [];
  const runtimeDirs: string[] = [];
  const createdRuntimeDirs = new Set<string>();
  const processEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) processEnv[key] = value;
  }

  try {
    for (const step of options.steps) {
    const cwd = assertPluginRelativePath(options.pluginDir, step.cwd, `Install step "cwd"`);

    if (step.kind === 'external') {
      skippedServerNames.push(...(step.serverNames ?? []));
      results.push({ step, status: 'skipped', skippedServerNames: step.serverNames });
      continue;
    }

    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new Error(`Install step "${step.kind}" cwd "${step.cwd}" does not exist in the verified plugin`);
    }

    if (step.kind === 'npm_ci' || step.kind === 'npm_run') {
      const npm = resolveNpmInvocation({ platform, execPath: options.execPath, env });
      const emptyUserNpmrc = join(options.paths.runtimesDir, 'empty-user.npmrc');
      const emptyGlobalNpmrc = join(options.paths.runtimesDir, 'empty-global.npmrc');
      mkdirSync(options.paths.runtimesDir, { recursive: true });
      if (!existsSync(emptyUserNpmrc)) writeFileSync(emptyUserNpmrc, '', 'utf8');
      if (!existsSync(emptyGlobalNpmrc)) writeFileSync(emptyGlobalNpmrc, '', 'utf8');
      const configArgs = [
        '--no-audit',
        '--no-fund',
        '--registry',
        NPM_REGISTRY_URL,
        '--userconfig',
        emptyUserNpmrc,
        '--globalconfig',
        emptyGlobalNpmrc,
      ];
      const args = step.kind === 'npm_ci'
        ? ['ci', '--ignore-scripts', ...configArgs]
        : ['run', step.script as string, ...configArgs];

      const result = await runner.run(npm.command, [...npm.prefixArgs, ...args], {
        cwd,
        env: processEnv,
        timeoutMs,
      });
      if (result.code !== 0) {
        throw new Error(
          `Install step "${step.kind}" failed with exit code ${result.code} in "${step.cwd}": ${result.stderr.trim()}`,
        );
      }
      results.push({ step, status: 'completed' });
      continue;
    }

    // python_requirements
    const requirementsPath = assertPluginRelativePath(
      options.pluginDir,
      step.file ?? 'requirements.txt',
      'Install step "file"',
    );
    if (!existsSync(requirementsPath)) {
      throw new Error(`Requirements file "${step.file}" does not exist in the verified plugin`);
    }
    assertHashedRequirements(requirementsPath);

      const runtimeDir = join(options.paths.runtimesDir, options.pluginName, options.digest);
      if (options.reusePythonRuntimeDir === runtimeDir) {
        if (!existsSync(runtimeDir)) {
          throw new Error(`The active Python runtime for "${options.pluginName}" is missing`);
        }
        runtimeDirs.push(runtimeDir);
        results.push({ step, status: 'completed' });
        continue;
      }

      if (!createdRuntimeDirs.has(runtimeDir)) {
        rmSync(runtimeDir, { recursive: true, force: true });
        mkdirSync(runtimeDir, { recursive: true });
        createdRuntimeDirs.add(runtimeDir);

        const python = resolvePythonCommand(platform, env);
        const venv = await runner.run(python, ['-m', 'venv', runtimeDir], { cwd, env: processEnv, timeoutMs });
        if (venv.code !== 0) {
          throw new Error(`Failed to create the isolated Python runtime for "${options.pluginName}": ${venv.stderr.trim()}`);
        }
      }

      const venvPython = resolveVenvPython(runtimeDir, platform);
      const pip = await runner.run(
        venvPython,
        [
          '-m',
          'pip',
          'install',
          '--no-input',
          '--disable-pip-version-check',
          '--no-cache-dir',
          '--only-binary',
          ':all:',
          '--require-hashes',
          '--no-deps',
          '--index-url',
          'https://pypi.org/simple',
          '-r',
          requirementsPath,
        ],
        { cwd, env: processEnv, timeoutMs },
      );
      if (pip.code !== 0) {
        throw new Error(`Install step "python_requirements" failed with exit code ${pip.code}: ${pip.stderr.trim()}`);
      }

      if (!runtimeDirs.includes(runtimeDir)) runtimeDirs.push(runtimeDir);
      results.push({ step, status: 'completed' });
    }
  } catch (error) {
    for (const runtimeDir of createdRuntimeDirs) {
      rmSync(runtimeDir, { recursive: true, force: true });
    }
    throw error;
  }

  return { results, skippedServerNames, runtimeDirs };
}
