import {
  A2UI_MIME_TYPE,
  A2UI_PROTOCOL_VERSION,
  A2UI_V1_CATALOG_ID,
  sanitizeA2UIIdPart,
  type A2UIComponent,
  type A2UIV1Message,
  type CompiledA2UIArtifact,
  type RenderUIInput,
} from './protocol.js';
import { assertRenderUiInput } from './validator.js';
import { MAX_UI_BYTES } from './json-budget.js';
import { validateA2uiMessages } from './decoder.js';

export interface CompileRenderUiContext {
  taskId: string;
  toolUseId: string;
}

export function compileRenderUiToA2ui(input: RenderUIInput, context: CompileRenderUiContext): CompiledA2UIArtifact {
  const validated = assertRenderUiInput(input);
  const surfaceId = `a2ui-${sanitizeA2UIIdPart(context.taskId)}-${sanitizeA2UIIdPart(context.toolUseId)}`;
  const components: A2UIComponent[] = [];
  const children: string[] = [];
  const dataModel: {
    metrics?: Record<string, { value: string | number }>;
    tables?: Record<string, { rows: unknown[][] }>;
  } = {};
  let counter = 0;
  const nextId = () => `c${++counter}`;

  for (const section of validated.sections) {
    switch (section.kind) {
      case 'heading': {
        const id = nextId();
        components.push({
          id,
          component: 'Text',
          text: section.text,
          variant: `h${section.level ?? 2}` as 'h1' | 'h2' | 'h3',
        });
        children.push(id);
        break;
      }
      case 'text': {
        const id = nextId();
        components.push({ id, component: 'Text', text: section.content, variant: 'body' });
        children.push(id);
        break;
      }
      case 'metric': {
        const id = nextId();
        dataModel.metrics ??= {};
        dataModel.metrics[id] = { value: section.value };
        components.push({
          id,
          component: 'MetricCard',
          label: section.label,
          value: { path: `metrics.${id}.value` },
          ...(section.change ? { change: section.change } : {}),
        });
        children.push(id);
        break;
      }
      case 'table': {
        const id = nextId();
        dataModel.tables ??= {};
        dataModel.tables[id] = { rows: section.rows };
        components.push({
          id,
          component: 'Table',
          columns: section.columns,
          rows: { path: `tables.${id}.rows` },
        });
        children.push(id);
        break;
      }
      case 'list': {
        const id = nextId();
        components.push({ id, component: 'List', items: section.items });
        children.push(id);
        break;
      }
      case 'chart': {
        const id = nextId();
        components.push({ id, component: 'Chart', title: section.title, chartType: section.chartType, points: section.points });
        children.push(id);
        break;
      }
      case 'divider': {
        const id = nextId();
        components.push({ id, component: 'Divider' });
        children.push(id);
        break;
      }
    }
  }

  // Keep each container within the catalog child budget, including large reports.
  const rootChildren = children.length <= 20 ? children : [];
  if (children.length > 20) for (let i = 0; i < children.length; i += 20) {
    const id = nextId(); components.push({ id, component: 'Column', children: children.slice(i, i + 20) }); rootChildren.push(id);
  }
  const wireComponents = [{ id: 'root', component: 'Column' as const, children: rootChildren }, ...components].map(component => {
    const result = { ...component } as Record<string, unknown>;
    for (const key of ['value','rows'] as const) {
      const ref = result[key];
      if (ref && typeof ref === 'object' && !Array.isArray(ref) && 'path' in ref) result[key] = { '@path': '/' + String(ref.path).split('.').map(part => part.replace(/~/g,'~0').replace(/\//g,'~1')).join('/') };
    }
    return result;
  });
  const messages: A2UIV1Message[] = [
    {
      version: A2UI_PROTOCOL_VERSION,
      createSurface: {
        surfaceId,
        catalogId: A2UI_V1_CATALOG_ID,
      },
    },
    {
      version: A2UI_PROTOCOL_VERSION,
      updateComponents: {
        surfaceId,
        components: wireComponents as never,
      },
    },
    {
      version: A2UI_PROTOCOL_VERSION,
      updateDataModel: {
        surfaceId,
        path: '/',
        value: dataModel,
      },
    },
  ];

  const validation = validateA2uiMessages(messages);
  if (!validation.ok) throw new Error(validation.reason);

  const payloadBytes = new TextEncoder().encode(JSON.stringify(messages)).length;
  if (payloadBytes > MAX_UI_BYTES) throw Error('UI payload limit');
  return {
    surfaceId,
    mimeType: A2UI_MIME_TYPE,
    messages,
    componentCount: components.length + 1,
    payloadBytes,
  };
}
