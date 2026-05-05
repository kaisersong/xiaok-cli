import type { DesktopApi } from '../../electron/preload-api.js';

declare global {
  interface Window {
    xiaokDesktop: DesktopApi;
  }
  const __APP_VERSION__: string;
}
