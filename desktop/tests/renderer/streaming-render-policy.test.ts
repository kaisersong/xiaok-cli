import { describe, expect, it } from 'vitest';
import { getStreamingRenderDelay } from '../../renderer/src/lib/streaming-render-policy';

describe('getStreamingRenderDelay', () => {
  it('renders the first delta immediately and bounds later refreshes to 80ms', () => {
    expect(getStreamingRenderDelay(null, 100)).toBe(0);
    expect(getStreamingRenderDelay(100, 150)).toBe(30);
    expect(getStreamingRenderDelay(100, 180)).toBe(0);
    expect(getStreamingRenderDelay(100, 250)).toBe(0);
  });
});
