# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## Desktop 验证

- 只读、禁联网或用户限定只在隔离 fork/worktree 工作时，先读检查脚本的副作用。当前 `hygiene:check` 默认会 `git fetch --prune`、更新 remote HEAD，并从主 checkout 定位 sibling；此类任务使用 `npm run hygiene:check -- --no-fetch`，另逐个核对实际 active sibling 路径。`--no-fetch` 不验证远程新鲜度，也不会把 sibling 定位自动切到 active fork；不要重复运行默认命令来“留档”，不要回滚其他任务的 Git 元数据。

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
- 本地打包**禁止签名**。`npm run pack:dir` 默认会触发 codesign，本机 keychain 经常 `errSecInternalComponent` 失败，且本地验证不需要签名。本地验证使用：
  ```bash
  cd desktop
  CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --dir \
    --config electron-builder.json \
    -c.mac.identity=null \
    -c.win.signAndEditExecutable=false
  ```
  仅在需要正式发布产物时才允许签名。
- `desktop` 的 `typecheck` 使用 baseline；不要因为无关历史错误更新 baseline。只有本次改动确实需要改变 baseline 时，才说明原因并更新。


## 生成回写与测试命中

- 格式化、代码生成或分片替换不能只凭退出码0回写。写前同时核输入/输出非空、长度下限、语法、预期导出/函数/类成员/测试调用仍存在；异步转换完成后再核当前文件仍等于读取版本，变化则中止，不能用旧全文覆盖协作改动。失败保留原文和原日志。
- 子集测试必须在原日志中命中预期命名用例，并核实际产品入口的事实文件/子进程结果。Node把空测试文件显示为1个文件通过，不等于任何目标用例已运行；零用例、全跳过、未命中标题或缺实际事实均不得记为该验收通过。恢复误删后重核相关源码与原入口，不迁旧成功日志到新字节。

## 原生测试的用户配置隔离

- 实际 Services/Store fixture 必须在任何产品模块首次加载前，将 `XIAOK_CONFIG_DIR` 设置为本次私有临时根下的独立目录（0700）；不能仅设置 Electron `userData`，也不能修改 `HOME`。ordinary discovery 会在 Store 出生时写登记，不调用显式设置 API 也有副作用。
- 运行后核默认 discovery registry 未增加本次临时来源；涉及 `known-directory-writer-fence.persist()` 时另核其实际 OS 用户目录，不能把配置覆盖误当全文件系统隔离。误写后先独立只读留档，按真实 fixture birth log 核精确 SourceId、namespace、目录物理身份和完整原文，再用原锁与原子写入、前后 CAS 清理自己的条目；保留其它来源和原始证据。

## 重复 Native Electron 测试与 Dock 干扰

- `tests/native` 的 Node driver 通过 `tests/native/helpers/electron-executable.mjs` 获取测试可执行文件。它复制原 Electron 到私有临时目录，仅修改副本顶层 plist 的 `LSUIElement=true` 与按私有 cache 派生的独立 `CFBundleIdentifier`，启动前核对完整原树与副本；同 cache 标识稳定，不同 cache 分离。禁止修改共享 app、生产安装包或以 RunAsNode 代替真实 Main。
- 新增同类 driver 继续使用该入口，不直接解析共享 Electron 路径。缺平台、复制或字节核验失败明确拒绝，不 fallback 原 GUI。fixture 内 `require('electron')` 仍是已经启动的真实 API，不替换。
- 无 Dock 不代表 Native、签名或安装资格。首次变更核真实 Main、sandbox renderer、`app.dock.isVisible()` 和独立进程 activation policy；不能用启动后 hide/setActivationPolicy 自证。真实 UI 视觉验收仍按其独立任务运行。
- 收到用户被 GUI 测试打扰的反馈时，先停新出生，再按自己记录的 PID 收尾，保留用户与其它任务应用；报告实际回收与剩余数量，不按命令名批量杀。

## CLI / Sandbox 验证说明

- 在 Codex sandbox 中，raw `vitest` 跑 TypeScript source 可能因为 Vite / esbuild 启动 child process 出现 `spawn EPERM`。
- CLI 侧优先使用 `npm test` 或 `npm run test:sandbox`，它会先把 `src/` 和 `tests/` 编译到 `.test-dist/`，再用 `vitest.sandbox.config.mjs` 跑 emitted JavaScript。
- reminder / daemon suites 会打开真实 Unix socket；受限 sandbox 中可能出现 `listen EPERM`。需要 full pass signal 时，在 unrestricted 环境重跑。
- sandbox suite 会排除依赖 subprocess 的测试，例如 `bash` 和 `grep`；完整套件在非受限机器跑 `npm run test:full`。
