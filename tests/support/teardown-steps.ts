/**
 * #145（codex M2）：用例收尾的每一步都必须执行，某一步抛错（例如 ps 不可用、产品 retire 拒绝）
 * 不能跳过后面的删目录 / resetModules / clearAllMocks；错误先收集，最后一次性抛出。
 * 收集时就统一成 Error（DS 第 6 轮 minor 3），非 Error 的抛出值包成 `${label}：${值}`。
 */
export function createTeardownSteps(label: string) {
  const errors: Error[] = [];
  const toError = (error: unknown): Error => error instanceof Error ? error : new Error(`${label}：${String(error)}`);
  return {
    /** 已收集的错误（副本，改它不影响收尾结果）。 */
    get errors(): readonly Error[] { return [...errors]; },
    /** 执行一步；返回 true 表示这一步成功。 */
    async step(work: () => unknown): Promise<boolean> {
      try { await work(); return true; } catch (error) { errors.push(toError(error)); return false; }
    },
    /** 记一条不是由某一步抛出的失败（例如收尾后仍有 owner 存活）。 */
    fail(error: unknown): void { errors.push(toError(error)); },
    finish(): void {
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, `${label}：收尾有 ${errors.length} 个错误`);
    },
  };
}
