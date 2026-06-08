import type { IpcMain } from 'electron';
import type { KSwarmService } from './kswarm-service.js';
import { KSwarmStreamBridge } from './kswarm-stream-bridge.js';

async function kswarmFetch<T>(
  service: Pick<KSwarmService, 'request'> | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  if (!service) return null;
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await service.request(path, opts);
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function kswarmFetchRaw(
  service: Pick<KSwarmService, 'request'> | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!service) return { ok: false, status: 0, data: null };
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await service.request(path, opts);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function kswarmFetchText(
  service: Pick<KSwarmService, 'request'> | null,
  path: string,
): Promise<string | null> {
  if (!service) return null;
  try {
    const res = await service.request(path, { method: 'GET' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function registerKSwarmProxy(
  ipcMain: IpcMain,
  bridge: KSwarmStreamBridge,
  kswarmService: Pick<KSwarmService, 'request'> | null = null,
): void {
  ipcMain.handle('desktop:kswarm:proxy:get', (_event, path: string) =>
    kswarmFetch(kswarmService, 'GET', path));

  ipcMain.handle('desktop:kswarm:proxy:getText', (_event, path: string) =>
    kswarmFetchText(kswarmService, path));

  ipcMain.handle('desktop:kswarm:proxy:post', (_event, path: string, body?: unknown) =>
    kswarmFetch(kswarmService, 'POST', path, body));

  ipcMain.handle('desktop:kswarm:proxy:postJson', async (_event, path: string, body?: unknown) => {
    const result = await kswarmFetchRaw(kswarmService, 'POST', path, body);
    if (!result.data) return null;
    return { ...(result.data as Record<string, unknown>), status: (result.data as any).status ?? result.status };
  });

  ipcMain.handle('desktop:kswarm:proxy:put', (_event, path: string, body?: unknown) =>
    kswarmFetch(kswarmService, 'PUT', path, body));

  ipcMain.handle('desktop:kswarm:proxy:patch', (_event, path: string, body?: unknown) =>
    kswarmFetch(kswarmService, 'PATCH', path, body));

  ipcMain.handle('desktop:kswarm:proxy:delete', async (_event, path: string) => {
    try {
      if (!kswarmService) return false;
      const res = await kswarmService.request(path, { method: 'DELETE' });
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
