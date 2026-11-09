import { access, realpath } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import type { SessionProbe, NativeOptions, NativeEvent } from './codex-native-transport.js';
import type { NativeSnapshot, NativeApproval } from '../shared/codex-native-types.js';
export interface NativeActor { requestSource: 'user' | 'agent' | 'scheduler'; actorId: string }
export type Pending = { view: NativeApproval; connection: SessionProbe; threadId: string; turnId: string; digest: string; requestId: string; resolve: (result: unknown) => void; timer: ReturnType<typeof setTimeout> };
export type NativeTaskTurn = Readonly<{ sessionId: string; nativeThreadId: string; turnId: string; generation: number; incarnation: string }>;
export type NativeApprovalInventory = NativeTaskTurn & Readonly<{ inventoryRevision: number; digest: string; questions: readonly Readonly<NativeApproval & { requestDigest: string }>[] }>;
export type Session = { view: NativeSnapshot; nativeId: string | null; client?: SessionProbe; lock: Promise<unknown>; ready: boolean; stopping: boolean; pending: Map<string, Pending>; approvalRevision?: number; turnId?: string; turnGeneration?: number; liveTurn?: boolean; startingTaskTurn?: (turn: NativeTaskTurn) => void; items: Map<string, unknown>; queue: Array<{id:string;text:string}> };
export interface NativeServiceOptions {
  dbPath: string; profileId: string;
  createClient?: (options: NativeOptions) => SessionProbe;
  approvalTimeoutMs?: number; onChanged?: (id: string) => void; onEvent?: (id:string,event:NativeEvent)=>void;
}
export async function findCodexEntry(): Promise<string> {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'node', 'bin'), join(homedir(), '.local', 'bin'), join(homedir(), '.npm-global', 'bin')];
  if (process.platform === 'win32' && process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'));
  for (const dir of dirs.filter(Boolean)) for (const name of process.platform === 'win32' ? ['codex.exe', join('node_modules','@openai','codex','bin','codex.js')] : ['codex']) {
    try { const entry = await realpath(join(dir, name)); await access(entry); return entry; } catch { /* next installation */ }
  }
  throw new Error('codex_not_installed');
}
