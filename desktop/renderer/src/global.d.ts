import type { FullDesktopApi } from '../../electron/preload-api.js';

declare global {
  interface Window {
    xiaokDesktop: FullDesktopApi;
  }
  const __APP_VERSION__: string;
  const __APP_BUILD__: string;
}
