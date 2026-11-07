import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface DesktopServicePorts { broker: number; kswarm: number }

/** Per Desktop process: concurrent installations must never overwrite each other's endpoint. */
export function desktopServiceDiscoveryFile(): string {
  return process.env.XIAOK_DESKTOP_DISCOVERY_FILE ?? join(process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok'), `desktop-services-${process.pid}.json`);
}
function configuredPort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a port between 1 and 65535`);
  return port;
}
export function configuredDesktopServicePorts(env: NodeJS.ProcessEnv = process.env): DesktopServicePorts {
  return { broker: configuredPort(env.XIAOK_DESKTOP_PORT ?? env.INTENT_BROKER_PORT, 4318, 'XIAOK_DESKTOP_PORT'),
    kswarm: configuredPort(env.KSWARM_PORT, 4400, 'KSWARM_PORT') };
}
async function bindPort(port: number) {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve); });
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}
/** Hold both probes until selected, so the two endpoints cannot select the same port.
 * Sidecars accept port numbers rather than inherited sockets; a later bind race is
 * reported by startup health/identity checks or timeout, never by killing an unknown listener. */
export async function prepareDesktopServicePorts(file = desktopServiceDiscoveryFile(), env: NodeJS.ProcessEnv = process.env): Promise<DesktopServicePorts> {
  const requested = configuredDesktopServicePorts(env);
  const held: Awaited<ReturnType<typeof bindPort>>[] = [];
  try {
    const selected = {} as DesktopServicePorts;
    for (const name of ['broker', 'kswarm'] as const) {
      let server;
      try { server = await bindPort(requested[name]); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        server = await bindPort(0);
      }
      held.push(server);
      selected[name] = (server.address() as { port: number }).port;
    }
    writeDesktopServicePorts(file, selected);
    return selected;
  } catch (error) {
    throw new Error(`Desktop service port setup failed: ${(error as Error).message}`);
  } finally {
    await Promise.all(held.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
}
export function writeDesktopServicePorts(file: string, ports: DesktopServicePorts): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(ports), { mode: 0o600 });
  renameSync(temporary, file);
}
export function readDesktopServicePorts(file = desktopServiceDiscoveryFile()): DesktopServicePorts {
  const value = JSON.parse(readFileSync(file, 'utf8')) as DesktopServicePorts;
  for (const name of ['broker', 'kswarm'] as const) {
    if (typeof value?.[name] !== 'number') throw new Error(`discovery.${name} must be a number`);
    configuredPort(String(value[name]), 0, `discovery.${name}`);
  }
  if (value.broker === value.kswarm) throw new Error('discovery ports must be distinct');
  return { broker: Number(value.broker), kswarm: Number(value.kswarm) };
}
export function desktopServiceUrl(name: keyof DesktopServicePorts, file = desktopServiceDiscoveryFile()): string {
  // Before main's bootstrap (and for standalone callers), preserve configured defaults.
  const ports = existsSync(file) ? readDesktopServicePorts(file) : configuredDesktopServicePorts();
  return `http://127.0.0.1:${ports[name]}`;
}
