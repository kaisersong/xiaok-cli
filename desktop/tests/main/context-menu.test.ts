import { describe, expect, it, vi } from 'vitest';
import {
  attachDesktopContextMenu,
  buildDesktopContextMenuTemplate,
} from '../../electron/context-menu.js';

describe('desktop context menu', () => {
  it('builds native edit commands for editable fields', () => {
    const template = buildDesktopContextMenuTemplate({
      isEditable: true,
      selectionText: '',
    });

    const roles = template
      .filter((item) => 'role' in item)
      .map((item) => item.role);

    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('keeps a useful non-editable menu and disables copy without selection', () => {
    const template = buildDesktopContextMenuTemplate({
      isEditable: false,
      selectionText: '',
    });

    const roles = template
      .filter((item) => 'role' in item)
      .map((item) => item.role);
    const copy = template.find((item) => 'role' in item && item.role === 'copy');

    expect(roles).toEqual(['copy', 'selectAll']);
    expect(copy).toMatchObject({ enabled: false });
  });

  it('enables copy for selected non-editable text', () => {
    const template = buildDesktopContextMenuTemplate({
      isEditable: false,
      selectionText: 'selected text',
    });

    const copy = template.find((item) => 'role' in item && item.role === 'copy');

    expect(copy).toMatchObject({ role: 'copy', enabled: true });
  });

  it('registers a webContents context-menu handler and opens the native menu', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }, params: { isEditable: boolean; selectionText: string }) => void>();
    const popup = vi.fn();
    const menuApi = {
      buildFromTemplate: vi.fn(() => ({ popup })),
    };
    const window = {
      webContents: {
        on: vi.fn((event: string, listener: (event: { preventDefault(): void }, params: { isEditable: boolean; selectionText: string }) => void) => {
          listeners.set(event, listener);
        }),
      },
    };
    const event = { preventDefault: vi.fn() };

    attachDesktopContextMenu(window as never, menuApi);
    listeners.get('context-menu')?.(event, { isEditable: true, selectionText: 'draft' });

    expect(window.webContents.on).toHaveBeenCalledWith('context-menu', expect.any(Function));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(menuApi.buildFromTemplate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: 'paste' }),
    ]));
    expect(popup).toHaveBeenCalledWith({ window });
  });
});
