import { describe, expect, it } from 'vitest';
import {
  SAFE_A2UI_CATALOG_ID,
  validateA2uiMessages,
  validateRenderUiInput,
} from '../../src/a2ui/index.js';

describe('A2UI validator', () => {
  it('accepts the safe read-only message subset', () => {
    const result = validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: SAFE_A2UI_CATALOG_ID, root: 'root' } },
      {
        version: 1,
        updateComponents: {
          surfaceId: 'a2ui-task_1-tool_1',
          components: [
            { id: 'root', component: 'Column', children: ['title', 'metric'] },
            { id: 'title', component: 'Text', text: 'Hello', variant: 'h2' },
            { id: 'metric', component: 'MetricCard', label: 'Revenue', value: { path: 'metrics.metric.value' } },
          ],
        },
      },
      {
        version: 1,
        updateDataModel: {
          surfaceId: 'a2ui-task_1-tool_1',
          path: '',
          value: { metrics: { metric: { value: '42' } } },
        },
      },
    ]);

    expect(result).toEqual({ ok: true });
  });

  it('rejects unknown components, interaction props, unsafe catalog, and destroy operations', () => {
    expect(validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: 'default', root: 'root' } },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/catalogId/) });

    expect(validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: SAFE_A2UI_CATALOG_ID, root: 'root' } },
      { version: 1, updateComponents: { surfaceId: 'a2ui-task_1-tool_1', components: [{ id: 'root', component: 'Button', children: [] }] } },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/未知组件/) });

    expect(validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: SAFE_A2UI_CATALOG_ID, root: 'root' } },
      { version: 1, updateComponents: { surfaceId: 'a2ui-task_1-tool_1', components: [{ id: 'root', component: 'Text', text: 'Click', onClick: 'steal()' }] } },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/禁止的 prop/) });

    expect(validateA2uiMessages([
      { version: 1, destroySurface: { surfaceId: 'a2ui-task_1-tool_1' } },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/不允许的操作/) });
  });

  it('rejects proto pollution, cycles, orphan nodes, and invalid dynamic paths', () => {
    const polluted = JSON.parse('[{"version":1,"createSurface":{"surfaceId":"a2ui-task_1-tool_1","catalogId":"xiaok-safe","root":"root","__proto__":{"polluted":true}}}]');
    expect(validateA2uiMessages(polluted)).toMatchObject({ ok: false, reason: expect.stringMatching(/危险 key/) });

    expect(validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: SAFE_A2UI_CATALOG_ID, root: 'root' } },
      {
        version: 1,
        updateComponents: {
          surfaceId: 'a2ui-task_1-tool_1',
          components: [
            { id: 'root', component: 'Column', children: ['child'] },
            { id: 'child', component: 'Column', children: ['root'] },
          ],
        },
      },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/循环/) });

    expect(validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: SAFE_A2UI_CATALOG_ID, root: 'root' } },
      {
        version: 1,
        updateComponents: {
          surfaceId: 'a2ui-task_1-tool_1',
          components: [
            { id: 'root', component: 'Column', children: [] },
            { id: 'orphan', component: 'Text', text: 'Hidden' },
          ],
        },
      },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/孤儿/) });

    expect(validateA2uiMessages([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: SAFE_A2UI_CATALOG_ID, root: 'root' } },
      {
        version: 1,
        updateComponents: {
          surfaceId: 'a2ui-task_1-tool_1',
          components: [
            { id: 'root', component: 'Column', children: ['metric'] },
            { id: 'metric', component: 'MetricCard', label: 'Secret', value: { path: 'user.token' } },
          ],
        },
      },
    ])).toMatchObject({ ok: false, reason: expect.stringMatching(/数据路径/) });
  });

  it('enforces DSL table and payload limits', () => {
    expect(validateRenderUiInput({
      title: 'Bad table',
      sections: [{ kind: 'table', columns: Array.from({ length: 11 }, (_, index) => `c${index}`), rows: [] }],
      data: {},
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/表格列数超限/) });

    expect(validateRenderUiInput({
      title: 'Bad content',
      sections: [{ kind: 'text', content: 'x'.repeat(10_001) }],
      data: {},
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/内容过长/) });
  });

  it('reports the unsupported section discriminator and supported kinds', () => {
    const result = validateRenderUiInput({
      title: 'Bad chart',
      sections: [{ kind: 'chart', points: [] }],
      data: {},
    });

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining('chart'),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining('heading/text/metric/table/list/divider'),
    });
  });
});
