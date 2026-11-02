/**
 * #145（codex M2）：用例收尾的每一步都必须执行，某一步抛错（例如 ps 不可用、产品 retire 拒绝）
 * 不能跳过后面的删目录 / resetModules / clearAllMocks；错误先收集，最后一次性抛出。
 */
export function createTeardownSteps(label: string) {
  const errors: unknown[] = [];
  return {
    /** 已收集的错误（副本，改它不影响收尾结果）。 */
    get errors(): readonly unknown[] { return [...errors]; },
    /** 执行一步；返回 true 表示这一步成功。 */
    async step(work: () => unknown): Promise<boolean> {
      try { await work(); return true; } catch (error) { errors.push(error); return false; }
    },
    /** 记一条不是由某一步抛出的失败（例如收尾后仍有 owner 存活）。 */
    fail(error: unknown): void { errors.push(error); },
    finish(): void {
      if (errors.length === 1) throw errors[0] instanceof Error ? errors[0] : new Error(`${label}：${String(errors[0])}`);
      if (errors.length > 1) throw new AggregateError(errors, `${label}：收尾有 ${errors.length} 个错误`);
    },
  };
}
