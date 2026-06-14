import { describe, expect, it } from 'vitest';

import {
  classifyKSwarmHealth,
  highestSeverityFinding,
  type KSwarmHealthFinding,
} from '../../electron/kswarm-service-diagnostics.js';

describe('kswarm service diagnostics classifier', () => {
  it('classifies missing spawn entry before probing runtime state', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/Applications/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js',
      spawnEntryExists: false,
      port: { listening: false },
      health: { ok: false, error: 'connect ECONNREFUSED' },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'spawn_path_missing',
        severity: 'high',
        summary: expect.stringContaining('KSwarm startup entry is missing'),
        suggestedActionKind: 'repair_installation',
      }),
    ]);
  });

  it('classifies no listener as service_not_running', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      port: { listening: false },
      health: { ok: false, error: 'connect ECONNREFUSED' },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'service_not_running',
        severity: 'medium',
        suggestedActionKind: 'start_kswarm',
      }),
    ]);
  });

  it('classifies a desktop-owned running service with transient health timeout as unreachable', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      managerRunning: true,
      port: { listening: false, pid: 42, command: 'desktop-owned kswarm service' },
      health: { ok: false, error: 'health check timed out (1000ms): http://127.0.0.1:4400/health' },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'health_unreachable',
        severity: 'high',
        suggestedActionKind: 'inspect_kswarm_log',
      }),
    ]);
  });

  it('classifies a port listener with unreadable health as unknown port occupation', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      port: { listening: true, pid: 991, command: 'python -m http.server 4400' },
      health: { ok: false, error: 'Unexpected token < in JSON' },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'port_occupied_by_unknown_process',
        severity: 'high',
        summary: expect.stringContaining('python -m http.server 4400'),
        suggestedActionKind: 'free_port_4400',
      }),
    ]);
  });

  it('classifies invalid 2xx health JSON as a health parse failure', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      port: { listening: true, pid: 991, command: 'python -m http.server 4400' },
      health: { ok: false, status: 200, error: 'invalid health JSON' },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'health_parse_error',
        severity: 'high',
        summary: expect.stringContaining('invalid health JSON'),
        suggestedActionKind: 'stop_conflicting_kswarm',
      }),
    ]);
  });

  it('classifies a non-2xx health response as an HTTP health error', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      port: { listening: true, pid: 991, command: 'node src/server/index.js' },
      health: { ok: false, status: 404, error: 'HTTP 404' },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'health_http_error',
        severity: 'high',
        summary: expect.stringContaining('HTTP 404'),
        suggestedActionKind: 'inspect_kswarm_log',
      }),
    ]);
  });

  it('classifies readable health from a different KSwarm entry as identity mismatch', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/Applications/xiaok.app/Contents/Resources/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      port: { listening: true, pid: 123, command: 'node src/server/index.js' },
      health: {
        ok: true,
        body: {
          service: {
            entryPath: '/Users/song/projects/kswarm/src/server/index.js',
            sourceHash: 'actual',
          },
          features: ['dynamic_workflows'],
          workflowCapabilities: {
            schemaVersion: 'kswarm_workflow_patterns_v1',
            compiledContract: true,
            patternPublicView: true,
          },
          brokerConnected: true,
        },
      },
      expectedSourceHash: 'expected',
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'health_identity_mismatch',
        severity: 'high',
        suggestedActionKind: 'stop_conflicting_kswarm',
        metadata: expect.objectContaining({
          actualEntryPath: '/Users/song/projects/kswarm/src/server/index.js',
        }),
      }),
    ]);
  });

  it('classifies capability and broker failures independently', () => {
    const findings = classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      spawnEntryExists: true,
      port: { listening: true, pid: 123, command: 'node index.js' },
      health: {
        ok: true,
        body: {
          service: { entryPath: '/app/services/kswarm/src/server/index.js' },
          features: [],
          brokerConnected: false,
        },
      },
      broker: { ok: false, error: 'broker refused connection' },
    });

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'health_capability_mismatch', severity: 'high' }),
      expect.objectContaining({ kind: 'broker_unavailable', severity: 'medium' }),
    ]);
  });

  it('keeps source hash drift as a warning for matching entry path', () => {
    expect(classifyKSwarmHealth({
      expectedEntryPath: '/app/services/kswarm/src/server/index.js',
      expectedSourceHash: 'expected',
      spawnEntryExists: true,
      port: { listening: true, pid: 123, command: 'node index.js' },
      health: {
        ok: true,
        body: {
          service: {
            entryPath: '/app/services/kswarm/src/server/index.js',
            sourceHash: 'actual',
          },
          features: ['dynamic_workflows'],
          workflowCapabilities: {
            schemaVersion: 'kswarm_workflow_patterns_v1',
            compiledContract: true,
            patternPublicView: true,
          },
          brokerConnected: true,
        },
      },
      broker: { ok: true },
    })).toEqual([
      expect.objectContaining({
        kind: 'source_hash_warning',
        severity: 'warning',
        suggestedActionKind: 'inspect_service_identity',
      }),
    ]);
  });

  it('selects the highest severity finding deterministically', () => {
    const findings: KSwarmHealthFinding[] = [
      finding('broker_unavailable', 'medium'),
      finding('source_hash_warning', 'warning'),
      finding('health_identity_mismatch', 'high'),
    ];

    expect(highestSeverityFinding(findings)).toMatchObject({
      kind: 'health_identity_mismatch',
      severity: 'high',
    });
  });
});

function finding(kind: KSwarmHealthFinding['kind'], severity: KSwarmHealthFinding['severity']): KSwarmHealthFinding {
  return {
    kind,
    severity,
    summary: kind,
    suggestedActionKind: 'inspect_loop_diagnostics',
    suggestedActionSummary: kind,
    metadata: {},
  };
}
