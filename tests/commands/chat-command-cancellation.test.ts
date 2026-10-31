import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import {
  matchesCurrentCommandCancellation,
  observeCommandCancellationReason,
  type CommandCancellationFacts,
} from '../../src/commands/chat-command-cancellation.js';

function localCommandState() {
  const context = new AsyncLocalStorage<object>();
  const liveCommands = new Set<object>();
  const commandCancellations = new WeakMap<object, Set<unknown>>();
  const finalizationReason = new Error('original chat finalization');
  let closed = false;
  let tokenReads = 0;
  const facts: CommandCancellationFacts = {
    isIngressClosed: () => closed,
    finalizationReason,
    currentToken: () => { tokenReads++; return context.getStore(); },
    liveCommands,
    commandCancellations,
  };
  return {
    context, liveCommands, commandCancellations, finalizationReason, facts,
    closeIngress() { closed = true; },
    tokenReads: () => tokenReads,
  };
}

describe('actual command cancellation reason identity', () => {
  it('observes the real AbortController reason for the original live ALS command', () => {
    const state = localCommandState(), token = {}, controller = new AbortController();
    state.liveCommands.add(token); state.commandCancellations.set(token, new Set());
    const cleanup = state.context.run(token, () => observeCommandCancellationReason(controller.signal, state.facts));
    const reason = new DOMException('original ESC', 'AbortError');
    try {
      controller.abort(reason);
      expect(state.context.run(token, () => matchesCurrentCommandCancellation(reason, state.facts))).toBe(true);
      expect(matchesCurrentCommandCancellation(reason, state.facts)).toBe(false);
    } finally { cleanup(); }
  });

  it.each([false, true])('does not replace independent reader B with cancellation A (B has AbortError name=%s)', abortName => {
    const state = localCommandState(), token = {}, controller = new AbortController();
    state.liveCommands.add(token); state.commandCancellations.set(token, new Set());
    const cleanup = state.context.run(token, () => observeCommandCancellationReason(controller.signal, state.facts));
    const cancellation = new DOMException('cancellation A', 'AbortError');
    const failure = abortName ? new DOMException('reader B', 'AbortError') : new Error('reader B');
    try {
      controller.abort(cancellation);
      expect(state.context.run(token, () => matchesCurrentCommandCancellation(cancellation, state.facts))).toBe(true);
      expect(state.context.run(token, () => matchesCurrentCommandCancellation(failure, state.facts))).toBe(false);
    } finally { cleanup(); }
  });

  it('does not equate a new same-name and same-message error to the actual reason', () => {
    const state = localCommandState(), token = {}, controller = new AbortController();
    state.liveCommands.add(token); state.commandCancellations.set(token, new Set());
    const reason = new DOMException('same text', 'AbortError');
    controller.abort(reason);
    const cleanup = state.context.run(token, () => observeCommandCancellationReason(controller.signal, state.facts));
    try {
      expect(state.context.run(token, () => matchesCurrentCommandCancellation(reason, state.facts))).toBe(true);
      expect(state.context.run(token, () => matchesCurrentCommandCancellation(new DOMException('same text', 'AbortError'), state.facts))).toBe(false);
    } finally { cleanup(); }
  });

  it('captures the original command at observation, even when abort is emitted under another ALS command', () => {
    const state = localCommandState(), original = {}, other = {}, controller = new AbortController();
    for (const token of [original, other]) { state.liveCommands.add(token); state.commandCancellations.set(token, new Set()); }
    const cleanup = state.context.run(original, () => observeCommandCancellationReason(controller.signal, state.facts));
    const reason = new DOMException('original cancellation', 'AbortError');
    try {
      state.context.run(other, () => controller.abort(reason));
      expect(state.context.run(original, () => matchesCurrentCommandCancellation(reason, state.facts))).toBe(true);
      expect(state.context.run(other, () => matchesCurrentCommandCancellation(reason, state.facts))).toBe(false);
    } finally { cleanup(); }
  });

  it('does not classify a retired command merely because its recorded set still contains the reason', () => {
    const state = localCommandState(), token = {}, controller = new AbortController();
    state.liveCommands.add(token); state.commandCancellations.set(token, new Set());
    const cleanup = state.context.run(token, () => observeCommandCancellationReason(controller.signal, state.facts));
    const reason = new DOMException('retired cancellation', 'AbortError');
    try {
      controller.abort(reason); state.liveCommands.delete(token);
      expect(state.commandCancellations.get(token)?.has(reason)).toBe(true);
      expect(state.context.run(token, () => matchesCurrentCommandCancellation(reason, state.facts))).toBe(false);
    } finally { cleanup(); }
  });

  it('removes the real abort listener when the original observation is closed', () => {
    const state = localCommandState(), token = {}, controller = new AbortController();
    state.liveCommands.add(token); state.commandCancellations.set(token, new Set());
    const cleanup = state.context.run(token, () => observeCommandCancellationReason(controller.signal, state.facts));
    cleanup();
    const reason = new DOMException('after listener cleanup', 'AbortError');
    controller.abort(reason);
    expect(state.commandCancellations.get(token)?.size).toBe(0);
    expect(state.context.run(token, () => matchesCurrentCommandCancellation(reason, state.facts))).toBe(false);
  });

  it('uses the exact finalization sentinel only after ingress closes and preserves the short-circuit', () => {
    const state = localCommandState();
    expect(matchesCurrentCommandCancellation(state.finalizationReason, state.facts)).toBe(false);
    const readsBeforeClosing = state.tokenReads();
    state.closeIngress();
    expect(matchesCurrentCommandCancellation(state.finalizationReason, state.facts)).toBe(true);
    expect(state.tokenReads()).toBe(readsBeforeClosing);
    expect(matchesCurrentCommandCancellation(new Error(state.finalizationReason.message), state.facts)).toBe(false);
  });

  it('records no cancellation when observation was made outside an admitted command', () => {
    const state = localCommandState(), controller = new AbortController();
    const cleanup = observeCommandCancellationReason(controller.signal, state.facts);
    const reason = new DOMException('outside command', 'AbortError');
    try {
      controller.abort(reason);
      expect(matchesCurrentCommandCancellation(reason, state.facts)).toBe(false);
    } finally { cleanup(); }
  });
});
