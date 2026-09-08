import type { Tool } from '../../src/types.js';
import type { McpClientConnection } from '../../src/platform/mcp/transport.js';
import { DesktopOwnedToolRegistry } from './desktop-multi-agent-catalog-bridge.js';

/** Owns one live MCP connection's tool identities, not the connection process. */
export class DesktopMcpCatalogRegistration<TSchema> {
  private revision = 0;
  private active = true;
  private tools: Tool[] = [];
  private readonly previousOnClose: McpClientConnection['client']['onclose'];
  private readonly onClose: () => void;
  constructor(private readonly options: {
    registry: DesktopOwnedToolRegistry; ownerId: string; connection: McpClientConnection;
    listSchemas(): Promise<TSchema[]>; buildTools(schemas: TSchema[]): Tool[];
    onChanged?(tools: Tool[]): void; onDisconnected?(): void;
  }) {
    this.previousOnClose = options.connection.client.onclose;
    this.onClose = () => { try { this.previousOnClose?.(); } finally { this.dispose(); options.onDisconnected?.(); } };
    options.connection.client.onclose = this.onClose;
    options.connection.client.setNotificationHandler('notifications/tools/list_changed', async () => {
      try { await this.refresh(); } catch { /* Current refresh already revoked its tools. */ }
    });
  }
  async refresh(): Promise<void> {
    if (!this.active) return;
    const revision = ++this.revision;
    try {
      const schemas = await this.options.listSchemas();
      if (!this.active || revision !== this.revision) return;
      this.replace(this.options.buildTools(schemas));
    } catch (error) {
      if (this.active && revision === this.revision) this.replace([]);
      throw error;
    }
  }
  dispose(): void {
    if (!this.active) return;
    this.active = false; this.revision++; this.replace([]);
    if (this.options.connection.client.onclose === this.onClose) this.options.connection.client.onclose = this.previousOnClose;
    this.options.connection.client.setNotificationHandler('notifications/tools/list_changed', () => {});
  }
  private replace(next: Tool[]): void {
    for (const tool of this.tools) this.options.registry.unregisterTool(tool.definition.name, tool);
    this.tools = [];
    try {
      for (const tool of next) {
        this.options.registry.registerOwnedTool(tool, { ownerId: this.options.ownerId, slotKey: tool.definition.name, binding: 'independent' });
        this.tools.push(tool);
      }
    } catch (error) {
      for (const tool of this.tools) this.options.registry.unregisterTool(tool.definition.name, tool);
      this.tools = []; throw error;
    } finally { this.options.onChanged?.([...this.tools]); }
  }
}
