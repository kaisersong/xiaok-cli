# OpenDuet CI package contracts

[验证入口](openduet-package-validation.md) · [打包历史](openduet-package-validation-history.md) · [GUI smoke](openduet-package-validation-gui.md) · [CI](openduet-package-validation-ci.md)

这里记录 CI 配置及本机验证；远端六格 CI 由主线程执行，未在这里宣称全绿。

## assistant-coverage CI Electron 准备（2026-11-01）

接手 `.github/workflows/assistant-coverage.yml` 的 runtime 环境，保留主线程已有测试列表、Node 22.14.0/24 × Ubuntu/Windows/macOS 六格矩阵。改动如下：

- `npm ci --ignore-scripts` 后仅显式执行 `desktop/node_modules/electron/install.js`，补齐 lock 里的 Electron binary；不启用所有依赖的 lifecycle scripts。installer step 清空 skip/override 变量，下载失败直接失败。
- 所有 OS 运行真实 Electron 子进程预检，使用 `ELECTRON_RUN_AS_NODE=1` 比对 `process.versions.electron` 与 installed package version；缺 binary 或无法执行即失败。实际 ASAR verifier 原本就以该模式执行，未改 gate 或用 host Node 替换 Electron。
- Linux 安装 xvfb/xauth 和 Electron 动态库；仅 Linux 使用 `xvfb-run --auto-servernum` 包裹同一测试命令，其余 OS 通过 Bash 运行相同完整测试列表。Node probe 不启动 Chromium sandbox，不传 `--no-sandbox`、不全局 disable sandbox。依据 [Electron 环境变量文档](https://www.electronjs.org/docs/latest/api/environment-variables) 的 Run-as-Node 模式及 [Linux headless CI 文档](https://github.com/electron/electron/blob/main/docs/tutorial/testing-on-headless-ci.md)。
- 保留 copy-packaged-dependencies contract，加入现有 packaged-runtime-imports / runtime-dependencies / main-freshness 三组。当前同一 command 共 73 个 Desktop 测试文件；没有 skip、continue-on-error 或替身 Electron。
- 精确 dependency-copy fixture 使用 `finished(..., {cleanup:true})` 等待 ASAR 完整 flush，避免 CI 竞态；没有修改 production import gate。
- job 继续 contents:read，显式 CSC_IDENTITY_AUTO_DISCOVERY=false；无 signing、打包发布、上传 binary/private logs 步骤。

验证：YAML parse/矩阵与文件存在性检查、`bash -n` 均退出 0（`ci-workflow-validation.log`、`ci-test-command.sh`）；同 workflow 的真实 Electron binary 预检本机退出 0（`ci-electron-preflight.log`）；四文件共 31 项 package contract 本机退出 0（`ci-package-contracts-final.log`）。未在本机运行 npm ci、没有改共享依赖，也没有启动实际 App GUI 或构建/改写 dist。

**Linux xvfb/root 及 Windows/Node22.14 远端六格尚未实际运行，不能写成 CI 全绿。** 由主线程推 draft PR 后查看真实矩阵结果。本任务不推送、不签名、不发布；所有本地日志仍在被忽略的 `.artifacts/openduet-package-validation`。该 workflow 现在也属于本次可提交的文本文件；不会因此提交任何大型产物。

## CI 显式清单补全

已按主线程通知补 `assistant-derived-main.test.ts`，目录比对另外补 `assistant-derived-publication-readers.test.ts`、`assistant-launch-binding-thread.test.ts`。既有 readonly audit 清单保持。当前新 assistant tests 目录全部显式覆盖；后续新增再对照，不以旧 glob 时点推断覆盖。远端六格 CI 仍由主线程 draft PR 实跑。
