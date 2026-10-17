import { describe, expect, it } from 'vitest';
import {
  emitThreadDeletionPhase, parseThreadDeletionPhase, collectThreadDeletionPhase,
  THREAD_DELETION_DIAGNOSTIC_PREFIX, THREAD_DELETION_DIAGNOSTIC_LIMIT,
  type ThreadDeletionPhaseFact, type ThreadDeletionDiagnosticConsole, type ThreadDeletionDiagnosticBuffer,
} from '../../renderer/src/api/thread-deletion-diagnostics';

const fact: ThreadDeletionPhaseFact = { attemptOrdinal: 1, phase: 'delete_enter', taskOrdinal: 0 };
const wire = THREAD_DELETION_DIAGNOSTIC_PREFIX + '{"attemptOrdinal":1,"phase":"delete_enter","taskOrdinal":0}';
function buffer(): ThreadDeletionDiagnosticBuffer { return { facts: [], overflow: 0, parseFailures: 0, readFailures: 0 }; }

describe('real renderer deletion diagnostic helper, without application or SDK owners', () => {
  it('captures console and debug once, preserves callback receiver and projects scalar fields only', () => {
    const state = { active: false };
    let consoleReads = 0, debugReads = 0, factBuilds = 0;
    let receiver: ThreadDeletionDiagnosticConsole | undefined;
    const messages: string[] = [];
    const logger: ThreadDeletionDiagnosticConsole = { get debug() {
      debugReads += 1;
      return function(this: ThreadDeletionDiagnosticConsole, text: string) { receiver = this; messages.push(text); };
    } };
    const extra = { ...fact, unrelatedPrivateValue: 'must-not-serialize' };
    emitThreadDeletionPhase(state, () => { consoleReads += 1; return logger; }, () => { factBuilds += 1; return extra; });
    expect({ consoleReads, debugReads, factBuilds, active: state.active }).toEqual({ consoleReads: 1, debugReads: 1, factBuilds: 1, active: false });
    expect(receiver).toBe(logger);
    expect(messages).toEqual([wire]);
  });

  it('isolates console acquisition failure before fact construction', () => {
    const state = { active: false };
    let factBuilds = 0;
    expect(() => emitThreadDeletionPhase(state, () => { throw new Error('console getter failed'); }, () => { factBuilds += 1; return fact; })).not.toThrow();
    expect(factBuilds).toBe(0);
    expect(state.active).toBe(false);
  });

  it('isolates an actual debug getter failure without a second getter read', () => {
    const state = { active: false };
    let reads = 0, factBuilds = 0;
    const logger: ThreadDeletionDiagnosticConsole = { get debug(): (text: string) => void { reads += 1; throw new Error('debug getter failed'); } };
    expect(() => emitThreadDeletionPhase(state, () => logger, () => { factBuilds += 1; return fact; })).not.toThrow();
    expect({ reads, factBuilds, active: state.active }).toEqual({ reads: 1, factBuilds: 0, active: false });
  });

  it('does not build facts when debug is absent', () => {
    const state = { active: false };
    let factBuilds = 0;
    emitThreadDeletionPhase(state, () => ({}), () => { factBuilds += 1; return fact; });
    expect(factBuilds).toBe(0);
    expect(state.active).toBe(false);
  });

  it('isolates fact construction failure without calling debug', () => {
    const state = { active: false };
    let calls = 0;
    expect(() => emitThreadDeletionPhase(state, () => ({ debug() { calls += 1; } }), () => { throw new Error('fact failed'); })).not.toThrow();
    expect(calls).toBe(0);
    expect(state.active).toBe(false);
  });

  it('isolates callback throws and permits the next emission after guard reset', () => {
    const state = { active: false };
    expect(() => emitThreadDeletionPhase(state, () => ({ debug() { throw new Error('debug failed'); } }), () => fact)).not.toThrow();
    const messages: string[] = [];
    emitThreadDeletionPhase(state, () => ({ debug(text) { messages.push(text); } }), () => fact);
    expect(messages).toEqual([wire]);
    expect(state.active).toBe(false);
  });

  it('blocks a recursive console acquisition before nested getter or facts', () => {
    const state = { active: false };
    let nestedReads = 0, nestedBuilds = 0;
    const messages: string[] = [];
    emitThreadDeletionPhase(state, () => {
      emitThreadDeletionPhase(state, () => { nestedReads += 1; return {}; }, () => { nestedBuilds += 1; return fact; });
      return { debug(text) { messages.push(text); } };
    }, () => fact);
    expect({ nestedReads, nestedBuilds, active: state.active }).toEqual({ nestedReads: 0, nestedBuilds: 0, active: false });
    expect(messages).toEqual([wire]);
  });

  it('blocks recursive debug callback reporting before nested acquisition', () => {
    const state = { active: false };
    let nestedReads = 0;
    emitThreadDeletionPhase(state, () => ({ debug() {
      emitThreadDeletionPhase(state, () => { nestedReads += 1; return {}; }, () => fact);
    } }), () => fact);
    expect(nestedReads).toBe(0);
    expect(state.active).toBe(false);
  });

  it('parses only the exact prefix and retains a zero task ordinal', () => {
    expect(parseThreadDeletionPhase(wire)).toEqual({ kind: 'fact', fact });
    expect(parseThreadDeletionPhase('other ' + wire)).toEqual({ kind: 'unrelated' });
  });

  it('rejects malformed or non-scalar diagnostic payloads without retaining raw text', () => {
    const invalid = ['{', 'null', '[]', '{}',
      '{"attemptOrdinal":0,"phase":"delete_enter"}',
      '{"attemptOrdinal":1.5,"phase":"delete_enter"}',
      '{"attemptOrdinal":1,"phase":"unrecognized"}',
      '{"attemptOrdinal":1,"phase":"delete_enter","taskOrdinal":-1}',
      '{"attemptOrdinal":1,"phase":"delete_enter","taskOrdinal":null}',
      '{"attemptOrdinal":1,"phase":"delete_enter","rawError":"not-retained"}'];
    for (const text of invalid) expect(parseThreadDeletionPhase(THREAD_DELETION_DIAGNOSTIC_PREFIX + text)).toEqual({ kind: 'invalid' });
  });

  it('caps the actual collector at 64 facts and counts each overflow', () => {
    const collected = buffer();
    for (let i = 0; i < THREAD_DELETION_DIAGNOSTIC_LIMIT + 2; i += 1) collectThreadDeletionPhase(collected, wire);
    expect(collected.facts).toHaveLength(64);
    expect(collected.overflow).toBe(2);
    expect(collected.parseFailures).toBe(0);
  });

  it('ignores unrelated console text and reports malformed prefixed input explicitly', () => {
    const collected = buffer();
    collectThreadDeletionPhase(collected, 'unrelated console message');
    collectThreadDeletionPhase(collected, THREAD_DELETION_DIAGNOSTIC_PREFIX + '{');
    expect(collected).toEqual({ facts: [], overflow: 0, parseFailures: 1, readFailures: 0 });
  });
});
