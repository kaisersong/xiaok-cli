# 真实只读交办评估

当前已实现独立 eval 的 main-private readonly profile；生产改动只涉及授权的构造/默认 runner 初始化及必要的 scope 继承接缝。没有新增 IPC/TaskCreateInput/model 可选档位；普通默认行为及默认 pilot gate 不变。用户要求冻结包后，未再修改生产代码。

实际状态：20 个早期后端准备 checkpoint 已跨进程恢复；另一个最新 audit profile 单例准备/恢复已通过。真实 Qwen 晨间调用一次 HTTP200，正式 runtime 成功，正式 current publication reader 与 launch prepare 成功；usage 捕获未知后停止，未 confirm。完整 C 模型交办 0、A/B/C 全模型对照 0/30、全模型 handoff 0/20、UX 未测、pilot 未通过。准备任务不冒充这些指标。

## 可运行入口

从 repo 根执行，需要现有 Node/tsx/Electron 依赖：

```sh
node --import tsx evals/assistant-handoff/harness.mjs preflight NEW_OUTPUT.json
node --import tsx evals/assistant-handoff/harness.mjs prepare
node --import tsx evals/assistant-handoff/harness.mjs report SESSION
node --import tsx evals/assistant-handoff/prepared-run.mjs 1 audit
node --import tsx evals/assistant-handoff/audit-verify.mjs --tests-only
node --import tsx --test evals/assistant-handoff/harness.test.mjs
```

preflight 不调用模型，输出安全模型身份、源码行号/sha；ready=false 当前表示真实 usage/验收缺口，不再表示 readonly helper 未实现。prepare 只复制十个明确授权的普通源文件及 hash 到专用临时根，另建 data/config/workspace，拒绝源链接。report 保留 not_run，不生成收益。

prepared-run 实际启动两个 Electron main 进程，使用真实 DesktopServices、正式 foreground admission 和 TaskHost。加 audit 时使用本轮真实 readonly profile。最终 start-commit callback 人工拒绝，保存真实 checkpoint，再重启同 dataRoot 查询原 task；不调用模型、不重派。不经过完整 proposal/confirm，不计真实 C。原 host 会将中断准备恢复成 failed，这是恢复事实，不能当业务成功。

```sh
# 会发真实付费模型请求：本轮 source session 已因 unknown 持久 fence，禁止盲目重放。
node --import tsx evals/assistant-handoff/live-run.mjs PREPARED_SOURCE_SESSION 0
# 无模型调用：只检查已有真实 morning 的 current reader，并生成实际未确认 draft。
node --import tsx evals/assistant-handoff/inspect-current.mjs LIVE_SESSION
```

live-run 限定原配置的 custom qwen38-flash-next，直接只读解析原配置，将唯一选中 provider/model 临时放入独立 0600 配置，退出后清除该私有 key/headers，不写用户 global config。真实服务不注入 runner：原默认模型 runner、原 foreground Room/Project/Goal/prepareRoot、真实 TaskHost。真实 prepared task metadata 经原 snapshot reader→真实 morning model/runtime→原 evidence owner→真实 current publication reader→main-only AssistantLaunchService；不手造 sourceVector 或 isCurrent=true。

只允许配置模型 origin 的 POST chat/completions；仅 tools=[]（morning）或 read；单例最多 8 请求、累计请求体 100000B、provider 输出上限至多 1200（audit runner 自带 1000）、runner 至多 6 轮/120s。字节上限不是精确 token/货币上限。真实 usage 未知、quota、未确认回执均停止；source session 的 live-budget.json 持久 fence，重复 CLI 不会再发模型。live-run.lock 防同一 source session 并发；崩溃留 pending/lock，不自动释放，不 autogrant。整体 token 账按已知 usage 累计，不把缺失计为零。

原 SSE clone.text 在本轮收尾丢失 usage，因此新 provider-capture.mjs 改为逐块保存原文和 partial 错误。该修复只有合成传输回归，未再发模型证明真实 usage 已解决。不得删除 fence、改结果或补发同一 morning 来凑完成数。

## 安全实现

- desktop/electron/desktop-readonly-audit.ts：WeakMap brand；只认专用临时 session、独立 data/workspace/config；固定十文件，校验父目录与文件 dev/ino/hash；每次读取重新检查。原 createReadTool 与 native identity，不另造通用读取器。
- 主 registry 是封闭 DesktopOwnedToolRegistry.nativeReadonlyOnly，仅接受本实例的单个 read；连另一个真实 native read 也不准后装，两个 observation fork 拒绝。
- scoped registry 继承 native readonly；catalog 调用同一个精确实例，不重新 createReadTool(cwd) 放宽；外层 current/authority/revocation guard 保留。
- readonly 档不安装 child/control、技能、MCP/discovery、CUA、项目、Goal、附件和外部 mutation 工具；默认 task permission 保持 default，不继承 auto/yolo。Goal/artifact scope、材料、注入 runner/plugin runtime 拒绝。
- KSwarm 对象不 start/request；原知识库/插件/权限存储均隔离。没有日历、邀请或发消息操作。

main-harness.mjs 是早期 UI 触点/needs_input 记录接缝，仍保留缺真实 owner 时拒绝的旧接口；实际可执行 profile 与生产链路以 live-run/inspect-current 为准，不得手造它的 readiness 字段绕过。A/B 后端发送入口相同；API 调用数不能当 UI 操作。原审批/needs_user 只读观察为 needs_input，不批准、不回答、不修改 mode；close 回收自有 task 时保留原挂起记录。

## 复核与证据

人工流程见 MANUAL-REVIEW.md；review init 生成 50 行 null/unreviewed，不能生成 P3 标签或资格。质量未过默认 off。实际执行与失败记录见 RUN-20261101.md；安全设计、自审、红测说明见 READONLY-DESIGN.md；Codex 作者/Kimi k3 独立静态评审及 source SHA manifest 见 READONLY-KIMI-REVIEW.md。

没有真实 UI trace 就没有用户操作数/用户耗时；服务时间只作后端诊断。没有经过真实默认 runner/tool/TaskHost 和人工输出复核，就不计完整 C/真实 pilot。准备 checkpoint、受控故障、合成测试、源码构建、安装包验收分别记录。
