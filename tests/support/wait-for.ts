export async function waitFor(
  assertion: () => void | boolean | Promise<void | boolean>,
  options: { timeoutMs?: number; intervalMs?: number } | number = {},
): Promise<void> {
  const normalized = typeof options === 'number' ? { timeoutMs: options } : options;
  // Windows CI 上进程启动与文件系统操作明显更慢，显式等待需要相应放宽，
  // 否则平台性变慢会被误判成断言失败（terminal-ui 的 windows job）。
  const platformFactor = process.platform === 'win32' ? 5 : 1;
  const timeoutMs = (normalized.timeoutMs ?? 1_000) * platformFactor;
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
