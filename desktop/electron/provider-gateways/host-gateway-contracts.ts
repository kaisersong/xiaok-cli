/**
 * Host-owned static gateways for the reserved renderers (design v58 §4.4, §6.2,
 * §6.3; R5-03, R10-01, R11-01, R12-01, R50-06, R53-01).
 *
 * Why gateways instead of the generic loader's raw tools: the three reserved MCP
 * servers are removed from the generic loader, but Desktop still scans
 * each `~/.xiaok/plugins/<name>/skills` directory, and the bundled report/slide Skills reference eight
 * historical `mcp__…` canonical names. Those names must stay reachable, yet the
 * registration owner, schema, permission and output-path contract have to be the
 * host's — not the server's tool catalog.
 *
 * Frozen facts encoded here:
 *  - `preview_section` takes `section_ir: string` — a single-section `.report.md`
 *    DSL text containing at least one supported `:::component`, *not* JSON. A JSON
 *    string passes Zod and then renders an empty fragment, which is the bug the
 *    review caught twice.
 *  - `render_report` is `(ir_content, output_path?, theme?, bundle?)`; `theme` is
 *    a host alias mapped to the server's `theme_override`, and giving both with
 *    different values is a typed conflict.
 *  - `render_*` are `write`, everything else is `safe`. Desktop registries run in
 *    auto mode, so this corrects metadata without adding approval prompts.
 */

export type RendererOutputPolicy =
  | { kind: 'report-artifact-host-compat' }
  | { kind: 'report-skill-host-compat' }
  | { kind: 'slide-host-compat' }
  | { kind: 'forced-by-artifact-lease'; generationRoot: string };

export type GatewayCapabilityKey = 'mcp:slide-renderer' | 'mcp:report-renderer';

export interface HostGatewayContract {
  readonly canonicalName: string;
  readonly capabilityKey: GatewayCapabilityKey;
  /** Operation name on the provider value; the slot is server-level. */
  readonly operation: string;
  readonly permission: 'safe' | 'write';
  readonly inputSchema: Record<string, unknown>;
  readonly outputPolicy?: RendererOutputPolicy;
  readonly description: string;
}

/** The nine supported `:::component` tags a preview fragment may use. */
export const SUPPORTED_REPORT_COMPONENTS: readonly string[] = Object.freeze([
  'kpi', 'table', 'callout', 'list', 'chart', 'timeline', 'diagram', 'code', 'image',
]);

const SLIDE_OPERATIONS = ['validate_brief', 'render_slide', 'list_presets', 'get_schema'] as const;
const REPORT_OPERATIONS = ['validate_ir', 'render_report', 'list_themes', 'preview_section'] as const;

/** Required operation set per capability; a partial `tools/list` must not commit. */
export const REQUIRED_PROVIDER_OPERATIONS: Record<GatewayCapabilityKey, readonly string[]> = Object.freeze({
  'mcp:slide-renderer': Object.freeze([...SLIDE_OPERATIONS]),
  'mcp:report-renderer': Object.freeze([...REPORT_OPERATIONS]),
});

function obj(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

export const HOST_GATEWAY_CONTRACTS: readonly HostGatewayContract[] = Object.freeze([
  {
    canonicalName: 'mcp__slide-renderer__validate_brief',
    capabilityKey: 'mcp:slide-renderer',
    operation: 'validate_brief',
    permission: 'safe',
    description: '校验 BRIEF.json 是否满足 slide renderer 契约。',
    inputSchema: obj({ brief_json: { type: 'string' } }, ['brief_json']),
  },
  {
    canonicalName: 'mcp__slide-renderer__render_slide',
    capabilityKey: 'mcp:slide-renderer',
    operation: 'render_slide',
    permission: 'write',
    description: '将 BRIEF.json 渲染为 HTML 幻灯片。省略 output_path 时由 host 交付持久产物路径。',
    outputPolicy: { kind: 'slide-host-compat' },
    inputSchema: obj({ brief_json: { type: 'string' }, output_path: { type: 'string' } }, ['brief_json']),
  },
  {
    canonicalName: 'mcp__slide-renderer__list_presets',
    capabilityKey: 'mcp:slide-renderer',
    operation: 'list_presets',
    permission: 'safe',
    description: '列出可用的 slide 预设。',
    inputSchema: obj({}),
  },
  {
    canonicalName: 'mcp__slide-renderer__get_schema',
    capabilityKey: 'mcp:slide-renderer',
    operation: 'get_schema',
    permission: 'safe',
    description: '返回 BRIEF.json 的 schema。',
    inputSchema: obj({}),
  },
  {
    canonicalName: 'mcp__report-renderer__validate_ir',
    capabilityKey: 'mcp:report-renderer',
    operation: 'validate_ir',
    permission: 'safe',
    description: '校验 .report.md IR 文本。',
    inputSchema: obj({ ir_content: { type: 'string' } }, ['ir_content']),
  },
  {
    canonicalName: 'mcp__report-renderer__render_report',
    capabilityKey: 'mcp:report-renderer',
    operation: 'render_report',
    permission: 'write',
    description: '将 .report.md IR 渲染为 HTML 报告。省略 output_path 时由 host 交付持久产物路径。',
    outputPolicy: { kind: 'report-skill-host-compat' },
    inputSchema: obj({
      ir_content: { type: 'string' },
      output_path: { type: 'string' },
      theme: { type: 'string' },
      theme_override: { type: 'string' },
      bundle: { type: 'boolean' },
    }, ['ir_content']),
  },
  {
    canonicalName: 'mcp__report-renderer__list_themes',
    capabilityKey: 'mcp:report-renderer',
    operation: 'list_themes',
    permission: 'safe',
    description: '列出可用报告主题。',
    inputSchema: obj({}),
  },
  {
    canonicalName: 'mcp__report-renderer__preview_section',
    capabilityKey: 'mcp:report-renderer',
    operation: 'preview_section',
    permission: 'safe',
    description: [
      '预览单节报告片段。',
      'section_ir 是单节 .report.md DSL 文本（至少包含一个受支持的 :::component），不是 JSON。',
      `受支持组件：${SUPPORTED_REPORT_COMPONENTS.join(', ')}。`,
    ].join(''),
    inputSchema: obj({
      section_ir: { type: 'string' },
      theme: { type: 'string' },
      lang: { type: 'string' },
    }, ['section_ir']),
  },
]);

/** Canonical ids no third-party generic tool may claim (design R9-02). */
export const RESERVED_HOST_TOOL_IDS: readonly string[] = Object.freeze([
  ...HOST_GATEWAY_CONTRACTS.map((c) => c.canonicalName),
  'xiaok_computer_use',
]);

export function gatewayContract(canonicalName: string): HostGatewayContract {
  const found = HOST_GATEWAY_CONTRACTS.find((c) => c.canonicalName === canonicalName);
  if (!found) throw new Error(`unknown host gateway: ${canonicalName}`);
  return found;
}

export class ConflictingThemeAliasesError extends Error {
  readonly code = 'conflicting_theme_aliases';

  constructor(theme: string, themeOverride: string) {
    super(`conflicting_theme_aliases: theme=${theme} theme_override=${themeOverride}`);
    this.name = 'ConflictingThemeAliasesError';
  }
}

/**
 * Host alias mapping for report themes. The artifact helper historically passed
 * `theme` straight through to a server that only reads `theme_override`, so it was
 * silently ignored; mapping it is an intentional bugfix, not parity.
 */
export function resolveReportTheme(input: Record<string, unknown>): string | undefined {
  const theme = typeof input.theme === 'string' ? input.theme : undefined;
  const override = typeof input.theme_override === 'string' ? input.theme_override : undefined;
  if (theme !== undefined && override !== undefined && theme !== override) {
    throw new ConflictingThemeAliasesError(theme, override);
  }
  return override ?? theme;
}

/** True when the text carries at least one supported `:::component` block. */
export function hasSupportedReportComponent(sectionIr: string): boolean {
  const matches = sectionIr.matchAll(/^:::([a-zA-Z][\w-]*)/gm);
  for (const match of matches) {
    if (SUPPORTED_REPORT_COMPONENTS.includes(match[1])) return true;
  }
  return false;
}
