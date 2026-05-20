export async function waitFor(
  assertion: () => void | boolean | Promise<void | boolean>,
  options: { timeoutMs?: number; intervalMs?: number } | number = {},
): Promise<void> {
  const normalized = typeof options === 'number' ? { timeoutMs: options } : options;
  const timeoutMs = normalized.timeoutMs ?? 1_000;
  const intervalMs = normalized.intervalMs ?? 10;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await assertion();
      if (result === false) {
        throw new Error('waitFor condition returned false');
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'waitFor timed out'));
}
