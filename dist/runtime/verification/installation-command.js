import { spawn } from 'node:child_process';
/** Host helper admission latch only. Neither its release nor child.close proves
 * that a guest command, a VM, or a business execution tree is quiescent. */
const active = new Map();
export function assertInstallationCommandIdle(scope) { if (active.has(scope))
    throw Error('installation_command_busy'); }
export async function runInstallationCommand(input) {
    const { scope, executable, cwd, timeoutMs, signal } = input, argv = [...input.argv], env = { ...input.env }, stdin = typeof input.stdin === 'string' ? Buffer.from(input.stdin) : Buffer.from(input.stdin ?? ''), assertCurrent = input.assertCurrent.bind(input);
    if (typeof scope !== 'string' || !scope || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000 || stdin.length > 256 * 1024 ** 2 || Buffer.byteLength(JSON.stringify(argv)) > 128 * 1024)
        throw Error('installation_command_arguments');
    function current() { signal?.throwIfAborted(); const result = assertCurrent(); if (result !== undefined) {
        void Promise.resolve(result).catch(() => { });
        throw Error('installation_command_current');
    } }
    current();
    assertInstallationCommandIdle(scope);
    const token = Object.freeze({});
    active.set(scope, token);
    const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1000000n;
    return new Promise((resolve, reject) => {
        let settled = false, closed = false, failure, total = 0, grace;
        const chunks = [];
        let child;
        try {
            child = spawn(executable, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
        }
        catch (error) {
            if (active.get(scope) === token)
                active.delete(scope);
            reject(error);
            return;
        }
        const complete = () => { if (settled)
            return; settled = true; clearTimeout(timer); if (grace)
            clearTimeout(grace); signal?.removeEventListener('abort', abort); if (failure)
            reject(failure);
        else
            try {
                current();
                if (process.hrtime.bigint() >= deadline)
                    throw Error('installation_command_unknown');
                resolve(Buffer.concat(chunks));
            }
            catch (error) {
                reject(error);
            } };
        const fail = () => {
            if (closed || failure)
                return;
            failure = Error('installation_command_unknown');
            child.kill('SIGKILL');
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            // If even SIGKILL has no observed close, return bounded failure but retain
            // the admission latch until the real close event eventually occurs.
            grace = setTimeout(complete, 5000);
        };
        const abort = () => fail(), timer = setTimeout(fail, timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (bytes) => { total += bytes.length; if (total > 2 * 1024 ** 2)
            fail();
        else
            chunks.push(Buffer.from(bytes)); });
        child.stderr.on('data', (bytes) => { total += bytes.length; if (total > 2 * 1024 ** 2)
            fail(); });
        child.once('error', fail);
        child.stdin.on('error', fail);
        child.once('close', code => { closed = true; if (active.get(scope) === token)
            active.delete(scope); if (code !== 0)
            failure ??= Error('installation_command_unknown'); complete(); });
        if (signal?.aborted)
            fail();
        else
            child.stdin.end(stdin);
    });
}
