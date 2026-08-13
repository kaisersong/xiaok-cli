const PROTOCOL_VERSION = 1;
const ENGINE_VERSION = '0.1.8';
const MAX_REQUEST_BYTES = 1024 * 1024;

let responded = false;

function respond(payload) {
  if (responded) return;
  responded = true;
  process.stdout.write(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...payload }));
}

function failure(code, message, retryable = false) {
  respond({ ok: false, code, message, retryable });
}

async function readRequest() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validRequest(value) {
  return value
    && typeof value === 'object'
    && value.protocolVersion === PROTOCOL_VERSION
    && typeof value.absolutePath === 'string'
    && typeof value.format === 'string'
    && Number.isSafeInteger(value.maxOutputChars)
    && value.maxOutputChars > 0;
}

function mapConversionError(error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : '';
  switch (code) {
    case 'unsupported': return ['unsupported_format', 'The Office document format is unsupported.'];
    case 'malformed': return ['malformed_document', 'The Office document is malformed.'];
    case 'encrypted': return ['encrypted_document', 'The Office document is encrypted.'];
    case 'resourceLimit': return ['resource_limit', 'The Office document exceeded parser resource limits.'];
    case 'missingPart': return ['missing_part', 'The Office document is missing a required part.'];
    case 'io': return ['io_error', 'The Office document could not be read.'];
    default: return ['malformed_document', 'The Office document could not be converted.'];
  }
}

try {
  const request = await readRequest();
  if (!validRequest(request)) {
    failure('protocol_error', 'Invalid Office parser request.');
  } else {
    let toMarkdown;
    try {
      ({ toMarkdown } = await import('@firecrawl/anydoc'));
    } catch {
      failure('binding_unavailable', 'The AnyDoc native binding is unavailable.', true);
    }
    if (!responded) {
      try {
        const raw = await toMarkdown(request.absolutePath);
        const markdown = typeof raw === 'string' ? raw.trim() : '';
        if (!markdown) {
          failure('empty_output', 'The Office document contained no readable content.');
        } else {
          const truncated = markdown.length > request.maxOutputChars;
          const output = truncated ? markdown.slice(0, request.maxOutputChars) : markdown;
          respond({
            ok: true,
            markdown: output,
            format: request.format,
            engine: 'anydoc',
            engineVersion: ENGINE_VERSION,
            chars: markdown.length,
            truncated,
          });
        }
      } catch (error) {
        const [code, message] = mapConversionError(error);
        failure(code, message);
      }
    }
  }
} catch {
  failure('protocol_error', 'Invalid Office parser request.');
}
