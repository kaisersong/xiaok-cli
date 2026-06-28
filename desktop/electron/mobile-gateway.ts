import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

export type MobileDesktopHealth = 'online' | 'degraded' | 'offline';

export interface MobileChatMessage {
  id: string;
  conversationId?: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
  deliveryStatus?: 'sending' | 'sent' | 'failed';
}

export interface MobileConversationSummary {
  id: string;
  title: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  lastMessagePreview: string;
  updatedAt: string;
  messageCount: number;
}

export interface MobileRunningTurn {
  id: string;
  title: string;
  status: 'running' | 'waiting' | 'finished';
}

export interface MobileSnapshot {
  desktopName: string;
  health: MobileDesktopHealth;
  lastSyncSequence: number;
  runningTurn: MobileRunningTurn | null;
  messages: MobileChatMessage[];
  conversations: MobileConversationSummary[];
  projects: unknown[];
  approvals: unknown[];
  loops: unknown[];
  artifacts: unknown[];
}

export interface MobileArtifactPreview {
  artifact: unknown;
  contentType: string;
  text?: string;
}

export interface MobileDesktopHello {
  desktopId: string;
  desktopName: string;
  protocol: 'mobile-v1';
  health: MobileDesktopHealth;
  reachableURLs: string[];
}

export type MobileEvent =
  | { type: 'chat.message_appended'; sequence: number; message: MobileChatMessage }
  | { type: 'turn.started'; sequence: number; turn: MobileRunningTurn }
  | { type: 'turn.finished'; sequence: number; turnId: string }
  | { type: 'snapshot.required'; sequence: number };

export type MobileApprovalDecision = 'approve' | 'reject';

export interface MobileGatewayOptions {
  host?: string;
  port?: number;
  desktopName: string;
  desktopId?: string;
  mobileAccessToken?: string;
  getHello?: () => MobileDesktopHello | Promise<MobileDesktopHello>;
  getSnapshot?: () => MobileSnapshot | Promise<MobileSnapshot>;
  sendMessage?: (text: string) => MobileEvent[] | Promise<MobileEvent[]>;
  respondToApproval?: (input: { id: string; decision: MobileApprovalDecision }) => unknown | Promise<unknown>;
  getArtifactPreview?: (artifactId: string) => MobileArtifactPreview | null | Promise<MobileArtifactPreview | null>;
  onRequest?: (event: {
    method: string;
    pathname: string;
    remoteAddress: string | undefined;
    userAgent: string | undefined;
  }) => void;
}

export interface MobileGatewayStatus {
  running: boolean;
  host: string;
  port: number;
  baseURL: string;
  reachableURLs: string[];
}

export interface MobileGateway {
  start(): Promise<MobileGatewayStatus>;
  stop(): Promise<void>;
  getStatus(): MobileGatewayStatus;
}

export interface MobileDesktopIdentity {
  desktopId: string;
  mobileAccessToken: string;
  mobileRelayRoomSecret: string;
  createdAt: string;
}

export interface MobilePairingPayload {
  desktopId: string;
  desktopName: string;
  gatewayURL: string;
  reachableURLs: string[];
  relayUrl?: string;
  relayJwt?: string;
  relayRoomSecret: string;
  deepLink: string;
}

export interface MobileBonjourAdvertiserStatus {
  running: boolean;
  supported: boolean;
}

export interface MobileBonjourAdvertiser {
  start(input: {
    name: string;
    port: number;
    txt: Record<string, string>;
  }): void;
  stop(): void;
  getStatus(): MobileBonjourAdvertiserStatus;
}

export type MobileBonjourSpawnProcess = (
  command: string,
  args: string[],
) => Pick<ChildProcess, 'kill'> | null;

interface NetworkInterfaceLike {
  address: string;
  family: string;
  internal: boolean;
}

export function buildMobileGatewayReachableUrls(input: {
  port: number;
  interfaces?: NodeJS.Dict<NetworkInterfaceLike[]>;
}): string[] {
  const interfaces = input.interfaces ?? networkInterfaces();
  const addresses = new Set<string>();

  for (const values of Object.values(interfaces)) {
    for (const value of values ?? []) {
      if (value.internal || value.family !== 'IPv4') continue;
      if (!value.address || value.address.startsWith('127.')) continue;
      addresses.add(value.address);
    }
  }

  return [...addresses].sort().map((address) => `http://${address}:${input.port}`);
}

export function buildMobilePairingPayload(input: {
  desktopName: string;
  identity: MobileDesktopIdentity;
  gatewayStatus: MobileGatewayStatus;
  relayUrl?: string | null;
  relayJwt?: string | null;
}): MobilePairingPayload {
  const reachableURLs = input.gatewayStatus.reachableURLs
    .filter((url) => !isLoopbackHttpUrl(url));
  const gatewayURL = reachableURLs[0] ?? (
    isLoopbackHttpUrl(input.gatewayStatus.baseURL) ? '' : input.gatewayStatus.baseURL
  );
  const params = new URLSearchParams({
    desktopId: input.identity.desktopId,
    token: input.identity.mobileAccessToken,
    relayRoomSecret: input.identity.mobileRelayRoomSecret,
  });
  if (gatewayURL) params.set('gateway', gatewayURL);
  if (input.relayUrl) params.set('relayUrl', input.relayUrl);
  if (input.relayJwt) params.set('relayJWT', input.relayJwt);

  return {
    desktopId: input.identity.desktopId,
    desktopName: input.desktopName,
    gatewayURL,
    reachableURLs,
    relayUrl: input.relayUrl ?? undefined,
    relayJwt: input.relayJwt ?? undefined,
    relayRoomSecret: input.identity.mobileRelayRoomSecret,
    deepLink: `xiaok://mobile/pair?${params.toString()}`,
  };
}

export function createMobileGateway(options: MobileGatewayOptions): MobileGateway {
  const configuredHost = options.host ?? '0.0.0.0';
  const configuredPort = options.port ?? 47891;
  let server: Server | null = null;
  let currentStatus: MobileGatewayStatus = buildStatus(false, configuredHost, configuredPort);

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    options.onRequest?.({
      method,
      pathname: url.pathname,
      remoteAddress: request.socket.remoteAddress,
      userAgent: request.headers['user-agent'],
    });

    try {
      if (method === 'GET' && isHelloPath(url.pathname)) {
        sendJson(response, 200, await buildHello(options, currentStatus.port));
        return;
      }

      if (method === 'GET' && isSnapshotPath(url.pathname)) {
        if (!isAuthorized(request, options.mobileAccessToken)) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }
        sendJson(response, 200, await buildSnapshot(options));
        return;
      }

      const artifactPreviewId = artifactPreviewIdFromPath(url.pathname);
      if (method === 'GET' && artifactPreviewId) {
        if (!isAuthorized(request, options.mobileAccessToken)) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }
        if (!options.getArtifactPreview) {
          sendJson(response, 404, { error: 'artifact_preview_not_found' });
          return;
        }
        const preview = await options.getArtifactPreview(artifactPreviewId);
        if (!preview) {
          sendJson(response, 404, { error: 'artifact_preview_not_found' });
          return;
        }
        sendJson(response, 200, preview);
        return;
      }

      if (method === 'POST' && isChatSendPath(url.pathname)) {
        if (!isAuthorized(request, options.mobileAccessToken)) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }
        const body = await readJsonBody(request);
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (!text) {
          sendJson(response, 400, { error: 'message_text_required' });
          return;
        }
        const events = options.sendMessage
          ? await options.sendMessage(text)
          : defaultChatEvents(text);
        sendJson(response, 200, { events });
        return;
      }

      if (method === 'POST' && isApprovalRespondPath(url.pathname)) {
        if (!isAuthorized(request, options.mobileAccessToken)) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }
        if (options.respondToApproval) {
          const body = await readJsonBody(request);
          const id = typeof body?.id === 'string' ? body.id.trim() : '';
          const decision = body?.decision === 'approve' || body?.decision === 'reject'
            ? body.decision
            : null;
          if (!id || !decision) {
            sendJson(response, 400, { error: 'approval_decision_required' });
            return;
          }
          const approval = await options.respondToApproval({ id, decision });
          sendJson(response, 200, { approval });
          return;
        }
        sendJson(response, 403, { error: 'desktop_confirmation_required' });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    async start() {
      if (server) return currentStatus;

      server = createServer((request, response) => {
        void handleRequest(request, response);
      });

      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(configuredPort, configuredHost, () => {
          server!.off('error', reject);
          const address = server!.address();
          const port = typeof address === 'object' && address ? address.port : configuredPort;
          currentStatus = buildStatus(true, configuredHost, port);
          resolve();
        });
      });

      return currentStatus;
    },

    async stop() {
      if (!server) return;
      const target = server;
      server = null;
      await new Promise<void>((resolve, reject) => {
        target.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      currentStatus = buildStatus(false, configuredHost, currentStatus.port);
    },

    getStatus() {
      return currentStatus;
    },
  };
}

export function createMobileBonjourAdvertiser(input: {
  platform?: NodeJS.Platform;
  spawnProcess?: MobileBonjourSpawnProcess;
} = {}): MobileBonjourAdvertiser {
  const platform = input.platform ?? process.platform;
  const spawnProcess = input.spawnProcess ?? ((command, args) => spawn(command, args, {
    stdio: 'ignore',
    detached: false,
  }));
  const supported = platform === 'darwin';
  let child: Pick<ChildProcess, 'kill'> | null = null;

  return {
    start(service) {
      if (!supported) return;
      this.stop();
      const txtRecords = Object.entries(service.txt)
        .filter(([key, value]) => key.length > 0 && value.length > 0)
        .map(([key, value]) => `${key}=${value}`);
      child = spawnProcess('/usr/bin/dns-sd', [
        '-R',
        service.name,
        '_xiaok-desktop._tcp',
        'local.',
        String(service.port),
        ...txtRecords,
      ]);
    },

    stop() {
      child?.kill();
      child = null;
    },

    getStatus() {
      return { running: child !== null, supported };
    },
  };
}

export function loadOrCreateMobileIdentity(dataRoot: string): MobileDesktopIdentity {
  const identityPath = join(dataRoot, 'mobile-identity.json');
  if (existsSync(identityPath)) {
    const parsed = JSON.parse(readFileSync(identityPath, 'utf8')) as Partial<MobileDesktopIdentity>;
    if (parsed.desktopId && parsed.mobileAccessToken && parsed.createdAt) {
      const identity = {
        desktopId: parsed.desktopId,
        mobileAccessToken: parsed.mobileAccessToken,
        mobileRelayRoomSecret: parsed.mobileRelayRoomSecret ?? randomHexSecret(),
        createdAt: parsed.createdAt,
      };
      if (!parsed.mobileRelayRoomSecret) writeMobileIdentity(identityPath, identity);
      return identity;
    }
  }

  mkdirSync(dataRoot, { recursive: true });
  const identity: MobileDesktopIdentity = {
    desktopId: `desktop_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    mobileAccessToken: randomHexSecret() + randomHexSecret(),
    mobileRelayRoomSecret: randomHexSecret(),
    createdAt: new Date().toISOString(),
  };
  writeMobileIdentity(identityPath, identity);
  return identity;
}

function randomHexSecret(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

function writeMobileIdentity(identityPath: string, identity: MobileDesktopIdentity): void {
  const tempPath = `${identityPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, identityPath);
}

function isHelloPath(pathname: string): boolean {
  return pathname === '/v0/mobile/hello' || pathname === '/mobile/v1/hello';
}

function isSnapshotPath(pathname: string): boolean {
  return pathname === '/v0/mobile/snapshot' || pathname === '/mobile/v1/snapshot';
}

function isChatSendPath(pathname: string): boolean {
  return pathname === '/v0/mobile/actions/chat.send' || pathname === '/mobile/v1/actions/chat.send';
}

function isApprovalRespondPath(pathname: string): boolean {
  return pathname === '/v0/mobile/actions/approval.respond' || pathname === '/mobile/v1/actions/approval.respond';
}

function artifactPreviewIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:v0\/mobile|mobile\/v1)\/artifacts\/([^/]+)\/preview$/);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

function isLoopbackHttpUrl(rawValue: string): boolean {
  try {
    const url = new URL(rawValue);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '::1' || host.startsWith('127.');
  } catch {
    return false;
  }
}

async function buildHello(options: MobileGatewayOptions, port: number): Promise<MobileDesktopHello> {
  if (options.getHello) return await options.getHello();
  return {
    desktopId: options.desktopId ?? 'desktop_unconfigured',
    desktopName: options.desktopName,
    protocol: 'mobile-v1',
    health: 'online',
    reachableURLs: buildMobileGatewayReachableUrls({ port }),
  };
}

async function buildSnapshot(options: MobileGatewayOptions): Promise<MobileSnapshot> {
  if (options.getSnapshot) return await options.getSnapshot();
  return {
    desktopName: options.desktopName,
    health: 'online',
    lastSyncSequence: Date.now(),
    runningTurn: null,
    messages: [],
    conversations: [],
    projects: [],
    approvals: [],
    loops: [],
    artifacts: [],
  };
}

function isAuthorized(request: IncomingMessage, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  return request.headers.authorization === `Bearer ${expectedToken}`;
}

function defaultChatEvents(text: string): MobileEvent[] {
  const sequence = Date.now();
  const message: MobileChatMessage = {
    id: `mobile-user-${sequence}`,
    role: 'user',
    text,
    createdAt: new Date(sequence).toISOString(),
  };
  return [
    { type: 'chat.message_appended', sequence, message },
    { type: 'snapshot.required', sequence: sequence + 1 },
  ];
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function buildStatus(running: boolean, host: string, port: number): MobileGatewayStatus {
  const baseHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return {
    running,
    host,
    port,
    baseURL: `http://${baseHost}:${port}`,
    reachableURLs: buildMobileGatewayReachableUrls({ port }),
  };
}
