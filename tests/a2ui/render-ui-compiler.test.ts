import { describe, expect, it } from 'vitest';
import { A2UI_MIME_TYPE, SAFE_A2UI_CATALOG_ID, compileRenderUiToA2ui } from '../../src/a2ui/index.js';

describe('A2UI dashboard compiler', () => {
  it('compiles read-only DSL into a safe catalog surface with least-data model', () => {
    const compiled = compileRenderUiToA2ui({
      title: 'Sales pulse',
      data: {
        secret: 'must not be copied',
        metrics: { unrelated: 42 },
      },
      sections: [
        { kind: 'heading', text: 'Quarterly Sales', level: 1 },
        { kind: 'metric', label: 'Revenue', value: '$42M', change: '+8%' },
        { kind: 'table', columns: ['Region', 'Revenue'], rows: [['APAC', '$12M'], ['EMEA', '$15M']] },
        { kind: 'list', items: ['Pipeline healthy', 'Churn stable'] },
        { kind: 'divider' },
        { kind: 'text', content: 'All values are unaudited.' },
      ],
    }, {
      taskId: 'task_123',
      toolUseId: 'tool_456',
    });

    expect(compiled.mimeType).toBe(A2UI_MIME_TYPE);
    expect(compiled.surfaceId).toBe('a2ui-task_123-tool_456');
    expect(compiled.componentCount).toBe(7);

    expect(compiled.messages[0]).toEqual({
      version: 1,
      createSurface: {
        surfaceId: 'a2ui-task_123-tool_456',
        catalogId: SAFE_A2UI_CATALOG_ID,
        root: 'root',
      },
    });

    const updateComponents = compiled.messages[1]?.updateComponents;
    expect(updateComponents?.components.map((component) => component.component)).toEqual([
      'Column',
      'Text',
      'MetricCard',
      'Table',
      'List',
      'Divider',
      'Text',
    ]);
    expect(updateComponents?.components.find((component) => component.component === 'MetricCard')).toMatchObject({
      label: 'Revenue',
      value: { path: 'metrics.c2.value' },
      change: '+8%',
    });
    expect(updateComponents?.components.find((component) => component.component === 'Table')).toMatchObject({
      columns: ['Region', 'Revenue'],
      rows: { path: 'tables.c3.rows' },
    });

    const dataModel = compiled.messages[2]?.updateDataModel?.value as Record<string, unknown>;
    expect(JSON.stringify(dataModel)).not.toContain('must not be copied');
    expect(dataModel).toEqual({
      metrics: {
        c2: { value: '$42M' },
      },
      tables: {
        c3: { rows: [['APAC', '$12M'], ['EMEA', '$15M']] },
      },
    });
  });

  it('rejects oversized and unsafe DSL before compilation', () => {
    expect(() => compileRenderUiToA2ui({
      title: 'Too many rows',
      sections: [
        {
          kind: 'table',
          columns: ['Name'],
          rows: Array.from({ length: 201 }, (_, index) => [`row-${index}`]),
        },
      ],
      data: {},
    }, { taskId: 'task_1', toolUseId: 'tool_1' })).toThrow(/表格行数超限/);
  });
});
