import { describe, expect, it, vi } from 'vitest';
import {
  createAllHostGateways,
  createHostGatewayByName,
  type GatewayRuntimeFacade,
  type RendererProviderValue,
} from '../../electron/provider-gateways/create-host-gateways.js';
import {
  HOST_GATEWAY_CONTRACTS,
  REQUIRED_PROVIDER_OPERATIONS,
  RESERVED_HOST_TOOL_IDS,
  resolveReportTheme,
  ConflictingThemeAliasesError,
} from '../../electron/provider-gateways/host-gateway-contracts.js';
import {
  ProviderSlotDirectory,
} from '../../../src/platform/provider-runtime/provider-slot-directory.js';
import {
  componentInstanceKeyOf,
  ProviderUnavailableRetryError,
} from '../../../src/platform/provider-runtime/types.js';

/**
 * Design v58 §4.4 / §6.2 / §6.3. The eight historical `mcp__…` names stay
 * reachable for the bundled Skills, but the owner, schema, permission and
 * output-path contract are the host's.
 */
function facade(overrides: Partial<GatewayRuntimeFacade> = {}): GatewayRuntimeFacade {
  return {
    acquire: () => { throw new ProviderUnavailableRetryError(); },
    describeUnavailable: () => ({ code: 'provider_unavailable', message: 'renderer not ready', retryable: true }),
    ...overrides,
  };
}

/** A committed slot backed by the real ProviderSlotDirectory. */
function committedFacade(call: RendererProviderValue['call']) {
  const dir = new ProviderSlotDirectory();
  const provider = componentInstanceKeyOf('mcp:report-renderer-provider', 'gen-1');
  for (const key of ['mcp:report-renderer', 'mcp:slide-renderer']) {
    dir.prepare({
      capabilityKey: key,
      provider,
      resourceMode: 'invocation-scoped',
      value: { call } satisfies RendererProviderValue,
    });
    dir.commit(key, provider);
  }
  const runtime: GatewayRuntimeFacade = {
    acquire: (capabilityKey, options) => dir.acquire<RendererProviderValue>(capabilityKey, {
      budget: { executingMs: 94_000, finalizingMs: 34_000 },
      ...(options.callerSignal ? { callerSignal: options.callerSignal } : {}),
    }),
    describeUnavailable: () => ({ code: 'provider_unavailable', message: 'x', retryable: true }),
  };
  return { dir, runtime };
}

describe('host gateway contracts', () => {
  it('covers exactly the eight historical canonical names', () => {
    expect(HOST_GATEWAY_CONTRACTS.map((c) => c.canonicalName)).toEqual([
      'mcp__slide-renderer__validate_brief',
      'mcp__slide-renderer__render_slide',
      'mcp__slide-renderer__list_presets',
      'mcp__slide-renderer__get_schema',
      'mcp__report-renderer__validate_ir',
      'mcp__report-renderer__render_report',
      'mcp__report-renderer__list_themes',
      'mcp__report-renderer__preview_section',
    ]);
  });

  it('marks only render_* as write and leaves the rest safe', () => {
    const write = HOST_GATEWAY_CONTRACTS.filter((c) => c.permission === 'write').map((c) => c.operation);
    expect(write).toEqual(['render_slide', 'render_report']);
  });

  it('requires the full four-operation set per capability', () => {
    expect(REQUIRED_PROVIDER_OPERATIONS['mcp:slide-renderer'])
      .toEqual(['validate_brief', 'render_slide', 'list_presets', 'get_schema']);
    expect(REQUIRED_PROVIDER_OPERATIONS['mcp:report-renderer'])
      .toEqual(['validate_ir', 'render_report', 'list_themes', 'preview_section']);
  });

  it('freezes preview_section as section_ir: string plus optional theme/lang', () => {
    const preview = HOST_GATEWAY_CONTRACTS.find((c) => c.operation === 'preview_section')!;
    expect(preview.inputSchema).toMatchObject({
      required: ['section_ir'],
      properties: { section_ir: { type: 'string' }, theme: { type: 'string' }, lang: { type: 'string' } },
    });
    // The historical wrong translation must not come back.
    expect(JSON.stringify(preview.inputSchema)).not.toContain('section_index');
    expect(JSON.stringify(preview.inputSchema)).not.toContain('ir_content');
  });

  it('freezes render_report as (ir_content, output_path?, theme?, bundle?)', () => {
    const render = HOST_GATEWAY_CONTRACTS.find((c) => c.operation === 'render_report')!;
    expect(render.inputSchema).toMatchObject({ required: ['ir_content'] });
    const props = Object.keys((render.inputSchema as { properties: Record<string, unknown> }).properties).sort();
    expect(props).toEqual(['bundle', 'ir_content', 'output_path', 'theme', 'theme_override']);
  });

  it('reserves the eight names plus the CUA gateway against generic tools', () => {
    expect(RESERVED_HOST_TOOL_IDS).toContain('xiaok_computer_use');
    expect(RESERVED_HOST_TOOL_IDS).toHaveLength(9);
  });

  it('maps the theme alias and rejects a conflicting pair', () => {
    expect(resolveReportTheme({ theme: 'aurora' })).toBe('aurora');
    expect(resolveReportTheme({ theme_override: 'ink' })).toBe('ink');
    expect(resolveReportTheme({ theme: 'same', theme_override: 'same' })).toBe('same');
    expect(() => resolveReportTheme({ theme: 'a', theme_override: 'b' }))
      .toThrow(ConflictingThemeAliasesError);
  });
});

describe('host gateway behaviour', () => {
  it('stays visible and returns a structured unavailable result with no provider', async () => {
    const tool = createHostGatewayByName('mcp__report-renderer__list_themes', facade());

    const result = await tool.execute({});

    expect(JSON.parse(result)).toEqual({
      ok: false, error_code: 'provider_unavailable', message: 'renderer not ready', retryable: true,
    });
  });

  it('calls the committed provider operation and releases the lease', async () => {
    const call = vi.fn(async () => '{"ok":true}');
    const { dir, runtime } = committedFacade(call);
    const tool = createHostGatewayByName('mcp__report-renderer__validate_ir', runtime);

    const result = await tool.execute({ ir_content: '# t' });

    expect(result).toBe('{"ok":true}');
    expect(call).toHaveBeenCalledWith(
      { operation: 'validate_ir', input: { ir_content: '# t' } },
      expect.any(AbortSignal),
    );
    expect(dir.activeLeaseCount('mcp:report-renderer')).toBe(0);
  });

  it('releases the lease even when the provider call throws', async () => {
    const { dir, runtime } = committedFacade(async () => { throw new Error('server exploded'); });
    const tool = createHostGatewayByName('mcp__report-renderer__validate_ir', runtime);

    await expect(tool.execute({ ir_content: '# t' })).rejects.toThrow('server exploded');
    expect(dir.activeLeaseCount('mcp:report-renderer')).toBe(0);
  });

  it('rejects a JSON payload passed as section_ir before it reaches the server', async () => {
    const call = vi.fn(async () => 'never');
    const { runtime } = committedFacade(call);
    const tool = createHostGatewayByName('mcp__report-renderer__preview_section', runtime);

    await expect(tool.execute({ section_ir: JSON.stringify({ blocks: [] }) }))
      .rejects.toThrow(/invalid_section_ir/);
    expect(call).not.toHaveBeenCalled();
  });

  it('accepts a real single-section .report.md fixture', async () => {
    const call = vi.fn(async () => '<div class="callout callout--note">x</div>');
    const { runtime } = committedFacade(call);
    const tool = createHostGatewayByName('mcp__report-renderer__preview_section', runtime);
    const sectionIr = '## preview-contract\n\n:::callout type=note\npreview-contract-marker\n:::\n';

    const result = await tool.execute({ section_ir: sectionIr, lang: 'zh' });

    expect(result).toContain('callout--note');
    expect(call).toHaveBeenCalledWith(
      { operation: 'preview_section', input: { section_ir: sectionIr, lang: 'zh' } },
      expect.any(AbortSignal),
    );
  });

  it('rejects a :::block fixture, which renders as an unknown component', async () => {
    const { runtime } = committedFacade(async () => 'unused');
    const tool = createHostGatewayByName('mcp__report-renderer__preview_section', runtime);

    await expect(tool.execute({ section_ir: ':::block\nx\n:::\n' }))
      .rejects.toThrow(/invalid_section_ir/);
  });

  it('forwards the theme alias as theme_override and drops the alias key', async () => {
    const call = vi.fn(async () => 'ok');
    const { runtime } = committedFacade(call);
    const tool = createHostGatewayByName('mcp__report-renderer__render_report', runtime);

    await tool.execute({ ir_content: '# t', theme: 'aurora' });

    expect(call).toHaveBeenCalledWith(
      { operation: 'render_report', input: { ir_content: '# t', theme_override: 'aurora' } },
      expect.any(AbortSignal),
    );
  });

  it('rebuilds a canonical AbortError when the caller cancelled', async () => {
    const controller = new AbortController();
    const { runtime } = committedFacade(async (_request, signal) => {
      controller.abort();
      await Promise.resolve();
      expect(signal.aborted).toBe(true);
      throw new Error('sdk wrapped something else entirely');
    });
    const tool = createHostGatewayByName('mcp__slide-renderer__render_slide', runtime);

    await expect(tool.execute({ brief_json: '{}' }, { signal: controller.signal } as never))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('registers all eight gateways for a registry that should see them', () => {
    const tools = createAllHostGateways(facade());
    expect(tools).toHaveLength(8);
    expect(new Set(tools.map((t) => t.definition.name)).size).toBe(8);
  });
});
