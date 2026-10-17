import { describe, expect, it } from 'vitest';
import { reportDiagnosticSafely } from '../../electron/diagnostic-isolation.js';

describe('internal synchronous diagnostic isolation', () => {
  it('does not build facts when no observer exists', () => {
    const state = { active: false };
    let reads = 0, builds = 0;
    reportDiagnosticSafely<number>(state, () => { reads += 1; return undefined; }, () => { builds += 1; return 7; });
    expect({ reads, builds, active: state.active }).toEqual({ reads: 1, builds: 0, active: false });
  });

  it('isolates an actual throwing observer getter before facts are built', () => {
    const state = { active: false };
    let reads = 0, builds = 0;
    const options = { get observer(): ((fact: number) => void) | undefined { reads += 1; throw new Error('getter failed'); } };
    expect(() => reportDiagnosticSafely<number>(state, () => options.observer, () => { builds += 1; return 7; })).not.toThrow();
    expect({ reads, builds, active: state.active }).toEqual({ reads: 1, builds: 0, active: false });
  });

  it('captures a changing getter once and invokes that captured observer once', () => {
    const state = { active: false };
    let reads = 0;
    const observed: number[] = [];
    const options = { get observer(): (fact: number) => void {
      reads += 1;
      if (reads > 1) throw new Error('unexpected second getter read');
      return fact => { observed.push(fact); };
    } };
    reportDiagnosticSafely<number>(state, () => options.observer, () => 7);
    expect(reads).toBe(1);
    expect(observed).toEqual([7]);
    expect(state.active).toBe(false);
  });

  it('isolates fact construction failure and does not call the observer', () => {
    const state = { active: false };
    let calls = 0;
    expect(() => reportDiagnosticSafely<number>(state, () => () => { calls += 1; }, () => { throw new Error('facts failed'); })).not.toThrow();
    expect(calls).toBe(0);
    expect(state.active).toBe(false);
  });

  it('isolates callback throws and resets the guard for a later real emission', () => {
    const state = { active: false };
    let calls = 0;
    expect(() => reportDiagnosticSafely<number>(state, () => () => { calls += 1; throw new Error('callback failed'); }, () => 7)).not.toThrow();
    const observed: number[] = [];
    reportDiagnosticSafely<number>(state, () => fact => { observed.push(fact); }, () => 8);
    expect(calls).toBe(1);
    expect(observed).toEqual([8]);
    expect(state.active).toBe(false);
  });

  it('suppresses recursive reporting from a getter without re-reading that getter', () => {
    const state = { active: false };
    let reads = 0, builds = 0;
    const observed: number[] = [];
    const options = { get observer(): (fact: number) => void {
      reads += 1;
      reportDiagnosticSafely<number>(state, () => options.observer, () => { builds += 1; return 99; });
      return fact => { observed.push(fact); };
    } };
    reportDiagnosticSafely<number>(state, () => options.observer, () => { builds += 1; return 7; });
    expect({ reads, builds, active: state.active }).toEqual({ reads: 1, builds: 1, active: false });
    expect(observed).toEqual([7]);
  });

  it('suppresses recursive reporting from the callback before accessing another observer', () => {
    const state = { active: false };
    let nestedReads = 0, nestedBuilds = 0;
    reportDiagnosticSafely<number>(state, () => () => {
      reportDiagnosticSafely<number>(state, () => { nestedReads += 1; return undefined; }, () => { nestedBuilds += 1; return 99; });
    }, () => 7);
    expect({ nestedReads, nestedBuilds, active: state.active }).toEqual({ nestedReads: 0, nestedBuilds: 0, active: false });
  });

  it('resets after a getter throw so a later valid observer is not suppressed', () => {
    const state = { active: false };
    reportDiagnosticSafely<number>(state, () => { throw new Error('getter failed'); }, () => 7);
    const observed: number[] = [];
    reportDiagnosticSafely<number>(state, () => fact => { observed.push(fact); }, () => 8);
    expect(observed).toEqual([8]);
    expect(state.active).toBe(false);
  });
});
