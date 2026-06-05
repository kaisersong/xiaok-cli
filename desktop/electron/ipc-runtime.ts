import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { ZodSchema } from 'zod';

export type RiskTag =
  | 'fs-read'
  | 'fs-write'
  | 'fs-delete'
  | 'fs-watch'
  | 'shell-open'
  | 'exec'
  | 'network'
  | 'clipboard'
  | 'dialog'
  | 'long-subscription'
  | 'external-process'
  | 'capability-token'
  | 'issues-token'
  | 'internal-mutation'
  | 'fs-write-userData';

export interface IpcSchemaEntry {
  channel: string;
  input: ZodSchema;
  output: ZodSchema;
  sourceFile: string;
  rolloutRound: 1 | 2 | 3;
  riskTags: RiskTag[];
}

export const IPC_SCHEMA_REGISTRY = new Map<string, IpcSchemaEntry>();

let ipcMainImpl: IpcMain | null = null;

export function setIpcMainImpl(impl: IpcMain): void {
  ipcMainImpl = impl;
}

export function setIpcMainForTests(fake: IpcMain): void {
  ipcMainImpl = fake;
}

export function resetIpcSchemaRegistryForTests(): void {
  IPC_SCHEMA_REGISTRY.clear();
}

export function registerIpcHandler<I, O>(opts: {
  channel: string;
  input: ZodSchema<I>;
  output: ZodSchema<O>;
  sourceFile: string;
  rolloutRound: 1 | 2 | 3;
  riskTags?: RiskTag[];
  handler: (input: I, event: IpcMainInvokeEvent) => Promise<O>;
}): void {
  if (!ipcMainImpl) {
    throw new Error('ipcMainImpl not set. Call setIpcMainImpl(ipcMain) before registering handlers.');
  }
  if (IPC_SCHEMA_REGISTRY.has(opts.channel)) {
    throw new Error(
      `IPC channel "${opts.channel}" registered twice (existing: ${IPC_SCHEMA_REGISTRY.get(opts.channel)!.sourceFile})`,
    );
  }
  const entry: IpcSchemaEntry = {
    channel: opts.channel,
    input: opts.input,
    output: opts.output,
    sourceFile: opts.sourceFile,
    rolloutRound: opts.rolloutRound,
    riskTags: opts.riskTags ?? [],
  };
  IPC_SCHEMA_REGISTRY.set(opts.channel, entry);

  ipcMainImpl.handle(opts.channel, async (event: IpcMainInvokeEvent, raw: unknown) => {
    const parsed = opts.input.parse(raw);
    const result = await opts.handler(parsed, event);
    if (process.env.NODE_ENV !== 'production') {
      opts.output.parse(result);
    } else {
      const r = (opts.output as any).safeParse(result);
      if (!r.success) return { ok: false, error: 'ipc_contract_violation' };
    }
    return result;
  });
}
