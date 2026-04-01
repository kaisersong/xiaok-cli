import { clampOffset, moveOffsetLeft, moveOffsetRight, splitSymbols } from './text-metrics.js';

export interface InputStateSnapshot {
  value: string;
  cursorOffset: number;
  history: string[];
}

export interface InputModel {
  getState(): InputStateSnapshot;
  insertText(text: string): void;
  moveLeft(): void;
  moveRight(): void;
  backspace(): void;
  setValue(value: string, cursorOffset?: number): void;
  pushHistorySnapshot(): void;
}

export function createInputModel(initialValue = '', initialCursorOffset = splitSymbols(initialValue).length): InputModel {
  let state: InputStateSnapshot = {
    value: initialValue,
    cursorOffset: clampOffset(initialValue, initialCursorOffset),
    history: [],
  };

  return {
    getState() {
      return state;
    },
    insertText(text) {
      const symbols = splitSymbols(state.value);
      const nextOffset = clampOffset(state.value, state.cursorOffset);
      symbols.splice(nextOffset, 0, ...splitSymbols(text));
      state = {
        ...state,
        value: symbols.join(''),
        cursorOffset: nextOffset + splitSymbols(text).length,
      };
    },
    moveLeft() {
      state = { ...state, cursorOffset: moveOffsetLeft(state.value, state.cursorOffset) };
    },
    moveRight() {
      state = { ...state, cursorOffset: moveOffsetRight(state.value, state.cursorOffset) };
    },
    backspace() {
      if (state.cursorOffset <= 0) return;
      const symbols = splitSymbols(state.value);
      const nextOffset = moveOffsetLeft(state.value, state.cursorOffset);
      symbols.splice(nextOffset, state.cursorOffset - nextOffset);
      state = {
        ...state,
        value: symbols.join(''),
        cursorOffset: nextOffset,
      };
    },
    setValue(value, cursorOffset = splitSymbols(value).length) {
      state = {
        ...state,
        value,
        cursorOffset: clampOffset(value, cursorOffset),
      };
    },
    pushHistorySnapshot() {
      if (!state.value.trim()) return;
      state = {
        ...state,
        history: [...state.history, state.value],
      };
    },
  };
}
