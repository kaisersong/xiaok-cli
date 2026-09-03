export const STREAMING_RENDER_INTERVAL_MS = 80;

export function getStreamingRenderDelay(lastRenderedAt: number | null, now: number): number {
  if (lastRenderedAt === null) return 0;
  return Math.max(0, STREAMING_RENDER_INTERVAL_MS - (now - lastRenderedAt));
}
