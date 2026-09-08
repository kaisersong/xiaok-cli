import type { ComputerUseActionData } from '../components/ChatView';

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
