import { describe, expect, it } from 'vitest';

import { buildWindowsXiaokLaunchSpec } from '../../overrides/kswarm/windows-xiaok-launch.js';

function makeExists(paths: string[]) {
  const set = new Set(paths);
  return (candidate: string) => set.has(candidate);
}

describe('buildWindowsXiaokLaunchSpec', () => {
  it('uses pwsh + global xiaok.ps1 with the current non-interactive CLI contract on Windows', () => {
    const launch = buildWindowsXiaokLaunchSpec({
      platform: 'win32',
      runtimePath: null,
      prompt: '生成计划',
      model: 'kimi-for-coding',
      workFolder: 'D:\\workspace\\demo',
      env: {
        APPDATA: 'C:\\Users\\song\\AppData\\Roaming',
        ProgramFiles: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows',
      },
      exists: makeExists([
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
      ]),
    });

    expect(launch).toEqual({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: [
        '-NoProfile',
        '-File',
        'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
        '生成计划',
        '--auto',
        '--json',
      ],
    });
  });

  it('wraps ps1 runtime paths with PowerShell even when runtimePath is explicit', () => {
    const launch = buildWindowsXiaokLaunchSpec({
      platform: 'win32',
      runtimePath: 'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
      prompt: 'hello',
      env: {
        APPDATA: 'C:\\Users\\song\\AppData\\Roaming',
        ProgramFiles: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows',
      },
      exists: makeExists([
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
      ]),
    });

    expect(launch).toEqual({
      command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: [
        '-NoProfile',
        '-File',
        'C:\\Users\\song\\AppData\\Roaming\\npm\\xiaok.ps1',
        'hello',
        '--auto',
        '--json',
      ],
    });
  });

  it('returns null when Windows local xiaok launcher cannot be resolved', () => {
    const launch = buildWindowsXiaokLaunchSpec({
      platform: 'win32',
      runtimePath: null,
      prompt: 'hello',
      env: {
        APPDATA: 'C:\\Users\\song\\AppData\\Roaming',
        ProgramFiles: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows',
      },
      exists: () => false,
    });

    expect(launch).toBeNull();
  });

  it('keeps direct binary execution on non-Windows platforms without deprecated flags', () => {
    const launch = buildWindowsXiaokLaunchSpec({
      platform: 'darwin',
      runtimePath: '/usr/local/bin/xiaok',
      prompt: 'hello',
      model: 'claude-sonnet-4-6',
      workFolder: '/tmp/demo',
      exists: () => true,
    });

    expect(launch).toEqual({
      command: '/usr/local/bin/xiaok',
      args: [
        'hello',
        '--auto',
        '--json',
      ],
    });
  });
});
