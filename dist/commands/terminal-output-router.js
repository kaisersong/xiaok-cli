/** A failed terminal stream is never retried within this session. */
export function createTerminalOutputRouter(options) {
    const failed = new Set();
    const destination = (preferred) => {
        if (!failed.has(preferred))
            return preferred;
        const other = preferred === 'stdout' ? 'stderr' : 'stdout';
        return failed.has(other) ? null : other;
    };
    const fail = (stream, error) => {
        if (failed.has(stream))
            return;
        failed.add(stream); // Must precede logging/cleanup that could re-enter.
        options.onFailure(stream, error, destination(stream));
    };
    const write = (stream, ...args) => {
        const target = destination(stream);
        if (!target)
            return true;
        try {
            return options[target](...args);
        }
        catch (error) {
            fail(target, error);
            // At most two destinations; fail() permanently removes each one.
            return write(stream, ...args);
        }
    };
    return { fail, write, hasOutput: () => failed.size < 2 };
}
