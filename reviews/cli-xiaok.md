# KualityForge Review: xiaok-cli (HEAD~3..HEAD)

## 变更概要

本次评审覆盖 3 个 commit（`1ca22c58` → `6ded091e`），涉及 20 文件、+882/-49 行，主要围绕 **任务鲁棒性加固**、**KSwarm 路由守卫**、**Windows 跨平台 artifact 路径兼容**、**报告渲染器部署完整性修复**和**连接器超时防护**。

## 架构边界检查

| 边界 | 状态 | 说明 |
|------|------|------|
| main ↔ renderer 事实来源 | ✅ | renderer 仅做路径规范化，KSwarm 路由由 main 维护 |
| IPC contract | ✅ | 本次未改动 preload / IPC surface |
| scheduler / executor 分工 | ✅ | watchdog 在 executor（TaskRunner）层，stale recovery 在 startup 层 |
| 平台 gate | ⚠️ | Windows 路径处理已添加，但 `recoverStaleTasks()` 无平台守卫 |
| 打包 | ✅ | `electron-builder.json` filter 从细粒度改为 `dist/**/*`，修复 stale build |

## 发现

### P0 / 阻塞
无。

### P1 / 高风险

**F1: 工具循环 + finalization 逻辑在 `createDesktopModelRunner` 和 `createDesktopModelRunnerWithRegistry` 中完全重复**

`desktop/electron/desktop-services.ts` 两处 runner 函数共享 200+ 行几乎相同的工具循环逻辑，包括本次新增的 `toolResultsAwaitingFinalResponse` 标记和 `streamDesktopToolLoopFinalization` 调用。两处的差异仅在 `maxChars` 裁剪值（`getContextLimit(adapter.getModelName())` vs `2`）和 `onUsage` handler。这违反了 DRY 原则，未来任一分支的修改都有不到 50% 的概率同步到另一分支。

**F2: `streamDesktopToolLoopFinalization` 在 finalization 回合收到 tool_use 时抛异常**

`desktop-services.ts:3811` 的 `streamDesktopToolLoopFinalization` 在模型发出 tool_use 时直接 `throw new Error('desktop_tool_loop_finalization_requested_tool')`。finalization prompt（`DESKTOP_MODEL_TOOL_LOOP_FINALIZATION_PROMPT`）明确要求模型"不要再调用工具"，但没有任何模型保证 100% 遵循。若模型违规，这个 throw 会被外层 try/catch 捕获并标记任务失败。应考虑降级处理（忽略 tool_use，继续 stream）而不是硬失败。

### P2 / 中风险

**F3: `isReportRendererStructurallyValid` 将 L3 失败视为有效**

`desktop-services.ts:3544-3550` 的 `isReportRendererStructurallyValid` 只检查 L0/L1/L2 通过就算 valid。当 renderer 报告 `success: false` 但 L0/L1/L2 通过时，tool 返回 `success: true`。这可能导致模型和用户认为报告已成功渲染，而实际 L3 质量告警（如段落不完整、字体缺失）被静默丢弃。建议至少在 `success` 字段上保持诚实传递。

**F4: `recoverStaleTasks()` 在 `main.ts` 中无错误边界**

`desktop/electron/main.ts:133` 直接 `await services.recoverStaleTasks()` 无 try/catch。若 snapshot store 损坏或磁盘 I/O 失败，这个调用会阻止窗口创建，导致 app 启动白屏。建议加 defensive catch 并记录诊断日志。

### P3 / 低风险 / 改进建议

**F5: `normalizeDeliverableFile` 中 `basename` 的 Windows 反斜杠规范化未扩展到所有调用点**

`desktop/renderer/src/components/projects/DeliverableView.tsx:375` 和 `desktop/renderer/src/components/projects/artifactActions.ts:90` 的本地 `basename()` 都已添加 `replace(/\\/g, '/')`。但 `desktop/electron/desktop-services.ts` 和其他可能解析 artifact 路径的地方使用的是 `node:path` 的 `basename`，在 Windows 上行为一致，但在 macOS 上遇到 Windows 来源的路径字符串时仍会错误拆分。当前修复仅在 renderer 层生效。

**F6: `withReportRendererTimeout` 的 30 秒硬编码超时**

`desktop-services.ts:3555` 中 `30_000` 毫秒硬编码。对于大型 IR 内容的渲染，30 秒可能不够；对于简单 IR 又过长。应从 runner 的 `TASK_TIMEOUT_MS`（30 分钟）推导或作为可配置参数。

**F7: `ConnectorRegistry` 超时测试使用永不 resolve 的 Promise 可能造成测试泄漏**

`tests/ai/tools/connectors/registry.test.ts:147` 中 `new Promise<Response>(() => {})` 永不 resolve。Vitest 的超时机制会兜底，但若 vitest 配置的 test timeout 大于 registry 的 abort timeout（50ms），测试本身不会泄漏；否则这个 Promise 会在测试结束后继续存在。当前 signal timeout 50ms 远小于默认 test timeout 5s，风险较低但不够优雅。

## 正面发现

**G1: 任务鲁棒性三件套设计完整**
- watchdog timer（`taskWatchdogMs`，默认 30 分钟）防止 runner 永久挂起
- stale task recovery 在 startup 时将 `running` 快照标记为 `failed`，带 salvage summary
- 空交付检测 `isEmptyDelivery` 将无产出的任务标记 `degraded: true`
- 三者互补覆盖挂起、崩溃恢复、空产出三个故障模式，测试完整

**G2: Windows 跨平台 artifact 路径处理**
- `artifactActions.ts` 的 `resolveArtifactUrl` 现在优先从 `projectId + filename` 构造 KSwarm route，再 fallback 到 `file://` 路径
- `DeliverableView` 的 `normalizeDeliverableFile` 增加了 `label` 作为 displayName fallback
- `basename()` 统一规范化反斜杠
- 测试覆盖 Windows 绝对路径 artifact 打开流程

**G3: KSwarm create_project 路由守卫**
- system prompt 新增明确的 **禁止调用** 条件（单人可完成的任务不得创建项目）
- tool description 同步更新
- 能显著减少模型将简单报告任务升级为多智能体项目的误用

**G4: 报告渲染器部署完整性**
- `electron-builder.json` filter 从 `server.bundle.js` + `themes/**/*` 改为 `dist/**/*`
- 新增 `ensureReportRendererDistCompat` 处理已部署插件的 dist 目录补全
- 报告渲染从直接 `import()` `html-builder.js` 改为通过 MCP subprocess 调用 `server.bundle.js`，隔离更干净

**G5: 测试覆盖充分**
- `desktop-runner-finalization.test.ts`：146 行，覆盖 tool-exhaustion 后 finalization 回合和空回合处理
- `stale-task-recovery.test.ts`：103 行，覆盖 recovery 和 terminal 跳过
- `task-runtime-host.test.ts`：+69 行，覆盖 degraded 交付和 watchdog abort
- `connectors/registry.test.ts`：+24 行，覆盖 search/fetch 超时 abort
- `project-artifact-actions.test.tsx`：+86 行，覆盖 Windows 路径 artifact 打开

## 原则对齐

| 原则 | 对齐 |
|------|------|
| 设计先行 + 对抗性评审 | ⚠️ 本次未发现对应的设计文档或评审记录 |
| 测试先于生产代码 | ✅ 所有功能变更均有对应测试 |
| 跨平台兼容 | ✅ Windows 路径 + 平台守卫到位 |
| 单一事实来源 | ✅ main process 维护所有 durable state |
| renderer 不做持久化事实来源 | ✅ renderer 仅做路径规范化展示 |

```kualityforge-review
{
  "runnerId": "cli-xiaok",
  "status": "completed",
  "contextRead": {
    "projectBrief": true,
    "userQualityPrinciples": true
  },
  "contextConfidence": "high",
  "contextGaps": [],
  "principleAlignment": {
    "design_first": "⚠️ 未发现对应设计文档",
    "test_before_production": "✅ 全部覆盖",
    "cross_platform": "✅ Windows 路径已处理",
    "single_source_of_truth": "✅ main process 为主",
    "renderer_durable_state": "✅ renderer 仅展示"
  },
  "findings": [
    {
      "severity": "high",
      "id": "F1",
      "title": "工具循环 + finalization 逻辑在两处 runner 中重复",
      "file": "desktop/electron/desktop-services.ts",
      "line": 3996-4244, 5234-5415,
      "description": "createDesktopModelRunner 和 createDesktopModelRunnerWithRegistry 共享 200+ 行重复的工具循环代码，包括新增的 toolResultsAwaitingFinalResponse 和 streamDesktopToolLoopFinalization。",
      "recommendation": "提取共享的 toolLoopWithFinalization 函数，接受 adapter、message builder、maxChars 策略作为参数。"
    },
    {
      "severity": "high",
      "id": "F2",
      "title": "finalization 回合收到 tool_use 时硬失败",
      "file": "desktop/electron/desktop-services.ts",
      "line": 3811,
      "description": "streamDesktopToolLoopFinalization 在模型发出 tool_use 时抛异常，但模型可能不遵守 '不要调用工具' 的指令。",
      "recommendation": "将 tool_use 降级为跳过（忽略该 chunk 并继续 stream），或最多发出 warning event。"
    },
    {
      "severity": "medium",
      "id": "F3",
      "title": "isReportRendererStructurallyValid 静默忽略 L3 失败",
      "file": "desktop/electron/desktop-services.ts",
      "line": 3544-3550,
      "description": "当 renderer 报告 success:false 但 L0/L1/L2 通过时，tool 返回 success:true，L3 质量告警被丢弃。",
      "recommendation": "success 字段应保持诚实传递，或在 validation 中包含 L3 结果。"
    },
    {
      "severity": "medium",
      "id": "F4",
      "title": "recoverStaleTasks() 无错误边界",
      "file": "desktop/electron/main.ts",
      "line": 133,
      "description": "direct await 无 try/catch，启动失败会阻止窗口创建。",
      "recommendation": "添加 defensive try/catch 并记录诊断日志，不阻塞窗口创建。"
    },
    {
      "severity": "low",
      "id": "F5",
      "title": "Windows 路径规范化仅限于 renderer 层",
      "file": "desktop/renderer/src/components/projects/DeliverableView.tsx, desktop/renderer/src/components/projects/artifactActions.ts",
      "line": 375, 90,
      "description": "basename 反斜杠规范化仅在 renderer 的两个本地函数中实现，其他使用 node:path basename 的路径不受保护。",
      "recommendation": "将跨平台 basename 提取为 shared utility。"
    },
    {
      "severity": "low",
      "id": "F6",
      "title": "报告渲染超时硬编码 30 秒",
      "file": "desktop/electron/desktop-services.ts",
      "line": 3555,
      "description": "withReportRendererTimeout 使用硬编码 30_000ms，可能不适合大型 IR。",
      "recommendation": "从 TASK_TIMEOUT_MS 推导或设为可配置参数。"
    },
    {
      "severity": "positive",
      "id": "G1",
      "title": "任务鲁棒性三件套：watchdog + stale recovery + degraded delivery",
      "description": "三者互补覆盖挂起、崩溃恢复、空产出三个故障模式，测试完整覆盖。"
    },
    {
      "severity": "positive",
      "id": "G2",
      "title": "Windows artifact 路径跨平台处理",
      "description": "artifactActions 和 DeliverableView 均已添加 Windows 路径回退逻辑，测试覆盖完整。"
    },
    {
      "severity": "positive",
      "id": "G3",
      "title": "create_project 路由守卫减少多智能体误用",
      "description": "system prompt 和 tool description 同步更新，明确单人任务禁止调用。"
    },
    {
      "severity": "positive",
      "id": "G4",
      "title": "报告渲染器部署完整性修复",
      "description": "electron-builder filter 改为 dist/**/*，新增 ensureReportRendererDistCompat 处理增量兼容。"
    },
    {
      "severity": "positive",
      "id": "G5",
      "title": "测试覆盖充分",
      "description": "本次所有功能变更（finalization、stale recovery、degraded delivery、watchdog、connector timeout、Windows artifact 路径）均有对应测试。"
    }
  ]
}
```
