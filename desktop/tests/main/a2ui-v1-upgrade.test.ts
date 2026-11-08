import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import {
  compileRenderUiToA2ui,
  validateA2uiMessages,
  normalizeA2uiMessages,
  A2UI_CATALOG_SCHEMA,
} from '../../../src/a2ui/index.js';
import { captureTask7Event } from '../../electron/task7-typed-ipc.js';
import { RenderUiPreviewStream } from '../../../src/a2ui/preview-stream.js';
const create = {
  version: '1.0',
  createSurface: { surfaceId: 'a2ui-task-tool', catalogId: 'xiaok-safe/1.0' },
};
const components = [
  { id: 'root', component: 'Column', children: ['metric'] },
  {
    id: 'metric',
    component: 'MetricCard',
    label: 'Total',
    value: { '@path': '/metrics/metric/value' },
  },
];
const tree = { version: '1.0', updateComponents: { surfaceId: 'a2ui-task-tool', components } };
const data = {
  version: '1.0',
  updateDataModel: { surfaceId: 'a2ui-task-tool', value: { metrics: { metric: { value: 42 } } } },
};
describe('A2UI official 1.0 compatibility', () => {
  it('validates new compiler output against pinned upstream and custom catalog schemas', () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(
      JSON.parse(readFileSync('tests/fixtures/a2ui-v1/common_types.json', 'utf8')),
      'https://a2ui.org/specification/v1_0/common_types.json',
    );
    ajv.addSchema(A2UI_CATALOG_SCHEMA, 'https://a2ui.org/specification/v1_0/catalog.json');
    const catalogMeta = ajv.compile(
      JSON.parse(readFileSync('tests/fixtures/a2ui-v1/catalog_definition.json', 'utf8')),
    );
    expect(catalogMeta(A2UI_CATALOG_SCHEMA), JSON.stringify(catalogMeta.errors)).toBe(true);
    const validate = ajv.compile(
      JSON.parse(readFileSync('tests/fixtures/a2ui-v1/agent_to_renderer.json', 'utf8')),
    );
    const output = compileRenderUiToA2ui(
      {
        title: 'Analysis',
        sections: [
          { kind: 'metric', label: 'Total', value: 42 },
          { kind: 'chart', title: 'Costs', chartType: 'bar', points: [{ label: 'A', value: 4 }] },
        ],
      },
      { taskId: 'task', toolUseId: 'tool' },
    );
    for (const message of output.messages)
      expect(validate(message), JSON.stringify(validate.errors)).toBe(true);
    expect(output.messages[0]).toMatchObject({
      version: '1.0',
      createSurface: { catalogId: 'xiaok-safe/1.0' },
    });
    expect(JSON.stringify(output.messages)).toContain('"@path":"/metrics/');
  });
  it('upserts IDs, patches data, accepts embedded creation, deletion and recreation', () => {
    const messages = [
      create,
      tree,
      data,
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'a2ui-task-tool',
          components: [{ ...components[1], label: 'Updated' }],
        },
      },
      {
        version: '1.0',
        updateDataModel: { surfaceId: 'a2ui-task-tool', path: '/metrics/metric/value', value: 99 },
      },
    ];
    expect(validateA2uiMessages(messages)).toEqual({ ok: true });
    expect(JSON.stringify(normalizeA2uiMessages(messages))).toContain('99');
    expect(JSON.stringify(normalizeA2uiMessages(messages))).toContain('Updated');
    const embedded = {
      version: '1.0',
      createSurface: { ...create.createSurface, components, dataModel: data.updateDataModel.value },
    };
    const deleted = [embedded, { version: '1.0', deleteSurface: { surfaceId: 'a2ui-task-tool' } }];
    expect(normalizeA2uiMessages(deleted)).toEqual([]);
    expect(validateA2uiMessages([...deleted, embedded])).toEqual({ ok: true });
  });
  it.each([undefined, 2, '0.9', '2.0'])('rejects unknown version %s', (version) =>
    expect(validateA2uiMessages([{ ...create, version }, tree, data]).ok).toBe(false),
  );
  it('rejects mixed versions, dangerous pointers, unknown keys, RPC and executable bindings', () => {
    const invalid = [
      [{ ...create, extra: true }, tree, data],
      [create, { ...tree, version: 1 }, data],
      [
        create,
        tree,
        data,
        {
          version: '1.0',
          updateDataModel: {
            surfaceId: 'a2ui-task-tool',
            path: '/__proto__/polluted',
            value: true,
          },
        },
      ],
      [
        create,
        tree,
        data,
        {
          version: '1.0',
          updateDataModel: { surfaceId: 'a2ui-task-tool', path: '/metrics/~2invalid', value: true },
        },
      ],
      [create, { version: '1.0', callRendererFunction: { name: 'bash' } }],
      [
        create,
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'a2ui-task-tool',
            components: [{ id: 'root', component: 'Text', text: { '@call': 'fetch' } }],
          },
        },
      ],
    ];
    for (const payload of invalid) expect(validateA2uiMessages(payload).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects oversized bound data and repeated-child expansion', () => {
    const huge = structuredClone(data);
    huge.updateDataModel.value.metrics.metric.value = 'x'.repeat(10001) as never;
    expect(validateA2uiMessages([create, tree, huge]).ok).toBe(false);
    expect(
      validateA2uiMessages([
        create,
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'a2ui-task-tool',
            components: [
              { id: 'root', component: 'Column', children: ['a', 'a'] },
              { id: 'a', component: 'Text', text: 'repeat' },
            ],
          },
        },
      ]).ok,
    ).toBe(false);
  });
});
describe('render_ui progressive previews', () => {
  it('uses complete validated sections and isolates identity, oversize, reset and finish', () => {
    const stream = new RenderUiPreviewStream();
    expect(
      stream.update('a', '{"title":"Live","sections":[{"kind":"text","content":"Hello"},', 0),
    ).toMatchObject({ title: 'Live' });
    expect(
      stream.update('b', '{"title":"Other","sections":[{"kind":"metric","label":"N","value":4}', 0),
    ).toMatchObject({ title: 'Other' });
    stream.finish('a');
    expect(stream.update('a', '{"title":"Late","sections":[]}', 500)).toBeNull();
    expect(stream.update('huge', ' '.repeat(1000001), 500)).toBeNull();
    expect(stream.update('huge', '{"title":"Late","sections":[]}', 1000)).toBeNull();
    stream.reset();
    expect(
      stream.update('a', '{"title":"Fresh","sections":[{"kind":"text","content":"new"}', 0),
    ).toMatchObject({ title: 'Fresh' });
  });
  it('does not invent closing strings or admit unsafe completed sections', () => {
    const stream = new RenderUiPreviewStream();
    expect(
      stream.update('a', '{"title":"Live","sections":[{"kind":"text","content":"unfinished', 0),
    ).toBeNull();
    expect(
      stream.update('b', '{"title":"Live","sections":[{"kind":"script","content":"evil"}', 0),
    ).toBeNull();
  });
});

describe('UI decoder regression boundaries', () => {
  it('rejects invalid transient component batches even if later overwritten or deleted', () => {
    for (const component of [
      { id: 'root', component: 'Iframe', src: 'x' },
      { id: 'root', component: 'Text', text: 'x', extra: true },
    ]) {
      expect(
        validateA2uiMessages([
          create,
          {
            version: '1.0',
            updateComponents: { surfaceId: 'a2ui-task-tool', components: [component] },
          },
          { version: '1.0', deleteSurface: { surfaceId: 'a2ui-task-tool' } },
        ]).ok,
      ).toBe(false);
    }
  });
  it('rejects hidden DSL actions, non-scalar cells and escaped output beyond byte budget', () => {
    for (const sections of [
      [{ kind: 'text', content: 'x', action: 'bash' }],
      [{ kind: 'table', columns: ['A'], rows: [[{ object: 'value' }]] }],
      Array.from({ length: 20 }, () => ({ kind: 'text', content: '\u0000'.repeat(10000) })),
    ]) {
      expect(() =>
        compileRenderUiToA2ui(
          { title: 'Invalid', sections: sections as never },
          { taskId: 'task', toolUseId: 'call' },
        ),
      ).toThrow();
    }
  });
});

describe('preview IPC DTO boundary', () => {
  it('round trips a validated snapshot and rejects invalid/extra fields', () => {
    const content = JSON.stringify(
      compileRenderUiToA2ui(
        { title: 'Safe', sections: [{ kind: 'text', content: 'Hello' }] },
        { taskId: 't', toolUseId: 'c' },
      ).messages,
    );
    const event = {
      type: 'ui_preview',
      turnId: 'turn',
      toolUseId: 'call',
      preview: { title: 'Safe', content },
    };
    expect(captureTask7Event(event)).toEqual(event);
    expect(() =>
      captureTask7Event({ ...event, preview: { ...event.preview, script: 'evil' } }),
    ).toThrow();
    expect(() =>
      captureTask7Event({ ...event, preview: { title: 'Bad', content: 'x'.repeat(1000001) } }),
    ).toThrow();
  });
});

it('rejects a malformed completed section inside the preview publication throttle window', () => {
  const stream = new RenderUiPreviewStream();
  const prefix = '{"title":"Live","sections":[{"kind":"text","content":"Hello"},';
  expect(stream.update('call', prefix, 0)).not.toBeNull();
  expect(stream.update('call', prefix + '{"kind":"script","content":"evil"}', 1)).toBeNull();
  expect(stream.isClosed('call')).toBe(true);
});
