import type { IpcMain } from 'electron';
import { KSwarmStreamBridge } from './kswarm-stream-bridge.js';

const KSWARM_BASE = 'http://127.0.0.1:4400';

async function kswarmFetch<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${KSWARM_BASE}${path}`, opts);
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function kswarmFetchRaw(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${KSWARM_BASE}${path}`, opts);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function registerKSwarmProxy(ipcMain: IpcMain, bridge: KSwarmStreamBridge): void {
  ipcMain.handle('desktop:kswarm:proxy:get', (_event, path: string) =>
    kswarmFetch('GET', path));

  ipcMain.handle('desktop:kswarm:proxy:post', (_event, path: string, body?: unknown) =>
    kswarmFetch('POST', path, body));

  ipcMain.handle('desktop:kswarm:proxy:postJson', async (_event, path: string, body?: unknown) => {
    const result = await kswarmFetchRaw('POST', path, body);
    if (!result.data) return null;
    return { ...(result.data as Record<string, unknown>), status: (result.data as any).status ?? result.status };
  });

  ipcMain.handle('desktop:kswarm:proxy:put', (_event, path: string, body?: unknown) =>
    kswarmFetch('PUT', path, body));

  ipcMain.handle('desktop:kswarm:proxy:patch', (_event, path: string, body?: unknown) =>
    kswarmFetch('PATCH', path, body));

  ipcMain.handle('desktop:kswarm:proxy:delete', async (_event, path: string) => {
    try {
      const res = await fetch(`${KSWARM_BASE}${path}`, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  });

  ipcMain.handle('desktop:kswarm:stream:subscribe', (event) => {
    bridge.subscribe(event);
    return { ok: true };
  });

  ipcMain.handle('desktop:kswarm:stream:unsubscribe', (event) => {
    bridge.unsubscribe(event);
    return { ok: true };
  });

  ipcMain.handle('desktop:kswarm:stream:status', () => {
    return { status: bridge.getConnectionStatus() };
  });

  ipcMain.handle('desktop:connection:healthz', async (_event, url: string) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${url}/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('desktop:connection:health', async (_event, url: string) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });
}
