import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KSWARM_SERVICE_HEALTH_LOOP_ID,
  KSwarmServiceHealthScanner,
} from '../../electron/kswarm-health-loop.js';

describe('KSwarmServiceHealthScanner', () => {
  let rootDir: string;
  let dbPath: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-kswarm-health-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    dbPath = join(rootDir, 'loop-evidence.sqlite');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns success when KSwarm service is healthy', () => {
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => healthyProbe(),
      logPaths: [join(rootDir, 'kswarm-service.log')],
    });

    const result = scanner.scan({ loopRunId: 'run-1', now: 1_000 });

    expect(result).toMatchObject({
      loopId: KSWARM_SERVICE_HEALTH_LOOP_ID,
      openAnomalyCount: 0,
      resolvedAnomalyCount: 0,
      nextActionKind: 'none',
      summaryEvidence: {
        kind: 'log_diagnostic',
        summary: 'KSwarm service health scanner found no open anomalies.',
        metadata: expect.objectContaining({
          diagnosticKinds: [],
          logPaths: [join(rootDir, 'kswarm-service.log')],
        }),
      },
    });
    expect(scanner.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID })).toEqual([]);
    scanner.close();
  });

  it('records and updates an open service anomaly', () => {
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => ({
        expectedEntryPath: '/app/services/kswarm/src/server/index.js',
        spawnEntryExists: true,
        port: { listening: true, pid: 99, command: 'python -m http.server 4400' },
        health: { ok: false, error: 'Unexpected token < in JSON' },
        broker: { ok: true },
      }),
    });

    const first = scanner.scan({ loopRunId: 'run-1', now: 1_000 });
    const second = scanner.scan({ loopRunId: 'run-2', now: 2_000 });

    expect(first).toMatchObject({
      openAnomalyCount: 1,
      nextActionKind: 'inspect_kswarm_health',
      nextActionSummary: 'Stop the process occupying port 4400, then restart KSwarm.',
    });
    expect(second).toMatchObject({
      openAnomalyCount: 1,
      resolvedAnomalyCount: 0,
    });
    expect(scanner.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID })).toEqual([
      expect.objectContaining({
        loopId: KSWARM_SERVICE_HEALTH_LOOP_ID,
        ownerKind: 'loop_run',
        ownerId: 'kswarm-service',
        kind: 'port_occupied_by_unknown_process',
        status: 'open',
        firstSeenAt: 1_000,
        lastSeenAt: 2_000,
        seenCount: 2,
        message: expect.stringContaining('Port 4400 is occupied'),
      }),
    ]);
    scanner.close();
  });

  it('resolves a prior anomaly when the service becomes healthy', () => {
    let healthy = false;
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => healthy
        ? healthyProbe()
        : {
          expectedEntryPath: '/app/services/kswarm/src/server/index.js',
          spawnEntryExists: true,
          port: { listening: false },
          health: { ok: false, error: 'connect ECONNREFUSED' },
          broker: { ok: true },
        },
    });

    scanner.scan({ loopRunId: 'run-1', now: 1_000 });
    healthy = true;
    const resolved = scanner.scan({ loopRunId: 'run-2', now: 2_000 });

    expect(resolved).toMatchObject({
      openAnomalyCount: 0,
      resolvedAnomalyCount: 1,
      nextActionKind: 'none',
    });
    expect(scanner.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID })).toEqual([
      expect.objectContaining({
        kind: 'service_not_running',
        status: 'resolved',
        lastResolvedAt: 2_000,
      }),
    ]);
    scanner.close();
  });

  it('records source_unavailable when the probe fails', () => {
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => {
        throw new Error('probe failed');
      },
    });

    const result = scanner.scan({ loopRunId: 'run-1', now: 1_000 });

    expect(result).toMatchObject({
      openAnomalyCount: 1,
      nextActionKind: 'inspect_kswarm_health_source',
      summaryEvidence: {
        metadata: expect.objectContaining({
          diagnosticKinds: ['source_unavailable'],
        }),
      },
    });
    expect(scanner.listAnomalies({ loopId: KSWARM_SERVICE_HEALTH_LOOP_ID })).toEqual([
      expect.objectContaining({
        kind: 'source_unavailable',
        status: 'open',
        message: 'KSwarm health source is unavailable: probe failed',
      }),
    ]);
    scanner.close();
  });

  it('requests notification for a new high severity anomaly once', () => {
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => ({
        expectedEntryPath: '/app/services/kswarm/src/server/index.js',
        spawnEntryExists: false,
        port: { listening: false },
        health: { ok: false, error: 'connect ECONNREFUSED' },
        broker: { ok: true },
      }),
    });

    const first = scanner.scan({ loopRunId: 'run-1', now: 1_000 });
    const second = scanner.scan({ loopRunId: 'run-2', now: 2_000 });

    expect(first.summaryEvidence.metadata.notificationDecision).toMatchObject({
      shouldNotify: true,
      reason: 'new_high_severity',
      dedupKey: 'kswarm-service-health:spawn_path_missing:loop_run:kswarm-service',
    });
    expect(second.summaryEvidence.metadata.notificationDecision).toMatchObject({
      shouldNotify: false,
      reason: 'deduped',
    });
    scanner.close();
  });

  it('dedupes repeated unresolved anomalies after the first notification', () => {
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => ({
        expectedEntryPath: '/app/services/kswarm/src/server/index.js',
        spawnEntryExists: true,
        port: { listening: false },
        health: { ok: false, error: 'connect ECONNREFUSED' },
        broker: { ok: true },
      }),
    });

    scanner.scan({ loopRunId: 'run-1', now: 1_000 });
    scanner.scan({ loopRunId: 'run-2', now: 2_000 });
    const third = scanner.scan({ loopRunId: 'run-3', now: 3_000 });

    expect(third.summaryEvidence.metadata.notificationDecision).toMatchObject({
      shouldNotify: false,
      reason: 'deduped',
      occurrenceCount: 3,
    });
    scanner.close();
  });

  it('requests notification on the second source unavailable occurrence', () => {
    const scanner = new KSwarmServiceHealthScanner(dbPath, {
      probe: () => {
        throw new Error('probe failed');
      },
    });

    scanner.scan({ loopRunId: 'run-1', now: 1_000 });
    const second = scanner.scan({ loopRunId: 'run-2', now: 2_000 });

    expect(second.summaryEvidence.metadata.notificationDecision).toMatchObject({
      shouldNotify: true,
      reason: 'source_unavailable_repeated',
      occurrenceCount: 2,
    });
    scanner.close();
  });
});

function healthyProbe() {
  return {
    expectedEntryPath: '/app/services/kswarm/src/server/index.js',
    expectedSourceHash: 'hash',
    spawnEntryExists: true,
    port: { listening: true, pid: 123, command: 'node index.js' },
    health: {
      ok: true,
      body: {
        service: {
          entryPath: '/app/services/kswarm/src/server/index.js',
          sourceHash: 'hash',
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
  };
}
