import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
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
  payloadMode: 'single' | 'tuple';
  inputStage: 'beforeHandler' | 'afterHostAuthorization';
  wireInput?: ZodSchema;
  rolloutRound: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31;
  riskTags: RiskTag[];
}

export const IPC_SCHEMA_REGISTRY = new Map<string, IpcSchemaEntry>();

let registrations = new WeakMap<IpcHandleRegistrar, Map<string, IpcSchemaEntry>>();

let ipcMainImpl: IpcHandleRegistrar | null = null;

export function setIpcMainImpl(impl: IpcHandleRegistrar): void {
  ipcMainImpl = impl;
}

export function setIpcMainForTests(fake: IpcHandleRegistrar): void {
  ipcMainImpl = fake;
}

export function resetIpcSchemaRegistryForTests(): void {
  IPC_SCHEMA_REGISTRY.clear();
  registrations = new WeakMap();
}

export interface IpcStageHelpers<I> {
  parseInput(snapshot: unknown): I;
  onFailure(cleanup: () => void): void;
  fail(error: unknown): never;
}
export interface IpcCleanupFailure { channel: string; originalError: unknown; cleanupError: unknown }
export interface IpcRegistrationOptions<I, O> {
  registrar?: IpcHandleRegistrar;
  channel: string;
  input: ZodSchema<I>;
  output: ZodSchema<O>;
  sourceFile: string;
  rolloutRound: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31;
  riskTags?: RiskTag[];
  handler: (input: I, event: IpcMainInvokeEvent, helpers?: IpcStageHelpers<I>) => Promise<O>;
  /** Main-owned adapters preserve domain error envelopes without granting caller authority. */
  inputError?: (error: unknown) => O;
  outputError?: (error: unknown) => O;
  /** Host-only opt-in: default single consumes the first transport payload. */
  payloadMode?: 'single' | 'tuple';
  inputStage?: 'afterHostAuthorization';
  wireInput?: ZodSchema<I>;
  beforeInput?: (event: IpcMainInvokeEvent) => undefined;
  beforeOutput?: (event: IpcMainInvokeEvent) => undefined;
  captureOutput?: (result: O) => O;
  outputCheck?: (result: O) => undefined;
  cleanupFailureReporter?: (failure: IpcCleanupFailure) => void;
}
export function registerIpcHandler<I extends unknown[], O>(opts: Omit<IpcRegistrationOptions<I, O>, 'payloadMode'> & { payloadMode: 'tuple' }): void;
export function registerIpcHandler<I, O>(opts: Omit<IpcRegistrationOptions<I, O>, 'payloadMode'> & { payloadMode?: 'single' }): void;
export function registerIpcHandler<I, O>(opts: IpcRegistrationOptions<I, O>): void {
  if (opts.inputStage && !opts.wireInput) throw new Error('ipc_staged_wire_schema_required');
  const registrar = opts.registrar ?? ipcMainImpl;
  if (!registrar) {
    throw new Error('ipcMainImpl not set. Call setIpcMainImpl(ipcMain) before registering handlers.');
  }
  const owned = registrations.get(registrar) ?? new Map<string, IpcSchemaEntry>();
  if (owned.has(opts.channel)) {
    throw new Error(
      `IPC channel "${opts.channel}" registered twice (existing: ${owned.get(opts.channel)!.sourceFile})`,
    );
  }
  const entry: IpcSchemaEntry = {
    channel: opts.channel,
    input: opts.input,
    output: opts.output,
    sourceFile: opts.sourceFile,
    payloadMode: opts.payloadMode ?? 'single',
    inputStage: opts.inputStage ?? 'beforeHandler',
    ...(opts.wireInput ? { wireInput: opts.wireInput } : {}),
    rolloutRound: opts.rolloutRound,
    riskTags: opts.riskTags ?? [],
  };
  const validateOutput = (result: O): O | { ok: false; error: string } => {
    if (process.env.NODE_ENV !== 'production') {
      try {
        opts.output.parse(result);
      } catch (error) {
        if (!opts.outputError) throw error;
        const fallback = opts.outputError(error);
        opts.output.parse(fallback);
        return fallback;
      }
    } else {
      const checked = opts.output.safeParse(result);
      if (!checked.success) {
        if (!opts.outputError) return { ok: false, error: 'ipc_contract_violation' };
        const fallback = opts.outputError(checked.error);
        opts.output.parse(fallback);
        return fallback;
      }
    }
    return result;
  };
  registrar.handle(opts.channel, async (event: IpcMainInvokeEvent, ...rawArgs: unknown[]) => {
    const raw = opts.payloadMode === 'tuple' ? rawArgs : rawArgs[0];
    const cleanups: Array<() => void> = [];
    let failed = false, parsedFull = false;
    const report = (originalError: unknown, cleanupError: unknown) => {
      const failure = { channel: opts.channel, originalError, cleanupError };
      try {
        if (opts.cleanupFailureReporter) opts.cleanupFailureReporter(failure);
        else console.error('[ipc] owned cleanup failed', failure);
      } catch (reporterError) {
        console.error('[ipc] cleanup diagnostic failed', failure, reporterError);
      }
    };
    const runFailure = (error: unknown): void => {
      if (failed) return;
      failed = true;
      for (const cleanup of cleanups) {
        try { cleanup(); } catch (cleanupError) { report(error, cleanupError); }
      }
    };
    const helpers: IpcStageHelpers<I> = {
      parseInput(snapshot) {
        if (!opts.inputStage || parsedFull) throw new Error('ipc_staged_input_invalid');
        const result = opts.input.parse(snapshot); parsedFull = true; return result;
      },
      onFailure(cleanup) { if (failed) throw new Error('ipc_failed_scope'); cleanups.push(cleanup); },
      fail(error): never { runFailure(error); throw error; },
    };
    try {
      if (opts.beforeInput && opts.beforeInput(event) !== undefined) throw new Error('ipc_admission_must_be_synchronous');
      let parsed: I;
      try {
        parsed = (opts.inputStage ? opts.wireInput! : opts.input).parse(raw);
      } catch (error) {
        if (!opts.inputError) throw error;
        return validateOutput(opts.inputError(error));
      }
      const result = opts.inputStage ? await opts.handler(parsed, event, helpers) : await opts.handler(parsed, event);
      if (opts.inputStage && !parsedFull) throw new Error('ipc_staged_input_not_validated');
      if (opts.beforeOutput && opts.beforeOutput(event) !== undefined) throw new Error('ipc_output_admission_must_be_synchronous');
      const captured = opts.captureOutput ? opts.captureOutput(result) : result;
      if (opts.outputCheck && opts.outputCheck(captured) !== undefined) throw new Error('ipc_output_check_must_be_synchronous');
      return validateOutput(captured);
    } catch (error) {
      runFailure(error); throw error;
    }
  });
  owned.set(opts.channel, entry);
  registrations.set(registrar, owned);
  IPC_SCHEMA_REGISTRY.set(opts.channel, entry);
}
