import { describe, expect, it } from 'vitest';
import { parseComputerUseRecoverableAction } from '../../renderer/src/lib/computer-use-recoverable-action';

describe('parseComputerUseRecoverableAction', () => {
  it('does not render an enablement card for internal reobserve recovery', () => {
    expect(parseComputerUseRecoverableAction(JSON.stringify({
      ok: false,
      code: 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED',
      message: 'Computer Use 连接已恢复。请先重新观察当前界面。',
      retryable: true,
      waitForUserAction: false,
      nextAction: 'observe',
    }), 'fallback')).toBeNull();
  });

  it('fails closed when a response has an action but explicitly forbids waiting', () => {
    expect(parseComputerUseRecoverableAction(JSON.stringify({
      ok: false,
      code: 'COMPUTER_USE_MCP_CONNECT_TIMEOUT',
      message: '连接已恢复。',
      waitForUserAction: false,
      userAction: { type: 'reconnect_computer_use', label: '重新连接' },
    }), 'fallback')).toBeNull();
  });

  it('returns an actionable card only for a real user action', () => {
    expect(parseComputerUseRecoverableAction(JSON.stringify({
      ok: false,
      code: 'COMPUTER_USE_NEEDS_ENABLEMENT',
      message: '需要用户启用。',
      waitForUserAction: true,
      userAction: { type: 'enable_computer_use', label: '启用 Computer Use' },
    }), 'fallback')).toEqual({
      code: 'COMPUTER_USE_NEEDS_ENABLEMENT',
      message: '需要用户启用。',
      actionType: 'enable_computer_use',
      label: '启用 Computer Use',
      status: 'idle',
    });
  });

  it('keeps legacy actionable events that predate waitForUserAction', () => {
    expect(parseComputerUseRecoverableAction(JSON.stringify({
      ok: false,
      code: 'COMPUTER_USE_SCREEN_PERMISSION_REQUIRED',
      message: '需要系统授权。',
      userAction: { type: 'open_system_settings', label: '打开系统设置' },
    }), 'fallback')).toMatchObject({
      code: 'COMPUTER_USE_SCREEN_PERMISSION_REQUIRED',
      actionType: 'open_system_settings',
      label: '打开系统设置',
      status: 'idle',
    });
  });
});
