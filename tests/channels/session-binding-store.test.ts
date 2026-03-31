import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSessionBindingStore, InMemorySessionBindingStore } from '../../src/channels/session-binding-store.js';

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

  it('persists bindings across store instances', async () => {
    const root = join(tmpdir(), `xiaok-bind-${Date.now()}-persist`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'bindings.json');

    try {
      const store = new FileSessionBindingStore(filePath);
      await store.bind({
        sessionId: 'sess_1',
        chatId: 'robot-1',
        userId: 'openid-1',
        cwd: root,
      });

      const reloaded = new FileSessionBindingStore(filePath);
      expect(reloaded.get('sess_1')?.cwd).toBe(root);
      expect(reloaded.clear('sess_1')).toBe(true);
      expect(new FileSessionBindingStore(filePath).get('sess_1')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
