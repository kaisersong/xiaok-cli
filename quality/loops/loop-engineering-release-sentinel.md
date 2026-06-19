# Xiaok Loop Engineering Release Sentinel

## Run Metadata
- **Time**: 2026-06-19T04:19:39Z
- **Trigger**: User Loop (scheduled sentinel check)
- **Repository**: /Users/song/projects/xiaok-cli (master)
- **App Version**: 1.4.9 (CFBundleShortVersionString)
- **App Path**: /Applications/xiaok.app/Contents/Resources/app.asar (updated 2026-06-19 12:13)
- **Report Path**: /Users/song/projects/xiaok-cli/quality/loops/loop-engineering-release-sentinel.md

## Executive Summary
1. **App 核心服务健康**：intent-broker (4318) 和 kswarm (4400) 均 healthy，kswarm 34 projects 在线，无 broker 异常。
2. **桌面构建与类型检查**：renderer typecheck clean (0 diagnostics)；desktop-settings service-status test 通过 (2/2)。
3. **Loop 诊断已迁移**：Loop diagnostics 和 User Loops 均位于 `/automations` 路由下的独立 tab，不再隐藏在 General Settings 中。
4. **文档覆盖充分**：README.md 和 README.zh-CN.md 均包含 Loop Engineering 完整说明，包括 Loop/Harness/Memory/Worktree/Sub-agent/Connector/Automation 关系、最小 loop 创建步骤、诊断入口说明。
5. **文案存在过时误导**：`userLoopsDesc` 中英文仍声称"创建和运行会生成 Markdown 文件的用户循环"，但 v1.4.9 已引入 `task_completion` 类型（不生成文件），这会导致用户误解新 loop kind 的用途。
6. **状态判定**：当前适合继续发版/验证，但应在发版前修复 P1 文案误导和 P2 i18n 硬编码。

## Health Checks

| Check | Status | Evidence |
| --- | --- | --- |
| xiaok-cli git status | modified | master branch; 8 modified files + 2 untracked test files; no uncommitted merge conflicts |
| kswarm git status | clean | no local modifications |
| intent-broker git status | clean | no local modifications |
| kai-xiaok-plugins git status | clean | no local modifications |
| intent-broker health (4318) | healthy | `{"ok":true,"status":"healthy","degraded":false,"reasons":[]}` |
| kswarm health (4400) | healthy | `{"ok":true,"brokerConnected":true,"projects":34,"features":["dynamic_workflows",...]}` |
| desktop renderer Loop settings test | passed | `tests/renderer/desktop-settings-service-status.test.tsx` 2/2 passed, 289ms |
| desktop typecheck | passed | Electron + renderer baseline gate clean: 0 current diagnostics |
| App bundle freshness | fresh | app.asar and Info.plist both updated Jun 19 12:13, matching 1.4.9 bundle |

## Loop Documentation Review

### 已覆盖项
- **README.md** §22–48：完整说明 Loop Engineering 概念，包括 Automation / Work isolation / Skills / Connectors / Sub-agents / Memory / Evidence / Diagnostics 的映射关系。
- **README.zh-CN.md** §22–48：中文对应翻译，概念一致。
- **最小 loop 创建步骤**：中英文均列出 5 步（写 skill → 加 trigger → 持久 memory → 加 checker → 让失败可见）。
- **诊断入口说明**：中英文均说明"Loop 不再藏在通用设置中"，统一进入 Automations/自动化入口。
- **docs/design**：存在 17+ loop 相关设计文档（含 diagnostics i18n、task_completion、loop evidence、automations design 等）。
- **v1.4.9 新特性说明**：README 中英文均包含 `task_completion` 作为第二种 loop kind 的说明。

### 文档缺口
- **README.zh.md 不存在**：README.md 第7行链接写的是 `README.zh-CN.md`（实际文件存在），但旧链接 `README.zh.md` 不存在。如果外部引用使用旧路径会 404，但当前产品链接正确。
- **task_completion 回溯机制未在 README 中说明限制**：README 仅描述功能，未提及 `task_completion` 没有 output preview / 历史文件回溯。该限制在设计评审文档 (`desktop-loop-generic-task-completion-cc-review.md`) 中被明确标记为 R5 风险，但未在面向用户的 README 中披露。

## Product Behavior Review

### Loops 页 vs General 页
- **Loop 诊断已迁移**：`AutomationsPage.tsx` 使用 `LoopsPane sections="diagnostics"`，路由为 `/automations/diagnostics`。`GeneralPane` 中不再渲染 Loop 诊断或调用 Loop 诊断 API（与设计文档 `2026-06-15-loop-settings-diagnostics-i18n.md` 一致）。
- **General 仅保留入口**：`GeneralPane` 仅保留一个"打开自动化"按钮（`onOpenAutomations`），点击后跳转到 `/automations/loops`。这符合"General 不藏诊断"的要求。

### i18n 覆盖情况
| 词条 | 中文 (zh.ts) | 英文 (en.ts) | 状态 |
| --- | --- | --- | --- |
| 循环 / Loops | `loopsTab: "循环"` | `loopsTab: "Loops"` | ✅ |
| 用户循环 / User loops | `userLoops: "用户循环"` | `userLoops: "User loops"` | ✅ |
| 新建 Markdown 循环 | `newMarkdownLoop: "新建 Markdown 循环"` | `newMarkdownLoop: "New Markdown Loop"` | ⚠️ 词条存在但 UI 未使用（已死词条） |
| 新建循环 | `newLoop: "新建循环"` | `newLoop: "New Loop"` | ✅ 当前 UI 使用 |
| 立即运行 | `loopDiagnosticsRunNow: "立即运行"` | `loopDiagnosticsRunNow: "Run now"` | ✅ |
| 启用调度 / 启用后台自动运行 | `automationsGlobalAutoRunEnable: "启用后台自动运行"` | `automationsGlobalAutoRunEnable: "Enable background auto-run"` | ✅ |
| 关闭调度 / 暂停后台自动运行 | `automationsGlobalAutoRunPause: "暂停后台自动运行"` | `automationsGlobalAutoRunPause: "Pause background auto-run"` | ✅ |
| 批准自动运行 | `scheduledApproveAuto: "允许自动执行"` | `scheduledApproveAuto: "Approve auto"` | ✅ 语义对应 |
| 允许自动执行标题 | `scheduledApproveAutoTitle: "允许该任务自动执行写入/编辑/命令工具。"` | `scheduledApproveAutoTitle: "Allow this task to run write/edit/bash automatically."` | ✅ |

### 无障碍 (a11y) 检查
- **未发现重复 aria-label 冲突**：DesktopSettings.tsx 中 Refresh/Run 按钮分别使用 `loopDiagnosticsRefresh`、`buttonLabel`（动态生成 `Run now`/`Running`/`Already running`）以及带 `loopId` 前缀的 `aria-label`（如 `run-loop-${template.loopId}`），测试定位器可以区分。
- **输入控件均有 aria-label**：新建 loop 表单中的 title、kind、prompt、output directory、output file name 均绑定 `t.desktopSettings.*Label`。

### 硬编码文案问题
- `DesktopSettings.tsx:2282` 存在硬编码中文字符串 `+ 为此循环创建定时任务`，未走 locale 系统。该字符串仅在用户循环未绑定 schedule 时显示，属于 P2 级别缺口。

## Adversarial Review

### Maker 视角
- **当前状态是否足以让用户理解并执行一个 Loop？** 是。README 和 UI 提供了从概念到操作的路径：概念说明 → 最小 5 步 → 产品内 Automations 入口 → 新建循环表单。
- **哪些信息最有价值？** Loop/Harness/Automation 的对比表让用户理解体系结构；`task_completion` 的引入扩展了 loop 的适用场景（巡检、状态检查）。
- **哪些体验会阻塞用户？**
  1. `userLoopsDesc` 的误导文案会让用户误以为所有循环都必须产出 Markdown 文件，从而不敢创建 `task_completion` 循环。
  2. `task_completion` 没有 output preview 机制，运行 30 天后无法回看第 15 天的结果，信息密度为零。虽然设计评审已指出（R5），但目前产品未提供替代回溯路径（如 task thread 跳转或 summary 快照）。
  3. 硬编码的 `+ 为此循环创建定时任务` 在英文界面会出现中文，破坏体验一致性。

### Checker 视角
- **有没有证据不足的判断？** 没有严重证据不足。所有"诊断已迁移"的判断均基于代码 grep 和 `AutomationsPage.tsx` 的导入链路。
- **有没有把"构建通过"误认为"真实 app 行为通过"？** 存在中等风险。测试仅验证了 `desktop-settings-service-status.test.tsx`（2 个测试），而 Loop 相关测试在 README 中声称有 88 个 loop 测试，但本次 sentinel 只跑了 1 个测试文件。建议发版前确认 88 个 loop 测试在 CI 中通过，而非仅依赖本次单文件测试。
- **有没有文档写了但产品没实现？** `newMarkdownLoop` 词条在 locale 中保留，但 UI 按钮已改为 `newLoop`，属于"文档/代码残留写了但产品未使用"。
- **有没有中文/英文只覆盖一边？** 未发现。`scheduledApproveAuto` / `scheduledRevokeAutoTitle` 等敏感操作词条均双语覆盖。`userLoopsDesc` 的问题是中英文**同时**过时，而非只覆盖一边。
- **有没有 silent failure 风险？**
  1. `task_completion` run 的 summary 在 `finishLoopRunSuccess` 时仅记录 `{ taskId }`，如果 crash 发生在 task 创建后、stage finish 前，metadata 尚未写入，crash recovery 会丢失 taskId 关联。这是设计评审指出的问题，当前代码未完全修复（建议 `touchLoopStage` 立即写入）。
  2. `task_completion` 的 `answer` evidence kind 在 loop context 下语义模糊，可能导致 evidence contract 判断不一致。

## Findings

### P0
None

### P1
- **P1-1: `userLoopsDesc` 文案误导（中英文同步过时）**
  - 标题：User Loops 描述文案仍声称所有循环生成 Markdown 文件
  - 证据：`zh.ts:1096` `userLoopsDesc: "创建和运行会生成 Markdown 文件的用户循环。"`；`en.ts:1145` `userLoopsDesc: "Create and run user loops that write Markdown files."`；但 v1.4.9 已支持 `task_completion`（不生成文件）。
  - 影响：用户可能误以为 task_completion 循环也会生成文件，导致创建后困惑于"为什么没有输出文件"。
  - 建议修复：修改为"创建和运行用户循环。Markdown 文件循环会生成文件；通用循环以任务成功为完成标准。"
  - 验证方式：在 Automations → Loops 页面查看描述，确认文案包含两种 loop kind 的说明。

### P2
- **P2-1: DesktopSettings.tsx 硬编码中文字符串**
  - 标题：`+ 为此循环创建定时任务` 未走 i18n
  - 证据：`DesktopSettings.tsx:2282` 硬编码字符串 `+ 为此循环创建定时任务`。
  - 影响：英文界面出现中文文案，破坏国际化一致性。
  - 建议修复：替换为 `t.desktopSettings.createScheduleForLoop` 或类似词条，并在 zh.ts / en.ts 中补充翻译。
  - 验证方式：切换语言为 English，进入 Automations → Loops，检查未绑定 schedule 的 loop 卡片是否仍显示中文。

- **P2-2: `task_completion` 产物可追溯性缺失（设计已知但未修复）**
  - 标题：task_completion 循环运行历史缺乏回溯机制
  - 证据：设计评审 `2026-06-15-desktop-loop-generic-task-completion-cc-review.md` R5 明确指出 "用户无法回溯这次 loop 做了什么"；`output preview` 机制依赖 `outputPath`，`task_completion` 没有 `outputPath`。
  - 影响：运行 30 天的巡检 loop 无法回看第 15 天的结果，用户只能看到 `Task xxx completed successfully.` 的零信息密度历史。
  - 建议修复：1) 在 `finishLoopRunSuccess` 时从 task snapshot 提取 LLM 回复摘要（前 300 字）写入 `run.summary`；2) 在 LoopsPane 中增加"查看执行详情"按钮，导航到对应 task 的 thread。
  - 验证方式：创建一个 task_completion 循环并运行多次，检查历史记录中是否有可点击的摘要或详情入口。

- **P2-3: Sentinel 测试范围不足**
  - 标题：本次 sentinel 仅运行 1 个测试文件，未覆盖 88 个 loop 测试
  - 证据：README 声称 v1.4.9 通过 88 个 loop 测试，但本次 sentinel 只执行了 `desktop-settings-service-status.test.tsx`（2 个测试）。
  - 影响：无法确认 loop store、executor、runner、task_completion plan-mode block、timeout、crash recovery 等路径当前是否全部通过。
  - 建议修复：在发版前 CI 中运行完整 loop 测试套件；sentinel 下次应增加 `npm run test -- --run tests/renderer/loop-*.test.tsx` 或类似范围。
  - 验证方式：运行 `npm run test -- --run tests/renderer/loop` 并确认全部通过。

### P3
- **P3-1: `newMarkdownLoop` 死词条残留**
  - 标题：`newMarkdownLoop` 在 locale 中定义但 UI 已弃用
  - 证据：`zh.ts:1099` / `en.ts:1148` / `index.ts:1037` 均保留 `newMarkdownLoop`，但 UI 按钮使用 `newLoop`。
  - 影响：无直接功能影响，但增加维护负担和翻译成本。
  - 建议修复：移除 `newMarkdownLoop` 词条及类型定义。
  - 验证方式：grep 代码库确认 `newMarkdownLoop` 无引用。

- **P3-2: `userLoopsDesc` 中"定时触发从计划编辑器配置"语序偏硬**
  - 标题：中文文案语序不够自然
  - 证据：`zh.ts:1096` "定时触发从计划编辑器配置。"
  - 影响：轻微阅读体验问题。
  - 建议修复：改为"定时触发请在计划编辑器中配置。"
  - 验证方式：朗读测试确认自然度。

- **P3-3: `README.zh.md` 文件命名差异**
  - 标题：README 链接指向 `README.zh-CN.md` 而非 `README.zh.md`
  - 证据：README.md 第7行写 `[简体中文](README.zh-CN.md)`，实际文件也是 `README.zh-CN.md`。
  - 影响：无，但如果外部文档引用 `README.zh.md` 会 404。
  - 建议修复：如无外部依赖，可忽略；否则添加 symlink 或重定向。
  - 验证方式：curl 检查 `https://github.com/.../README.zh.md` 是否返回 404。

## Recommended Next Actions
1. **修复 P1-1 `userLoopsDesc` 文案**（中英文同步），确保 `task_completion` 用户不会误以为必须生成 Markdown 文件。发版前必须完成。
2. **修复 P2-1 硬编码中文 `+ 为此循环创建定时任务`**，补充 locale 词条并替换代码中的硬编码字符串。发版前必须完成。
3. **在 CI 中运行完整 loop 测试套件**（88 个测试），确认 task_completion、crash recovery、timeout、plan-mode block 路径全部通过。发版前必须完成。
4. **评估 P2-2 task_completion 回溯机制** 是否作为 v1.4.9 的 patch 或推迟到 v1.4.10。如果发版时间紧迫，可在 README 中增加临时说明，告知用户 `task_completion` 历史记录暂不支持文件预览。
5. **清理 P3-1 死词条 `newMarkdownLoop`** 及对应类型定义，减少技术债务。
6. **（可选）优化 P3-2 中文语序** 和 P3-3 README 链接一致性。

## Evidence Appendix

### 命令与输出摘要

```bash
# 1. 当前时间与 git 状态
date -u +"%Y-%m-%dT%H:%M:%SZ"
# 2026-06-19T04:19:39Z

cd /Users/song/projects/xiaok-cli && git branch --show-current && git status --short
# master
#  M AGENTS.md
#  M desktop/build/icon.icns
#  M desktop/build/icon.ico
#  M desktop/build/icon.png
#  M desktop/renderer/src/components/CanvasPreview.tsx
#  M dist/build-info.js
#  M quality/loops/loop-engineering-release-sentinel.md
#  M src/build-info.ts
# ?? desktop/tests/main/read-file-content-binary.test.ts
# ?? desktop/tests/renderer/canvas-preview-pdf.test.tsx

cd /Users/song/projects/kswarm && git status --short
# (clean)

cd /Users/song/projects/intent-broker && git status --short
# (clean)

cd /Users/song/projects/kai-xiaok-plugins && git status --short
# (clean)

# 2. App 版本与文件时间
grep -A1 CFBundleShortVersionString /Applications/xiaok.app/Contents/Info.plist
# <string>1.4.9</string>

ls -la /Applications/xiaok.app/Contents/Resources/app.asar
# -rw-r--r--@ 1 song admin 65349466 Jun 19 12:13

# 3. 端口健康
curl -s http://127.0.0.1:4318/health
# {"ok":true,"status":"healthy","degraded":false,"reasons":[],...}

curl -s http://127.0.0.1:4400/health
# {"ok":true,"brokerConnected":true,"projects":34,"features":["dynamic_workflows",...]}

# 4. 测试执行
cd /Users/song/projects/xiaok-cli/desktop && npm run test -- --run tests/renderer/desktop-settings-service-status.test.tsx --reporter=basic
#  RUN  v3.2.4
#  ✓ tests/renderer/desktop-settings-service-status.test.tsx (2 tests) 289ms
#  Test Files  1 passed (1)
#  Tests  2 passed (2)

# 5. 类型检查
cd /Users/song/projects/xiaok-cli/desktop && npm run typecheck
# Electron typecheck clean. Renderer baseline gate clean: 0 current diagnostics, 0 resolved since baseline.

# 6. 产品行为验证（grep 链路）
# AutomationsPage.tsx 导入 LoopsPane 并分别用于 loops/diagnostics tabs:
# import { LoopsPane } from '../DesktopSettings';
# <LoopsPane sections="user" />   (automations/loops tab)
# <LoopsPane sections="diagnostics" /> (automations/diagnostics tab)
# GeneralPane 中仅保留 openAutomations 跳转按钮，无 Loop 诊断渲染。

# 7. Locale 文案验证（grep 结果）
# zh.ts:1096  userLoopsDesc: "创建和运行会生成 Markdown 文件的用户循环。定时触发从计划编辑器配置。"
# en.ts:1145  userLoopsDesc: "Create and run user loops that write Markdown files. Configure timing from the schedule editor."
# zh.ts:2282  硬编码: "+ 为此循环创建定时任务"
```

### 文件引用
- `/Users/song/projects/xiaok-cli/desktop/renderer/src/components/DesktopSettings.tsx` — `LoopsPane` / `GeneralPane` 结构
- `/Users/song/projects/xiaok-cli/desktop/renderer/src/components/automations/AutomationsPage.tsx` — Automations 路由与 tab 结构
- `/Users/song/projects/xiaok-cli/desktop/renderer/src/locales/zh.ts` / `en.ts` — i18n 词条
- `/Users/song/projects/xiaok-cli/README.md` / `README.zh-CN.md` — 用户文档
- `/Users/song/projects/xiaok-cli/docs/design/2026-06-15-desktop-loop-generic-task-completion-cc-review.md` — design review (R5 可追溯性)
- `/Users/song/projects/xiaok-cli/docs/design/2026-06-15-loop-settings-diagnostics-i18n.md` — Loop 诊断迁移设计文档

---
*Report generated by Loop Engineering Release Sentinel. Do not edit manually unless correcting factual errors.*
