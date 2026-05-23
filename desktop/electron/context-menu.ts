import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from 'electron';

export type DesktopContextMenuParams = Pick<ContextMenuParams, 'isEditable' | 'selectionText'>;

export interface DesktopMenuApi {
  buildFromTemplate(template: MenuItemConstructorOptions[]): {
    popup(options: { window: BrowserWindow }): void;
  };
}

type ContextMenuEvent = {
  preventDefault(): void;
};

export function buildDesktopContextMenuTemplate(params: DesktopContextMenuParams): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    return [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' },
    ];
  }

  return [
    { role: 'copy', enabled: params.selectionText.length > 0 },
    { type: 'separator' },
    { role: 'selectAll' },
  ];
}

export function attachDesktopContextMenu(window: BrowserWindow, menuApi: DesktopMenuApi): void {
  window.webContents.on('context-menu', (event: ContextMenuEvent, params: ContextMenuParams) => {
    event.preventDefault();
    const menu = menuApi.buildFromTemplate(buildDesktopContextMenuTemplate(params));
    menu.popup({ window });
  });
}
