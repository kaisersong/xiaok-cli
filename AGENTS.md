# Repo Notes

## 语言

- 始终使用中文回复。

## 相关项目

- `xiaok-cli` 关联项目都在 `/Users/song/projects/` 下：
  - `kswarm`：多智能体项目编排服务。负责 project / task / deliverable 状态、PO / worker agent、任务分派、项目推进、干预、重试、review、project health 和项目产物状态。`xiaok desktop` 通过 main process 的 KSwarm service adapter 启动、探活和调用它，renderer 只展示结构化项目状态。
  - `intent-broker`：本地协作与事件中转服务。负责 participant / agent 注册、消息和事件流、任务进度同步、跨 agent adapter 协调，以及 KSwarm 与本地执行 agent 之间的通信基础。desktop 打包时它是关联 sidecar service。
  - `kai-xiaok-plugins`：小 K 插件与 MCP server 集合。负责 report / slide 等 bundled plugin 能力、plugin registry、MCP server 资源和打包输入。desktop 会把其中需要的插件资源打入 `extraResources` 并部署到 `~/.xiaok/plugins`。
- 从 GitHub 拉取更新时，这些项目要一起更新。
- 提交代码时，相关项目也要一起提交；如果某次只提交其中一部分，必须在最终说明里写清楚原因。
- 修改 KSwarm project workflow、agent contract、project state、artifact handoff 时，优先检查 `kswarm` 是否也需要改。
- 修改 agent 协作、事件投递、adapter、broker lifecycle、queued / progress / approval 流程时，优先检查 `intent-broker` 是否也需要改。
- 修改报告、幻灯片、MCP plugin、bundled plugin、plugin packaging 或 runtime path 时，优先检查 `kai-xiaok-plugins` 是否也需要改。

## 关联项目构建 / 测试 / 发布联动

- 本地构建 desktop 时，`desktop/electron-builder.json` 会从 sibling repos 打包资源：
  - `../../kswarm/src`、`../../kswarm/scripts`、`../../kswarm/package.json`、`../../kswarm/node_modules/ws`
  - `../../intent-broker/src`、`../../intent-broker/package.json`、`../../intent-broker/adapters`、`../../intent-broker/node_modules/ws`
  - `../../kai-xiaok-plugins/plugins/kai-report-creator`
  - `../../kai-xiaok-plugins/plugins/kai-slide-creator`
- 因此 packaging / release 不能只看 `xiaok-cli` 当前 repo；必须确认 sibling repos 的本地内容、依赖和构建产物是当前要发布的版本。
- 改 `kswarm` 后，至少在 `/Users/song/projects/kswarm` 跑与改动相关的 focused test；发布或改 project workflow / runtime / recovery 时优先跑：
  ```bash
  npm test
  npm run test:all
  ```
  如果只改了窄路径，可以用对应脚本，例如 `npm run test:delivery`、`npm run test:event-log`、`npm run test:e2e-p0`，但最终说明要写清楚为什么足够。
- 改 `intent-broker` 后，至少在 `/Users/song/projects/intent-broker` 跑：
  ```bash
  npm test
  ```
  如果改 participant / adapter / collaboration 流程，再跑：
  ```bash
  npm run verify:collaboration
  ```
- 改 `kai-xiaok-plugins` 的 report-renderer 后，在 `plugins/kai-report-creator/mcp-servers/report-renderer` 跑：
  ```bash
  npm run build
  npm run build:bundle
  ```
  并做 MCP initialize smoke test，确认 `dist/server.bundle.js` 可启动。
- 改 `kai-xiaok-plugins` 的 slide-renderer / Python MCP / bundled wheels 后，要按目标平台更新或验证 `plugins/kai-slide-creator/bundled-wheels/`，并跑该插件相关 Python tests；desktop release 的 macOS 和 Windows wheels 不能混用。
- 只要关联项目改动会进入 desktop 打包资源，回到 `/Users/song/projects/xiaok-cli` 后还要跑 desktop packaging contract：
  ```bash
  cd desktop
  npm run test -- --run tests/main/kswarm-contract.test.ts tests/main/deploy-bundled-plugins.test.ts tests/main/e2e-plugin-bundling.test.ts tests/main/e2e-plugin-rendering.test.ts
  npm run build
  ```
  必要时再跑 `npm run pack:dir`，确认 `extraResources` 真正进入 unpacked app。
- desktop release / CI 必须 checkout 与 `extraResources` 对应的 sibling repos。不要假设 CI 里存在本机的 `/Users/song/projects/*`；release workflow 需要显式 checkout `kai-xiaok-plugins`、`kswarm`、`intent-broker` 或使用等价的 vendor / submodule 方案。
- 发布前如果 sibling repo 有未提交改动、未 push commit、未构建 bundle、缺 wheels，不能宣称 desktop release ready。

## Desktop 构建新鲜度 / Stale Build Artifacts

- 如果 desktop 构建提示某个产物还是旧的，不要靠反复运行同一个 build 直到碰巧通过。把它当成 build graph / generated artifact 新鲜度问题处理。
- 先定位提示里的 owner：
  - `kswarm` / `auto-worker` / generated service override：检查 `/Users/song/projects/kswarm` 的源文件和 `desktop/.generated/kswarm/**` 是否由当前源重新生成，通常需要重新跑 `cd desktop && npm run build:main`，必要时先确认 `scripts/generate-desktop-service-overrides.mjs` 的输入路径。
  - `report-renderer` / `server.bundle.js`：到 `/Users/song/projects/kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer` 跑 `npm run build` 和 `npm run build:bundle`，再回到 desktop build。
  - `slide-renderer` / `bundled-wheels`：确认 `/Users/song/projects/kai-xiaok-plugins/plugins/kai-slide-creator/bundled-wheels/` 是当前目标平台需要的 wheel 集合。
  - `intent-broker` 或 `kswarm` dependency：确认 sibling repo 的 `node_modules/ws` 存在且来自当前 repo install，而不是依赖旧打包输出。
- 修 stale build 时只重建对应 owner 的产物；不要无差别清理多个 repo 的 build output。需要删除生成物时，只删除明确可再生的命名产物，并在最终说明写清楚。
- stale build 修复后，至少跑一次 deterministic 验证，而不是把“重复 build 终于过了”当作通过：
  ```bash
  cd desktop
  npm run test -- --run tests/main/kswarm-contract.test.ts tests/main/deploy-bundled-plugins.test.ts tests/main/e2e-plugin-bundling.test.ts tests/main/e2e-plugin-rendering.test.ts
  npm run build
  ```
  packaging / release 相关时再跑 `npm run pack:dir`。

## 当前重心

- 当前项目重心是 `xiaok desktop`，不是旧的 `xiaok chat` CLI runtime refactor。
- desktop 相关工作默认先考虑 Electron main process、preload / IPC、renderer、daemon、scheduler、SQLite、KSwarm、intent-broker、bundled plugins、packaging 的边界。
- `xiaok chat` terminal frontend 规则仍然有效，但只在修改 `src/ui/**` 或 `src/commands/chat.ts` 中直接影响 TUI 的路径时适用。
- 不要把 `yzj` channel、webhook、websocket 工作混入 desktop 或 terminal frontend 的当前变更，除非用户明确要求。

## CUA / Computer Use 平台边界

- CUA / Computer Use 当前是 macOS-only 能力。
- Windows CLI / desktop startup 不能顶层 import、启动期解析或暴露 CUA / CuaDriver / `cua-driver mcp` 依赖；平台 gate 必须发生在动态 import `platform/mcp/cua-connection-manager` 和注册 `xiaok_computer_use` wrapper 之前。
- Windows 上发现 `cua-driver` / `cua-computer-use` plugin 时，应标记为 macOS-only degraded capability 并跳过 wrapper 注册，不能让 `xiaok --auto` 因 CUA 模块缺失或 CuaDriver 不存在而启动失败。
- 改 CUA lazy activation 或 CLI runtime startup 时，必须跑 package-boundary 测试，证明缺失 compiled CUA manager 时 Windows runtime context 仍可导入并跳过 CUA。

## Worktrees

- CLI runtime layer refactor 已经合回主工作区。
- 当前没有 active runtime refactor worktree。
- 本地验证 `xiaok` 命令必须使用主工作区 `/Users/song/projects/xiaok-cli`；不要 `npm link` feature worktree。
- 如果后续确实需要 worktree，只为隔离实现创建，并在集成后移除。

## 跨平台兼容

以下规则适用于 `xiaok-cli` 及所有关联项目（`kswarm`、`intent-broker`、`kai-xiaok-plugins`）。

- 路径拼接必须用 `path.join` / `path.resolve`，禁止硬编码 `/` 或 `\` 分隔符。
- 禁止对 `os.homedir()`、config dir、temp dir 的结果做字符串拼接 `/`；一律用 `path.join`。
- macOS 专有能力（CUA driver、`open` 命令、`.app` bundle 路径、`launchctl`、`defaults`）必须有 `process.platform` 守卫；Windows / Linux 路径下不能调用，也不能因为缺失而导致启动崩溃。
- Windows 专有能力（`reg`、`cmd /c`、`explorer.exe`）同样需要平台守卫。
- child_process spawn / exec 的命令和参数不要假设 Unix shell 语法（如 `&&`、`|`、`$VAR`）；需要跨平台时用 `cross-spawn` 或分成多步。
- 文件路径比较和去重必须考虑大小写（Windows 默认 case-insensitive）和盘符（`C:\` vs `/`）。
- 新增或修改 daemon spawn、MCP server 启动、plugin 路径解析、socket 路径时，必须验证 Windows 分支不会崩溃。CI 可以覆盖，但至少需要 `process.platform === 'win32'` 分支的单元测试或条件跳过。
- 已知历史教训：CUA 是 macOS 专有功能，之前因为无条件启动 CUA daemon 导致 Windows CLI 无法启动；路径硬编码 `/Users/...` 导致 Windows 解析失败。改动时优先检查是否会重蹈覆辙。

## 方案决策前置验证

- 从外部项目分析、竞品参考、设计评审中得出的"值得借鉴"结论，**不等于**"值得现在做"。
- 决定做一项改动之前，必须先 grep / 实测回答：**当前代码是否已经解决了这个问题？** 如果已解决，不做。
- 对任何"节省 token / 减少 payload / 提升性能"的方案，先用真实数据量化收益。如果收益 < 5%，不做（除非有安全动机）。
- 不要凭印象写"现状"——`formatSkillPayload 把全 body 注入 system prompt` 这类假设，必须 grep 到确切调用链再写进设计。
- 设计评审循环不能替代 ROI 判断。6 轮评审通过 ≠ 值得做。评审只验证"如果做，怎样不出错"，不验证"应不应该做"。
- 竞品分析产出的借鉴清单，必须标注"xiaok 是否已有等价实现"一列。已有等价的项直接标 skip，不进入设计阶段。
- 历史教训（2026-06-15 maka-agent 借鉴方案）：6 轮设计评审 + 26 份文档 + 3.5 天实施 = 1.1% token 节省。根因是第一步"现状判断"就错了（xiaok 早已 lazy catalog），后续所有轮次都在优化一个不存在的问题。

## Requirement Implementation Gate

- 任何新需求或行为变更，先写设计文档。
- 实现前先对设计做对抗性评审。
- 评审后先写测试，再写 production code。
- 只有 docs、adversarial review、tests 都到位后，才开始写或修改 production code。
- 核心/高风险改动强制执行方案 + 对抗性评审，不可跳过：
  - 跨层架构变更，例如 main / preload / renderer / daemon / scheduler / executor / store 的数据流或生命周期变化。
  - 影响多文件的接口、协议、IPC contract、preload API、tool schema、store schema。
  - 并发、竞态、信号传递、轮询、后台任务、恢复、取消、重试相关逻辑。
  - SQLite / durable state / migration / data ownership 相关逻辑。
  - 会话上下文、历史记录、project state、artifact handoff、KSwarm task state 等影响用户体验连续性的机制。
  - Bug 修复涉及根因不明确、曾经回归、或者只能通过真实用户流程暴露的问题。
- 对抗性评审重点：边界条件、并发竞态、取消/异常路径、恢复路径、测试是否真正覆盖核心行为，而不是只覆盖 happy path。

## Desktop 设计文档

- `docs/design/README.md` 是当前设计文档总入口，已经 desktop-first。
- desktop 改动优先读取：
  - `docs/design/2026-05-20-xiaok-desktop-architecture-design.md`
  - `docs/design/2026-05-20-xiaok-desktop-test-matrix.md`
  - `docs/design/2026-05-20-xiaok-desktop-change-checklist.md`
- scheduled task / reminder / timed action 相关改动还要读取：
  - `docs/superpowers/specs/2026-05-20-desktop-recurring-autorun-scheduled-tasks-design.md`
  - `docs/design/2026-05-20-desktop-scheduled-task-daemon-offline-execution.md`
  - `docs/design/2026-05-20-desktop-scheduled-task-daemon-offline-execution-test-plan.md`
- KSwarm / project workflow 相关改动还要读取：
  - `docs/design/2026-05-12-kswarm-xiaok-integration-architecture.md`
  - `docs/design/2026-05-16-kswarm-service-lifecycle-gateway.md`
  - `docs/design/2026-05-16-kswarm-service-lifecycle-gateway-adversarial-review.md`

## Desktop 架构规则

- Electron main process 是本地事实来源，负责 filesystem、SQLite、daemon、scheduler、notification、child process、KSwarm / intent-broker / plugin lifecycle、window lifecycle、packaging runtime path。
- preload 只暴露白名单、语义级 API，不暴露通用 `fs`、`shell`、`sql`、任意命令执行、任意 socket 连接。
- renderer 负责展示、交互、局部 UI state、loading / empty / error / success，不负责 durable state 和后台执行。
- renderer 不能成为 scheduled task、reminder、project、artifact、agent runtime status 的最终事实来源。
- 不要让 main、renderer、daemon 各自轮询同一个业务事实。轮询服务只能有一个 owner，不同业务通过 executor 分流。
- reminder 是到点通知；scheduled task 是自动执行任务。工具说明、system prompt、renderer 文案、store 字段必须保持这条边界。
- scheduler 负责 claim due action、调用 executor、记录结果、计算下一次触发；业务是否补跑 overdue 由 executor 决定。
- 改 IPC / preload contract 时，同步更新 main handler、`preload-api.ts`、`preload.cjs`、renderer API type 和 contract tests。

## Desktop 验证

- desktop main / service / scheduler:
  ```bash
  cd desktop
  npm run test -- --run tests/main/<target>.test.ts
  npm run build:main
  ```
- preload / IPC contract:
  ```bash
  cd desktop
  npm run test -- --run tests/main/preload-contract.test.ts tests/main/preload-sandbox.test.ts
  npm run build:main
  ```
- renderer UI / hooks / context:
  ```bash
  cd desktop
  npm run test -- --run tests/renderer/<target>.test.tsx
  npm run build:renderer
  ```
- cross-layer desktop 改动：
  ```bash
  cd desktop
  npm run test -- --run tests/main/<target>.test.ts tests/renderer/<target>.test.tsx
  npm run build:main
  npm run build:renderer
  ```
- typecheck:
  ```bash
  cd desktop
  npm run typecheck
  ```
- packaging 相关改动：
  ```bash
  cd desktop
  npm run build
  ```
  必要时再跑：
  ```bash
  cd desktop
  npm run pack:dir
  ```
- `desktop` 的 `typecheck` 使用 baseline；不要因为无关历史错误更新 baseline。只有本次改动确实需要改变 baseline 时，才说明原因并更新。

## Terminal Frontend 说明

- Terminal E2E verification 使用 `tests/e2e/tmux-e2e.py`，它会启动本地 OpenAI-compatible SSE server 和真实 tmux TTY。
- 首次提交输入后，startup welcome card 应保持在输入上方，直到正常 terminal scrolling 将其滚走；不要在首次 submit 时清空 content region。
- `Thinking`、`Working` 等 live activity 渲染在 input footer 上方的 activity row，activity 和 `❯` 之间保留一行空白 gap。
- activity line 不应重复 footer status fields，例如 model、mode、tokens、project。
- 忙碌/streaming 状态下按 `ESC` 是当前 turn 的用户中断请求，不是失败态；`AbortError` 必须沿 runtime 原样冒泡到 chat 层处理，不能被 normalize 成普通 tool/model failure。
- ESC 中断必须保留用户 draft 和 queued input，不能清空输入缓冲；`XIAOK_NO_ESC_INTERRUPT=1` 时应退回旧行为。
- abort 后的 Stop/auto-continue 路径不能继续消耗 aborted turn；broker/runtime 事件应使用 `turn_aborted` + `turn_stop(reason: 'user_aborted')` 表达用户中断。
- terminal frontend focused 验证示例：
  ```bash
  npm run build
  npm run test:sandbox:build
  npm run test:sandbox:run -- .test-dist/tests/ui/scroll-region.test.js .test-dist/tests/ui/tool-explorer.test.js .test-dist/tests/ui/permission-prompt.test.js
  python3 tests/e2e/tmux-e2e.py --project-dir /Users/song/projects/xiaok-cli
  ```

## CLI / Sandbox 验证说明

- 在 Codex sandbox 中，raw `vitest` 跑 TypeScript source 可能因为 Vite / esbuild 启动 child process 出现 `spawn EPERM`。
- CLI 侧优先使用 `npm test` 或 `npm run test:sandbox`，它会先把 `src/` 和 `tests/` 编译到 `.test-dist/`，再用 `vitest.sandbox.config.mjs` 跑 emitted JavaScript。
- reminder / daemon suites 会打开真实 Unix socket；受限 sandbox 中可能出现 `listen EPERM`。需要 full pass signal 时，在 unrestricted 环境重跑。
- sandbox suite 会排除依赖 subprocess 的测试，例如 `bash` 和 `grep`；完整套件在非受限机器跑 `npm run test:full`。

## Docs Symlink Scope

- 本工作区的 `docs` 是 symlink，指向 `/Users/song/projects/mydocs/xiaok-cli`。
- `docs/design/**`、`docs/superpowers/**`、`docs/analysis/**`、`docs/bugfix/**` 都视为本 repo 工作范围内的项目文档。
- 任务需要时，直接更新最小相关文档集；不要因为 design-doc edit 跨 symlink 就额外请求确认。
- 注意：在 `/Users/song/projects/xiaok-cli` 下执行 `git status` 不会显示这些 docs 改动，因为实际文件属于 `mydocs` repo。

## Desktop Packaging

- Apple Developer 注册信息：
  - App ID Prefix / Team ID：`Y9YR86UG94`
  - Bundle ID：`com.xiaok.desktop`（explicit）
  - Description：`Xiaok Desktop`
  - 当前注册阶段不需要额外启用 Capabilities / App Services / Capability Requests；Electron hardened runtime entitlements 由签名配置处理，macOS Accessibility / Screen Recording 等是用户本机 TCC 授权，不在 Apple Developer App ID 中申请。
- `desktop/package.json` 的 `dependencies` 只保留 main process 运行时需要的包；纯 renderer 依赖放在 `devDependencies`。
- Vite 打包 renderer 时不区分 dependencies / devDependencies，不影响前端构建。
- `electron-builder.json` 的 `files` 不需要手动加 `node_modules/**/*`，electron-builder 默认会根据 `dependencies` 自动打包运行时模块。
- 打包前务必确认 `dist/main/` 中所有外部 import 都在 `dependencies` 中声明，验证命令：
  ```bash
  find dist/main -name "*.js" -exec grep -h "from ['\"]" {} \; | sed "s/.*from ['\"]//;s/['\"].*//" | grep -v "^\." | grep -v "^node:" | sort -u
  ```
