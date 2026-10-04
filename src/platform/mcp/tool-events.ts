import type { McpSubscription } from '@modelcontextprotocol/client';
import type { McpClientConnection } from './transport.js';

/** Call after installing the notification handler, before the initial catalog read. */
export async function startMcpToolSubscription(
  connection: Pick<McpClientConnection, 'client' | 'protocolEra'>,
  options: { timeout?: number; signal?: AbortSignal; onClosed?(reason: 'graceful' | 'remote'): void } = {},
): Promise<McpSubscription | undefined> {
  if (connection.protocolEra !== 'modern' || !connection.client.getServerCapabilities()?.tools?.listChanged) return;
  const subscription = await connection.client.listen({ toolsListChanged: true }, {
    timeout: options.timeout,
    signal: options.signal,
  });
  if (!subscription.honoredFilter.toolsListChanged) {
    await subscription.close();
    throw new Error('MCP subscription did not honor toolsListChanged');
  }
  void subscription.closed.then(reason => {
    if (reason !== 'local') options.onClosed?.(reason);
  }).catch(() => undefined);
  return subscription;
}
