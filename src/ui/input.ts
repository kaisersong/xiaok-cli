import * as readline from 'readline';
import { stdin, stdout } from 'process';
import { boldCyan, dim } from './render.js';
import type { SkillMeta } from '../ai/skills/loader.js';
import { appendFileSync } from 'fs';
import type { PermissionMode } from '../ai/permissions/manager.js';
import type { TranscriptLogger } from './transcript.js';
import type { ReplRenderer } from './repl-renderer.js';
import { buildSlashMenuOverlayLines, MAX_MENU_DESCRIPTION_WIDTH } from './repl-state.js';
import { getDisplayWidth } from './display-width.js';
import { sliceByDisplayColumns } from './text-metrics.js';
import { identifyKey, loadKeybindingsSync, resolveAction, type Action } from './keybindings.js';

const DEBUG_LOG = '/tmp/xiaok-debug.log';
const MAX_MENU_VISIBLE_ITEMS = 8;
type MenuItem = { cmd: string; desc: string };
const SAVE_CURSOR = '\x1b[s';
const RESTORE_CURSOR = '\x1b[u';

function log(msg: string) {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

const BASE_SLASH_COMMANDS: MenuItem[] = [
  { cmd: '/exit', desc: 'Exit the chat' },
  { cmd: '/clear', desc: 'Clear the screen' },
  { cmd: '/commit', desc: 'Commit staged changes' },
  { cmd: '/context', desc: 'Show loaded repo context' },
  { cmd: '/doctor', desc: 'Inspect local CLI health' },
  { cmd: '/init', desc: 'Initialize project xiaok settings' },
  { cmd: '/review', desc: 'Summarize current git changes' },
  { cmd: '/pr', desc: 'Create or preview a pull request' },
  { cmd: '/models', desc: 'Switch model' },
  { cmd: '/mode', desc: 'Show or change permission mode' },
  { cmd: '/settings', desc: 'Show active CLI settings' },
  { cmd: '/tasks', desc: 'List workflow tasks' },
  { cmd: '/help', desc: 'Show help' },
];

export interface InputSnapshot {
  input: string;
  cursor: number;
}

export interface InputHistoryState {
  undoStack: InputSnapshot[];
  redoStack: InputSnapshot[];
}

/** 向左找词边界（Ctrl+W / Alt+Left 用） */
export function wordBoundaryLeft(text: string, cursor: number): number {
  let i = cursor;
  // 跳过光标左侧的空白
  while (i > 0 && text[i - 1] === ' ') i--;
  // 跳过非空白（即当前词）
  while (i > 0 && text[i - 1] !== ' ') i--;
  return i;
}

/** 向右找词边界（Alt+Right 用） */
export function wordBoundaryRight(text: string, cursor: number): number {
  let i = cursor;
  // 跳过空白
  while (i < text.length && text[i] === ' ') i++;
  // 跳过非空白（下一个词）
  while (i < text.length && text[i] !== ' ') i++;
  return i;
}

export function getSlashCommands(skills: SkillMeta[]): MenuItem[] {
  const commands = [...BASE_SLASH_COMMANDS];
  for (const skill of skills) {
    const cmd = `/${skill.name}`;
    if (!commands.some((c) => c.cmd === cmd)) {
      commands.push({ cmd, desc: skill.description });
    }
  }
  return commands.sort((a, b) => a.cmd.localeCompare(b.cmd));
}

export function truncateMenuDescription(desc: string, maxWidth: number): string {
  const singleLine = desc.replace(/\s+/g, ' ').trim();
  if (maxWidth <= 0 || singleLine.length === 0) return '';
  if (getDisplayWidth(singleLine) <= maxWidth) return singleLine;
  if (maxWidth <= 3) return '.'.repeat(maxWidth);
  return `${sliceByDisplayColumns(singleLine, 0, maxWidth - 3)}...`;
}

export function getMenuClearSequence(lineCount: number): string {
  if (lineCount <= 0) return '';

  let sequence = '';
  for (let i = 0; i < lineCount; i++) {
    sequence += '\x1b[1B\r\x1b[2K';
  }
  sequence += `\x1b[${lineCount}A\r`;
  return sequence;
}

export function getVisibleMenuItems(
  items: MenuItem[],
  selectedIdx: number,
  maxVisible: number,
): {
  items: MenuItem[];
  selectedOffset: number;
  start: number;
} {
  if (items.length === 0 || maxVisible <= 0) {
    return { items: [], selectedOffset: 0, start: 0 };
  }

  const clampedSelectedIdx = Math.max(0, Math.min(selectedIdx, items.length - 1));
  const visibleCount = Math.min(maxVisible, items.length);
  const maxStart = Math.max(items.length - visibleCount, 0);
  const start = Math.min(Math.max(clampedSelectedIdx - visibleCount + 1, 0), maxStart);
  const visibleItems = items.slice(start, start + visibleCount);

  return {
    items: visibleItems,
    selectedOffset: clampedSelectedIdx - start,
    start,
  };
}

export function cyclePermissionMode(mode: PermissionMode): PermissionMode {
  if (mode === 'default') return 'auto';
  if (mode === 'auto') return 'plan';
  return 'default';
}

export function createInputHistoryState(): InputHistoryState {
  return { undoStack: [], redoStack: [] };
}

export function pushInputHistory(state: InputHistoryState, input: string, cursor: number): InputHistoryState {
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && last.input === input && last.cursor === cursor) {
    return state;
  }

  return {
    undoStack: [...state.undoStack, { input, cursor }],
    redoStack: [],
  };
}

export function undoInputHistory(
  state: InputHistoryState,
  currentInput: string,
  currentCursor: number,
): { history: InputHistoryState; input: string; cursor: number } {
  if (state.undoStack.length <= 1) {
    return { history: state, input: currentInput, cursor: currentCursor };
  }

  const previous = state.undoStack[state.undoStack.length - 2];
  return {
    history: {
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [{ input: currentInput, cursor: currentCursor }, ...state.redoStack],
    },
    input: previous.input,
    cursor: previous.cursor,
  };
}

export function redoInputHistory(
  state: InputHistoryState,
  currentInput: string,
  currentCursor: number,
): { history: InputHistoryState; input: string; cursor: number } {
  const [next, ...remainingRedo] = state.redoStack;
  if (!next) {
    return { history: state, input: currentInput, cursor: currentCursor };
  }

  return {
    history: {
      undoStack: [...state.undoStack, { input: currentInput, cursor: currentCursor }, next],
      redoStack: remainingRedo,
    },
    input: next.input,
    cursor: next.cursor,
  };
}

export class InputReader {
  private history: string[] = [];
  private historyIdx = 0;
  private menuOpen = false;
  private menuItems: MenuItem[] = [];
  private menuIdx = 0;
  private renderedMenuRows = 0;
  private skills: SkillMeta[] = [];
  private onModeCycle?: () => PermissionMode;
  private transcriptLogger?: TranscriptLogger;
  private statusLineProvider?: () => string[];
  constructor(private readonly renderer?: ReplRenderer) {}

  setSkills(skills: SkillMeta[]): void {
    this.skills = skills;
  }

  setModeCycleHandler(handler: () => PermissionMode): void {
    this.onModeCycle = handler;
  }

  setTranscriptLogger(logger: TranscriptLogger | undefined): void {
    this.transcriptLogger = logger;
  }

  setStatusLineProvider(provider: (() => string[]) | undefined): void {
    this.statusLineProvider = provider;
  }

  async read(prompt: string): Promise<string | null> {
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }

    loadKeybindingsSync();

    return new Promise((resolve) => {
      let input = '';
      let cursor = 0;
      let resolved = false;
      let historyState = pushInputHistory(createInputHistoryState(), '', 0);

      const redraw = () => {
        if (this.renderer) {
          const overlayLines = this.menuOpen
            ? buildSlashMenuOverlayLines(
              this.menuItems,
              this.menuIdx,
              stdout.columns ?? 80,
              MAX_MENU_VISIBLE_ITEMS,
            )
            : [];
          const footerLines = this.statusLineProvider?.() ?? [];
          this.renderedMenuRows = overlayLines.length;
          this.renderer.renderInput({ prompt, input, cursor, overlayLines, footerLines });
          return;
        }
        stdout.write(`\r\x1b[K${prompt}${input}`);
        const back = getDisplayWidth(input.slice(cursor));
        if (back > 0) stdout.write(`\x1b[${back}D`);
      };

      const renderMenu = () => {
        if (this.renderer) {
          redraw();
          return;
        }
        if (this.menuItems.length === 0) return;

        log(`renderMenu: items=${this.menuItems.length} idx=${this.menuIdx}`);
        const columns = stdout.columns ?? 80;
        const visibleMenu = getVisibleMenuItems(this.menuItems, this.menuIdx, MAX_MENU_VISIBLE_ITEMS);

        stdout.write(SAVE_CURSOR);
        // 菜单显示在输入框下方
        for (let m = 0; m < visibleMenu.items.length; m++) {
          const item = visibleMenu.items[m];
          const isSelected = m === visibleMenu.selectedOffset;
          const prefix = isSelected ? boldCyan('\u276f') : ' ';
          const cmdStr = isSelected ? boldCyan(item.cmd) : dim(item.cmd);
          const descWidth = Math.min(
            Math.max(columns - getDisplayWidth(item.cmd) - 8, 0),
            MAX_MENU_DESCRIPTION_WIDTH,
          );
          const desc = truncateMenuDescription(item.desc, descWidth);
          const descStr = desc ? `  ${dim(desc)}` : '';
          stdout.write(`\n  ${prefix} ${cmdStr}${descStr}`);
        }

        this.renderedMenuRows = visibleMenu.items.length;
        stdout.write(RESTORE_CURSOR);
      };

      const clearMenu = () => {
        if (this.renderer) {
          this.renderer.clearOverlay();
          this.renderedMenuRows = 0;
          return;
        }
        if (this.renderedMenuRows <= 0) return;
        stdout.write(SAVE_CURSOR);
        stdout.write(getMenuClearSequence(this.renderedMenuRows));
        stdout.write(RESTORE_CURSOR);
        this.renderedMenuRows = 0;
      };

      const clearMenuIfLegacy = () => {
        if (this.menuOpen && !this.renderer) {
          clearMenu();
        }
      };

      const getFilteredCommands = (text: string) =>
        getSlashCommands(this.skills).filter((c) => c.cmd.startsWith(text));

      const syncMenu = (text: string) => {
        log(`syncMenu: text=${JSON.stringify(text)}`);
        this.menuItems = getFilteredCommands(text);
        log(`syncMenu: filtered items=${this.menuItems.length}`);
        if (this.menuItems.length > 0) {
          this.menuIdx = Math.min(this.menuIdx, this.menuItems.length - 1);
          this.menuOpen = true;
          redraw();
        } else {
          this.menuOpen = false;
          this.menuItems = [];
          this.menuIdx = 0;
          this.renderedMenuRows = 0;
          redraw();
        }
      };

      const closeMenu = () => {
        if (this.menuOpen) {
          if (!this.renderer) {
            clearMenu();
          }
          this.menuOpen = false;
          this.menuItems = [];
          this.menuIdx = 0;
          this.renderedMenuRows = 0;
          redraw();
        }
      };

      const done = (result: string | null) => {
        if (resolved) return;
        resolved = true;
        closeMenu();
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();

        // 不清除输入行，因为输入行是固定位置的
        // 只需要换行即可

        if (result !== null && result.trim()) {
          this.history.push(result);
        }
        this.historyIdx = this.history.length;
        resolve(result);
      };

      const onData = (data: Buffer) => {
        const key = data.toString('utf8');
        log(`key pressed: ${JSON.stringify(key)} input=${JSON.stringify(input)} cursor=${cursor}`);
        this.transcriptLogger?.record({ type: 'input_key', key, timestamp: Date.now() });

        // OSC 1337: paste image (iTerm2, Terminal.app, etc.)
        // Format: \x1b]1337;File=name=...;inline=1:<base64>\x07
        if (key.startsWith('\x1b]1337;File=')) {
          const endMarker = key.indexOf('\x07');
          if (endMarker !== -1) {
            const oscContent = key.slice(7, endMarker); // skip \x1b]
            const base64Start = oscContent.indexOf(':');
            if (base64Start !== -1) {
              const base64Data = oscContent.slice(base64Start + 1);
              // Extract filename if available
              const nameMatch = oscContent.match(/name=([^;]+)/);
              const filename = nameMatch ? Buffer.from(nameMatch[1], 'base64').toString('utf8') : 'pasted-image.png';
              // Store as file reference for image-input.ts to handle
              const tempPath = `/tmp/xiaok-pasted-${Date.now()}.png`;
              require('fs').writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));
              input = input.slice(0, cursor) + tempPath + input.slice(cursor);
              cursor += tempPath.length;
              historyState = pushInputHistory(historyState, input, cursor);
              redraw();
              return;
            }
          }
        }

        // Kitty graphics protocol: \x1b_G...;\x1b\\
        if (key.startsWith('\x1b_G')) {
          // Kitty protocol is more complex, for now just note it
          // Full implementation would need to parse the transmission
          return;
        }

        const submitInput = () => {
          if (this.menuOpen && this.menuItems.length > 0) {
            const selected = this.menuItems[this.menuIdx].cmd;
            input = selected;
            cursor = selected.length;
            closeMenu();
            return;
          }

          if (input.trim()) {
            this.transcriptLogger?.record({ type: 'input_submit', value: input, timestamp: Date.now() });
            done(input);
          }
        };

        const applyAutocomplete = () => {
          if (this.menuOpen && this.menuItems.length > 0) {
            const selected = this.menuItems[this.menuIdx].cmd;
            input = selected;
            cursor = selected.length;
            closeMenu();
          } else if (input.startsWith('/')) {
            const matches = getFilteredCommands(input);
            if (matches.length === 1) {
              input = matches[0].cmd;
              cursor = matches[0].cmd.length;
              redraw();
            } else if (matches.length > 1) {
              if (this.renderer) {
                syncMenu(input);
              } else {
                clearMenuIfLegacy();
                redraw();
                syncMenu(input);
              }
            }
          }
        };

        const handleAction = (action: Action): boolean => {
          if (action === 'cancel') {
            done(null);
            return true;
          }

          if (action === 'eof') {
            if (input.length === 0) {
              done(null);
            }
            return true;
          }

          if (action === 'submit') {
            submitInput();
            return true;
          }

          if (action === 'newline') {
            // Shift+Enter: insert newline at cursor
            input = input.slice(0, cursor) + '\n' + input.slice(cursor);
            cursor++;
            historyState = pushInputHistory(historyState, input, cursor);
            redraw();
            return true;
          }

          if (action === 'delete-back') {
            if (cursor > 0) {
              const shouldSyncMenu = input.startsWith('/');
              clearMenuIfLegacy();
              input = input.slice(0, cursor - 1) + input.slice(cursor);
              cursor--;
              historyState = pushInputHistory(historyState, input, cursor);
              redraw();

              if (shouldSyncMenu && input.startsWith('/')) {
                syncMenu(input);
              } else {
                closeMenu();
              }
            }
            return true;
          }

          if (action === 'cursor-left') {
            if (cursor > 0) {
              cursor--;
              redraw();
            }
            return true;
          }

          if (action === 'cursor-right') {
            if (cursor < input.length) {
              cursor++;
              redraw();
            }
            return true;
          }

          if (action === 'shift-tab') {
            if (this.onModeCycle) {
              const nextMode = this.onModeCycle();
              stdout.write(`\n${dim(`权限模式已切换为 ${nextMode}`)}\n`);
              redraw();
            }
            return true;
          }

          if (action === 'history-prev') {
            if (this.menuOpen) {
              this.menuIdx = (this.menuIdx - 1 + this.menuItems.length) % this.menuItems.length;
              if (this.renderer) {
                redraw();
              } else {
                clearMenu();
                renderMenu();
              }
            } else if (this.historyIdx > 0) {
              this.historyIdx--;
              input = this.history[this.historyIdx];
              cursor = input.length;
              redraw();
            }
            return true;
          }

          if (action === 'history-next') {
            if (this.menuOpen) {
              this.menuIdx = (this.menuIdx + 1) % this.menuItems.length;
              if (this.renderer) {
                redraw();
              } else {
                clearMenu();
                renderMenu();
              }
            } else if (this.historyIdx < this.history.length - 1) {
              this.historyIdx++;
              input = this.history[this.historyIdx];
              cursor = input.length;
              redraw();
            } else if (this.historyIdx === this.history.length - 1) {
              this.historyIdx = this.history.length;
              input = '';
              cursor = 0;
              redraw();
            }
            return true;
          }

          if (action === 'cursor-home') {
            cursor = 0;
            redraw();
            return true;
          }

          if (action === 'cursor-end') {
            cursor = input.length;
            redraw();
            return true;
          }

          if (action === 'tab') {
            applyAutocomplete();
            return true;
          }

          if (action === 'undo') {
            const undone = undoInputHistory(historyState, input, cursor);
            historyState = undone.history;
            input = undone.input;
            cursor = undone.cursor;
            redraw();
            return true;
          }

          if (action === 'redo') {
            const redone = redoInputHistory(historyState, input, cursor);
            historyState = redone.history;
            input = redone.input;
            cursor = redone.cursor;
            redraw();
            return true;
          }

          if (action === 'delete-word-back') {
            const newCursor = wordBoundaryLeft(input, cursor);
            if (newCursor < cursor) {
              const shouldSyncMenu = input.startsWith('/');
              clearMenuIfLegacy();
              input = input.slice(0, newCursor) + input.slice(cursor);
              cursor = newCursor;
              historyState = pushInputHistory(historyState, input, cursor);
              redraw();
              if (shouldSyncMenu && input.startsWith('/') && input.length > 0) {
                syncMenu(input);
              } else {
                closeMenu();
              }
            }
            return true;
          }

          if (action === 'word-left') {
            cursor = wordBoundaryLeft(input, cursor);
            redraw();
            return true;
          }

          if (action === 'word-right') {
            cursor = wordBoundaryRight(input, cursor);
            redraw();
            return true;
          }

          if (action === 'delete-to-start') {
            if (cursor > 0) {
              const shouldSyncMenu = input.startsWith('/');
              clearMenuIfLegacy();
              input = input.slice(cursor);
              cursor = 0;
              historyState = pushInputHistory(historyState, input, cursor);
              redraw();
              if (shouldSyncMenu && input.startsWith('/')) {
                syncMenu(input);
              } else {
                closeMenu();
              }
            }
            return true;
          }

          if (action === 'delete-to-end') {
            if (cursor < input.length) {
              const shouldSyncMenu = input.startsWith('/');
              clearMenuIfLegacy();
              input = input.slice(0, cursor);
              historyState = pushInputHistory(historyState, input, cursor);
              redraw();
              if (shouldSyncMenu && input.startsWith('/')) {
                syncMenu(input);
              } else {
                closeMenu();
              }
            }
            return true;
          }

          if (action === 'escape') {
            if (this.menuOpen) {
              closeMenu();
            }
            return true;
          }

          if (action === 'clear-screen') {
            stdout.write('\x1b[2J\x1b[H');
            redraw();
            return true;
          }

          return false;
        };

        // Alt+Left (ESC b) — 词跳左
        if (key === '\x1bb') {
          cursor = wordBoundaryLeft(input, cursor);
          redraw();
          return;
        }

        // Alt+Right (ESC f) — 词跳右
        if (key === '\x1bf') {
          cursor = wordBoundaryRight(input, cursor);
          redraw();
          return;
        }

        const identified = identifyKey(key, 0);
        if (identified && identified.consumed === key.length) {
          const action = resolveAction(identified.key);
          if (action && handleAction(action)) {
            return;
          }
        }

        if (key.length >= 1 && key >= ' ' && !/[\x1b\x7f]/.test(key)) {
          const shouldSyncMenu = input.startsWith('/') || key === '/';
          clearMenuIfLegacy();
          input = input.slice(0, cursor) + key + input.slice(cursor);
          cursor += key.length;
          historyState = pushInputHistory(historyState, input, cursor);
          redraw();

          if (shouldSyncMenu && input.startsWith('/')) {
            syncMenu(input);
          } else if (this.menuOpen) {
            closeMenu();
          }
        }
      };

      if (this.renderer) {
        redraw();
      } else {
        stdout.write(prompt);
      }
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
    });
  }
}
