# CLAUDE.md

## 规则优先级

- 先阅读并遵守 `AGENTS.md`。它包含本项目的通用协作规则：中文回复、设计先行、对抗性评审、测试顺序、sandbox 验证方式、`docs` symlink 规则、desktop packaging 规则等。
- 本文件是 Claude 专用补充。当前项目重心是 desktop，默认先按 desktop 规则思考；只有明确触及 `xiaok chat` terminal frontend 时，才进入 terminal frontend 专项规则。
- 如果规则有重叠：项目级流程以 `AGENTS.md` 为准；desktop 的 main / preload / renderer / daemon / scheduler 边界以本文件和相关设计文档为准；terminal frontend 的渲染、scroll-region、cursor、footer、activity、overlay 细则以本文件的 terminal 专项规则和 `docs/design/README.md` 指向的文档为准。

## 当前重心

当前优先关注 desktop：

- Electron main process、本地 service、child process、daemon、scheduler、SQLite、notification、packaging。
- preload bridge、IPC contract、renderer API 类型、sandbox 安全边界。
- React renderer、项目视图、scheduled task 页面、artifact、settings、KSwarm / project workflow。
- desktop 与 `intent-broker`、`kai-xiaok-plugins`、`kswarm` 的集成边界。

不要把 terminal frontend 的流程当成默认路径。terminal 规则只在修改 `src/ui/**` 或 `src/commands/chat.ts` 中的 TUI 行为时适用。

## 设计文档入口

- 设计文档总入口以 `docs/design/README.md` 为准，不在本文件重复维护完整清单。
- desktop 相关改动优先搜索并读取 `docs/design/**`、`docs/superpowers/specs/**`、`docs/analysis/**` 中最近、最贴近当前任务的设计和对抗性评审。
- 常见 desktop 入口包括：
  - `docs/superpowers/specs/2026-05-01-xiaok-desktop-intent-cockpit-design.md`
  - `docs/design/2026-05-12-kswarm-xiaok-integration-architecture.md`
  - `docs/design/2026-05-16-kswarm-service-lifecycle-gateway.md`
  - `docs/superpowers/specs/2026-05-15-xiaok-desktop-kswarm-runtime-and-renderer-e2e-design.md`
  - `docs/superpowers/specs/2026-05-19-desktop-renderer-typecheck-scope.md`
  - `docs/superpowers/specs/2026-05-20-desktop-recurring-autorun-scheduled-tasks-design.md`
  - `docs/design/2026-05-20-desktop-scheduled-task-daemon-offline-execution.md`
  - `docs/design/2026-05-20-desktop-scheduled-task-daemon-offline-execution-test-plan.md`
- 不要依赖 section 编号本身。优先引用文件路径和 heading；section 编号可能随文档演进而漂移。

## Desktop 架构边界

### Main Process

- main process 是本地事实来源，负责文件系统、SQLite、daemon、scheduler、notification、window lifecycle、child process、packaging 相关能力。
- durable state 不应以 renderer 的 `localStorage` / React state 为事实来源。renderer 可以缓存 UI 状态，但不能 bulk overwrite main process 的持久状态。
- scheduler / daemon / executor 这类后台能力必须有单一 owner。不要让多个轮询器分别维护同一业务的到期判断。
- service 应该能在 app 重启后恢复；是否执行过期任务由对应 executor 按业务策略判断，不要把所有 overdue 策略硬塞进 scheduler。
- 本地路径、workspace、artifact、project id、task id 需要在 main/service 层校验。renderer 传来的上下文只能作为输入，不是可信事实。

### Preload 与 IPC

- preload 只暴露白名单、语义级 API，不暴露通用 `fs`、`shell`、`sql`、任意命令执行能力。
- 改 IPC contract 时，同步更新 main handler、`preload-api.ts`、`preload.cjs`、renderer API 类型和 contract tests。
- renderer 不直接连接 daemon、SQLite、runtime host 或本地 socket；必须通过 preload 调用 main 暴露的窄接口。
- API 返回值要稳定、可序列化、可测试。不要让 renderer 依赖 main 内部 class instance、Error object shape 或临时日志文本。

### Renderer

- renderer 负责展示、交互、乐观 UI 和用户反馈；业务事实、持久化、后台执行、文件系统能力归 main/service。
- UI state 可以本地暂存，但不能成为 scheduled task、project task、artifact、agent runtime 的最终事实来源。
- 对跨页共享状态，优先使用已有 context / query / store 模式，不要在组件之间添加隐式全局变量。
- 用户可见状态必须有失败态、空态、loading 态和可恢复路径。后台执行失败不能只写日志。
- renderer 改动要尊重现有设计语言：紧凑、工作台式、信息密度高；不要引入营销页、无关 hero、装饰性大卡片。

### Packaging 与 Runtime

- `desktop/package.json` 的 `dependencies` 只放 main process 运行时需要的包；纯 renderer 依赖放 `devDependencies`。
- packaging 相关改动必须考虑 `dist/main` 外部 import、`preload.cjs`、renderer asset path、icon、extraResources、Electron sandbox。
- native module、SQLite、Electron ABI、`node:sqlite` / `better-sqlite3` 选择会影响打包和运行时，不能只用开发环境通过来判断。
- 不要默认 `npm install` 或改 dependency 分类；需要新增依赖时先确认它在 main 运行时还是 renderer build-time 使用。

## Desktop 硬规则

不要做这些事：

- 不要让 renderer 成为 durable scheduled task、reminder、project、artifact、agent status 的事实来源。
- 不要让 main、renderer、daemon 各自轮询同一个业务事实，制造双事实来源。
- 不要用 preload 暴露通用本地能力来绕过 main service。
- 不要在 renderer 中解析日志文本来判断任务状态；应使用结构化 event / response / store snapshot。
- 不要把 notification reminder 和 automatic scheduled task 混成同一个 executor 语义。
- 不要为了 UI 快速修复直接改持久化 schema、IPC shape 或 task lifecycle，而不补 contract test。
- 不要在 packaging 改动里随意移动 dependency 到 `dependencies`，除非它确实是 main process 运行时依赖。

必须做这些事：

- 先明确改动触及 main、preload、renderer、daemon、scheduler、packaging 中的哪些边界。
- 跨层 contract 先写或更新测试，再改生产代码。
- IPC / preload 改动必须同时覆盖 contract test 和 renderer 调用点。
- scheduler / daemon / SQLite / executor 改动必须覆盖恢复、重复触发、过期、失败、取消、幂等。
- renderer 用户路径改动必须覆盖成功态、失败态、空态、loading 态中的真实风险点。
- 打包相关改动必须验证 build，而不只跑 unit tests。

## Desktop 变更门禁

修改 desktop 前，按这个顺序过 gate：

1. **确认改动层级**
   - main service / preload contract / renderer UI / daemon / scheduler / SQLite / packaging / external service。
   - 如果跨越两层以上，按高风险改动处理。

2. **确认事实来源**
   - 哪个模块拥有状态？
   - 状态如何持久化？
   - renderer 是否只是展示？
   - app 重启、daemon 重启、executor 失败后如何恢复？

3. **确认 contract**
   - IPC request / response shape 是否变化？
   - preload API、renderer type、main handler 是否同步？
   - 旧数据、旧配置、旧 scheduled task 是否还能读取？

4. **确认测试层级**
   - main/service：`desktop/tests/main/**`
   - renderer：`desktop/tests/renderer/**`
   - cross-layer contract：preload / desktop-services / packaged-renderer-assets / kswarm contract tests
   - packaging：`build:main`、`build:renderer`、必要时 `pack:dir`

5. **实现并验证**
   - 先补 focused test，再改生产代码。
   - 对高风险改动，设计、对抗性评审、测试、生产代码的顺序不能跳过。

## Desktop 常用验证

按改动范围选择最小但充分的验证：

- main / service / scheduler:

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

- cross-layer desktop 改动:

```bash
cd desktop
npm run test -- --run tests/main/<target>.test.ts tests/renderer/<target>.test.tsx
npm run build:main
npm run build:renderer
```

- 类型检查：

```bash
cd desktop
npm run typecheck
```

`typecheck` 使用 baseline。不要因为无关历史错误更新 baseline；只有本次改动需要改变 baseline 时，才说明原因并更新。

- 打包相关改动：

```bash
cd desktop
npm run build
```

必要时再跑：

```bash
cd desktop
npm run pack:dir
```

## Scheduler / Reminder / Timed Action 规则

- 轮询服务只能有一个 owner；不同业务通过 executor 分流，而不是各自维护独立轮询事实。
- reminder 是到点通知；scheduled task 是自动执行任务。工具说明、system prompt、renderer 文案、store 字段必须维持这条边界。
- scheduler 只负责 claim due action、调用 executor、记录结果、计算下一次触发；业务是否补跑 overdue 由 executor 决定。
- 所有周期任务必须有幂等和取消语义，至少考虑重复 claim、app 重启、executor 超时、连续失败、过期跳过。
- 迁移当前用户数据时，优先做明确、可检查的一次性导入；不要为了少量用户提前做通用迁移框架。

## Desktop 完成标准

desktop 改动只有在这些条件满足后才能认为完成：

- 已明确 main / preload / renderer / daemon / scheduler / packaging 的 owner 和边界。
- 关键 contract 有测试覆盖，不靠手动试出来的状态作为唯一验证。
- 按风险跑过 focused tests 和 build；没跑的高价值验证要说明原因。
- 没有新增双事实来源、renderer 持久化事实、preload 过宽 API、日志文本解析、隐式全局状态。
- 对用户可见路径，失败态和恢复路径可见；不能只在 console 或 main log 里失败。

## Terminal Frontend 专项范围

以下规则只适用于 `xiaok chat` terminal frontend：

- `src/ui/**`
- `src/commands/chat.ts` 中直接影响 terminal frontend 的代码路径
- scroll-region、cursor tracking、footer、status bar、live activity
- tool activity rails、intent hint、summary line
- overlay、permission prompt、feedback prompt
- terminal rendering tests、interactive runtime tests、tmux E2E

## Terminal Frontend 硬规则

不要做这些事：

- 不要在没有阅读 governing design section 的情况下直接写 ANSI escape sequences。
- 不要凭直觉“修一下 cursor position”，先确认 `_cursorRow`、`_cursorCol`、`_cursorUncertain` 的语义。
- 不要绕过 scroll-region、footer、status bar 的 ownership 和 state machine。
- 不要在 `chat.ts` 或 renderer 层临时插入 cursor movement 来掩盖 layout 问题。
- 不要修改 render order、spacing、indentation、color semantics、prompt surface 或 turn lifecycle，而不更新对应设计和测试。
- 不要只靠 unit tests 宣称 terminal rendering bug 已修复；涉及 cursor、scroll、wrap、overlay 的问题必须用真实 terminal 验证。

必须做这些事：

- 先找到 governing design doc 和具体 heading，再实现。
- 使用已有 frontend state machine、scroll-region API 和 render pipeline ownership，不新增旁路。
- 如果设计文档和实现冲突，先记录冲突并更新设计，再继续改代码。
- 如果发现新的 frontend regression class，把它加入 test matrix 或 change checklist。
- 对 scroll / cursor / prompt / overlay 行为变更，补 focused regression test，并跑 tmux E2E。

terminal frontend 专项验证：

```bash
npm run test:sandbox:build
npm run test:sandbox:run -- .test-dist/tests/ui/scroll-region.test.js .test-dist/tests/ui/tool-explorer.test.js .test-dist/tests/ui/permission-prompt.test.js
python3 tests/e2e/tmux-e2e.py --project-dir /Users/song/projects/xiaok-cli
```

如果设计文档的 test matrix 给出了更窄或更完整的命令，以 test matrix 为准。
