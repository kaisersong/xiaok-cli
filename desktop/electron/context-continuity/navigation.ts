import { parseContextLink } from '../../shared/context-continuity-types.js';

interface NavigationWindow { getURL(): string; loadURL(url: string): Promise<unknown> }
/** Bounded transient navigation intent. It never resolves content or issues permissions. */
export class ContextLinkNavigation {
  private pending: string | null = null;
  private running?: Promise<void>;
  constructor(private readonly options: { open(): Promise<NavigationWindow>; isTrusted(url: string): boolean }) {}
  accept(raw: string): boolean { const id = parseContextLink(raw); if (!id) return false; this.pending = id; return true; }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.pending) return Promise.resolve();
    const run = (async () => {
      while (this.pending) {
        const window = await this.options.open(), id = this.pending;
        const current = window.getURL(); if (!this.options.isTrusted(current)) throw new Error('untrusted_navigation');
        const target = new URL(current); target.hash = `/context/${id}`;
        await window.loadURL(target.href);
        if (this.pending === id) this.pending = null;
      }
    })();
    this.running = run; void run.finally(() => { if (this.running === run) this.running = undefined; }).catch(() => {}); return run;
  }
}
export function registerContextProtocol(app: { isPackaged: boolean; isDefaultProtocolClient?(scheme: string): boolean; setAsDefaultProtocolClient(scheme: string): boolean }, platform: NodeJS.Platform): boolean {
  if (!app.isPackaged || !['darwin', 'win32'].includes(platform)) return false;
  try { return app.isDefaultProtocolClient?.('xiaok') || app.setAsDefaultProtocolClient('xiaok'); } catch { return false; }
}
