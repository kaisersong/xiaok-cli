import { describe, expect, it } from 'vitest';
import { shouldStartYZJWebSocket } from '../../src/commands/yzj.js';

describe('yzj command helpers', () => {
  it('does not start websocket client during dry-run verification', () => {
    expect(
      shouldStartYZJWebSocket(
        {
          webhookUrl: 'https://example.com/hook',
          inboundMode: 'websocket',
          webhookPath: '/yzj/webhook',
          webhookPort: 3001,
        },
        { dryRun: true },
      ),
    ).toBe(false);
  });

  it('starts websocket client for normal websocket inbound mode', () => {
    expect(
      shouldStartYZJWebSocket(
        {
          webhookUrl: 'https://example.com/hook',
          inboundMode: 'websocket',
          webhookPath: '/yzj/webhook',
          webhookPort: 3001,
        },
        {},
      ),
    ).toBe(true);
  });
});
