import { describe, expect, it } from 'vitest';
import { resolveXiaokDaemonSocketPath } from '../../../src/runtime/daemon/protocol.js';

// cross-platform 规则：改动 daemon socket 相关逻辑时，至少要有覆盖 Windows 分支的断言。
describe('resolveXiaokDaemonSocketPath', () => {
  it('builds a named pipe path on win32 and a tmp socket otherwise', () => {
    const socketPath = resolveXiaokDaemonSocketPath('user:C:\\Users\\song');
    if (process.platform === 'win32') {
      expect(socketPath).toMatch(/^\\\\\.\\pipe\\xiaok-daemon-[0-9a-f]{16}$/);
      return;
    }
    expect(socketPath).toMatch(/[\\/]xiaok-daemon-[0-9a-f]{16}\.sock$/);
  });

  it('derives a stable id per label and a different id per label', () => {
    expect(resolveXiaokDaemonSocketPath('a:b')).toBe(resolveXiaokDaemonSocketPath('a:b'));
    expect(resolveXiaokDaemonSocketPath('a:b')).not.toBe(resolveXiaokDaemonSocketPath('a:c'));
  });

  it('defaults to the current user identity when no label is given', () => {
    expect(resolveXiaokDaemonSocketPath()).toMatch(/xiaok-daemon-[0-9a-f]{16}/);
  });
});
