import { describe, expect, it } from 'vitest';
import {
  buildOfficialInstallerExecution,
  getPluginDependencyStatus,
  type ExternalPluginDependency,
} from '../../electron/plugin-dependency-service.js';

const cuaDependency: ExternalPluginDependency = {
  id: 'cua-driver',
  kind: 'macos_app_cli',
  displayName: 'CUA Driver',
  binaryCandidates: ['~/.local/bin/cua-driver', '/usr/local/bin/cua-driver', 'cua-driver'],
  minVersion: '0.1.0',
  install: {
    kind: 'official_installer',
    sourceUrl: 'https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh',
    requiresUserConfirmation: true,
  },
  update: {
    kind: 'command',
    command: '~/.local/bin/cua-driver',
    args: ['update'],
    requiresUserConfirmation: true,
  },
  health: {
    version: ['~/.local/bin/cua-driver', '--version'],
    permissions: ['~/.local/bin/cua-driver', 'check_permissions'],
    doctor: ['~/.local/bin/cua-driver', 'doctor'],
  },
  mcp: {
    serverName: 'cua-driver',
    command: '~/.local/bin/cua-driver',
    args: ['mcp'],
  },
};

describe('plugin dependency service', () => {
  it('resolves the first installed binary candidate with home expansion before running health checks', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const status = await getPluginDependencyStatus(cuaDependency, {
      platform: 'darwin',
      homeDir: '/Users/alice',
      pathEnv: '/opt/bin:/usr/bin',
      exists: (path) => path === '/Users/alice/.local/bin/cua-driver',
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.1.7\n', stderr: '' };
        if (args[0] === 'check_permissions') return { exitCode: 0, stdout: 'Accessibility: granted\nScreen Recording: granted\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(status).toMatchObject({
      state: 'ready',
      code: 'ready',
      resolvedBinary: '/Users/alice/.local/bin/cua-driver',
      version: '0.1.7',
    });
    expect(calls[0]).toEqual({ command: '/Users/alice/.local/bin/cua-driver', args: ['--version'] });
    expect(calls[1]).toEqual({ command: '/Users/alice/.local/bin/cua-driver', args: ['check_permissions'] });
  });

  it('falls back to PATH candidates when configured absolute candidates are missing', async () => {
    const status = await getPluginDependencyStatus(cuaDependency, {
      platform: 'darwin',
      homeDir: '/Users/alice',
      pathEnv: '/opt/bin:/usr/bin',
      exists: (path) => path === '/opt/bin/cua-driver',
      runCommand: async (_command, args) => {
        if (args[0] === '--version') return { exitCode: 0, stdout: '0.1.2\n', stderr: '' };
        return { exitCode: 0, stdout: 'Accessibility: granted\nScreen Recording: granted\n', stderr: '' };
      },
    });

    expect(status).toMatchObject({
      state: 'ready',
      code: 'ready',
      resolvedBinary: '/opt/bin/cua-driver',
    });
  });

  it('honors a safe env override before default binary candidates', async () => {
    const previous = process.env.XIAOK_CUA_DRIVER_CMD;
    process.env.XIAOK_CUA_DRIVER_CMD = '/opt/cua-dev/bin/cua-driver';
    try {
      const status = await getPluginDependencyStatus({
        ...cuaDependency,
        envOverride: 'XIAOK_CUA_DRIVER_CMD',
      }, {
        platform: 'darwin',
        homeDir: '/Users/alice',
        pathEnv: '/usr/bin',
        exists: (path) => path === '/opt/cua-dev/bin/cua-driver' || path === '/Users/alice/.local/bin/cua-driver',
        runCommand: async (_command, args) => {
          if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.2.0\n', stderr: '' };
          return { exitCode: 0, stdout: 'Accessibility: granted\nScreen Recording: granted\n', stderr: '' };
        },
      });

      expect(status).toMatchObject({
        state: 'ready',
        code: 'ready',
        resolvedBinary: '/opt/cua-dev/bin/cua-driver',
        version: '0.2.0',
      });
    } finally {
      if (previous === undefined) delete process.env.XIAOK_CUA_DRIVER_CMD;
      else process.env.XIAOK_CUA_DRIVER_CMD = previous;
    }
  });

  it('rejects env override values that contain shell arguments', async () => {
    const previous = process.env.XIAOK_CUA_DRIVER_CMD;
    process.env.XIAOK_CUA_DRIVER_CMD = 'cua-driver --mcp';
    try {
      await expect(getPluginDependencyStatus({
        ...cuaDependency,
        envOverride: 'XIAOK_CUA_DRIVER_CMD',
      }, {
        platform: 'darwin',
        homeDir: '/Users/alice',
        pathEnv: '/usr/bin',
        exists: () => true,
        runCommand: async () => ({ exitCode: 0, stdout: 'cua-driver 0.2.0\n', stderr: '' }),
      })).resolves.toMatchObject({
        state: 'degraded',
        code: 'invalid_binary_override',
        detail: expect.stringContaining('XIAOK_CUA_DRIVER_CMD'),
      });
    } finally {
      if (previous === undefined) delete process.env.XIAOK_CUA_DRIVER_CMD;
      else process.env.XIAOK_CUA_DRIVER_CMD = previous;
    }
  });

  it('classifies a missing CUA binary without attempting health commands', async () => {
    const calls: string[] = [];
    const status = await getPluginDependencyStatus(cuaDependency, {
      platform: 'darwin',
      homeDir: '/Users/alice',
      pathEnv: '/opt/bin:/usr/bin',
      exists: () => false,
      runCommand: async (command) => {
        calls.push(command);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(status).toMatchObject({
      state: 'missing',
      code: 'binary_missing',
      canInstall: true,
    });
    expect(calls).toEqual([]);
  });

  it('classifies missing macOS permissions separately from install failures', async () => {
    const status = await getPluginDependencyStatus(cuaDependency, {
      platform: 'darwin',
      homeDir: '/Users/alice',
      pathEnv: '',
      exists: (path) => path === '/Users/alice/.local/bin/cua-driver',
      runCommand: async (_command, args) => {
        if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.1.7\n', stderr: '' };
        return { exitCode: 0, stdout: 'Accessibility: denied\nScreen Recording: granted\n', stderr: '' };
      },
    });

    expect(status).toMatchObject({
      state: 'needs_permission',
      code: 'permission_accessibility_missing',
      resolvedBinary: '/Users/alice/.local/bin/cua-driver',
    });
  });

  it('classifies failed health commands as degraded instead of throwing', async () => {
    await expect(getPluginDependencyStatus(cuaDependency, {
      platform: 'darwin',
      homeDir: '/Users/alice',
      pathEnv: '',
      exists: (path) => path === '/Users/alice/.local/bin/cua-driver',
      runCommand: async (_command, args) => {
        if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.1.7\n', stderr: '' };
        return { exitCode: 2, stdout: '', stderr: 'permission check failed' };
      },
    })).resolves.toMatchObject({
      state: 'degraded',
      code: 'health_check_failed',
      detail: 'permission check failed',
    });
  });

  it('builds installer execution from a downloaded file and requires user confirmation', () => {
    expect(() =>
      buildOfficialInstallerExecution(cuaDependency, '/tmp/cua-install.sh', { confirmed: false }),
    ).toThrow(/confirmation/i);

    expect(buildOfficialInstallerExecution(cuaDependency, '/tmp/cua-install.sh', { confirmed: true })).toEqual({
      command: '/bin/bash',
      args: ['/tmp/cua-install.sh'],
    });
  });

  it('rejects official installer URLs that are not allowlisted', () => {
    const dependency: ExternalPluginDependency = {
      ...cuaDependency,
      install: {
        kind: 'official_installer',
        sourceUrl: 'https://example.test/install.sh',
        sourceAllowlist: ['https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh'],
        requiresUserConfirmation: true,
      },
    };

    expect(() =>
      buildOfficialInstallerExecution(dependency, '/tmp/cua-install.sh', { confirmed: true }),
    ).toThrow(/not allowed/i);
  });
});
