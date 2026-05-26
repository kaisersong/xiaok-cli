let buffer = '';
let transport = null;

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
    if (line) messages.push(JSON.parse(line));
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
        capabilities: {},
        serverInfo: { name: 'fixture-cua-driver', version: '1.0.0' },
      },
    }));
    return;
  }

  if (message.method === 'tools/list') {
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          { name: 'list_apps', description: 'list apps', inputSchema: { type: 'object', properties: {} } },
          { name: 'list_windows', description: 'list windows', inputSchema: { type: 'object', properties: { on_screen_only: { type: 'boolean' } } } },
          { name: 'get_window_state', description: 'get window state', inputSchema: { type: 'object', properties: { pid: { type: 'integer' }, window_id: { type: 'integer' } } } },
          { name: 'click', description: 'click an element', inputSchema: { type: 'object', properties: { app: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
        ],
      },
    }));
    return;
  }

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: name === 'list_apps' ? 'Finder\nSafari' : `cua:${name}` }],
        structuredContent: name === 'list_apps'
          ? { apps: ['Finder', 'Safari'] }
          : name === 'list_windows'
            ? { windows: [{ app_name: 'Safari', pid: 123, window_id: 456, is_on_screen: true }] }
            : { ok: true },
      },
    }));
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  if (transport === null) {
    if (buffer.includes('Content-Length:')) transport = 'framed';
    else if (buffer.includes('\n')) transport = 'line';
  }

  if (transport === 'framed') {
    const parsed = readFramedMessages(buffer);
    buffer = parsed.rest;
    parsed.messages.forEach(respond);
    return;
  }

  if (transport === 'line') {
    const parsed = readLineMessages(buffer);
    buffer = parsed.rest;
    parsed.messages.forEach(respond);
  }
});
