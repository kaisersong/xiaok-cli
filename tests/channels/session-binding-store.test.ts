import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemorySessionBindingStore } from '../../src/channels/session-binding-store.js';

describe('session binding store', () => {
  it('binds a session to a real directory and can clear it', async () => {
    const root = join(tmpdir(), `xiaok-bind-${Date.now()}`);
    mkdirSync(root, { recursive: true });

    try {
      const store = new InMemorySessionBindingStore();
      const binding = await store.bind({
        sessionId: 'sess_1',
        chatId: 'robot-1',
        userId: 'openid-1',
        cwd: root,
      });

      expect(binding.cwd).toBe(root);
      expect(store.get('sess_1')?.cwd).toBe(root);
      expect(store.clear('sess_1')).toBe(true);
      expect(store.get('sess_1')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
