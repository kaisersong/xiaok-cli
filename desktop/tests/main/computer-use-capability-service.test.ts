import { describe, expect, it } from 'vitest';

import {
  buildComputerUseDisabledError,
  isComputerUseAutoConnectEligibleApp,
  normalizeComputerUsePreference,
} from '../../electron/computer-use-capability-service.js';

describe('computer-use capability service', () => {
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
