import type {ChildProcess} from 'node:child_process';
import type {MobileDisclosureOptions} from './mobile-disclosure.js';

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
  fileName?: string;
  dataBase64?: string;
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

export interface MobileGatewayOptions extends MobileDisclosureOptions {
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

