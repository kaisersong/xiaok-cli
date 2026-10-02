import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildComputerUseDisabledError,
  isComputerUseAutoConnectEligibleApp,
  normalizeComputerUsePreference,
  saveComputerUsePreference,
} from '../../electron/computer-use-capability-service.js';

describe('computer-use capability service', () => {
  it('retains v2 Windows identity and compares paths with Windows semantics', () => {
    const preference = normalizeComputerUsePreference({ schemaVersion: 2, platform: 'win32', enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true, lastSuccessfulAt: 123,
      lastSuccessfulAppPath: 'C:\\Program Files\\Xiaok', lastSuccessfulAppAsarSha256: 'hash' });
    expect(preference).toMatchObject({ schemaVersion: 2, platform: 'win32' });
    expect(isComputerUseAutoConnectEligibleApp(preference, { platform: 'win32', appPath: 'c:/program files/xiaok',
      isPackaged: true, appAsarSha256: 'hash', installationSource: 'nsis' })).toEqual({ eligible: true });
    expect(isComputerUseAutoConnectEligibleApp(preference, { platform: 'win32', appPath: 'c:/program files/xiaok',
      isPackaged: true, appAsarSha256: 'hash' })).toEqual({ eligible: false, reason: 'installation_source_unverified' });
  });
  it.each([99, '3', null])('cannot overwrite an unknown or invalid preference schema %s', schemaVersion => {
    const root = mkdtempSync(join(tmpdir(), 'cua-future-'));
    try {
      const file = join(root, 'state.json');
      const original = JSON.stringify({ schemaVersion, enabledByUser: true, futureField: 'preserve' });
      writeFileSync(file, original);
      const decoded = normalizeComputerUsePreference(JSON.parse(original));
      expect(decoded.enabledByUser).toBe(false);
      saveComputerUsePreference(file, decoded);
      expect(readFileSync(file, 'utf8')).toBe(original);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('allows auto-connect only for a previously enabled packaged Applications app with matching TeamIdentifier', () => {
    const preference = normalizeComputerUsePreference({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
      lastSuccessfulAppBundleId: 'com.xiaok.desktop',
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulTeamId: 'TEAM123',
    });

    expect(isComputerUseAutoConnectEligibleApp(preference, {
      appPath: '/Applications/xiaok.app',
      bundleId: 'com.xiaok.desktop',
      teamId: 'TEAM123',
      isPackaged: true,
      devServerUrl: undefined,
      nodeEnv: 'production',
    })).toEqual({ eligible: true });
  });

  it('allows an explicitly enabled unsigned Applications build only when its path and app.asar fingerprint match', () => {
    const preference = normalizeComputerUsePreference({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulAppAsarSha256: 'asar-sha-123',
    });

    expect(isComputerUseAutoConnectEligibleApp(preference, {
      appPath: '/Applications/xiaok.app',
      appAsarSha256: 'asar-sha-123',
      isPackaged: true,
      nodeEnv: 'production',
    })).toEqual({ eligible: true });
  });

  it('fails closed for dev server, missing schema, suspended failures, and TeamIdentifier mismatch', () => {
    expect(isComputerUseAutoConnectEligibleApp(normalizeComputerUsePreference({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
      lastSuccessfulTeamId: 'TEAM123',
    }), {
      appPath: '/Applications/xiaok.app',
      bundleId: 'com.xiaok.desktop',
      teamId: 'TEAM123',
      isPackaged: true,
      devServerUrl: 'http://127.0.0.1:5173',
      nodeEnv: 'development',
    })).toEqual({ eligible: false, reason: 'development_build' });

    expect(isComputerUseAutoConnectEligibleApp(normalizeComputerUsePreference({
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
    }), {
      appPath: '/Applications/xiaok.app',
      isPackaged: true,
    })).toEqual({ eligible: false, reason: 'preference_migration_required' });

    expect(isComputerUseAutoConnectEligibleApp(normalizeComputerUsePreference({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
      lastSuccessfulTeamId: 'TEAM123',
      autoConnectSuspendedReason: 'COMPUTER_USE_PERMISSION_INVALID',
    }), {
      appPath: '/Applications/xiaok.app',
      teamId: 'TEAM123',
      isPackaged: true,
    })).toEqual({ eligible: false, reason: 'COMPUTER_USE_PERMISSION_INVALID' });

    expect(isComputerUseAutoConnectEligibleApp(normalizeComputerUsePreference({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
      lastSuccessfulTeamId: 'TEAM123',
    }), {
      appPath: '/Applications/xiaok.app',
      teamId: 'TEAM999',
      isPackaged: true,
    })).toEqual({ eligible: false, reason: 'team_id_mismatch' });

    const unsignedPreference = normalizeComputerUsePreference({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 123,
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulAppAsarSha256: 'asar-sha-123',
    });
    expect(isComputerUseAutoConnectEligibleApp(unsignedPreference, {
      appPath: '/Applications/xiaok.app',
      isPackaged: true,
    })).toEqual({ eligible: false, reason: 'installation_fingerprint_missing' });
    expect(isComputerUseAutoConnectEligibleApp(unsignedPreference, {
      appPath: '/Applications/xiaok-preview.app',
      appAsarSha256: 'asar-sha-123',
      isPackaged: true,
    })).toEqual({ eligible: false, reason: 'app_path_mismatch' });
    expect(isComputerUseAutoConnectEligibleApp(unsignedPreference, {
      appPath: '/Applications/xiaok.app',
      appAsarSha256: 'asar-sha-999',
      isPackaged: true,
    })).toEqual({ eligible: false, reason: 'installation_fingerprint_mismatch' });
  });

  it('uses disabled-by-user error without an enable action when the user explicitly disables Computer Use', () => {
    expect(buildComputerUseDisabledError('COMPUTER_USE_DISABLED_BY_USER')).toEqual({
      ok: false,
      code: 'COMPUTER_USE_DISABLED_BY_USER',
      message: 'Computer Use 已被用户禁用。',
      retryable: false,
      waitForUserAction: true,
    });
  });
});
