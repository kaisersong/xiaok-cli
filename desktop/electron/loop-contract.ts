import type { CreateUserLoopTemplateInput } from './loop-types.js';

export type LoopContractSchemaVersion = 'loop_contract_v1';

export type LoopSuccessCriterion =
  | { kind: 'task_completed'; strength: 'weak' | 'strong' }
  | { kind: 'file_exists'; pathTemplate: string; minBytes?: number; expectedMime?: string }
  | { kind: 'command_exit_zero'; commandId: string; args: string[]; cwdPolicy: 'workspace' | 'output_dir' };

export interface LoopStopPolicy {
  maxConsecutiveFailures?: number;
}

export interface LoopPermissionPolicy {
  mode: 'read_only' | 'workspace_write' | 'project_mutation' | 'external_side_effect';
  autoRunApproved: boolean;
  allowedToolCategories: string[];
  approvedTargetRefs?: string[];
}

export interface LoopConcurrencyPolicy {
  perLoop: 'skip_if_running' | 'queue_latest' | 'cancel_previous' | 'parallel';
  coalesceMissedRuns: boolean;
}

export interface LoopLegacyPolicy {
  requiresHumanApprovalBeforeBackgroundSuccess?: boolean;
  legacyWeakModeAuditRef?: string;
  grandfatheredOutputTargetRefs?: string[];
}

export interface LoopContractV1 {
  schemaVersion: LoopContractSchemaVersion;
  objective: string;
  triggerPolicy: { kind: 'manual' };
  successCriteria: LoopSuccessCriterion[];
  stopPolicy: LoopStopPolicy;
  permissionPolicy: LoopPermissionPolicy;
  concurrencyPolicy: LoopConcurrencyPolicy;
  legacyPolicy?: LoopLegacyPolicy;
}

export interface ParseLoopContractOptions {
  registeredCriteria: string[];
}

const LOOP_CONTRACT_FIELDS = new Set([
  'schemaVersion',
  'objective',
  'triggerPolicy',
  'successCriteria',
  'stopPolicy',
  'permissionPolicy',
  'concurrencyPolicy',
  'legacyPolicy',
]);
const UNSAFE_COMMAND_ARG_PATTERN = /[\0\r\n;&|<>`$"'\\]/;

export function parseLoopContractV1(raw: unknown, options: ParseLoopContractOptions): LoopContractV1 {
  const record = asRecord(raw, 'LoopContract');
  for (const key of Object.keys(record)) {
    if (!LOOP_CONTRACT_FIELDS.has(key)) throw new Error(`Unknown LoopContract field: ${key}`);
  }
  if (record.schemaVersion !== 'loop_contract_v1') {
    throw new Error(`Unsupported LoopContract schemaVersion: ${String(record.schemaVersion)}`);
  }
  const objective = readNonEmptyString(record.objective, 'LoopContract objective');
  const triggerPolicy = parseTriggerPolicy(record.triggerPolicy);
  const successCriteria = parseSuccessCriteria(record.successCriteria, options);
  const stopPolicy = parseStopPolicy(record.stopPolicy);
  const permissionPolicy = parsePermissionPolicy(record.permissionPolicy);
  const concurrencyPolicy = parseConcurrencyPolicy(record.concurrencyPolicy);
  const legacyPolicy = record.legacyPolicy === undefined
    ? undefined
    : parseLegacyPolicy(record.legacyPolicy);
  const parsed: LoopContractV1 = {
    schemaVersion: 'loop_contract_v1',
    objective,
    triggerPolicy,
    successCriteria,
    stopPolicy,
    permissionPolicy,
    concurrencyPolicy,
  };
  if (legacyPolicy) parsed.legacyPolicy = legacyPolicy;
  return parsed;
}

export function createDefaultLoopContract(input: CreateUserLoopTemplateInput): LoopContractV1 {
  const base = {
    schemaVersion: 'loop_contract_v1' as const,
    objective: input.prompt,
    triggerPolicy: { kind: 'manual' as const },
    stopPolicy: { maxConsecutiveFailures: 3 },
    concurrencyPolicy: {
      perLoop: 'skip_if_running' as const,
      coalesceMissedRuns: false,
    },
  };

  if (input.kind === 'task_completion') {
    return {
      ...base,
      successCriteria: [{ kind: 'task_completed', strength: 'weak' }],
      permissionPolicy: {
        mode: 'read_only',
        autoRunApproved: false,
        allowedToolCategories: [],
      },
      legacyPolicy: {
        requiresHumanApprovalBeforeBackgroundSuccess: true,
      },
    };
  }

  return {
    ...base,
    successCriteria: [
      {
        kind: 'file_exists',
        pathTemplate: '${outputDirectory}/${outputFileName}',
        minBytes: 1,
      },
    ],
    permissionPolicy: {
      mode: 'workspace_write',
      autoRunApproved: false,
      allowedToolCategories: ['file_write'],
      approvedTargetRefs: [],
    },
  };
}

export function isWeakOnlyBackgroundContract(contract: LoopContractV1 | undefined): boolean {
  if (!contract) return false;
  const hasStrongCriterion = contract.successCriteria.some(criterion =>
    criterion.kind !== 'task_completed' || criterion.strength === 'strong'
  );
  return !hasStrongCriterion && contract.legacyPolicy?.requiresHumanApprovalBeforeBackgroundSuccess === true;
}

function parseTriggerPolicy(raw: unknown): LoopContractV1['triggerPolicy'] {
  const record = asRecord(raw, 'LoopContract triggerPolicy');
  if (record.kind !== 'manual') throw new Error(`Unsupported LoopContract triggerPolicy kind: ${String(record.kind)}`);
  return { kind: 'manual' };
}

function parseSuccessCriteria(raw: unknown, options: ParseLoopContractOptions): LoopSuccessCriterion[] {
  if (!Array.isArray(raw)) throw new Error('LoopContract successCriteria must be an array.');
  if (raw.length === 0) throw new Error('LoopContract successCriteria must not be empty.');
  const registered = new Set(options.registeredCriteria);
  return raw.map((criterion, index) => {
    const record = asRecord(criterion, `LoopContract successCriteria[${index}]`);
    const kind = readNonEmptyString(record.kind, `LoopContract successCriteria[${index}].kind`);
    if (!registered.has(kind)) throw new Error(`Unsupported LoopContract success criterion: ${kind}`);
    if (kind === 'task_completed') {
      if (record.strength !== 'weak' && record.strength !== 'strong') {
        throw new Error(`LoopContract task_completed strength is unsupported: ${String(record.strength)}`);
      }
      return { kind, strength: record.strength };
    }
    if (kind === 'file_exists') {
      const parsed: Extract<LoopSuccessCriterion, { kind: 'file_exists' }> = {
        kind,
        pathTemplate: readNonEmptyString(record.pathTemplate, 'LoopContract file_exists pathTemplate'),
      };
      if (record.minBytes !== undefined) parsed.minBytes = readNonNegativeNumber(record.minBytes, 'LoopContract file_exists minBytes');
      if (record.expectedMime !== undefined) parsed.expectedMime = readNonEmptyString(record.expectedMime, 'LoopContract file_exists expectedMime');
      return parsed;
    }
    if (kind === 'command_exit_zero') {
      const args = readStringArray(record.args, 'LoopContract command_exit_zero args');
      args.forEach((arg, argIndex) => {
        if (UNSAFE_COMMAND_ARG_PATTERN.test(arg)) {
          throw new Error(`LoopContract command_exit_zero arg ${argIndex} is unsafe.`);
        }
      });
      if (record.cwdPolicy !== 'workspace' && record.cwdPolicy !== 'output_dir') {
        throw new Error(`LoopContract command_exit_zero cwdPolicy is unsupported: ${String(record.cwdPolicy)}`);
      }
      return {
        kind,
        commandId: readNonEmptyString(record.commandId, 'LoopContract command_exit_zero commandId'),
        args,
        cwdPolicy: record.cwdPolicy,
      };
    }
    throw new Error(`Unsupported LoopContract success criterion: ${kind}`);
  });
}

function parseStopPolicy(raw: unknown): LoopStopPolicy {
  const record = asRecord(raw, 'LoopContract stopPolicy');
  const parsed: LoopStopPolicy = {};
  if (record.maxConsecutiveFailures !== undefined) {
    parsed.maxConsecutiveFailures = readNonNegativeNumber(record.maxConsecutiveFailures, 'LoopContract stopPolicy maxConsecutiveFailures');
  }
  return parsed;
}

function parsePermissionPolicy(raw: unknown): LoopPermissionPolicy {
  const record = asRecord(raw, 'LoopContract permissionPolicy');
  if (!['read_only', 'workspace_write', 'project_mutation', 'external_side_effect'].includes(String(record.mode))) {
    throw new Error(`Unsupported LoopContract permission mode: ${String(record.mode)}`);
  }
  if (typeof record.autoRunApproved !== 'boolean') throw new Error('LoopContract permissionPolicy autoRunApproved must be boolean.');
  return stripUndefined({
    mode: record.mode as LoopPermissionPolicy['mode'],
    autoRunApproved: record.autoRunApproved,
    allowedToolCategories: readStringArray(record.allowedToolCategories, 'LoopContract permissionPolicy allowedToolCategories'),
    approvedTargetRefs: record.approvedTargetRefs === undefined
      ? undefined
      : readStringArray(record.approvedTargetRefs, 'LoopContract permissionPolicy approvedTargetRefs'),
  });
}

function parseConcurrencyPolicy(raw: unknown): LoopConcurrencyPolicy {
  const record = asRecord(raw, 'LoopContract concurrencyPolicy');
  if (!['skip_if_running', 'queue_latest', 'cancel_previous', 'parallel'].includes(String(record.perLoop))) {
    throw new Error(`Unsupported LoopContract concurrency perLoop: ${String(record.perLoop)}`);
  }
  if (typeof record.coalesceMissedRuns !== 'boolean') throw new Error('LoopContract concurrencyPolicy coalesceMissedRuns must be boolean.');
  return {
    perLoop: record.perLoop as LoopConcurrencyPolicy['perLoop'],
    coalesceMissedRuns: record.coalesceMissedRuns,
  };
}

function parseLegacyPolicy(raw: unknown): LoopLegacyPolicy {
  const record = asRecord(raw, 'LoopContract legacyPolicy');
  return stripUndefined({
    requiresHumanApprovalBeforeBackgroundSuccess: record.requiresHumanApprovalBeforeBackgroundSuccess === undefined
      ? undefined
      : readBoolean(record.requiresHumanApprovalBeforeBackgroundSuccess, 'LoopContract legacyPolicy requiresHumanApprovalBeforeBackgroundSuccess'),
    legacyWeakModeAuditRef: record.legacyWeakModeAuditRef === undefined
      ? undefined
      : readNonEmptyString(record.legacyWeakModeAuditRef, 'LoopContract legacyPolicy legacyWeakModeAuditRef'),
    grandfatheredOutputTargetRefs: record.grandfatheredOutputTargetRefs === undefined
      ? undefined
      : readStringArray(record.grandfatheredOutputTargetRefs, 'LoopContract legacyPolicy grandfatheredOutputTargetRefs'),
  });
}

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object.`);
  return raw as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function readNonNegativeNumber(value: unknown, label: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative number.`);
  return Number(value);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
