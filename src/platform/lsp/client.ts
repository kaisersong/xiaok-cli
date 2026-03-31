export interface LspEnvelope {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
}

export interface LspTransport {
  send(message: LspEnvelope): Promise<LspEnvelope | void>;
  onMessage(handler: (message: LspEnvelope) => void): () => void;
  dispose?(): void;
}

export function encodeLspMessage(message: LspEnvelope): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

export function decodeLspFrames(input: string): LspEnvelope[] {
  const messages: LspEnvelope[] = [];
  let rest = input;

  while (rest.length > 0) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = rest.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;

    const length = Number(match[1]);
    const payloadStart = headerEnd + 4;
    const payload = rest.slice(payloadStart, payloadStart + length);
    messages.push(JSON.parse(payload) as LspEnvelope);
    rest = rest.slice(payloadStart + length);
  }

  return messages;
}

export interface LspManagerLike {
  applyMessage(message: LspEnvelope): void;
}

export function createLspClient(transport: LspTransport, manager: LspManagerLike) {
  let nextId = 1;
  const unsubscribe = transport.onMessage((message) => {
    if (message.method) {
      manager.applyMessage(message);
    }
  });

  async function request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await transport.send({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params,
    });

    if (!response) {
      return undefined;
    }
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  async function notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await transport.send({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  return {
    async initialize(rootUri: string): Promise<void> {
      await request('initialize', {
        processId: process.pid,
        rootUri,
        capabilities: {},
      });
      await notify('initialized', {});
    },

    async didOpenDocument(document: {
      uri: string;
      languageId: string;
      version?: number;
      text: string;
    }): Promise<void> {
      await notify('textDocument/didOpen', {
        textDocument: {
          ...document,
          version: document.version ?? 1,
        },
      });
    },

    dispose(): void {
      unsubscribe();
      transport.dispose?.();
    },
  };
}
