import type { ComputerUseActionData } from '../components/ChatView';

export function resolveComputerUseUserAction(actionType: string | undefined, code: string):
  | { type: 'enable' | 'reconnect' }
  | { type: 'settings'; permission: 'accessibility' | 'screen' }
  | null {
  if (actionType === 'enable_computer_use') return { type: 'enable' };
  if (actionType === 'reconnect_computer_use') return { type: 'reconnect' };
  if (actionType !== 'open_system_settings') return null;
  if (['COMPUTER_USE_NEEDS_SCREEN_RECORDING', 'COMPUTER_USE_SCREEN_PERMISSION_REQUIRED'].includes(code)) return { type: 'settings', permission: 'screen' };
  if (['COMPUTER_USE_NEEDS_ACCESSIBILITY', 'COMPUTER_USE_ACCESSIBILITY_PERMISSION_REQUIRED'].includes(code)) return { type: 'settings', permission: 'accessibility' };
  return null;
}

export function parseComputerUseRecoverableAction(
  response: string,
  fallbackMessage: string,
): ComputerUseActionData | null {
  try {
    const parsed = JSON.parse(response) as {
      ok?: unknown;
      code?: unknown;
      message?: unknown;
      waitForUserAction?: unknown;
      userAction?: { type?: unknown; label?: unknown };
    };
    if (
      parsed.ok !== false
      || typeof parsed.code !== 'string'
      || !parsed.code.startsWith('COMPUTER_USE_')
      || parsed.waitForUserAction === false
      || typeof parsed.userAction?.type !== 'string'
      || !parsed.userAction.type.trim()
    ) {
      return null;
    }
    return {
      code: parsed.code,
      message: typeof parsed.message === 'string' ? parsed.message : fallbackMessage,
      actionType: parsed.userAction.type,
      ...(typeof parsed.userAction.label === 'string' ? { label: parsed.userAction.label } : {}),
      status: 'idle',
    };
  } catch {
    return null;
  }
}
