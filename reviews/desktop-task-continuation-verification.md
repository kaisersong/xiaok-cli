# Desktop 任务续跑修复验证

## 变更

- 已确认 create_project 成功且规划启动时，前台创建轮完成交接；后台计划仍 running，不重写项目、审核或最终产物状态。普通与 explicit delivery 使用同一判断。
- Kimi 官方思考字段缺失时，未准入的正文与工具调用仅留有界内存、不会发布；沿既有授权 owner 重试一次。再次失败按不可重试 model_failed 结束；已完成工具不重放，失败请求的 provider usage 仍计入。
- 新回归加入 Desktop startup/room 与跨平台 CI。CI 尚未推送/运行，不宣称远端通过。

## 审查

- 编码：Codex。设计：GLM-5.3-Flash、DeepSeek Flash 均 APPROVE，原文保留同目录。
- 首次 GLM-5.3 设计请求 120 秒超时，记为 UNREVIEWED；未作为通过证据。
- DeepSeek 首轮代码审查 BLOCK，原文保留 `desktop-task-continuation-code-review.md`。逐项复核发现其关于 attemptState 跨重试复用、usage 数字泄漏私有正文、terminal 再走普通重试及后台计划被改写的断言与源码不符。
- 补充完整循环上下文后，GLM-5.3-Flash 独立代码复核 APPROVE；见 `desktop-task-continuation-glm-code-review.md`。保留首轮 BLOCK，不将其改写为通过。
- 产品代码及回归的冻结 bundle SHA256：`8e197db5ba4df783746595bfc52f8ad83990c126551275754af9a6dd9a7aeb24`。后续仅增加 CI 文件列表与本文档，没有改动该 bundle 的产品代码/测试。

## 执行证据

- `npm run test:sandbox:build`：通过。隔离工作区依赖首次因 symlink guard 拒绝，后将 SQLite 类型包及受 guard 检查的 native 源包复制到本工作区；没有绕过 guard 或修改共享依赖。
- `npm run test:sandbox:run -- .test-dist/tests/runtime/task-host/project-handoff-delivery.test.js .test-dist/tests/runtime/task-host/task-runtime-host.test.js .test-dist/tests/ai/adapters/openai.test.js .test-dist/tests/runtime/task-host/deliverable-gate.test.js .test-dist/tests/ai/runtime/agent-model-recovery.test.js .test-dist/tests/ai/runtime/provider-request-error.test.js .test-dist/tests/ai/adapters/openai-stream-lifecycle.test.js`：321 通过、7 原有跳过（终端原始结果，2026-10-30 18:14:56 开始）。
- 最终 adapter + handoff 定向回归：203 通过；原始日志 `/tmp/xiaok-task-fix-final-focused.log`。
- Desktop `npm run test -- --run tests/main/kimi-reasoning-admission.test.ts tests/main/desktop-tool-loop-recovery.test.ts tests/main/desktop-post-seal-delivery-owner.bdd.test.ts tests/main/conversation-project-tool-loop.test.ts`：21 通过。新 SDK/HTTP 场景证明已执行工具只执行一次，失败响应的工具和 canary 正文没有进入下游事件。
- Desktop `npm run build:main`、`npm run typecheck`：通过。类型 baseline 未更新。
- 根目录 `npm run governance:check`、`npm run architecture:check -- --changed`、`git diff --check`：通过，无新增违规。一次误在 desktop 目录调用根 governance script 返回 missing script；之后在根目录成功运行，不计为产品失败或通过。
- 两份变更后的 workflow 使用 Python YAML parser 成功解析。

## 本机候选包

以当前安装包为底，保留 renderer、服务、插件和 native unpack metadata；修改 adapter、gate、错误分类并新增固定协议错误模块。错误分类在已安装文件上只插入本轮逻辑，保留其余安装内容。adapter 同时带入 master 已有且此重试所需的 transport/iterator cleanup；回归包含真实 HTTP body 回收。

候选 ASAR SHA256：`4e68594d03ff50553cc04cce4aa2cca77eb51cc09af612ecb845ea75658ccec8`。

候选 Electron 39.8.10 实际加载 ASAR 模块、SDK 与真实 delivery Worker：异常响应后第二次成功，未准入输出被抑制；现场旧快照经新 gate 接受交接、Worker 验证通过，旧历史快照保持原样。未重跑业务任务。

包验证清单与日志位于本机私有临时目录 `xiaok-task-fix-package-*` 的 `package-manifest.json`、`candidate-smoke.log`；既有 12067 个 archive entries 与 211 个 unpacked 文件逐项核对，除清单内变更外内容和 unpack 标记一致。未进行签名或正式发布。

## 安装与未验证边界

界面自动化持续返回 `Sky Computer Use native pipe startup failed`，未绕过它做键鼠、DOM 或截图操作。用户正常退出后，主日志确认原 PID 62464 于 18:43:59 exit 0。安装前再次恢复读取真实 checkpoint+journal，running/understanding 任务数为 0；原安装包仍匹配备份 SHA256，才原子替换 ASAR，未覆盖其它更新。

18:44:36 已安装到 `/Applications/xiaok.app`；安装后 SHA256 与候选一致。原 ASAR、补丁和清单保留在当前用户私有 `desktop/repair-candidates/task-continuation-20261030-*` 目录。没有签名或发布。

18:45:22 重新启动 PID 38180；主日志 18:45:24 `createWindow:loaded`，Python runtime 与 provider-runtime 均正常启动。保持这个用户应用进程运行；未结束原先独立运行的共享服务。

安装后的实际 ASAR 模块、SDK 与 delivery Worker 再次通过同一故障注入验证，退出码 0，历史快照未改写。使用安装包默认 Kimi K3 的真实接口探测也返回预期回复、官方思考字段和 done，退出码 0；未重跑用户业务任务。首次实网探测因测试脚本传空 system 消息被接口以 HTTP400 拒绝，读取原文确认后只修正测试脚本，重测通过；保留该失败日志，不记作通过或产品回归。

18:50:53 主日志确认 `task-initialization:completed` 与 `task-recovery:completed`。测试脚本均已退出，无需回收的自建后台测试进程为 0；保留新启动的用户应用 PID 38180 正常运行。

Windows 实机未跑；远端 CI 与最终 HEAD 质量验证以关联 PR 的实际记录为准。重新启动后的真实 UI 目测/点击验收仍受 CUA 连接故障阻塞；窗口加载证据来自主日志。历史失败状态没有人工改成成功。代码与台账在各自独立工作分支提交，本轮不发布正式版本；台账第 53 条附测试与 CI 执行机制，并标记合入前机制未生效。
