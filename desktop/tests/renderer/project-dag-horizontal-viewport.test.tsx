import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { InitialGraphViewport } from '../../renderer/src/components/projects/ProjectDagGraph';

const mock = vi.hoisted(() => ({
  initialized: true,
  viewportInitialized: true,
  width: 1440,
  height: 800,
  fitView: vi.fn(),
  setViewport: vi.fn(),
  getNodes: vi.fn(() => [
    { id: 'start', position: { x: 0, y: 0 }, width: 220, height: 76 },
    { id: 'end', position: { x: 1200, y: 0 }, width: 220, height: 76 },
  ]),
}));
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  useNodesInitialized: () => mock.initialized,
  useStore: (selector: (state: { width: number; height: number }) => unknown) => selector(mock),
  useReactFlow: () => ({ getNodes: mock.getNodes, fitView: mock.fitView, setViewport: mock.setViewport, viewportInitialized: mock.viewportInitialized }),
}));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mock.initialized = true; mock.viewportInitialized = true; mock.width = 1440; mock.height = 800; });

describe('horizontal workflow initial viewport', () => {
  it('fits a graph that remains readable in the available space', () => {
    render(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).toHaveBeenCalledExactlyOnceWith({ minZoom: 0.8, maxZoom: 1, padding: 0.2 });
    expect(mock.setViewport).not.toHaveBeenCalled();
  });

  it('starts a wide graph at its left edge with readable zoom in a narrow window', () => {
    mock.width = 900;
    render(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).not.toHaveBeenCalled();
    expect(mock.setViewport).toHaveBeenCalledExactlyOnceWith({ x: 24, y: 369.6, zoom: 0.8 });
  });

  it('does not reset user pan/zoom when the container resizes or the same topology refreshes', () => {
    mock.width = 900;
    const view = render(<InitialGraphViewport graphKey="project:topology" />);
    mock.width = 1000;
    view.rerender(<InitialGraphViewport graphKey="project:topology" />);
    view.rerender(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.setViewport).toHaveBeenCalledTimes(1);
    expect(mock.fitView).not.toHaveBeenCalled();
  });

  it('positions a newly selected project or changed topology', () => {
    const view = render(<InitialGraphViewport graphKey="one:topology" />);
    view.rerender(<InitialGraphViewport graphKey="two:topology" />);
    view.rerender(<InitialGraphViewport graphKey="two:changed" />);
    expect(mock.fitView).toHaveBeenCalledTimes(3);
  });

  it('waits for the viewport controller before marking the topology positioned', () => {
    mock.viewportInitialized = false;
    const view = render(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).not.toHaveBeenCalled();
    mock.viewportInitialized = true;
    view.rerender(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).toHaveBeenCalledTimes(1);
  });

  it('waits for measured nodes and a nonzero container', () => {
    mock.initialized = false;
    mock.width = 0;
    const view = render(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).not.toHaveBeenCalled();
    mock.initialized = true;
    view.rerender(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).not.toHaveBeenCalled();
    mock.width = 1440;
    view.rerender(<InitialGraphViewport graphKey="project:topology" />);
    expect(mock.fitView).toHaveBeenCalledTimes(1);
  });
});
