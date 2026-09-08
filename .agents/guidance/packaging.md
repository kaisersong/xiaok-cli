# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## 相关项目

- `xiaok-cli` 关联项目都在 `../` 下：
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
- 改 `kswarm` 后，至少在 `../kswarm` 跑与改动相关的 focused test；发布或改 project workflow / runtime / recovery 时优先跑：
  ```bash
  npm test
  npm run test:all
  ```
  如果只改了窄路径，可以用对应脚本，例如 `npm run test:delivery`、`npm run test:event-log`、`npm run test:e2e-p0`，但最终说明要写清楚为什么足够。
- 改 `intent-broker` 后，至少在 `../intent-broker` 跑：
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
- 只要关联项目改动会进入 desktop 打包资源，回到 `../xiaok-cli` 后还要跑 desktop packaging contract：
  ```bash
  cd desktop
  npm run test -- --run tests/main/kswarm-contract.test.ts tests/main/deploy-bundled-plugins.test.ts tests/main/e2e-plugin-bundling.test.ts tests/main/e2e-plugin-rendering.test.ts
  npm run build
  ```
  必要时再跑 `npm run pack:dir`，确认 `extraResources` 真正进入 unpacked app。
- desktop release / CI 必须 checkout 与 `extraResources` 对应的 sibling repos。不要假设 CI 里存在本机的 `../*`；release workflow 需要显式 checkout `kai-xiaok-plugins`、`kswarm`、`intent-broker` 或使用等价的 vendor / submodule 方案。
- 发布前如果 sibling repo 有未提交改动、未 push commit、未构建 bundle、缺 wheels，不能宣称 desktop release ready。


## Desktop 构建新鲜度 / Stale Build Artifacts

- 如果 desktop 构建提示某个产物还是旧的，不要靠反复运行同一个 build 直到碰巧通过。把它当成 build graph / generated artifact 新鲜度问题处理。
- 先定位提示里的 owner：
  - `kswarm` / `auto-worker` / generated service override：检查 `../kswarm` 的源文件和 `desktop/.generated/kswarm/**` 是否由当前源重新生成，通常需要重新跑 `cd desktop && npm run build:main`，必要时先确认 `scripts/generate-desktop-service-overrides.mjs` 的输入路径。
  - `report-renderer` / `server.bundle.js`：到 `../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer` 跑 `npm run build` 和 `npm run build:bundle`，再回到 desktop build。
  - `slide-renderer` / `bundled-wheels`：确认 `../kai-xiaok-plugins/plugins/kai-slide-creator/bundled-wheels/` 是当前目标平台需要的 wheel 集合。
  - `intent-broker` 或 `kswarm` dependency：确认 sibling repo 的 `node_modules/ws` 存在且来自当前 repo install，而不是依赖旧打包输出。
- 修 stale build 时只重建对应 owner 的产物；不要无差别清理多个 repo 的 build output。需要删除生成物时，只删除明确可再生的命名产物，并在最终说明写清楚。
- stale build 修复后，至少跑一次 deterministic 验证，而不是把“重复 build 终于过了”当作通过：
  ```bash
  cd desktop
  npm run test -- --run tests/main/kswarm-contract.test.ts tests/main/deploy-bundled-plugins.test.ts tests/main/e2e-plugin-bundling.test.ts tests/main/e2e-plugin-rendering.test.ts
  npm run build
  ```
  packaging / release 相关时再跑 `npm run pack:dir`。


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
