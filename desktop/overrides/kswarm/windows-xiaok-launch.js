import { existsSync } from 'node:fs';
import { join } from 'node:path';

function buildXiaokCliArgs({ prompt, model, workFolder }) {
  void model;
  void workFolder;
  return [prompt, '--auto', '--json'];
}

function resolveWindowsPowerShell(env, exists) {
  const candidates = [
    env.KSWARM_XIAOK_PWSH_PATH,
    env.ProgramW6432 ? join(env.ProgramW6432, 'PowerShell', '7', 'pwsh.exe') : null,
    env.ProgramFiles ? join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') : null,
    env.SystemRoot ? join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null,
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

  return candidates.find((candidate) => exists(candidate)) ?? null;
}

function resolveWindowsXiaokPs1Path(runtimePath, env, exists) {
  if (runtimePath && /\.ps1$/i.test(runtimePath) && exists(runtimePath)) {
    return runtimePath;
  }

  const candidates = [
    env.KSWARM_XIAOK_PS1_PATH,
    env.APPDATA ? join(env.APPDATA, 'npm', 'xiaok.ps1') : null,
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export function buildWindowsXiaokLaunchSpec({
  runtimePath,
  prompt,
  model,
  workFolder,
  platform = process.platform,
  env = process.env,
  exists = existsSync,
}) {
  const args = buildXiaokCliArgs({ prompt, model, workFolder });

  if (platform !== 'win32') {
    if (!runtimePath) {
      return null;
    }
    return {
      command: runtimePath,
      args,
    };
  }

  const ps1Path = resolveWindowsXiaokPs1Path(runtimePath ?? null, env, exists);
  const powerShellPath = resolveWindowsPowerShell(env, exists);
  if (!ps1Path || !powerShellPath) {
    return null;
  }

  return {
    command: powerShellPath,
    args: ['-NoProfile', '-File', ps1Path, ...args],
  };
}
