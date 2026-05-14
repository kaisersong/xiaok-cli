import { describe, expect, it } from 'vitest';
import {
  artifactEditingReducer,
  INITIAL_STATE,
  type ArtifactEditingState,
  type ArtifactEditingAction,
} from '../../renderer/src/hooks/artifact-editing-state';

describe('artifact-editing-state', () => {
  function reduce(state: ArtifactEditingState, ...actions: ArtifactEditingAction[]): ArtifactEditingState {
    return actions.reduce(artifactEditingReducer, state);
  }

  it('initial state is preview', () => {
    expect(INITIAL_STATE).toBe('preview');
  });

  it('preview → annotating via START_ANNOTATING', () => {
    expect(reduce('preview', { type: 'START_ANNOTATING' })).toBe('annotating');
  });

  it('annotating → preview via CANCEL_ANNOTATING', () => {
    expect(reduce('annotating', { type: 'CANCEL_ANNOTATING' })).toBe('preview');
  });

  it('annotating → submitted via SUBMIT', () => {
    expect(reduce('annotating', { type: 'SUBMIT' })).toBe('submitted');
  });

  it('submitted → reviewing via FILE_CHANGED', () => {
    expect(reduce('submitted', { type: 'FILE_CHANGED' })).toBe('reviewing');
  });

  it('submitted → timeout_idle via TIMEOUT', () => {
    expect(reduce('submitted', { type: 'TIMEOUT' })).toBe('timeout_idle');
  });

  it('timeout_idle → annotating via START_ANNOTATING', () => {
    expect(reduce('timeout_idle', { type: 'START_ANNOTATING' })).toBe('annotating');
  });

  it('reviewing → annotating via START_ANNOTATING (continue annotating)', () => {
    expect(reduce('reviewing', { type: 'START_ANNOTATING' })).toBe('annotating');
  });

  it('reviewing → done via FINISH', () => {
    expect(reduce('reviewing', { type: 'FINISH' })).toBe('done');
  });

  it('any state → preview via RESET', () => {
    const states: ArtifactEditingState[] = ['annotating', 'submitted', 'timeout_idle', 'reviewing', 'done'];
    for (const s of states) {
      expect(reduce(s, { type: 'RESET' })).toBe('preview');
    }
  });

  // Invalid transitions should not change state
  it('preview ignores SUBMIT', () => {
    expect(reduce('preview', { type: 'SUBMIT' })).toBe('preview');
  });

  it('preview ignores FILE_CHANGED', () => {
    expect(reduce('preview', { type: 'FILE_CHANGED' })).toBe('preview');
  });

  it('reviewing ignores TIMEOUT', () => {
    expect(reduce('reviewing', { type: 'TIMEOUT' })).toBe('reviewing');
  });

  it('annotating ignores TIMEOUT', () => {
    expect(reduce('annotating', { type: 'TIMEOUT' })).toBe('annotating');
  });

  // Full flow
  it('full flow: preview → annotating → submitted → reviewing → done', () => {
    let s: ArtifactEditingState = 'preview';
    s = artifactEditingReducer(s, { type: 'START_ANNOTATING' });
    expect(s).toBe('annotating');
    s = artifactEditingReducer(s, { type: 'SUBMIT' });
    expect(s).toBe('submitted');
    s = artifactEditingReducer(s, { type: 'FILE_CHANGED' });
    expect(s).toBe('reviewing');
    s = artifactEditingReducer(s, { type: 'FINISH' });
    expect(s).toBe('done');
  });

  it('timeout recovery flow: submitted → timeout_idle → annotating → submitted', () => {
    let s: ArtifactEditingState = 'submitted';
    s = artifactEditingReducer(s, { type: 'TIMEOUT' });
    expect(s).toBe('timeout_idle');
    s = artifactEditingReducer(s, { type: 'START_ANNOTATING' });
    expect(s).toBe('annotating');
    s = artifactEditingReducer(s, { type: 'SUBMIT' });
    expect(s).toBe('submitted');
  });
});
