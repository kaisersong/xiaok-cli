// Copy to desktop/tests/renderer/skill-mutation-bridge.test.ts.
import { afterEach, expect, it, vi } from 'vitest';
import { api, installSkill, deleteSkill } from '../../renderer/src/api/bridge';
const original = window.xiaokDesktop;
afterEach(() => { window.xiaokDesktop = original; vi.restoreAllMocks(); });
it('market install adapter rejects a business failure so ensureInstalledAndDefault cannot continue', async () => {
  const install = vi.fn().mockResolvedValue({ success: false, message: 'owned_failure' }); window.xiaokDesktop = { ...original, installSkill: install };
  await expect(installSkill('', { skill_key: 'owned', version: '1' })).rejects.toThrow('owned_failure'); expect(install).toHaveBeenCalledExactlyOnceWith('owned');
});
it.each(['installSkill', 'uninstallSkill'] as const)('actual bridge preserves %s rejection', async method => {
  const failure = Error('owned_transport_failure'); window.xiaokDesktop = { ...original, [method]: vi.fn().mockRejectedValue(failure) };
  await expect(api[method]('owned')).rejects.toBe(failure);
});
it('market delete adapter preserves the existing business-failure rejection', async () => {
  window.xiaokDesktop = { ...original, uninstallSkill: vi.fn().mockResolvedValue({ success: false, message: 'owned_failure' }) };
  await expect(deleteSkill('', { skill_key: 'owned', version: '1' })).rejects.toThrow('owned_failure');
});
it('market install adapter retains the successful result and exact slug', async () => {
  const result = { success: true, message: 'owned_ok' }, install = vi.fn().mockResolvedValue(result); window.xiaokDesktop = { ...original, installSkill: install };
  expect(await installSkill('', { skill_key: 'owned', version: '1' })).toBe(result); expect(install).toHaveBeenCalledExactlyOnceWith('owned');
});
