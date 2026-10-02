import { describe, expect, it, vi } from 'vitest';
import { resolveWindowsComputerUseIdentity, XIAOK_NSIS_GUID } from '../../electron/windows-computer-use-identity.js';
describe('Windows installation identity', () => {
  const base = { platform: 'win32' as const, executablePath: 'C:\\Apps\\xiaok\\xiaok.exe', resourcesPath: 'C:\\Apps\\xiaok\\resources', isPackaged: true };
  it('matches the actual electron-builder GUID, registered root and physical asar', async () => {
    expect(XIAOK_NSIS_GUID).toBe('e915e417-4c7f-5880-944a-980493960d29');
    const run = vi.fn(async () => ({ success: true, output: JSON.stringify([{ installLocation: 'c:/apps/Xiaok', uninstallString: '"C:\\Apps\\xiaok\\Uninstall xiaok.exe" /currentuser' }]) }));
    expect(await resolveWindowsComputerUseIdentity(base, { run, hashAsar: async () => 'digest', isFile: async () => true })).toMatchObject({ platform: 'win32', installationSource: 'nsis', appPath: 'C:\\Apps\\xiaok', appAsarSha256: 'digest' });
    expect(run.mock.calls[0][1]).toContain('-EncodedCommand');
  });
  it('does not infer NSIS from isPackaged or match another registered installation', async () => {
    for (const records of [[], [{ installLocation: 'C:\\Other', uninstallString: '"C:\\Other\\Uninstall xiaok.exe"' }], [{ installLocation: 'C:\\Apps\\xiaok', uninstallString: '"C:\\Other\\Uninstall xiaok.exe"' }]]) {
      const identity = await resolveWindowsComputerUseIdentity(base, { run: async () => ({ success: true, output: JSON.stringify(records) }), hashAsar: async () => 'digest', isFile: async () => true });
      expect(identity.installationSource).toBeUndefined();
    }
  });
  it('never probes other platforms, development builds or mismatched resources roots', async () => {
    const run = vi.fn();
    for (const input of [{ ...base, platform: 'darwin' as const }, { ...base, isPackaged: false }, { ...base, resourcesPath: 'C:\\Other\\resources' }, { ...base, devServerUrl: 'http://localhost:5173' }]) {
      expect((await resolveWindowsComputerUseIdentity(input, { run })).installationSource).toBeUndefined();
    }
    expect(run).not.toHaveBeenCalled();
  });
});
