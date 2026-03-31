import { describe, expect, it } from 'vitest';
import {
  createInputHistoryState,
  pushInputHistory,
  undoInputHistory,
  redoInputHistory,
} from '../../src/ui/input.js';

describe('input undo redo helpers', () => {
  it('undoes to the previous snapshot', () => {
    let state = createInputHistoryState();
    state = pushInputHistory(state, 'hello', 5);
    state = pushInputHistory(state, 'hello world', 11);

    const undone = undoInputHistory(state, 'hello world', 11);

    expect(undone.input).toBe('hello');
    expect(undone.cursor).toBe(5);
  });

  it('redoes the snapshot after undo', () => {
    let state = createInputHistoryState();
    state = pushInputHistory(state, 'hello', 5);
    state = pushInputHistory(state, 'hello world', 11);

    const undone = undoInputHistory(state, 'hello world', 11);
    const redone = redoInputHistory(undone.history, undone.input, undone.cursor);

    expect(redone.input).toBe('hello world');
    expect(redone.cursor).toBe(11);
  });
});
