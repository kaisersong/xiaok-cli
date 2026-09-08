# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## CUA / Computer Use 平台边界

- CUA / Computer Use 当前是 macOS-only 能力。
- Windows CLI / desktop startup 不能顶层 import、启动期解析或暴露 CUA / CuaDriver / `cua-driver mcp` 依赖；平台 gate 必须发生在动态 import `platform/mcp/cua-connection-manager` 和注册 `xiaok_computer_use` wrapper 之前。
- Windows 上发现 `cua-driver` / `cua-computer-use` plugin 时，应标记为 macOS-only degraded capability 并跳过 wrapper 注册，不能让 `xiaok --auto` 因 CUA 模块缺失或 CuaDriver 不存在而启动失败。
- 改 CUA lazy activation 或 CLI runtime startup 时，必须跑 package-boundary 测试，证明缺失 compiled CUA manager 时 Windows runtime context 仍可导入并跳过 CUA。


## 跨平台兼容

以下规则适用于 `xiaok-cli` 及所有关联项目（`kswarm`、`intent-broker`、`kai-xiaok-plugins`）。

### 路径
- 路径拼接必须用 `path.join` / `path.resolve`，禁止硬编码 `/` 或 `\` 分隔符。
- 禁止对 `os.homedir()`、config dir、temp dir 的结果做字符串拼接 `/`；一律用 `path.join`。
- 不要在代码里硬编码具体机器路径（`/Users/<name>/...`、`C:\Users\<name>\...`）；运行时推导。
- 取文件名用 `path.basename`（Node 侧）或 renderer 的 `fileBasename`，不要 `split('/').pop()`（Windows 路径用 `\`）。
- 判断"路径是否在某根目录内"用 `path.relative` + `isAbsolute`，不要 `resolved.startsWith(root + '/')`——硬编码 `/` 在 Windows 永不匹配，会误拒合法路径。
- 判断绝对路径要同时认 POSIX `/`、Windows 盘符 `C:\`/`C:/`、UNC `\\`，不要只 `startsWith('/')`。
- 文件路径比较和去重必须考虑大小写（Windows case-insensitive）和盘符（`C:\` vs `/`）。
- renderer 构造 `file://` URL 用 `lib/file-path.ts` 的 `toFileUrl`（Windows 产出 `file:///D:/...`），不要写 `` `file://${path}` ``。

### 子进程
- spawn / exec 的命令和参数不要假设 Unix shell 语法（`&&`、`|`、`$VAR`）；跨平台时用 `cross-spawn` 或分多步。
- **不要无 shell 直接 spawn `.cmd` / `.bin` shim**：`npm`/`npx`/`tsc`/`electron`/`node_modules/.bin/*` 在 Windows 上是 `.cmd`，现代 Node 无 shell spawn 会抛 `EINVAL` / `ENOENT`。处理方式：Windows 上 `shell: true`（参数必须是固定白名单，无注入），或直接 spawn 真实可执行——electron 用 `require('electron')` 返回的路径、tsc 用 `process.execPath` 跑 JS 入口、固定命令用平台对应的 `.cmd`。
- 拉起后台 node sidecar 用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`（已是标准做法），不要 spawn 裸 `node` 或 `.cmd`。

### 平台守卫
- macOS 专有能力（CUA driver、`open`、`.app` bundle 路径、`launchctl`、`defaults`）必须有 `process.platform` 守卫；Windows / Linux 下不能调用，也不能因缺失而启动崩溃。macOS 专有的固定路径（如 `/Applications/...`）用 `path.posix` 构造，避免在 Windows 上被转成反斜杠。
- Windows 专有能力（`reg`、`cmd /c`、`explorer.exe`）同样需要平台守卫。
- 可选原生模块（`better-sqlite3`、`nodejieba` 等）在 Windows 上可能未构建：生产代码必须优雅降级，测试在模块不可用时用运行时探测 + skip，不要假设一定存在。

### 测试
- 测试里把 `path.slice` / `path.relative` 得到的相对路径与 POSIX 风格 allowlist / snapshot 比对前，先 `.replace(/\\/g, '/')` 归一化；否则 Windows 的 `\` 路径会全不匹配，导致整批误报。
- 临时目录递归清理在 Windows 上可能因瞬时文件锁抛 `EPERM`：用 `maxRetries` + best-effort（`desktop/tests/setup.ts` 已全局处理递归删除）。
- 新增或修改 daemon spawn、MCP server 启动、plugin 路径解析、socket 路径时，必须验证 Windows 分支不崩。CI 可以覆盖，但至少需要 `process.platform === 'win32'` 分支的单元测试或条件跳过。

### 强制 / 工具
- desktop 路径相关改动遵循 `.kiro/steering/cross-platform-paths.md`（统一用 `lib/file-path.ts` helper）。
- `desktop/tests/main/cross-platform-path-guard.test.ts` 会扫描反模式（手写 `file://`、以硬编码主目录路径开头的字面量）并直接失败。
- `.github/workflows/desktop-cross-platform.yml` 在 windows-latest + macos-14 上跑跨平台路径测试 + renderer 构建，把 Windows-only 回归挡在 PR 阶段。

### 已知历史教训
- CUA 是 macOS 专有，曾因无条件启动导致 Windows CLI 无法启动。
- 路径硬编码 `/Users/...` 导致 Windows 解析失败（产品代码与测试都出现过）。
- 无 shell spawn `.cmd` shim（dev-runner 的 tsc/electron/npm、evidence-gate 的 npm、react-doctor bin）在 Windows 抛 `EINVAL`/`ENOENT`，曾让 `npm run dev:all` 和多个测试在 Windows 失败。
- 路径包含判断硬编码 `/`（kswarm-runtime-bridge `isAllowedPath`）在 Windows 误拒合法 handoff，连带导致取消/超时测试失败。
- 改动时优先 grep 是否会重蹈以上覆辙。
