import { describe, expect, it, vi } from 'vitest';
import {
  REPORT_PHASE_BUDGET,
  REPORT_TOTAL_LEASE_BUDGET_MS,
  ReportCleanupFailedError,
  runReportInvocation,
  type ReportFactoryDeps,
  type ReportInvocationChild,
  type ReportInvocationContext,
} from '../../electron/provider-gateways/report-provider-adapter.js';
import type { HostNodeRuntimeIdentity } from '../../../src/platform/provider-store/host-node-identity.js';
import { HOST_NODE_IDENTITY_SCHEMA } from '../../../src/platform/provider-store/host-node-identity.js';
import type { EffectHandle } from '../../../src/platform/provider-runtime/types.js';

/** Design v58 §4.5 / §6.3 / R22-01 / R44-01 / R54-01. */
const LIVE = {
  execPath: process.execPath,
  platform: process.platform,
  nodeVersion: '22.22.1',
  moduleAbi: '140',
  v8Version: '14.2',
  appVersion: '1.0.0',
};

function frozenIdentity(overrides: Partial<HostNodeRuntimeIdentity> = {}): HostNodeRuntimeIdentity {
  return {
    schema: HOST_NODE_IDENTITY_SCHEMA,
    platform: LIVE.platform,
    appBundleRoot: '/apps/Xiaok.app',
    execPathRealpath: process.execPath,
    nodeVersion: LIVE.nodeVersion,
    moduleAbi: LIVE.moduleAbi,
    v8Version: LIVE.v8Version,
    appVersion: LIVE.appVersion,
    inputs: [],
    digest: 'sha256-frozen',
    ...overrides,
  };
}

function child(overrides: Partial<ReportInvocationChild> = {}): ReportInvocationChild {
  return {
    rawCloseHandle: { close: async () => {}, getChildPid: () => 9001 },
    call: async () => '{"ok":true,"output_path":"report-2026.html"}',
    listOperations: async () => ['validate_ir', 'render_report', 'list_themes', 'preview_section'],
    closeAndProveExit: async () => ({ exited: true }),
    ...overrides,
  };
}

function context(overrides: Partial<ReportInvocationContext> = {}): ReportInvocationContext & {
  handles: EffectHandle[]; finalizingCalls: number;
} {
  const handles: EffectHandle[] = [];
  const base = {
    operation: 'render_report',
    input: { ir_content: '# t' },
    signal: new AbortController().signal,
    beginFinalizing: () => { base.finalizingCalls += 1; return true; },
    registerInvocationHandle: (h: EffectHandle) => { handles.push(h); },
    owner: { componentId: 'mcp:report-renderer-provider', generationId: 'gen-1' },
    leaseId: 'lease-1',
    handles,
    finalizingCalls: 0,
    ...overrides,
  };
  return base as ReportInvocationContext & { handles: EffectHandle[]; finalizingCalls: number };
}

function deps(overrides: Partial<ReportFactoryDeps> = {}): ReportFactoryDeps {
  return {
    frozenIdentity: frozenIdentity(),
    liveIdentityFacts: () => LIVE,
    now: () => 1_000,
    lastFullHashAt: () => 1_000,
    spawnChild: async () => child(),
    ...overrides,
  };
}

describe('report invocation phase budget', () => {
  it('freezes the 94 second total as the sum of its phases', () => {
    expect(REPORT_PHASE_BUDGET).toEqual({
      startupMs: 30_000, callMs: 30_000, controlledCloseMs: 3_000, promotionMs: 30_000, guardMs: 1_000,
    });
    expect(REPORT_TOTAL_LEASE_BUDGET_MS).toBe(94_000);
  });
});

describe('report invocation lifecycle', () => {
  it('registers the child close handle before any external await', async () => {
    const ctx = context();
    const order: string[] = [];
    await runReportInvocation(deps({
      spawnChild: async () => {
        order.push('spawn');
        return child({ listOperations: async () => { order.push('listOperations'); return [
          'validate_ir', 'render_report', 'list_themes', 'preview_section',
        ]; } });
      },
    }), ctx);

    expect(ctx.handles).toHaveLength(1);
    expect(ctx.handles[0].resourceId).toBe('report-invocation:lease-1');
    // The handle exists before the first post-spawn await (listOperations).
    expect(order).toEqual(['spawn', 'listOperations']);
  });

  it('closes the child and proves exit before promoting the default output', async () => {
    const events: string[] = [];
    const outcome = await runReportInvocation(deps({
      spawnChild: async () => child({
        closeAndProveExit: async () => { events.push('close'); return { exited: true }; },
      }),
      promoteDefaultOutput: async () => { events.push('promote'); return '/store/outputs/x/delivered.bin'; },
    }), context());

    expect(events).toEqual(['close', 'promote']);
    expect(outcome).toMatchObject({ childExited: true, promotedPath: '/store/outputs/x/delivered.bin' });
  });

  it('enters finalizing exactly once, after the backend result is parsed', async () => {
    const ctx = context();
    await runReportInvocation(deps(), ctx);
    expect(ctx.finalizingCalls).toBe(1);
  });

  it('returns cleanup_failed when the child cannot be proven gone, and never promotes', async () => {
    const promote = vi.fn(async () => '/never');
    await expect(runReportInvocation(deps({
      spawnChild: async () => child({
        closeAndProveExit: async () => ({ exited: false, diagnostic: 'descendant tree unknown' }),
      }),
      promoteDefaultOutput: promote,
    }), context())).rejects.toThrow(ReportCleanupFailedError);

    expect(promote).not.toHaveBeenCalled();
  });

  it('fails activation atomically when an operation is missing', async () => {
    const close = vi.fn(async () => ({ exited: true }));
    await expect(runReportInvocation(deps({
      spawnChild: async () => child({
        listOperations: async () => ['validate_ir', 'render_report', 'list_themes'],
        closeAndProveExit: close,
      }),
    }), context())).rejects.toThrow(/missing preview_section/);

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('report invocation host identity binding', () => {
  it('refuses to spawn when the interpreter drifted, without building a generation inline', async () => {
    const spawnChild = vi.fn(async () => child());
    await expect(runReportInvocation(deps({
      spawnChild,
      liveIdentityFacts: () => ({ ...LIVE, appVersion: '2.0.0' }),
    }), context())).rejects.toMatchObject({ code: 'host_runtime_identity_drift', field: 'appVersion' });

    expect(spawnChild).not.toHaveBeenCalled();
  });

  it('refuses a host node outside the supported range before touching identity files', async () => {
    await expect(runReportInvocation(deps({
      liveIdentityFacts: () => ({ ...LIVE, nodeVersion: '25.1.0' }),
    }), context())).rejects.toThrow(/outside the supported range/);
  });

  it('refuses plain Node 24 (ABI 137) even though the version is inside the range', async () => {
    await expect(runReportInvocation(deps({
      liveIdentityFacts: () => ({ ...LIVE, nodeVersion: '24.15.0', moduleAbi: '137' }),
    }), context())).rejects.toThrow(/module ABI 137/);
  });

  it('proceeds when the frozen identity still matches', async () => {
    const outcome = await runReportInvocation(deps(), context());
    expect(outcome.childExited).toBe(true);
  });
});
