# OpenDuet 打包验证历史

[验证入口](openduet-package-validation.md) · [打包历史](openduet-package-validation-history.md) · [GUI smoke](openduet-package-validation-gui.md) · [CI](openduet-package-validation-ci.md)

以下保留各验证时点的命令、失败、修复及产物证据；历史通过不代表后来修改后的最终包通过。

## 首次 OpenDuet macOS unsigned package 验证（2026-11-01）


结论：实际执行 macOS arm64 无身份签名目录打包，退出码 **1**；afterPack runtime dependency 门禁失败，不能验收通过、不能称 release ready。没有绕过门禁或修改产品代码。Windows 未验证，macOS 结果不能替代 Windows。

读取了根 AGENTS.md、.agents/guidance/packaging.md、实际 `/Users/kk/projects/mydocs/xiaok-cli/quality/lessons-ledger.md`，重点遵循 #2/#14 最终产物验证、#4/#12 自己 PID 清理、#11 原始日志证据规则。仓库无 .codegraph 目录，未使用/创建索引。

## 命令与输出

工作目录：`/Users/kk/projects/.worktrees/openduet-20261101/xiaok-cli`。证据根：`.artifacts/openduet-package-validation/`。执行 `python3 .artifacts/openduet-package-validation/run.py`（驱动退出 0；各子命令退出码独立记录，不能据此误认打包通过）。实际打包命令（在 desktop 下）：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder \
  --mac dir --arm64 --publish never --config electron-builder.json \
  -c.mac.identity=null -c.mac.notarize=false -c.forceCodeSigning=false \
  -c.electronDist=node_modules/electron/dist \
  -c.directories.output=../.artifacts/openduet-package-validation/package
```

驱动另外清除了继承的 CSC_* / APPLE_* 环境变量。没有安装依赖、没有 build/clean dist、没有修改 sibling、没有推送或发布。详细 argv/cwd/PID/退出码见 `commands.json`；打包完整输出见 `unsigned-package.log`。

本机 Node v24.16.0、Electron 39.8.10、electron-builder 26.15.7、arm64。`npm run hygiene:check` 退出 1：intent-broker tracked WIP 且落后 upstream 1 commit；该检查默认 fetch=true，实际输出已在本次会话记录，未合并或修改 sibling 工作树。

所有 electron-builder extraResources 的实际 from 均存在，真实路径见 `resources.json`。三 sibling 的 HEAD、工作树状态分别保存在 `*-head.log`、`*-status.log`，intent-broker 有四项 tracked WIP；kswarm/plugins 本次 status 输出为空。它们是到主 checkout 的 symlink，未重建资源或改动 WIP。存在不等于 bundle/wheels 新鲜度及完整性已通过。

## 实际包内容与失败

中间产物：`package/mac-arm64/xiaok.app`，是失败产物，不能使用为合格安装包。

- afterPack 第一项 main freshness 通过，日志第 10 行 hash `1307f9f2feda16a3764b6dfbf56ad15338eea04116103239bd0c9da084395c1b`。
- 第二项 verify-packaged-runtime-dependencies 失败：`cross-spawn/lib/util/resolveCommand.js` require `path-key` 报 MODULE_NOT_FOUND（日志第 17 行起）。未运行后续 service contract、bundled runtime/helper 门禁，不得记为通过。
- `node .artifacts/openduet-package-validation/inspect.cjs` 退出 0，直接读取实际 ASAR：cross-spawn 和 which 存在；path-key、shebang-command 的顶层 package.json 缺失。原始结果 `artifact-inspection.json`。这说明实际打包依赖闭包不完整；本任务未改产品配置或共享 node_modules 去掩盖问题。
- 实际 ASAR 内 1,442 个 dist 文件逐一 SHA256 对比输入，0 不一致；输入 dist 打包前后完全一致（dist-before.json / dist-after.json / dist-stability.json）。证明本次复用了现有 dist，不等于证明所有源文件已重新构建或最终源 HEAD 已验收。
- file 命令退出 0：主执行文件 Mach-O arm64。codesign -dv 只读检查退出 0：继承 Electron 的 linker adhoc signature，TeamIdentifier 未设置、Sealed Resources none；本次没有执行签名、公证操作。这里 unsigned 指没有开发者身份签名，并非断言每个 Mach-O 无任何内嵌签名。

## 进程及边界

启动 shell PID 95234；驱动和 builder 的实际 PID 保存在 runner.pid / unsigned-package.pid，builder PID 99608；检查器 PID 1686。驱动 wait 回收全部直接子进程。cleanup.json 是按本任务记录 PID 及后代检查的实际结果，剩余 0、kill 0。保留日志和失败产物用于定位，没有常驻验证服务。

未启动应用 GUI/真实 profile。afterPack 自身使用 Electron Node 做模块加载探针；未运行云之家命令，未读取真实日程、未执行任何日程写。未安装到用户 Applications。

后续主线程应修复 electron-builder 的真实 runtime dependency 闭包，再用相同 unsigned 命令重跑全部 afterPack 门禁；本轮不会绕开失败。仍需独立的 macOS 隔离 profile 功能验收及 Windows 实机/安装包验收；当前不声称 OpenDuet 完整验收完成。

## 续验更新：依赖修复通过，最终 fresh build 包待主线程通知

**当前结论覆盖冻结 dist 的 macOS arm64 unsigned package：通过（退出码 0）。** 上述首次失败记录保留为历史证据；不能再将依赖缺失视为当前阻塞。最终产品源仍由主线程 worker 修改，尚未收到最终 fresh build 完成通知；冻结包不能代替该最终包，更不能代替 Windows。

## 文件归属与实现

本任务修改仅：

- `desktop/scripts/copy-packaged-dependencies.cjs`（新增）：按已安装 production/optional/runtime-peer 图补齐最终 ASAR 缺失包，保留 nested 版本，拒绝覆盖已有不同版本；不安装或修改共享 node_modules/sibling。
- `desktop/scripts/after-pack.cjs`：在原门禁之前接入 copy；所有原门禁顺序及失败行为保留。
- `desktop/tests/main/copy-packaged-dependencies.test.ts`（新增）：真实 ASAR 合成、嵌套版本/循环/optional、必需缺失/原包不变、版本冲突，以及真实 cross-spawn→包内 Electron 门禁先拒绝后通过。
- `reviews/openduet-package-dependency-design.md` 与本报告及专用证据目录。

没有改产品源、electron-builder/package manifest 或 sibling WIP。ASAR rewrite 保留原 link/executable/unpack 元数据，新增依赖全包 unpack；等待输出流完成后替换文件，并清除 canonical/requested ASAR header 缓存。规划期缺依赖不会改原包；I/O 错误仍会使打包失败。源包内部 symlink 目前拒绝，不盲目跟随。

## 红绿测试与验证

在 desktop 下运行：

```sh
./node_modules/.bin/vitest run tests/main/copy-packaged-dependencies.test.ts
./node_modules/.bin/vitest run tests/main/copy-packaged-dependencies.test.ts tests/main/packaged-runtime-imports.test.ts tests/main/packaged-runtime-dependencies.test.ts tests/main/packaged-main-freshness.test.ts
```

先红退出 1、3 项失败（`dependency-red.log`）；实现后最初 8 项通过（`dependency-green.log`）。增加真实 Electron contract 后，发现并修复 realpath ASAR 缓存问题；最终 **31 项通过、退出 0**（`dependency-contracts-final.log`）。`npm run governance:check` 退出 0，lint/architecture 均 0 新违规（`governance.log`），未更新 baseline。`git diff --check -- <本任务三个代码文件>` 退出 0。

## 完整冻结包：两次实际执行

驱动 `python3 .artifacts/openduet-package-validation/frozen-repack.py`，在任务目录生成独立 builder config：仅将 files 的 dist 输入换为任务内冻结副本，全部 afterPack 与 extraResources 保留，禁签名/公证及 publish never。实际命令/argv/PID/cwd/退出码分别保存在 `dependency-fix-r1/command.json`、`dependency-fix-r2/command.json`，完整输出分别为 `package.log`。

- r1：复制 79 包，原失败的 13 个实际 Electron imports 全通过，service contracts 与 slide Python runtime 通过；继续在 artifact-export-helper 缺少 worktree 本地输入时失败，退出 1，没有跳过该门禁。
- 准备 helper：从 [Go 官方下载](https://go.dev/dl/go1.27.1.darwin-arm64.tar.gz) 获取锁定归档；大小 68,100,347 字节、SHA256 `ee215d57e0ec269c60cc9ceca68e6bda321ba9ee5afe24f4b0988703c2d87d12` 均与仓库 lock 相符（`toolchain-download.json`）。未安装 SDK。运行：

```sh
node scripts/verification/build-artifact-export-helper.mjs --target darwin-arm64 --toolchain-archive /Users/kk/projects/.worktrees/openduet-20261101/xiaok-cli/.artifacts/openduet-package-validation/go1.27.1.darwin-arm64.tar.gz
```

helper 构建退出 0（`helper-command.json`、`helper-build.log`），生成本 worktree `.artifacts/artifact-export-helper/darwin-arm64/`，临时解压 SDK 由现有脚本 finally 清理。

- r2：**完整打包退出 0**；复制 79 包、freshness、13 imports Electron smoke、所有 service contracts、slide-python 659 entries/1 target 验证及 artifact-export-helper 门禁均通过；末行明确 `skipped macOS code signing / identity explicitly is set to null`。

成功 `.app`：`.artifacts/openduet-package-validation/dependency-fix-r2/package/mac-arm64/xiaok.app`。

运行 `node .artifacts/openduet-package-validation/inspect-success.cjs` 退出 0（`dependency-fix-r2/inspection.json`、`inspection.log`）：冻结的 **1,445 个 dist 文件逐一 hash 对比 0 不一致**；真实包内 path-key 3.1.1、shebang-command 2.0.0 已存在；再次执行闭包复制 copied=[] 且 ASAR hash 不变。helper 实际 bytes hash 与 manifest 相符：`e5e6ab34ed546e453232f496064dbd996b76f90e2ecf807cabc418495b40b5ee`。codesign 只读 inspection 仍为 inherited linker adhoc、无 TeamIdentifier；没有执行签名。

PID 见各命令 JSON、*.pid 和 `cleanup-fix.json`。检查记录的本任务 PID 剩余 0、kill 0；没有启动真实 profile 或云之家命令。现有 afterPack service probe 使用隔离临时 HOME、finally 停止服务并清理临时目录。后续驱动已加本任务 builder 后代 PID 监视清单，供最终 fresh 包检查。

## 最终包串行交接

等待主线程明确 fresh build 完成后，再执行以下已准备命令；本任务没有抢跑产品 build：

```sh
python3 .artifacts/openduet-package-validation/frozen-repack.py final-fresh --fresh-dist
node .artifacts/openduet-package-validation/inspect-success.cjs final-fresh
```

前者从届时完成的 desktop/dist 创建新的独立快照并运行同一完整 unsigned 门禁；后者逐文件核对最终包。输出到 `.artifacts/openduet-package-validation/final-fresh/`。当前只宣称冻结输入的包装依赖修复及完整门禁通过，不宣称最终产品/Windows/真实功能验收完成。

## Artifact 迁移与提交范围（2026-11-01）

本任务大型产物已从 `reviews/artifacts/openduet-package-validation` 移至现有 `.gitignore` 已忽略的 `.artifacts/openduet-package-validation`；未新增忽略规则、未移动其他任务产物。上文路径更新为迁移后可访问位置；原始 command JSON、日志中的历史 argv/绝对路径保留原文，不伪造当时执行记录。驱动脚本及可重用 builder config 已更新为新根。迁移只更改存储位置，不代表重新打包或增加验收覆盖。

CI 提交仅包含本任务三个 packaging script/test 文件及两个 review Markdown：`desktop/scripts/after-pack.cjs`、`desktop/scripts/copy-packaged-dependencies.cjs`、`desktop/tests/main/copy-packaged-dependencies.test.ts`、`reviews/openduet-package-dependency-design.md`、`reviews/openduet-package-validation.md`。`.app`、binary、SDK、冻结 dist、完整本地日志及任务驱动全部留在被忽略的 `.artifacts`，不进 Git；不执行广泛 add、不替主线程提交。

## 09:35 快照实际 package + GUI：基础通过，后续源码变化待新 build

已读取主线程给定的 `current-complete-build.log` 与 `complete-feature-rerun.log` 原始末尾：build 成功；feature 61 passed/1 skipped files、403 passed/6 skipped tests。该记录不替代本任务实际包验证。

实际执行（仓库根）：

```sh
python3 .artifacts/openduet-package-validation/manifest-inputs.py before
python3 .artifacts/openduet-package-validation/frozen-repack.py final-fresh --fresh-dist
node .artifacts/openduet-package-validation/inspect-success.cjs final-fresh
node desktop/scripts/smoke-packaged-openduet.cjs --app .artifacts/openduet-package-validation/final-fresh/package/mac-arm64/xiaok.app --output .artifacts/openduet-package-validation/final-gui-smoke
```

输入 manifest `final-inputs-before.json`：3,022 个 source 文件、1,463 个 dist 文件，以及实际 sibling/resource 输入 hash 和 HEAD/status。Pack 实际退出 0（`final-fresh/command.json`、`package.log`），全部 afterPack 门禁通过，明确跳过签名；builder PID 17970、驱动 PID 17880，子树清单和退出后 0 残留见 `final-fresh/cleanup.json`。inspection 退出 0，1,463 个包内 dist 文件全部匹配该 frozen snapshot，ASAR SHA256 `a8dc733a49890b7e16abfe9057d1f08f462a0a5aa3fe6fcbe3d585470356d30a`；闭包复制再次执行 copied=[]、archive unchanged，helper bytes hash 匹配。

### 失效边界与重跑依据

在这次 package 启动之后，主线程明确告知 HomeCard key 前缀、locale 及 quality native error handling 等仍有更新。已经执行 `manifest-inputs.py after`，`final-input-delta.json` 记录 source 12 keys、dist 107 keys 变化；resources/siblings 与打包前完全一致。这是该时点的快照，不冒充后续全部变更清单。故 **09:35 包只作为基础验证，不能代表最新 renderer/main**。不手工覆盖 ASAR 局部文件；下一次明确 fresh build 后使用新的 run label/snapshot 再跑完整门禁与 GUI，保存新的前后 manifest。产品 src/main/renderer、生成资源、lock/config/afterPack 或 dist 差异要求重新确认包；纯测试/workflow/review 文本差异单独识别，不把它们说成产品 bundle 变化。
