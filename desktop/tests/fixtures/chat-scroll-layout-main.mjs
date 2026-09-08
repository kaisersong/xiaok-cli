import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', process.env.XIAOK_SCROLL_LAYOUT_PROFILE);
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: Number(process.env.XIAOK_SCROLL_LAYOUT_WIDTH || 1280), height: 820,
    useContentSize: true, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(join(directory, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
