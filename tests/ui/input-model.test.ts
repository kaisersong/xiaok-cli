import { describe, expect, it } from 'vitest';
import { createInputModel } from '../../src/ui/input-model.js';

describe('input-model', () => {
  it('inserts mixed-width text and tracks caret offset', () => {
    const model = createInputModel();
    model.insertText('为什么没有调用kai-report-creator');
    expect(model.getState().value).toBe('为什么没有调用kai-report-creator');
    expect(model.getState().cursorOffset).toBe('为什么没有调用kai-report-creator'.length);
  });

  it('moves left and right across mixed-width text', () => {
    const model = createInputModel('为什么a', '为什么a'.length);
    model.moveLeft();
    model.moveLeft();
    expect(model.getState().cursorOffset).toBe(2);
    model.moveRight();
    expect(model.getState().cursorOffset).toBe(3);
  });

  it('supports backspace and history snapshots', () => {
    const model = createInputModel();
    model.insertText('abc');
    model.backspace();
    expect(model.getState().value).toBe('ab');
    model.pushHistorySnapshot();
    expect(model.getState().history).toEqual(['ab']);
  });

  it('handles multiline input correctly', () => {
    const model = createInputModel();
    // Insert first line
    model.insertText('ABC');
    expect(model.getState().value).toBe('ABC');
    expect(model.getState().cursorOffset).toBe(3);
    // Insert newline (Shift+Enter)
    model.insertText('\n');
    expect(model.getState().value).toBe('ABC\n');
    expect(model.getState().cursorOffset).toBe(4);
    // Insert second line
    model.insertText('DEF');
    expect(model.getState().value).toBe('ABC\nDEF');
    expect(model.getState().cursorOffset).toBe(7);
    // Move cursor to beginning of second line
    model.setValue('ABC\nDEF', 4);
    expect(model.getState().cursorOffset).toBe(4);
    // Insert text at beginning of second line
    model.insertText('X');
    expect(model.getState().value).toBe('ABC\nXDEF');
    // Backspace should delete X
    model.backspace();
    expect(model.getState().value).toBe('ABC\nDEF');
  });

  it('handles backspace across lines correctly', () => {
    const model = createInputModel('ABC\nDEF', 4); // cursor at start of second line
    model.backspace(); // should delete the newline
    expect(model.getState().value).toBe('ABCDEF');
    expect(model.getState().cursorOffset).toBe(3);
  });
});
