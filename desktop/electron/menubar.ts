import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let tray: Tray | null = null;

export function setupMenuBar(window: BrowserWindow): void {
  // Find tray icon - check multiple possible locations
  let iconPath: string | null = null;
  
  const candidates = [
    join(__dirname, 'tray-icon.png'),
    join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main', 'desktop', 'electron', 'tray-icon.png'),
  ];
  
  // If inside asar, try the asar path directly
  if (__dirname.includes('app.asar')) {
    const asarRoot = __dirname.split('app.asar')[0] + 'app.asar';
    candidates.push(join(asarRoot, 'dist', 'main', 'desktop', 'electron', 'tray-icon.png'));
  }
  
  for (const p of candidates) {
    if (existsSync(p)) { iconPath = p; break; }
  }
  
  let trayImage: Electron.NativeImage;
  
  if (iconPath) {
    trayImage = nativeImage.createFromPath(iconPath);
  } else {
    // Fallback: create a simple white dot pattern
    const size = 18;
    const buf = Buffer.alloc(size * size * 4, 0);
    // Draw a small K
    for (let y = 2; y < 16; y++) { buf[(y * size + 2) * 4] = 255; buf[(y * size + 2) * 4 + 3] = 255; }
    for (let i = 0; i < 13; i++) {
      const x = 3 + i, y = 8 - i;
      if (x < 18 && y >= 0) { buf[(y * size + x) * 4] = 255; buf[(y * size + x) * 4 + 3] = 255; }
      const y2 = 8 + i;
      if (x < 18 && y2 < 18) { buf[(y2 * size + x) * 4] = 255; buf[(y2 * size + x) * 4 + 3] = 255; }
    }
    trayImage = nativeImage.createFromBuffer(buf, { width: size, height: size });
  }
  
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
