import { appendFileSync, existsSync, writeFileSync, readFileSync } from 'node:fs';

const windowsFixture = process.env.CUA_MCP_WINDOWS_FIXTURE;
const windowsCatalog = windowsFixture ? JSON.parse(readFileSync(process.env.CUA_MCP_WINDOWS_CATALOG, 'utf8')) : null;
const windowsCapture = windowsFixture ? JSON.parse(readFileSync(process.env.CUA_MCP_WINDOWS_CAPTURE, 'utf8')) : null;
const macosCatalog = JSON.parse(readFileSync(process.env.CUA_MCP_MACOS_CATALOG || new URL('../fixtures/cua-macos-0.33.1/catalog.json', import.meta.url), 'utf8'))
  .map(({ name, required, properties }) => ({ name, inputSchema: { type: 'object', required, properties } }));
let buffer = '';
let transport = null;
let toolCallCount = 0;
let sessionRevived = false;

const failAfterFirstToolCall = process.env.CUA_MCP_FAIL_AFTER_FIRST_TOOL_CALL === '1';
const endSessionAfterFirstToolCall = process.env.CUA_MCP_END_SESSION_AFTER_FIRST_TOOL_CALL === '1';
const exitOnceMarker = process.env.CUA_MCP_EXIT_ONCE_MARKER || '';
const callLogPath = process.env.CUA_MCP_CALL_LOG_PATH || '';
const toolCallDelayMs = Number(process.env.CUA_MCP_DELAY_TOOL_CALL_MS || 0);
const staleDaemonError = 'Internal error: cua-driver daemon not reachable on /Users/song/Library/Caches/cua-driver/cua-driver.sock. Start it with `open -n -g -a CuaDriver --args serve` and retry.';
const endedSessionError = process.env.CUA_MCP_SESSION_ENDED_MESSAGE
  || "session 'mcp-fixture-ended' has ended; Call start_session with this id to revive it before issuing further actions, or use a new session id.";

function logEvent(event) {
  if (!callLogPath) return;
  appendFileSync(callLogPath, `${JSON.stringify({ ...event, pid: process.pid })}\n`, 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function respond(message) {
  const encode = transport === 'line' ? encodeLine : encodeFramed;

  if (message.method === 'initialize') {
    logEvent({ event: 'initialize' });
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: windowsFixture ? { name: 'cua-driver', version: process.env.CUA_MCP_WINDOWS_VERSION || '0.31.0' } : { name: 'fixture-cua-driver', version: '1.0.0' },
      },
    }));
    return;
  }

  if (message.method === 'tools/list') {
    logEvent({ event: 'tools_list' });
    process.stdout.write(encode({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: windowsCatalog || macosCatalog,
      },
    }));
    return;
  }

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    toolCallCount += 1;
    logEvent({ event: 'tool_call', name, input: message.params?.arguments ?? {} });
    if (toolCallDelayMs > 0) await delay(toolCallDelayMs);
    if (exitOnceMarker && toolCallCount > 1 && !existsSync(exitOnceMarker)) {
      writeFileSync(exitOnceMarker, String(process.pid), 'utf8');
      process.exit(0);
    }
    if (endSessionAfterFirstToolCall && toolCallCount > 1 && !sessionRevived && name !== 'start_session') {
      process.stdout.write(encode({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: endedSessionError }],
          isError: true,
        },
      }));
      return;
    }
    if (name === 'start_session') {
      sessionRevived = true;
      process.stdout.write(encode({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: 'session revived' }],
          structuredContent: { session: 'fixture-session', status: 'active' },
        },
      }));
      return;
    }
    if (failAfterFirstToolCall && toolCallCount > 1) {
      process.stdout.write(encode({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: staleDaemonError }],
          isError: true,
        },
      }));
      return;
    }
    if (windowsFixture) {
      const result = name === 'get_window_state' ? windowsCapture : { content: [], structuredContent: { windows: windowsFixture === 'empty' ? [] : [{ pid: windowsCapture.structuredContent.pid, window_id: windowsCapture.structuredContent.window_id }] } };
      process.stdout.write(encode({ jsonrpc: '2.0', id: message.id, result })); return;
    }
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
    parsed.messages.forEach((message) => { void respond(message); });
    return;
  }

  if (transport === 'line') {
    const parsed = readLineMessages(buffer);
    buffer = parsed.rest;
    parsed.messages.forEach((message) => { void respond(message); });
  }
});

process.stdin.on('end', () => process.exit(0));
