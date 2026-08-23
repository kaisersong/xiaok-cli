import { describe, expect, it } from 'vitest';
import {
  admitGenericServer,
  isReservedPluginDirName,
  resolveTrustedProviderSource,
  RESERVED_PLUGIN_DIR_NAMES,
  v2ManagedSnapshotPath,
  type ResolverInputs,
} from '../../../src/platform/provider-store/trusted-source-resolver.js';

/**
 * Design v58 §4.4 / R25-02 / R26-02 / R29-01. The ordering below is the whole
 * point: an invalid v2 pointer must fail closed rather than fall back, because
 * falling back is what would let a user-writable directory win.
 */
const STORE = '/home/u/.xiaok/plugins';
const SNAPSHOT = v2ManagedSnapshotPath(STORE, 'kai-slide-creator', 'sha256-aaa');

function inputs(overrides: Partial<ResolverInputs> = {}): ResolverInputs {
  return {
    storeRoot: STORE,
    v2Pointer: null,
    v1Pointer: null,
    packagedInput: null,
    ...overrides,
  };
}

describe('trusted source resolver ordering', () => {
  it('prefers a valid v2 pointer over the packaged input', () => {
    const outcome = resolveTrustedProviderSource('kai-slide-creator', inputs({
      v2Pointer: { sourceDigest: 'sha256-aaa', targetPath: SNAPSHOT, valid: true, targetExists: true },
      packagedInput: { path: '/Applications/Xiaok.app/.../bundled-plugins/kai-slide-creator', mode: 'packaged-input' },
    }));

    expect(outcome).toEqual({
      kind: 'trusted',
      source: {
        pluginName: 'kai-slide-creator',
        mode: 'v2-pointer',
        sourceSnapshotPath: SNAPSHOT,
        sourceDigest: 'sha256-aaa',
      },
    });
  });

  it('fails closed on an invalid v2 pointer instead of falling back', () => {
    const outcome = resolveTrustedProviderSource('kai-slide-creator', inputs({
      v2Pointer: { sourceDigest: 'sha256-aaa', targetPath: SNAPSHOT, valid: false, targetExists: true },
      v1Pointer: { targetPath: '/legacy/managed/x', revision: 3, valid: true },
      packagedInput: { path: '/app/bundled-plugins/kai-slide-creator', mode: 'packaged-input' },
    }));

    expect(outcome).toMatchObject({ kind: 'blocked', code: 'blocked_manifest' });
  });

  it('fails closed when the v2 pointer names a missing digest directory', () => {
    const outcome = resolveTrustedProviderSource('kai-slide-creator', inputs({
      v2Pointer: { sourceDigest: 'sha256-gone', targetPath: SNAPSHOT, valid: true, targetExists: false },
    }));

    expect(outcome).toMatchObject({ kind: 'blocked', code: 'blocked_manifest' });
  });

  it('uses a valid v1 pointer only as a migration input', () => {
    const outcome = resolveTrustedProviderSource('kai-report-creator', inputs({
      v1Pointer: { targetPath: '/home/u/.xiaok/plugins/.managed/kai-report-creator/2.3.0', revision: 7, valid: true },
      packagedInput: { path: '/app/bundled-plugins/kai-report-creator', mode: 'packaged-input' },
    }));

    expect(outcome).toEqual({
      kind: 'migrate',
      from: { path: '/home/u/.xiaok/plugins/.managed/kai-report-creator/2.3.0', revision: 7 },
    });
  });

  it('requires explicit repair for an invalid v1 pointer', () => {
    const outcome = resolveTrustedProviderSource('kai-report-creator', inputs({
      v1Pointer: { targetPath: '/legacy', revision: 1, valid: false },
      packagedInput: { path: '/app/bundled-plugins/kai-report-creator', mode: 'packaged-input' },
    }));

    expect(outcome).toMatchObject({ kind: 'blocked', code: 'blocked_manifest' });
  });

  it('treats the packaged root as a materialisation input, never as a source', () => {
    const outcome = resolveTrustedProviderSource('cua-computer-use', inputs({
      packagedInput: { path: '/app/bundled-plugins/cua-computer-use', mode: 'packaged-input' },
    }));

    expect(outcome).toEqual({
      kind: 'materialise',
      from: { path: '/app/bundled-plugins/cua-computer-use', mode: 'packaged-input' },
    });
  });

  it('blocks when nothing admissible exists', () => {
    expect(resolveTrustedProviderSource('cua-computer-use', inputs()))
      .toMatchObject({ kind: 'blocked', code: 'no_trusted_source_available' });
  });

  it('refuses a non-reserved plugin name outright', () => {
    expect(resolveTrustedProviderSource('third-party-thing', inputs({
      packagedInput: { path: '/app/x', mode: 'packaged-input' },
    }))).toMatchObject({ kind: 'blocked', code: 'not_a_reserved_provider' });
  });

  it('ignores a forged source declaration and a higher version in the manifest', () => {
    const outcome = resolveTrustedProviderSource('kai-slide-creator', inputs({
      packagedInput: { path: '/app/bundled-plugins/kai-slide-creator', mode: 'packaged-input' },
      candidateManifest: { pluginName: 'kai-slide-creator', declaredSource: 'bundled', version: '99.0.0' },
    }));

    // The declaration grants nothing: the input is still only an input.
    expect(outcome).toMatchObject({ kind: 'materialise' });
  });

  it('rejects a candidate whose manifest names a different plugin', () => {
    expect(resolveTrustedProviderSource('kai-slide-creator', inputs({
      packagedInput: { path: '/app/x', mode: 'packaged-input' },
      candidateManifest: { pluginName: 'evil-twin' },
    }))).toMatchObject({ kind: 'blocked', code: 'manifest_plugin_name_mismatch' });
  });
});

describe('generic MCP server admission', () => {
  it('keeps the three reserved tuples away from the generic loader', () => {
    for (const [pluginName, serverName] of [
      ['cua-computer-use', 'cua-driver'],
      ['kai-report-creator', 'report-renderer'],
      ['kai-slide-creator', 'slide-renderer'],
    ] as const) {
      expect(admitGenericServer({ pluginName, serverName }))
        .toMatchObject({ kind: 'reject', code: 'reserved_provider_uses_runtime_owner' });
    }
  });

  it('rejects a third-party server that reuses a reserved name, in any casing', () => {
    for (const serverName of ['report-renderer', 'REPORT-RENDERER', ' Report-Renderer ']) {
      expect(admitGenericServer({ pluginName: 'third-party', serverName }))
        .toMatchObject({ kind: 'reject', code: 'reserved_mcp_server_name_conflict' });
    }
  });

  it('admits an unrelated third-party server', () => {
    expect(admitGenericServer({ pluginName: 'kai-infinity-canvas', serverName: 'canvas-server' }))
      .toEqual({ kind: 'admit' });
  });
});

describe('reserved store directory names', () => {
  it('skips the v2 store and every legacy internal root', () => {
    for (const name of RESERVED_PLUGIN_DIR_NAMES) {
      expect(isReservedPluginDirName(name)).toBe(true);
    }
    expect(isReservedPluginDirName('.provider-store-v2')).toBe(true);
    expect(isReservedPluginDirName('kai-infinity-canvas')).toBe(false);
  });
});
