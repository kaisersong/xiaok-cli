# Loop 质量提升方案（修订版 v3）

> 日期: 2026-06-25
> 状态: v3 — 第二轮评审后修订，待第三轮共识确认
> 来源: https://x.com/AnatoliKopadze/status/2068328135611822149 分析
> 修订依据: 两轮 Claude / Kiro / xiaok / Qoder 四方对抗性评审

---

## 评审历程

### 第一轮（v1 → v2）

四方 Critical 共识：token 数据源不存在 + Maker/Checker 上下文隔离缺失。
结论：废弃原 P0/P2，转向"数据优先 + 轻量质量提升"。

### 第二轮（v2 → v3）

| 评审者 | 结论 | 核心反馈 |
|--------|------|---------|
| Claude | Conditional Go | Phase 1B signal 传播路径不完整；Phase 2 需 verifySkipped observability |
| Kiro | 7/10，Conditional Go | Phase 1B 漏中间层接口；blocked runs 污染 accept rate；Phase 2 前置也需 1B |
| xiaok | 有 Critical 残留 | Signal 需改 4 层签名；abort 时必须 cancelTask；llmPort 不需新增方法 |
| Qoder | Conditional Go | 1B 应独立 PR；badge 降为 optional；80% 阈值需加 AND 用户反馈 |

---

## v3 修订要点

| v2 问题 | v3 修正 |
|---------|---------|
| Phase 1B 只写了 2 层签名变更 | 补全 4 层完整调用链 |
| abort 后 task 变 zombie | abort 时先 cancelTask 再 failRun |
| badge 含 blocked runs 稀释成功率 | 排除 blocked，只计 success/(success+failed) |
| Phase 2 "默认 pass" 无可观测性 | 新增 verifySkipped metadata |
| 80% 阈值无依据 | 改为数据 + 用户反馈 AND 条件 |
| `LoopsPane.tsx` 文件不存在 | 修正为 `DesktopSettings.tsx` |
| Phase 2 `slice(0, 4000)` token 风险 | 降为 2000 字符 + head/tail 策略 |
| Phase 2 "可能新增 verifyOutput method" | 明确复用 `llmPort.complete`，不改接口 |

---

## 设计原则

1. **先度量，再优化** — 没有数据 + 用户反馈不动 production code
2. **零 schema 改动优先** — 能用现有数据计算的指标不新增字段
3. **修已有 bug 优先于加新功能**
4. **Bug fix 独立提交** — 不被方案的其他争议拖延

---

## Phase 1B: AbortSignal Bug Fix（独立 PR，立即做）

### 问题

`user-loop-template-runner.ts` 的 `waitForTerminalSnapshot` 不监听 scheduler 传入的 AbortSignal。当 70min executor timeout 触发时，runner 内部 poll loop 变 zombie，task 也成为无主进程。

### 完整调用链与断点

```
timed-action-scheduler.executeClaimed (signal 持有者)
  → loopExecutor.execute(action, context, runtimeContext)     // runtimeContext.signal ✓
    → options.runLoop(loopId, trigger)                        // ← 断点 1: 签名无 signal
      → loopRunner.runLoopNow(loopId, trigger)               // ← 断点 2: 签名无 signal
        → userLoopTemplateRunner.runTemplateLoop(input)       // ← 断点 3: input 无 signal
          → waitForTerminalSnapshot(...)                     // ← 断点 4: 无 signal check
```

### 修复方案（2 个 commit）

**Commit 1: 签名 refactor（纯类型变更，行为不变）**

```typescript
// loop-executor.ts — CreateLoopExecutorOptions
interface CreateLoopExecutorOptions {
  runLoop: (loopId: string, trigger: LoopRunTrigger, signal?: AbortSignal) => ...;
  // ...
}

// loop-executor.ts — createLoopRunner 返回的 LoopRunner
interface LoopRunner {
  runLoopNow: (loopId: string, trigger?: LoopRunTrigger, signal?: AbortSignal) => ...;
}

// user-loop-template-runner.ts — RunUserLoopTemplateInput
interface RunUserLoopTemplateInput {
  loopId: string;
  runId: string;
  trigger: LoopRunTrigger;
  signal?: AbortSignal;  // 新增
}

// loop-executor.ts — createDesktopLoopRuntime 内 wiring
runLoop: (loopId, trigger, signal) => runner.runLoopNow(loopId, trigger, signal)

// createLoopExecutor.execute 内
await options.runLoop(loopId, trigger, runtimeContext.signal);
```

**Commit 2: 行为变更（abort 逻辑）**

`waitForTerminalSnapshot` 修改：

```typescript
while (true) {
  if (signal?.aborted) {
    // 先 cancel task，避免 zombie
    if (taskId) {
      try { await taskPort.cancelTask(taskId); } catch {}
    }
    // 标记 run 失败
    throw new AbortError('Loop run aborted by scheduler timeout');
  }
  // ... 现有 poll 逻辑 ...
  await sleep(pollIntervalMs);
}
```

abort 后的处理流程：
1. `cancelTask(taskId)` — 通知 task-host 停止执行
2. throw `AbortError` — 冒泡到 `runTemplateLoop`
3. `runTemplateLoop` catch → `loopStore.finishLoopRunFailure(runId, 'executor_crash')` — 正确关闭 run 记录
4. executor catch → scheduler 标记 timed_action_run 完成

### 竞态处理

| 场景 | 行为 |
|------|------|
| signal 在 createTask 之前 abort | 不创建 task，直接 throw AbortError，finishFailure |
| signal 在 createTask 之后、首次 poll 之前 abort | cancelTask + throw，finishFailure |
| signal 与 task 完成在同一 tick | 检查顺序：先检查 signal → abort 优先（产出可能不完整） |
| abort 后 constraint extraction | 跳过，不触发（abort 不是内容质量问题） |

### 受影响文件

```
desktop/electron/loop-executor.ts              — 签名变更 + signal 转发
desktop/electron/user-loop-template-runner.ts  — 签名变更 + abort check + cancelTask
desktop/tests/main/loop-executor.test.ts       — 新增 abort 测试
```

### 测试用例

1. signal abort 后 runner 在下一个 poll tick 调用 cancelTask 并抛 AbortError
2. abort 后 loop_runs 标记 `status: 'failed'`, `failureKind: 'executor_crash'`
3. signal 在 createTask 之前 abort → 不创建 task，直接 failRun
4. abort + task 恰好同时完成 → abort 优先，产出不计为 success
5. 签名变更后，signal=undefined 时行为与修复前完全一致（backward compat）

---

## Phase 1A: 前端成功率 Badge（可选，低优先）

### 定位

非阻塞项。价值是让成功率在 UI 中可见，为 Phase 2 的数据决策提供直觉参考。

如果团队认为"一条 SQL 就够"（`SELECT status, count(*) FROM loop_runs WHERE loop_id=? GROUP BY status`），可以跳过此 Phase，在需要做数据决策时直接查 SQLite。

### 如果做

**计算公式**（修正：排除 blocked）：
```typescript
function computeAcceptRate(runs: LoopRun[]): { rate: number; level: 'healthy' | 'warning' | 'critical' } {
  const effective = runs.filter(r => r.status === 'success' || r.status === 'failed');
  if (effective.length === 0) return { rate: 1, level: 'healthy' };
  const success = effective.filter(r => r.status === 'success').length;
  const rate = success / effective.length;
  const level = rate >= 0.7 ? 'healthy' : rate >= 0.5 ? 'warning' : 'critical';
  return { rate, level };
}
```

**数据窗口**：最近 20 次 effective run（排除 blocked）。

**UI 位置**：Automations > Loops tab，每个 loop card 右上角。Tooltip 显示 `成功 N / 总 M 次（排除因环境问题阻塞的 K 次）`。

**受影响文件**（修正路径）：
```
desktop/renderer/src/components/DesktopSettings.tsx  — LoopsPane 中添加 badge
desktop/renderer/src/locales/index.ts                — type
desktop/renderer/src/locales/zh.ts                   — 中文
desktop/renderer/src/locales/en.ts                   — 英文
```

**i18n keys**：
```typescript
loops: {
  acceptRate: string;
  acceptRateHealthy: string;
  acceptRateWarning: string;
  acceptRateCritical: string;
  acceptRateTooltip: (success: number, total: number, blocked: number) => string;
}
```

---

## Phase 1C: 数据观测窗口

Phase 1B 交付后，等待真实 scheduled loop run 数据积累。

**最小样本要求**：单个 loop 20+ 次 effective run，且至少有 2 个不同 loop 达到此标准。

**时间线现实检查**：
- daily loop → 20 runs ≈ 3 周
- weekly loop → 20 runs ≈ 5 个月（对 weekly loop 不适用此决策框架）
- 如果所有 loop 都是 daily 以下频率，决策窗口实际为 3-6 周

**数据决策矩阵**（修正：AND 条件）：
| 观测结果 | 下一步 |
|---------|--------|
| 成功率 > 80% **且** 无用户质量投诉 | 维持现状，不做 Phase 2 |
| 成功率 60-80% **或** 用户反馈产出质量差 | 进入 Phase 2（轻量 verify check） |
| 成功率 < 60% | 进入 Phase 2 + 排查 prompt / constraints 质量 |
| 发现 "从未成功的 loop 持续自动运行" 模式 | 进入 Phase 3（手动成功 gate） |

注：成功率数字是参考阈值，非硬性 gate。关键决策因子是"用户是否认为产出有用"，数字只是辅助信号。

---

## Phase 2: Verify Stage LLM Quality Check（数据驱动后再做）

### 前置条件

- Phase 1C 数据观测完成
- 满足决策矩阵中"进入 Phase 2"的条件
- Phase 1B 已合入（verify LLM 调用也需 signal 传播保护）

### 做什么

在 `markdown_file` loop 的现有 verify 阶段追加一次 `llmPort.complete` 质量评估。

### 接口决策：复用 `llmPort.complete`，不改 LoopLLMPort 接口

`LoopLLMPort` 只有一个 `complete` 方法。Phase 2 的 verify 是一次标准 `complete` 调用（不同 prompt），在 `user-loop-template-runner.ts` 内写一个 `verifyViaLLM(port, input)` 纯函数即可（类似现有 `extractViaLLM`）。

### 执行流程

```
现有 verify:
  1. existsSync(outputPath) → false → fail
  2. stat.size > 0 → false → fail
  3. → success

修订后 verify:
  1. existsSync(outputPath) → false → fail
  2. stat.size > 0 → false → fail
  3. readFileSync(outputPath, 'utf-8') → fileContent
  4. [新增] verifyViaLLM(llmPort, { prompt: template.prompt, content: fileContent }) → verdict
     - pass → success
     - fail → 触发 constraint extraction + 标记 failed (failureKind: 'validation_failed')
     - skip (llmPort 失败) → success + 记录 verifySkipped metadata
```

### Verify Prompt 设计

```typescript
const truncated = truncateForVerify(fileContent, 2000); // head 1200 + tail 800

const verifyPrompt = `你是一个严格的质量审查员。

原始需求：
${template.prompt}

产出内容：
${truncated}

请判断产出是否满足原始需求。只回答 JSON：
{"pass": true/false, "reason": "一句话理由"}

评判标准：
- 内容是否回答了原始需求
- 是否有明显的敷衍/重复/跑题
- 格式是否基本正确
不需要评判文采或创意，只判断基本合格性。`;
```

### 内容截断策略（v1 简化方案）

```typescript
function truncateForVerify(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const head = content.slice(0, Math.floor(maxChars * 0.6));  // 前 60%
  const tail = content.slice(-Math.floor(maxChars * 0.4));     // 后 40%
  return `${head}\n\n[...中间内容省略...]\n\n${tail}`;
}
```

- 总量限制 2000 字符（≈ 2000-4000 tokens，对主流模型安全）
- Head + tail 策略：防止"前面 OK 后面敷衍"的模式漏检
- 已知限制：对于结构依赖中间段的内容（如长报告的第三章）可能漏检
- 迭代条件：如果发现"中间段偏离"模式频繁出现，再改为摘要式截断

### LLM 请求参数

```typescript
const verifyResult = await llmPort.complete({
  systemPrompt: '你是质量审查员，只输出 JSON。',
  userMessage: verifyPrompt,
  maxTokens: 150,   // verdict + reason 不需要长回复
  temperature: 0,   // 确定性判断
});
```

### "默认 pass" 策略 + Observability

**规则**：llmPort 失败时默认 pass，但记录 skip 事件。

**实现**：
```typescript
interface VerifyResult {
  verdict: 'pass' | 'fail' | 'skipped';
  reason?: string;
  skipReason?: string;  // 'llm_timeout' | 'llm_error' | 'parse_failed'
}
```

- `verdict: 'skipped'` 时，loop run 仍标记 `status: 'success'`（不阻断产出）
- skip 事件记入 loop run 的 stage message（现有 `recordStageEvidence` 可携带 metadata）
- 连续 3 次 skip → 记录 warn 级别日志（可能 API key 过期 / model 不可用）

**前端 badge 交互**：如果做了 Phase 1A，badge tooltip 中区分 "verified success" 和 "verify skipped"。

### JSON 解析容错

```typescript
function parseVerifyResponse(text: string): { pass: boolean; reason: string } | null {
  // 1. 尝试直接 parse
  try { return JSON.parse(text.trim()); } catch {}
  // 2. strip markdown code fence
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  // 3. regex fallback
  const passMatch = text.match(/"pass"\s*:\s*(true|false)/);
  if (passMatch) return { pass: passMatch[1] === 'true', reason: 'parsed via regex fallback' };
  // 4. 无法解析
  return null;
}
```

### 不做什么

- 不做 retry/重跑 maker（留给 Phase 4）
- 不改 `task_completion` loop（没有文件产出可 verify）
- 不新增 schema 字段（verify 结果通过现有 `failureKind` + stage evidence 记录）
- 不改 `LoopLLMPort` 接口

### 受影响文件

```
desktop/electron/user-loop-template-runner.ts  — verify 阶段新增 verifyViaLLM + readFileSync
desktop/tests/main/loop-executor.test.ts       — verify pass/fail/skip 测试
```

### 测试用例

1. llmPort 返回 `{"pass": true, "reason": "OK"}` → loop run success
2. llmPort 返回 `{"pass": false, "reason": "内容跑题"}` → loop run failed (validation_failed) + constraint extraction
3. llmPort 超时 (30s) → verdict=skipped, loop run success, stage message 记录 skipReason
4. llmPort 返回无法解析的响应 → verdict=skipped, loop run success
5. llmPort 返回 markdown-fenced JSON → 正确解析
6. fileContent 为空 → 不调 llmPort，走现有 size=0 fail 逻辑
7. signal abort 在 verifyViaLLM 期间触发 → abort 优先，cancelTask，failRun

---

## Phase 3: 手动成功 Gate（按需再做）

### 前置条件

- Phase 1C 数据显示存在 "从未成功的 loop 持续自动运行" 的模式
- 或用户反馈此问题

### 设计要点（已根据评审修订）

1. **Prompt hash 比对**：记录 success run 的 `promptHash`，prompt 变更后旧 success 失效
2. **requestSource 参数**：基于现有 `CreateLoopScheduleInput.source` 字段判断，agent source → default deny
3. **结构化错误码**：返回 `{ error: 'LOOP_NO_MANUAL_SUCCESS' }` → renderer 走 `t.*`
4. **区分 loop kind**：`markdown_file` 严格 block，`task_completion` 仅 warn

---

## Phase 4: Maker/Checker 双 Agent（远期，数据驱动）

### 前置条件

- Phase 2 运行 2+ 周后成功率仍 < 60%
- 或用户明确要求"产出被打回后自动重做"

### 设计要点（已根据评审修订）

1. Checker 走 `llmPort.complete`（非 taskPort，无 tool 权限）
2. Per-iteration time budget（`maxRetryBudgetMs`）而非硬限次数
3. AbortSignal 全链路传播（Phase 1B 已修复）
4. 移除 "checker pass 3 次 → constraint deactivate"
5. Token usage 等 task-host 自然演进

### 实际启动时间线

Phase 1C（3-6 周）+ Phase 2 运行 2 周 = **最早 5-8 周后**才可能考虑 Phase 4。方案在此之前不做任何 Phase 4 相关的 schema 或接口变更。

---

## 关联项目同步清单

| 项目 | 是否需要改动 | 说明 |
|------|:---:|------|
| kswarm | 否 | Loop 系统完全在 desktop/electron 内部 |
| intent-broker | 否 | Loop 不经过 broker 通信 |
| kai-xiaok-plugins | 否 | 不涉及 plugin 能力 |
| desktop packaging | 否 | 无新增 extraResources |

**Phase 1-3 均为 `xiaok-cli` desktop 内部改动，无关联项目同步需求。**

---

## 实施时间线

| Phase | 前置条件 | 预估工作量 | 交付方式 | 风险 |
|-------|---------|-----------|---------|------|
| 1B: AbortSignal | 无 | 0.5-1 天 | 独立 PR | 低 |
| 1A: 前端 badge | 无（可选） | 0.5 天 | 独立 PR | 极低 |
| 1C: 数据观测 | 1B 合入 | 3-6 周等待 | 无代码 | 无 |
| 2: Verify LLM | 数据+反馈触发 | 1 天 | 独立 PR | 低 |
| 3: 手动成功 gate | 数据显示问题 | 0.5 天 | 独立 PR | 低 |
| 4: Maker/Checker | Phase 2 不足 | 3-5 天 | 独立 PR | 高 |
