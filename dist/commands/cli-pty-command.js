/** Local terminal input is forwarded only; it is never returned or recorded. */
export async function runPtyCommand(command, options) {
    options.signal?.throwIfAborted();
    if ((options.platform ?? process.platform) === 'win32')
        throw new Error('Windows sudo 不使用此交互终端；请使用管理员终端。');
    const input = options.input ?? process.stdin;
    if (!input.isTTY)
        throw new Error('sudo 需要本地交互终端，当前会话不可输入密码。');
    let backend;
    try {
        backend = await import('node-pty');
    }
    catch {
        throw new Error('交互终端组件 node-pty 不可用，请重新安装小 K CLI。');
    }
    options.signal?.throwIfAborted();
    const proc = backend.spawn('/bin/sh', ['-c',
        'stty -echo || exit 125; printf "\\036XIAOK_PTY_READY\\037"; exec /bin/sh -c "$1"', 'xiaok', command], {
        name: process.env.TERM || 'xterm-256color', cwd: options.cwd ?? process.cwd(),
        cols: process.stdout.columns || 80, rows: process.stdout.rows || 24, env: process.env,
    });
    const wasRaw = input.isRaw;
    const wasPaused = input.isPaused();
    const limit = Math.max(1, Math.min(options.maxChars ?? 12000, 200000));
    let output = '', startup = '', ready = false, exited = false, interrupted = false, timedOut = false;
    let escalation;
    let timeout;
    const stop = () => {
        if (exited || escalation)
            return;
        // The PTY line discipline delivers SIGINT to the foreground command.
        proc.write('\x03');
        escalation = setTimeout(() => {
            if (exited)
                return;
            try {
                process.kill(-proc.pid, 'SIGKILL');
            }
            catch { /* onExit remains the completion boundary */ }
            try {
                proc.kill('SIGKILL');
            }
            catch { /* do not report a live process as complete */ }
        }, 1000);
    };
    const onAbort = () => { interrupted = true; stop(); };
    const onInput = (data) => {
        if (!ready || exited || interrupted || timedOut)
            return;
        const text = data.toString();
        if (text === '\x03' || text === '\x1b') {
            onAbort();
            return;
        }
        proc.write(text);
    };
    const onResize = () => {
        if (!exited) {
            try {
                proc.resize(process.stdout.columns || 80, process.stdout.rows || 24);
            }
            catch { /* exiting */ }
        }
    };
    let dataSubscription;
    let exitSubscription;
    try {
        return await new Promise((resolve, reject) => {
            exitSubscription = proc.onExit(({ exitCode }) => {
                exited = true;
                if (!ready)
                    output = startup.slice(0, limit);
                if (interrupted)
                    reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
                else
                    resolve({ output, exitCode, timedOut });
            });
            dataSubscription = proc.onData(data => {
                if (!ready) {
                    startup += data;
                    const marker = '\x1eXIAOK_PTY_READY\x1f';
                    const index = startup.indexOf(marker);
                    if (index < 0) {
                        startup = startup.slice(-4096);
                        return;
                    }
                    data = startup.slice(index + marker.length);
                    startup = '';
                    ready = true;
                    input.setRawMode(true);
                    input.on('data', onInput);
                    input.resume();
                }
                output += data.slice(0, Math.max(0, limit - output.length));
                try {
                    options.write(data);
                }
                catch {
                    onAbort();
                }
            });
            process.stdout.on('resize', onResize);
            options.signal?.addEventListener('abort', onAbort, { once: true });
            timeout = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, Math.min(options.timeoutMs ?? 120000, 3600000)));
            if (options.signal?.aborted)
                onAbort();
        });
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        if (escalation)
            clearTimeout(escalation);
        input.off('data', onInput);
        process.stdout.off('resize', onResize);
        options.signal?.removeEventListener('abort', onAbort);
        dataSubscription?.dispose();
        exitSubscription?.dispose();
        input.setRawMode(Boolean(wasRaw));
        if (wasPaused)
            input.pause();
    }
}
