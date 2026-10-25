import { callControllerIpc } from './controller-ipc.js';
/** Packaged, root-owned helper for a bounded synchronous client freshness check.
 * All secrets travel on stdin/stdout, never argv, environment, or error logs. */
async function main() {
    const chunks = [];
    let total = 0;
    for await (const chunk of process.stdin) {
        const bytes = Buffer.from(chunk);
        if ((total += bytes.length) > 4 * Math.ceil(1024 ** 2 / 3) + 8192)
            throw Error('transport_input_limit');
        chunks.push(bytes);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'body,socketPath' || typeof input.body !== 'string' || typeof input.socketPath !== 'string')
        throw Error('transport_input');
    const body = Buffer.from(input.body, 'base64');
    if (body.length > 1024 ** 2 || body.toString('base64') !== input.body)
        throw Error('transport_input');
    const result = await callControllerIpc(input.socketPath, body, { timeoutMs: 5000 });
    process.stdout.write(result);
}
void main().catch(() => { process.stderr.write('controller_transport_unknown\n'); process.exitCode = 1; });
