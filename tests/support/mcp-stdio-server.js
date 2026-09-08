import { writeFileSync } from 'node:fs';

if (process.env.XIAOK_TEST_MCP_PID_FILE) {
  writeFileSync(process.env.XIAOK_TEST_MCP_PID_FILE, String(process.pid), 'utf8');
}
if (process.env.XIAOK_TEST_MCP_STUBBORN === '1') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1_000);
}

let buffer = '';
let transport = null;
let catalogRemoved = false;
let raceListRequest;
let racing = false;
let freshCatalog = false;

function encodeFramed(message) {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function encodeLine(message) {
  return `${JSON.stringify(message)}\n`;
}

function readFramedMessages(input) {
  const messages = [];
  let rest = input;

  while (rest.length > 0) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = rest.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;

    const length = Number(match[1]);
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + length;
    if (rest.length < payloadEnd) break;

    messages.push(JSON.parse(rest.slice(payloadStart, payloadEnd)));
    rest = rest.slice(payloadEnd);
  }

  return { messages, rest };
}

function readLineMessages(input) {
  const messages = [];
  let rest = input;

  while (rest.length > 0) {
    const lineEnd = rest.indexOf('\n');
    if (lineEnd === -1) break;

    const line = rest.slice(0, lineEnd).replace(/\r$/, '').trim();
    rest = rest.slice(lineEnd + 1);
    if (!line) continue;

    messages.push(JSON.parse(line));
  }

  return { messages, rest };
}

function respond(message) {
  const encode = transport === 'line' ? encodeLine : encodeFramed;

  if (message.method === 'initialize') {
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'fixture-mcp',
          version: '1.0.0',
        },
      },
    }));
    return;
  }

  if (message.method === 'tools/list') {
    if (racing && !raceListRequest) {
      raceListRequest = message;
      process.stdout.write(encode({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
      return;
    }
    if (racing) freshCatalog = true;
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: catalogRemoved ? [] : [
          {
            name: freshCatalog ? 'fresh' : 'search',
            description: 'search fixture docs',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          },
        ],
      },
    }));
    if (racing && raceListRequest) {
      const oldId = raceListRequest.id;
      racing = false;
      setTimeout(() => {
        process.stdout.write(encode({ jsonrpc: '2.0', id: oldId, error: { code: -32603, message: 'old catalog failed' } }));
      }, 20);
    }
    return;
  }

  if (message.method === 'tools/call') {
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: `fixture:${String(message.params?.arguments?.q ?? message.params?.input?.q ?? '')}`,
          },
        ],
      },
    }));
    if (process.env.XIAOK_TEST_MCP_MUTABLE_CATALOG === '1') {
      const action = message.params?.arguments?.q;
      if (action === '__race__') {
        racing = true;
        process.stdout.write(encode({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
      }
      if (action === '__remove__') {
        catalogRemoved = true;
        process.stdout.write(encode({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
      }
      if (action === '__disconnect__') setTimeout(() => process.exit(0), 10);
    }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  if (transport === null) {
    if (buffer.includes('Content-Length:')) {
      transport = 'framed';
    } else if (buffer.includes('\n')) {
      transport = 'line';
    }
  }

  if (transport === 'framed') {
    const parsed = readFramedMessages(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      respond(message);
    }
    return;
  }

  if (transport === 'line') {
    const parsed = readLineMessages(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      respond(message);
    }
  }
});
