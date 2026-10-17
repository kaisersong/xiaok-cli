// Transport fixture loaded only by the dedicated TTY regression with --import.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.XIAOK_ERROR_RECOVERY_PROBE_DIR;
if (!root) throw new Error('KIMI_RECOVERY_PROBE_DIR_REQUIRED');
writeFileSync(join(root, 'cli.pid'), String(process.pid));
const actualFetch = globalThis.fetch;
let attempt = 0;
const encoder = new TextEncoder();
function event(delta, finish_reason = null) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
}
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  if (!url.startsWith('https://api.kimi.com/coding/v1/chat/completions')) return actualFetch(input, init);
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : await input.clone().text());
  const permanent = JSON.stringify(body.messages).includes('PERMANENT_TTY_CASE');
  appendFileSync(join(root, 'requests.jsonl'), JSON.stringify({ attempt: ++attempt, permanent, model: body.model }) + '\n');
  if (permanent) return new Response(JSON.stringify({ error: {
    code: 'invalid_api_key', message: 'PRIVATE_REASONING_CANARY sk-fixture-private',
  } }), { status: 401, headers: { 'content-type': 'application/json' } });
  let timer;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(event({ reasoning_content: 'fixture reasoning' })));
      if (attempt === 1) {
        controller.enqueue(encoder.encode(event({ tool_calls: [{ index: 0, id: 'once', type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: "printf 'once\\n' >> tool-count.txt" }) },
        }] })));
        controller.enqueue(encoder.encode(event({}, 'tool_calls') + 'data: [DONE]\n\n'));
        controller.close();
      } else if (attempt === 2) {
        controller.enqueue(encoder.encode(event({ content: 'RECOVERY_PARTIAL' })));
        timer = setTimeout(() => controller.error(Object.assign(new Error('PRIVATE_REASONING_CANARY socket hang up'), {
          code: 'ECONNRESET',
        })), 40);
      } else {
        controller.enqueue(encoder.encode(event({ content: 'RECOVERY_TTY_COMPLETE' })));
        controller.enqueue(encoder.encode(event({}, 'stop') + 'data: [DONE]\n\n'));
        controller.close();
      }
    },
    cancel() { clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
};
