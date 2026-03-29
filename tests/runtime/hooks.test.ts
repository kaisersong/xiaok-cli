import { describe, it, expect } from 'vitest';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';

describe('runtime hooks', () => {
  it('delivers emitted events to subscribers', () => {
    const hooks = createRuntimeHooks();
    const seen: string[] = [];

    hooks.on('turn_started', (event) => {
      seen.push(event.turnId);
    });

    hooks.emit({ type: 'turn_started', turnId: 'turn_1', sessionId: 'sess_1' });

    expect(seen).toEqual(['turn_1']);
  });

  it('supports wildcard subscribers for notifications', () => {
    const hooks = createRuntimeHooks();
    const seen: string[] = [];

    hooks.onAny((event) => {
      seen.push(event.type);
    });

    hooks.emit({ type: 'turn_completed', turnId: 'turn_1', sessionId: 'sess_1' });

    expect(seen).toEqual(['turn_completed']);
  });
});
