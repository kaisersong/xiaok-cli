import { spawn } from 'node:child_process';
/** Only fixed, installed native broker helpers, never project workers. These helpers
 * cannot spawn descendants. Caller abort is not completion: await close before releasing admission. */
export function runBrokerHelper(input: { executable: string; args: readonly string[]; stdin?: Buffer; maximumOutput: number; timeoutMs: number; signal: AbortSignal }): Promise<Buffer> {
  const { executable, args, stdin, maximumOutput, timeoutMs, signal } = input;
  if (!Number.isSafeInteger(maximumOutput) || maximumOutput < 0 || maximumOutput > 16 * 1024 ** 2 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return Promise.reject(Error('broker_helper_budget'));
  signal.throwIfAborted(); const argv = [...args], body = stdin ? Buffer.from(stdin) : undefined;
  return new Promise((resolve, reject) => {
    const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n;
    const child = spawn(executable, argv, { cwd: '/', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let failure: Error | undefined, size = 0, stderr = 0; const output: Buffer[] = [];
    const abort = () => { failure ??= Error('broker_helper_unknown'); child.kill('SIGKILL'); };
    const remainingMs = Math.max(0, Math.ceil(Number(deadline - process.hrtime.bigint()) / 1_000_000));
    const timer = setTimeout(abort, remainingMs); signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => { failure ??= Error('broker_helper_unknown'); });
    child.stdin.on('error', () => { failure ??= Error('broker_helper_unknown'); child.kill('SIGKILL'); });
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maximumOutput) abort(); else if (!failure) output.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.length; if (stderr > 4096) abort(); });
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (failure || signal.aborted || code !== 0 || process.hrtime.bigint() >= deadline) reject(failure ?? Error('broker_helper_unknown'));
      else resolve(Buffer.concat(output));
    });
    if (signal.aborted) abort();
    child.stdin.end(body);
  });
}
