export const A2UI_MIME_TYPE = 'application/vnd.xiaok.a2ui+json';
export const SAFE_A2UI_CATALOG_ID = 'xiaok-safe';
export const A2UI_PROTOCOL_VERSION = 1;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export const RENDER_UI_SECTION_KINDS = ['heading', 'text', 'metric', 'table', 'list', 'divider'] as const;
export type RenderUISectionKind = typeof RENDER_UI_SECTION_KINDS[number];

export interface RenderUIInput {
  title: string;
  sections: RenderUISection[];
  data?: Record<string, unknown>;
  output_path?: string;
  task_id?: string;
}

export type RenderUISection =
  | { kind: 'heading'; text: string; level?: 1 | 2 | 3 }
  | { kind: 'text'; content: string }
  | { kind: 'metric'; label: string; value: string | number; change?: string }
  | { kind: 'table'; columns: string[]; rows: unknown[][] }
  | { kind: 'list'; items: string[] }
  | { kind: 'divider' };

export type A2UIDynamicValue = { path: string };

export interface A2UIComponent {
  id: string;
  component: 'Text' | 'Row' | 'Column' | 'Card' | 'Divider' | 'List' | 'Table' | 'MetricCard';
  children?: string[];
  text?: string;
  variant?: 'h1' | 'h2' | 'h3' | 'body';
  label?: string;
  value?: string | number | A2UIDynamicValue;
  change?: string;
  columns?: string[];
  rows?: unknown[][] | A2UIDynamicValue;
  items?: string[];
  distribution?: 'start' | 'center' | 'end' | 'between';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export type A2UIMessage =
  | {
      version: typeof A2UI_PROTOCOL_VERSION;
      createSurface: {
        surfaceId: string;
        catalogId: typeof SAFE_A2UI_CATALOG_ID;
        root: string;
      };
    }
  | {
      version: typeof A2UI_PROTOCOL_VERSION;
      updateComponents: {
        surfaceId: string;
        components: A2UIComponent[];
      };
    }
  | {
      version: typeof A2UI_PROTOCOL_VERSION;
      updateDataModel: {
        surfaceId: string;
        path: '';
        value: Record<string, unknown>;
      };
    };

export interface CompiledA2UIArtifact {
  surfaceId: string;
  mimeType: typeof A2UI_MIME_TYPE;
  messages: A2UIMessage[];
  componentCount: number;
  payloadBytes: number;
}

export const A2UI_LIMITS = {
  maxMessages: 50,
  maxComponents: 100,
  maxTreeDepth: 8,
  maxChildrenPerNode: 20,
  maxDataModelBytes: 500_000,
  maxSinglePropBytes: 100_000,
  maxStringLen: 10_000,
  maxTableRows: 200,
  maxTableCols: 10,
  maxTableCellLen: 1_000,
  maxMetricValueLen: 50,
  maxSections: 30,
} as const;

export function formatA2UIBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isA2UIMimeType(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase().split(';')[0]?.trim() === A2UI_MIME_TYPE;
}

export function sanitizeA2UIIdPart(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || 'local';
}

export function summarizeRenderUiInput(input: unknown): {
  title: string;
  sectionCount: number;
  payloadBytes: number;
  summary: string;
} {
  const record = input != null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim()
    : 'Untitled UI';
  const sectionCount = Array.isArray(record.sections) ? record.sections.length : 0;
  const payloadBytes = new TextEncoder().encode(JSON.stringify({
    title: record.title,
    sections: record.sections,
    data: record.data,
  })).length;
  const sectionLabel = sectionCount === 1 ? 'section' : 'sections';
  return {
    title,
    sectionCount,
    payloadBytes,
    summary: `[A2UI] ${title} - ${sectionCount} ${sectionLabel}, ${formatA2UIBytes(payloadBytes)}`,
  };
}
