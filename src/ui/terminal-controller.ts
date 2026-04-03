import { createInputModel, type InputModel } from './input-model.js';
import type { PermissionModalState } from './modal-state.js';
import type { SlashOverlayItem, SlashOverlayState } from './overlay-state.js';
import type { SurfaceState } from './surface-state.js';

export interface PermissionModalRequest {
  toolName: string;
  targetLines: string[];
  options: string[];
}

export interface TerminalController {
  getState(): SurfaceState;
  setPrompt(prompt: string): void;
  setTerminalSize(columns: number, rows: number): void;
  setSlashCommands(commands: SlashOverlayItem[]): void;
  setFooterLines(lines: string[]): void;
  setOverlayLines(lines: string[]): void;
  insertText(text: string): void;
  moveCursorLeft(): void;
  moveCursorRight(): void;
  backspace(): void;
  handleKey(key: string): void;
  replaceInput(value: string, cursorOffset?: number): void;
  openPermissionModal(request: PermissionModalRequest): void;
  closeModal(): void;
  clearOverlay(): void;
  consumeSubmission(): string | null;
}

function createSlashOverlay(query: string, items: SlashOverlayItem[], previousIndex = 0): SlashOverlayState | null {
  if (!query.startsWith('/')) return null;
  if (items.length === 0) return null;

  return {
    type: 'slash',
    query,
    items,
    selectedIndex: Math.max(0, Math.min(previousIndex, items.length - 1)),
  };
}

export function createTerminalController({ prompt }: { prompt: string }): TerminalController {
  const inputModel: InputModel = createInputModel();
  let slashCommands: SlashOverlayItem[] = [];
  let pendingSubmission: string | null = null;

  let state: SurfaceState = {
    prompt,
    transcript: [],
    input: inputModel.getState(),
    footerLines: [],
    overlay: null,
    modal: null,
    focusTarget: 'input',
    terminalSize: {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    },
  };

  const syncInput = () => {
    state = { ...state, input: inputModel.getState() };
  };

  const syncSlashOverlay = () => {
    const query = inputModel.getState().value;
    const items = query.startsWith('/')
      ? slashCommands.filter((item) => item.cmd.startsWith(query))
      : [];

    state = {
      ...state,
      overlay: createSlashOverlay(query, items, state.overlay?.type === 'slash' ? state.overlay.selectedIndex : 0),
    };
  };

  const acceptSlashSelection = () => {
    if (state.overlay?.type !== 'slash') return false;
    const selected = state.overlay.items[state.overlay.selectedIndex];
    if (!selected) return false;
    inputModel.setValue(selected.cmd);
    syncInput();
    syncSlashOverlay();
    return true;
  };

  return {
    getState() {
      return state;
    },
    setPrompt(nextPrompt) {
      state = { ...state, prompt: nextPrompt };
    },
    setTerminalSize(columns, rows) {
      state = {
        ...state,
        terminalSize: { columns, rows },
      };
    },
    setSlashCommands(commands) {
      slashCommands = commands;
      syncSlashOverlay();
    },
    setFooterLines(lines) {
      state = {
        ...state,
        footerLines: lines,
      };
    },
    setOverlayLines(lines) {
      state = {
        ...state,
        overlay: lines.length > 0 ? { type: 'lines', lines } : null,
      };
    },
    insertText(text) {
      inputModel.insertText(text);
      syncInput();
      syncSlashOverlay();
    },
    moveCursorLeft() {
      inputModel.moveLeft();
      syncInput();
    },
    moveCursorRight() {
      inputModel.moveRight();
      syncInput();
    },
    backspace() {
      inputModel.backspace();
      syncInput();
      syncSlashOverlay();
    },
    handleKey(key) {
      if (state.modal?.type === 'permission') {
        const modal = state.modal;
        if (key === '\x1b[A') {
          state = {
            ...state,
            modal: {
              ...modal,
              selectedIndex: (modal.selectedIndex - 1 + modal.options.length) % modal.options.length,
            },
          };
        }
        if (key === '\x1b[B') {
          state = {
            ...state,
            modal: {
              ...modal,
              selectedIndex: (modal.selectedIndex + 1) % modal.options.length,
            },
          };
        }
        return;
      }

      if (state.overlay?.type === 'slash' && key === '\x1b[A') {
        state = {
          ...state,
          overlay: {
            ...state.overlay,
            selectedIndex: (state.overlay.selectedIndex - 1 + state.overlay.items.length) % state.overlay.items.length,
          },
        };
        return;
      }

      if (state.overlay?.type === 'slash' && key === '\x1b[B') {
        state = {
          ...state,
          overlay: {
            ...state.overlay,
            selectedIndex: (state.overlay.selectedIndex + 1) % state.overlay.items.length,
          },
        };
        return;
      }

      if ((key === '\r' || key === '\n') && acceptSlashSelection()) {
        return;
      }
    },
    replaceInput(value, cursorOffset) {
      inputModel.setValue(value, cursorOffset);
      syncInput();
      syncSlashOverlay();
    },
    openPermissionModal(request) {
      const modal: PermissionModalState = {
        type: 'permission',
        toolName: request.toolName,
        targetLines: request.targetLines,
        options: request.options,
        selectedIndex: 0,
      };
      state = {
        ...state,
        modal,
        focusTarget: 'modal',
      };
    },
    closeModal() {
      state = {
        ...state,
        modal: null,
        focusTarget: 'input',
      };
    },
    clearOverlay() {
      state = {
        ...state,
        overlay: null,
      };
    },
    consumeSubmission() {
      const value = pendingSubmission;
      pendingSubmission = null;
      return value;
    },
  };
}
