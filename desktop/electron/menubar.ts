import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let tray: Tray | null = null;

function tryReadIcon(): Electron.NativeImage {
  // Collect candidate paths
  const candidates: string[] = [
    join(__dirname, 'tray-icon.png'),
    join(__dirname, '..', 'build', 'tray-icon.png'),
    join(__dirname, '..', 'dist', 'main', 'desktop', 'electron', 'tray-icon.png'),
    join(__dirname, '..', 'electron', 'tray-icon.png'),
  ];

  // Inside asar: the path contains 'app.asar', try the asar path too
  if (__dirname.includes('app.asar')) {
    const asarRoot = __dirname.split('app.asar')[0] + 'app.asar';
    candidates.push(join(asarRoot, 'dist', 'main', 'desktop', 'electron', 'tray-icon.png'));
    candidates.push(join(asarRoot, 'electron', 'tray-icon.png'));
  }

  console.log('[menubar] __dirname:', __dirname);
  console.log('[menubar] candidates:', candidates);

  for (const p of candidates) {
    try {
      const buf = readFileSync(p);
      console.log('[menubar] read', p, 'length:', buf.length);
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) {
        console.log('[menubar] icon loaded:', img.getSize());
        return img;
      }
      console.log('[menubar] image empty for', p);
    } catch (e) {
      console.log('[menubar] failed to read', p, String(e));
    }
  }
  console.log('[menubar] no icon found, returning empty');
  return nativeImage.createEmpty();
}

function drawFallbackK(): Electron.NativeImage {
  const size = 18;
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let y = 2; y < 16; y++) { buf[(y * size + 2) * 4] = 255; buf[(y * size + 2) * 4 + 3] = 255; }
  for (let i = 0; i < 13; i++) {
    const x = 3 + i, y = 8 - i;
    if (x < 18 && y >= 0) { buf[(y * size + x) * 4] = 255; buf[(y * size + x) * 4 + 3] = 255; }
    const y2 = 8 + i;
    if (x < 18 && y2 < 18) { buf[(y2 * size + x) * 4] = 255; buf[(y2 * size + x) * 4 + 3] = 255; }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

export function setupMenuBar(window: BrowserWindow): void {
  let trayImage = tryReadIcon();

  if (trayImage.isEmpty()) {
    trayImage = drawFallbackK();
  }

  // For macOS menubar: use template image mode so the icon adapts to system theme.
  // Our icon is now white-on-transparent, which is the correct format for macOS template images.
  trayImage.setTemplateImage(true);

  tray = new Tray(trayImage);
  tray.setToolTip('xiaok desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open xiaok',
      click: () => {
        if (window.isMinimized()) window.restore();
        if (!window.isVisible()) window.show();
        window.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit xiaok',
      click: () => { app.quit(); },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (window.isVisible() && !window.isMinimized()) {
      window.hide();
    } else {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
}

export function destroyMenuBar(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
