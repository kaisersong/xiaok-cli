import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileReplyTargetStore } from '../../src/channels/reply-target-store.js';

describe('reply target store', () => {
  it('persists latest reply targets across store instances', () => {
    const root = join(tmpdir(), `xiaok-reply-target-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'reply-targets.json');

    try {
      const store = new FileReplyTargetStore(filePath);
      store.set('sess_1', {
        chatId: 'robot-1',
        userId: 'openid-1',
        messageId: 'msg-1',
      });

      const reloaded = new FileReplyTargetStore(filePath);
      expect(reloaded.get('sess_1')).toEqual({
        chatId: 'robot-1',
        userId: 'openid-1',
        messageId: 'msg-1',
      });

      reloaded.delete('sess_1');
      expect(new FileReplyTargetStore(filePath).get('sess_1')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
