import { resolve } from 'node:path';

export type KSwarmHealthDiagnosticKind =
  | 'service_not_running'
  | 'port_occupied_by_unknown_process'
  | 'health_unreachable'
  | 'health_http_error'
  | 'health_parse_error'
  | 'health_identity_mismatch'
  | 'health_capability_mismatch'
  | 'broker_unavailable'
  | 'spawn_path_missing'
  | 'spawn_exit'
  | 'source_hash_warning';

export type KSwarmHealthSeverity = 'info' | 'warning' | 'medium' | 'high';

export interface KSwarmHealthFinding {
  kind: KSwarmHealthDiagnosticKind;
  severity: KSwarmHealthSeverity;
  summary: string;
  suggestedActionKind: string;
  suggestedActionSummary: string;
  metadata: Record<string, unknown>;
}

export interface KSwarmHealthDiagnosticInput {
  expectedEntryPath: string | null;
  expectedSourceHash?: string | null;
  spawnEntryExists: boolean;
  managerRunning?: boolean;
  port?: {
    listening: boolean;
    pid?: number | null;
    command?: string | null;
  } | null;
  health?: {
    ok: boolean;
    status?: number;
    body?: Record<string, unknown> | null;
    error?: string | null;
  } | null;
  broker?: {
    ok: boolean;
    error?: string | null;
  } | null;
  lastExit?: {
    code?: number | null;
    signal?: string | null;
    stderr?: string | null;
  } | null;
}

const WORKFLOW_PATTERN_SCHEMA_VERSION = 'kswarm_workflow_patterns_v1';

export function classifyKSwarmHealth(input: KSwarmHealthDiagnosticInput): KSwarmHealthFinding[] {
  if (!input.spawnEntryExists) {
    return [finding('spawn_path_missing', 'high',
      'KSwarm startup entry is missing.',
      'repair_installation',
      'Repair or reinstall Xiaok so the bundled KSwarm service is present.',
      baseMetadata(input))];
  }

  if (input.lastExit) {
    return [finding('spawn_exit', 'high',
      'KSwarm service exited after startup.',
      'inspect_kswarm_log',
      'Open KSwarm service logs and inspect the child process exit code.',
      { ...baseMetadata(input), lastExit: input.lastExit })];
  }

  if (input.port && input.port.listening === false && input.managerRunning !== true) {
    return [finding('service_not_running', 'medium',
      'KSwarm service is not running on port 4400.',
      'start_kswarm',
      'Restart Xiaok or run the KSwarm service health check again.',
      baseMetadata(input))];
  }

  const health = input.health;
  if (!health?.ok) {
    if (input.port?.listening && isSuccessfulHttpStatus(health?.status)) {
      return [finding('health_parse_error', 'high',
        `KSwarm health endpoint returned invalid JSON${health?.error ? `: ${health.error}` : ''}.`,
        'stop_conflicting_kswarm',
        'Stop the conflicting service on port 4400 or inspect KSwarm health logs.',
        baseMetadata(input))];
    }
    if (input.port?.listening && !health?.status) {
      return [finding('port_occupied_by_unknown_process', 'high',
        `Port 4400 is occupied by a non-KSwarm process${input.port.command ? `: ${input.port.command}` : ''}.`,
        'free_port_4400',
        'Stop the process occupying port 4400, then restart KSwarm.',
        baseMetadata(input))];
    }
    if (health?.status) {
      return [finding('health_http_error', 'high',
        `KSwarm health endpoint returned HTTP ${health.status}.`,
        'inspect_kswarm_log',
        'Open KSwarm service logs and inspect the health endpoint failure.',
        baseMetadata(input))];
    }
    return [finding('health_unreachable', 'high',
      `KSwarm health endpoint is unreachable${health?.error ? `: ${health.error}` : ''}.`,
      'inspect_kswarm_log',
      'Open KSwarm service logs and verify the service process is alive.',
      baseMetadata(input))];
  }

  const body = health.body ?? null;
  const findings: KSwarmHealthFinding[] = [];
  const actualEntryPath = getHealthServiceEntryPath(body);
  if (input.expectedEntryPath && (!actualEntryPath || resolve(actualEntryPath) !== resolve(input.expectedEntryPath))) {
    findings.push(finding('health_identity_mismatch', 'high',
      'KSwarm health identity does not match the current Xiaok desktop service.',
      'stop_conflicting_kswarm',
      'Stop the conflicting KSwarm service on port 4400, then let Xiaok start the bundled service.',
      {
        ...baseMetadata(input),
        actualEntryPath,
      }));
    return findings;
  }

  if (!hasDynamicWorkflowSupport(body)) {
    findings.push(finding('health_capability_mismatch', 'high',
      'KSwarm service is reachable but lacks required workflow capabilities.',
      'upgrade_kswarm_service',
      'Use the bundled KSwarm service shipped with this Xiaok version.',
      baseMetadata(input)));
  }

  if (body?.brokerConnected === false || input.broker?.ok === false) {
    findings.push(finding('broker_unavailable', 'medium',
      'KSwarm service is reachable but intent-broker is unavailable or disconnected.',
      'restart_intent_broker',
      'Restart Xiaok or inspect the intent-broker service logs.',
      baseMetadata(input)));
  }

  const actualSourceHash = getHealthServiceSourceHash(body);
  if (input.expectedSourceHash && actualSourceHash !== input.expectedSourceHash) {
    findings.push(finding('source_hash_warning', 'warning',
      'KSwarm service entry matches but source hash differs or is missing.',
      'inspect_service_identity',
      'Inspect the KSwarm service identity if diagnostics keep recurring.',
      {
        ...baseMetadata(input),
        actualSourceHash,
      }));
  }

  return findings;
}

export function highestSeverityFinding(findings: KSwarmHealthFinding[]): KSwarmHealthFinding | undefined {
  return [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
}

function finding(
  kind: KSwarmHealthDiagnosticKind,
  severity: KSwarmHealthSeverity,
  summary: string,
  suggestedActionKind: string,
  suggestedActionSummary: string,
  metadata: Record<string, unknown>
): KSwarmHealthFinding {
  return {
    kind,
    severity,
    summary,
    suggestedActionKind,
    suggestedActionSummary,
    metadata: stripUndefined(metadata),
  };
}

function baseMetadata(input: KSwarmHealthDiagnosticInput): Record<string, unknown> {
  return {
    expectedEntryPath: input.expectedEntryPath,
    expectedSourceHash: input.expectedSourceHash,
    managerRunning: input.managerRunning,
    port: input.port,
    healthStatus: input.health?.status,
    healthError: input.health?.error,
    brokerOk: input.broker?.ok,
    brokerError: input.broker?.error,
  };
}

function getHealthServiceEntryPath(body: Record<string, unknown> | null): string | null {
  const service = body?.service;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return null;
  const entryPath = (service as Record<string, unknown>).entryPath;
  return typeof entryPath === 'string' && entryPath.length > 0 ? entryPath : null;
}

function getHealthServiceSourceHash(body: Record<string, unknown> | null): string | null {
  const service = body?.service;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return null;
  const sourceHash = (service as Record<string, unknown>).sourceHash;
  return typeof sourceHash === 'string' && sourceHash.length > 0 ? sourceHash : null;
}

function hasDynamicWorkflowSupport(body: Record<string, unknown> | null): boolean {
  const features = body?.features;
  if (!Array.isArray(features) || !features.includes('dynamic_workflows')) return false;
  const capabilities = body?.workflowCapabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false;
  const record = capabilities as Record<string, unknown>;
  return record.schemaVersion === WORKFLOW_PATTERN_SCHEMA_VERSION
    && record.compiledContract === true
    && record.patternPublicView === true;
}

function severityRank(severity: KSwarmHealthSeverity): number {
  switch (severity) {
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
  }
}

function isSuccessfulHttpStatus(status: number | undefined): boolean {
  return typeof status === 'number' && status >= 200 && status < 300;
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
