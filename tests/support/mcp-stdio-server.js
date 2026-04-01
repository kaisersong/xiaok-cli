let buffer = '';

function encode(message) {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function readFrames(input) {
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

function respond(message) {
  if (message.method === 'initialize') {
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: { serverInfo: { name: 'fixture-mcp' } },
    }));
    return;
  }

  if (message.method === 'tools/list') {
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'search',
            description: 'search fixture docs',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
          },
        ],
      },
    }));
    return;
  }

  if (message.method === 'tools/call') {
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: `fixture:${String(message.params?.input?.q ?? '')}` }],
      },
    }));
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const parsed = readFrames(buffer);
  buffer = parsed.rest;
  for (const message of parsed.messages) {
    respond(message);
  }
});
