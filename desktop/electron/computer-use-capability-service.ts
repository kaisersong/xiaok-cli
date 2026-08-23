import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ComputerUseFailureCode =
  | 'COMPUTER_USE_NEEDS_ENABLEMENT'
  | 'COMPUTER_USE_PLUGIN_MISSING'
  | 'COMPUTER_USE_DRIVER_MISSING'
  | 'COMPUTER_USE_NEEDS_ACCESSIBILITY'
  | 'COMPUTER_USE_NEEDS_SCREEN_RECORDING'
  | 'COMPUTER_USE_ATTRIBUTION_MISMATCH'
  | 'COMPUTER_USE_PERMISSION_INVALID'
  | 'COMPUTER_USE_MCP_CONNECT_TIMEOUT'
  | 'COMPUTER_USE_WRAPPER_NOT_READY'
  | 'COMPUTER_USE_MODEL_IMAGE_DISABLED'
  | 'COMPUTER_USE_DISABLED_BY_USER';

export interface ComputerUsePreference {
  schemaVersion?: 1;
  enabledByUser: boolean;
  autoConnectAfterSuccessfulEnablement: boolean;
  lastSuccessfulAt?: number;
  lastSuccessfulAppBundleId?: string;
  lastSuccessfulAppPath?: string;
  lastSuccessfulTeamId?: string;
  lastSuccessfulAppAsarSha256?: string;
  lastDriverVersion?: string;
  lastCuaBundleId?: string;
  lastCuaAppPath?: string;
  /**
   * Removed by design v58 §6.1 (R44-03): `launchMethod` was a persisted field
   * whose only writer was the startup path, and it never described runtime
   * readiness. The decoder below still tolerates the three legacy values so an
   * old config loads, but nothing reads or rewrites them.
   */
  lastFailureCode?: ComputerUseFailureCode;
  autoConnectSuspendedReason?: ComputerUseFailureCode;
  userDeclinedUntil?: number;
}

export interface ComputerUseAppIdentity {
  appPath?: string;
  bundleId?: string;
  teamId?: string;
  appAsarSha256?: string;
  isPackaged: boolean;
  devServerUrl?: string;
  nodeEnv?: string;
}

export type ComputerUseAutoConnectDecision =
  | { eligible: true }
  | { eligible: false; reason: string };

export interface ComputerUseRecoverableError {
  code: ComputerUseFailureCode;
  message: string;
  userAction?: { type: string; label: string };
}

export function loadComputerUsePreference(filePath: string): ComputerUsePreference {
  try {
    if (!existsSync(filePath)) return normalizeComputerUsePreference(null);
    return normalizeComputerUsePreference(JSON.parse(readFileSync(filePath, 'utf-8')));
  } catch {
    return normalizeComputerUsePreference(null);
  }
}

export function saveComputerUsePreference(filePath: string, preference: ComputerUsePreference): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(normalizeComputerUsePreference(preference), null, 2), 'utf-8');
}

export function normalizeComputerUsePreference(raw: unknown): ComputerUsePreference {
  const value = raw && typeof raw === 'object' ? raw as Partial<ComputerUsePreference> : {};
  return {
    ...(value.schemaVersion === 1 ? { schemaVersion: 1 as const } : {}),
    enabledByUser: value.enabledByUser === true,
    autoConnectAfterSuccessfulEnablement: value.autoConnectAfterSuccessfulEnablement !== false,
    ...(typeof value.lastSuccessfulAt === 'number' ? { lastSuccessfulAt: value.lastSuccessfulAt } : {}),
    ...(typeof value.lastSuccessfulAppBundleId === 'string' ? { lastSuccessfulAppBundleId: value.lastSuccessfulAppBundleId } : {}),
    ...(typeof value.lastSuccessfulAppPath === 'string' ? { lastSuccessfulAppPath: value.lastSuccessfulAppPath } : {}),
    ...(typeof value.lastSuccessfulTeamId === 'string' ? { lastSuccessfulTeamId: value.lastSuccessfulTeamId } : {}),
    ...(typeof value.lastSuccessfulAppAsarSha256 === 'string' ? { lastSuccessfulAppAsarSha256: value.lastSuccessfulAppAsarSha256 } : {}),
    ...(typeof value.lastDriverVersion === 'string' ? { lastDriverVersion: value.lastDriverVersion } : {}),
    ...(typeof value.lastCuaBundleId === 'string' ? { lastCuaBundleId: value.lastCuaBundleId } : {}),
    ...(typeof value.lastCuaAppPath === 'string' ? { lastCuaAppPath: value.lastCuaAppPath } : {}),
    ...(isComputerUseFailureCode(value.lastFailureCode) ? { lastFailureCode: value.lastFailureCode } : {}),
    ...(isComputerUseFailureCode(value.autoConnectSuspendedReason) ? { autoConnectSuspendedReason: value.autoConnectSuspendedReason } : {}),
    ...(typeof value.userDeclinedUntil === 'number' ? { userDeclinedUntil: value.userDeclinedUntil } : {}),
  };
}

export function isComputerUseAutoConnectEligibleApp(
  preference: ComputerUsePreference,
  identity: ComputerUseAppIdentity,
): ComputerUseAutoConnectDecision {
  if (preference.schemaVersion !== 1) return { eligible: false, reason: 'preference_migration_required' };
  if (!preference.enabledByUser) return { eligible: false, reason: 'not_enabled_by_user' };
  if (!preference.autoConnectAfterSuccessfulEnablement) return { eligible: false, reason: 'auto_connect_disabled' };
  if (!preference.lastSuccessfulAt) {
    return { eligible: false, reason: 'preference_migration_required' };
  }
  if (preference.autoConnectSuspendedReason) {
    return { eligible: false, reason: preference.autoConnectSuspendedReason };
  }
  if (identity.devServerUrl || identity.nodeEnv === 'development') {
    return { eligible: false, reason: 'development_build' };
  }
  if (!identity.isPackaged) return { eligible: false, reason: 'not_packaged' };
  if (!identity.appPath?.startsWith('/Applications/')) {
    return { eligible: false, reason: 'not_applications_install' };
  }
  if (!identity.teamId) {
    if (preference.lastSuccessfulAppPath !== identity.appPath) {
      return { eligible: false, reason: 'app_path_mismatch' };
    }
    if (!preference.lastSuccessfulAppAsarSha256 || !identity.appAsarSha256) {
      return { eligible: false, reason: 'installation_fingerprint_missing' };
    }
    if (preference.lastSuccessfulAppAsarSha256 !== identity.appAsarSha256) {
      return { eligible: false, reason: 'installation_fingerprint_mismatch' };
    }
    return { eligible: true };
  }
  if (!preference.lastSuccessfulTeamId) {
    return { eligible: false, reason: 'preference_migration_required' };
  }
  if (preference.lastSuccessfulAppBundleId && identity.bundleId && preference.lastSuccessfulAppBundleId !== identity.bundleId) {
    return { eligible: false, reason: 'bundle_id_mismatch' };
  }
  if (preference.lastSuccessfulTeamId !== identity.teamId) {
    return { eligible: false, reason: 'team_id_mismatch' };
  }
  return { eligible: true };
}

export function buildComputerUseDisabledError(code: ComputerUseFailureCode): Record<string, unknown> {
  const message = code === 'COMPUTER_USE_DISABLED_BY_USER'
    ? 'Computer Use 已被用户禁用。'
    : 'Computer Use 当前不可用。';
  return {
    ok: false,
    code,
    message,
    retryable: false,
    waitForUserAction: true,
  };
}

function isComputerUseFailureCode(value: unknown): value is ComputerUseFailureCode {
  return typeof value === 'string' && (
    value === 'COMPUTER_USE_NEEDS_ENABLEMENT' ||
    value === 'COMPUTER_USE_PLUGIN_MISSING' ||
    value === 'COMPUTER_USE_DRIVER_MISSING' ||
    value === 'COMPUTER_USE_NEEDS_ACCESSIBILITY' ||
    value === 'COMPUTER_USE_NEEDS_SCREEN_RECORDING' ||
    value === 'COMPUTER_USE_ATTRIBUTION_MISMATCH' ||
    value === 'COMPUTER_USE_PERMISSION_INVALID' ||
    value === 'COMPUTER_USE_MCP_CONNECT_TIMEOUT' ||
    value === 'COMPUTER_USE_WRAPPER_NOT_READY' ||
    value === 'COMPUTER_USE_MODEL_IMAGE_DISABLED' ||
    value === 'COMPUTER_USE_DISABLED_BY_USER'
  );
}
