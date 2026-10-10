function normalizeWarningCode(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === 'string' && /^DEP\d{4}$/.test(first)) {
    return first;
  }

  const second = args[1];
  if (typeof second === 'string' && /^DEP\d{4}$/.test(second)) {
    return second;
  }

  return undefined;
}

export function shouldSuppressWarning(warning: unknown, args: unknown[] = []): boolean {
  const message = warning instanceof Error ? warning.message : String(warning ?? '');
  const code = warning instanceof Error && 'code' in warning && typeof warning.code === 'string'
    ? warning.code
    : normalizeWarningCode(args);

  const experimental = args[0] === 'ExperimentalWarning'
    || (warning instanceof Error && warning.name === 'ExperimentalWarning');
  if (experimental && message.startsWith('SQLite is an experimental feature')) return true;

  return code === 'DEP0040' && message.includes('`punycode` module is deprecated');
}

export function installWarningFilter(): void {
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (shouldSuppressWarning(warning, args)) {
      return;
    }
    return originalEmitWarning(warning, ...(args as []));
  }) as typeof process.emitWarning;
}
