import { describe, expect, it } from 'vitest';
import { createTerminalController } from '../../src/ui/terminal-controller.js';

describe('terminal-controller surface state', () => {
  it('opens slash overlay from input text', () => {
    const controller = createTerminalController({ prompt: '> ' });
    controller.setSlashCommands([
      { cmd: '/clear', desc: 'Clear the screen' },
      { cmd: '/commit', desc: 'Commit staged changes' },
    ]);
    controller.insertText('/');
    expect(controller.getState().overlay?.type).toBe('slash');
    expect(controller.getState().focusTarget).toBe('input');
  });

  it('opens modal permission request and shifts focus', () => {
    const controller = createTerminalController({ prompt: '> ' });
    controller.openPermissionModal({
      toolName: 'write',
      targetLines: ['文件: /tmp/demo.txt'],
      options: ['允许一次', '拒绝'],
    });
    expect(controller.getState().modal?.type).toBe('permission');
    expect(controller.getState().focusTarget).toBe('modal');
  });
});

describe('terminal-controller', () => {
  it('tracks width-aware cursor edits through the shared input model', () => {
    const controller = createTerminalController({ prompt: '> ' });

    controller.insertText('为什么');
    controller.moveCursorLeft();
    controller.moveCursorLeft();
    controller.insertText('还');

    expect(controller.getState().input).toEqual({
      value: '为还什么',
      cursorOffset: 2,
      history: [],
    });
  });

  it('routes arrow keys to slash overlay selection without moving input focus', () => {
    const controller = createTerminalController({ prompt: '> ' });
    controller.setSlashCommands([
      { cmd: '/clear', desc: 'Clear the screen' },
      { cmd: '/commit', desc: 'Commit staged changes' },
    ]);
    controller.insertText('/');
    controller.handleKey('\x1b[B');
    expect(controller.getState().overlay?.selectedIndex).toBe(1);
    expect(controller.getState().focusTarget).toBe('input');
  });

  it('routes arrow keys to permission modal selection when modal is active', () => {
    const controller = createTerminalController({ prompt: '> ' });
    controller.openPermissionModal({
      toolName: 'write',
      targetLines: ['文件: /tmp/demo.txt'],
      options: ['允许一次', '拒绝'],
    });
    controller.handleKey('\x1b[B');
    expect(controller.getState().modal?.selectedIndex).toBe(1);
    expect(controller.getState().focusTarget).toBe('modal');
  });

  it('restores input focus after closing the permission modal', () => {
    const controller = createTerminalController({ prompt: '> ' });
    controller.insertText('hello');
    controller.openPermissionModal({
      toolName: 'write',
      targetLines: ['文件: /tmp/demo.txt'],
      options: ['允许一次', '拒绝'],
    });

    controller.closeModal();

    expect(controller.getState().modal).toBeNull();
    expect(controller.getState().focusTarget).toBe('input');
    expect(controller.getState().input.value).toBe('hello');
  });
});
