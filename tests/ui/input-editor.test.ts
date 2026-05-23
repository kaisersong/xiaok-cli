import { describe, expect, it } from 'vitest';
import {
  backspace,
  deleteToEnd,
  deleteToStart,
  insertNewline,
  insertText,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  type InputEditorState,
} from '../../src/ui/input-editor.js';

function state(draft: string, cursor = draft.length): InputEditorState {
  return { draft, cursor };
}

describe('input editor mutations', () => {
  it('inserts text at the cursor', () => {
    expect(insertText(state('hello world', 5), ',')).toEqual(state('hello, world', 6));
  });

  it('inserts image placeholders with the same path as regular text', () => {
    expect(insertText(state('see  now', 4), '[image 0]')).toEqual(state('see [image 0] now', 13));
  });

  it('backspaces before the cursor', () => {
    expect(backspace(state('abcd', 2))).toEqual(state('acd', 1));
    expect(backspace(state('abcd', 0))).toEqual(state('abcd', 0));
  });

  it('deletes to the start of the draft', () => {
    expect(deleteToStart(state('hello world', 6))).toEqual(state('world', 0));
  });

  it('deletes to the end of the draft', () => {
    expect(deleteToEnd(state('hello world', 5))).toEqual(state('hello', 5));
  });

  it('inserts newlines at the cursor', () => {
    expect(insertNewline(state('line one', 4))).toEqual(state('line\n one', 5));
  });

  it('moves the cursor left right home and end within bounds', () => {
    expect(moveLeft(state('abc', 0))).toEqual(state('abc', 0));
    expect(moveLeft(state('abc', 2))).toEqual(state('abc', 1));
    expect(moveRight(state('abc', 3))).toEqual(state('abc', 3));
    expect(moveRight(state('abc', 1))).toEqual(state('abc', 2));
    expect(moveHome(state('abc', 2))).toEqual(state('abc', 0));
    expect(moveEnd(state('abc', 1))).toEqual(state('abc', 3));
  });

  it('keeps CJK cursor movement string-index based', () => {
    expect(moveLeft(state('你好a', 2))).toEqual(state('你好a', 1));
    expect(insertText(state('你好', 1), '中')).toEqual(state('你中好', 2));
  });
});
