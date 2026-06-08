import {
  A2UI_MIME_TYPE,
  A2UI_PROTOCOL_VERSION,
  SAFE_A2UI_CATALOG_ID,
  sanitizeA2UIIdPart,
  type A2UIComponent,
  type A2UIMessage,
  type CompiledA2UIArtifact,
  type RenderUIInput,
} from './protocol.js';
import { assertRenderUiInput, validateA2uiMessages } from './validator.js';

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
      case 'divider': {
        const id = nextId();
        components.push({ id, component: 'Divider' });
        children.push(id);
        break;
      }
    }
  }

  const messages: A2UIMessage[] = [
    {
      version: A2UI_PROTOCOL_VERSION,
      createSurface: {
        surfaceId,
        catalogId: SAFE_A2UI_CATALOG_ID,
        root: 'root',
      },
    },
    {
      version: A2UI_PROTOCOL_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children },
          ...components,
        ],
      },
    },
    {
      version: A2UI_PROTOCOL_VERSION,
      updateDataModel: {
        surfaceId,
        path: '',
        value: dataModel,
      },
    },
  ];

  const validation = validateA2uiMessages(messages);
  if (!validation.ok) throw new Error(validation.reason);

  return {
    surfaceId,
    mimeType: A2UI_MIME_TYPE,
    messages,
    componentCount: components.length + 1,
    payloadBytes: new TextEncoder().encode(JSON.stringify(messages)).length,
  };
}
