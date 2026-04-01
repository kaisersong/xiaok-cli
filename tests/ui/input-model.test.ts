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
});
