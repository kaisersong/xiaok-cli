import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2UI_MIME_TYPE, compileRenderUiToA2ui } from '../../../src/a2ui/index.js';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { A2uiArtifactRenderer } from '../../renderer/src/components/a2ui/A2uiArtifactRenderer';
import { ArtifactStreamBlock } from '../../renderer/src/components/ArtifactStreamBlock';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('A2UI artifact renderer', () => {
  it('renders heading, metric, table, list, divider, and text sections from safe messages', async () => {
    const compiled = compileRenderUiToA2ui({
      title: 'Sales dashboard',
      sections: [
        { kind: 'heading', text: 'Sales', level: 1 },
        { kind: 'metric', label: 'Revenue', value: '$42M', change: '+8%' },
        { kind: 'table', columns: ['Region', 'Revenue'], rows: [['APAC', '$12M']] },
        { kind: 'list', items: ['Pipeline healthy'] },
        { kind: 'divider' },
        { kind: 'text', content: 'All values are unaudited.' },
      ],
      data: {},
    }, { taskId: 'task_1', toolUseId: 'tool_1' });

    render(<LocaleProvider><A2uiArtifactRenderer artifactContent={JSON.stringify(compiled.messages)} artifactRef={{
      artifactId: 'artifact_1',
      type: 'artifact',
      key: 'a2ui/task_1/tool_1.json',
      filename: 'sales.a2ui.json',
      mime_type: A2UI_MIME_TYPE,
    }} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeDefined();
    expect(screen.getAllByText('Revenue')).toHaveLength(2);
    expect(screen.getByText('$42M')).toBeDefined();
    expect(screen.getByText('+8%')).toBeDefined();
    expect(screen.getByText('Region')).toBeDefined();
    expect(screen.getByText('APAC')).toBeDefined();
    expect(screen.getByText('Pipeline healthy')).toBeDefined();
    expect(screen.getByText('All values are unaudited.')).toBeDefined();
  });

  it('shows a safe error when payload validation fails', async () => {
    render(<LocaleProvider><A2uiArtifactRenderer artifactContent={JSON.stringify([
      { version: 1, createSurface: { surfaceId: 'a2ui-task_1-tool_1', catalogId: 'default', root: 'root' } },
    ])} artifactRef={{ artifactId: 'artifact_1', type: 'artifact', mime_type: A2UI_MIME_TYPE }} /></LocaleProvider>);

    expect(await screen.findByText('无法渲染该交互式 UI')).toBeDefined();
    expect(screen.queryByText('default')).toBeNull();
  });

  it('refetches and rerenders when a static A2UI artifact key changes', async () => {
    const first = compileRenderUiToA2ui({
      title: 'First',
      sections: [{ kind: 'heading', text: 'First', level: 2 }],
      data: {},
    }, { taskId: 'task_1', toolUseId: 'tool_1' });
    const second = compileRenderUiToA2ui({
      title: 'Second',
      sections: [{ kind: 'heading', text: 'Second', level: 2 }],
      data: {},
    }, { taskId: 'task_1', toolUseId: 'tool_2' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('/key-2') ? JSON.stringify(second.messages) : JSON.stringify(first.messages);
      return new Response(body, { status: 200, headers: { 'content-type': A2UI_MIME_TYPE } });
    });

    const { rerender } = render(<LocaleProvider><ArtifactStreamBlock accessToken="token" entry={{
      toolCallIndex: 0,
      argumentsBuffer: '',
      complete: true,
      artifactRef: {
        artifactId: 'artifact_1',
        type: 'artifact',
        key: 'key-1',
        filename: 'first.a2ui.json',
        mime_type: A2UI_MIME_TYPE,
      },
    }} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: 'First' })).toBeDefined();

    rerender(<LocaleProvider><ArtifactStreamBlock accessToken="token" entry={{
      toolCallIndex: 0,
      argumentsBuffer: '',
      complete: true,
      artifactRef: {
        artifactId: 'artifact_2',
        type: 'artifact',
        key: 'key-2',
        filename: 'second.a2ui.json',
        mime_type: A2UI_MIME_TYPE,
      },
    }} /></LocaleProvider>);

    expect(await screen.findByRole('heading', { name: 'Second' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'First' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
