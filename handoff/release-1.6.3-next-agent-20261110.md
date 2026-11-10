# xiaok 1.6.3 发版交接（2026-11-10，北京时间）

用户现在切换 Agent，要求提交该提交的代码、通过正常 PR 流程合入主干，并交接剩余发版工作。本轮停止扩展功能。**当前不是 release ready；不得把局部通过、旧 SHA 的通过或构建退出 0 写成整体验收通过。**

## 用户最新决定

- 历史真实语料和密码相关备份不得推送 GitHub。完整历史只保留本地。
- 先验证安装包和 CLI tgz，**暂不发布 npm**。不要再索要 npm 登录或 token。
- 不直推 master、不 force/rebase、不用 admin 或绕过分支保护。只尝试正常 PR 合并；实际阻塞必须原样交接。
- 先前明确决定不配置 `DSH_SIBLING_READ_TOKEN`；私有文档 CI 权限阻塞保留，不重复询问。
- 旧大小例外都绑定精确 blob 和指定提交，不能复用。七个 Core blob 的例外已用于 `26564c705b2b1c4706d0ae0e0dfa0174fdc7e394`；本轮新修复正常 hook 提交，无新例外。

## Git 与公开历史

- PR：<https://github.com/kaisersong/xiaok-cli/pull/209>。本轮开始时远端是 `c0c1943efb2eeb97042e3d65a7de6a844bf2e8c6`，Draft，base `d3091f82573d7d536de5326941b8c548b64dfdf1`。
- 本地完整字面合流：`04e7955d83976b71f6671a442f580bbdf7b6d7e7`，tree `af14e9351036c11d846b45ffe570b183d78fcc3a`。实际审计为冻结 185/185 分支头、380/380 原独立对象都是祖先。这只是 ancestry 证明。
- **禁止把上述完整历史提交或其完整历史 bundle 推到 GitHub。** 原 `43aa2d6de356ccdf1265ef2803d419b3444be695` 历史带有私人语料与设备备份；当前 tree 删除了文件也不能消除 Git 历史中的内容。
- 已有公开候选 `4792806f83f8b09fcd12b3fac00723bb3242d4cb`，parent `9ae5f3c723ea27e2d261a6e0654af74e9e8b905f`，与完整合流 **同一 product tree**。它保留全部当前功能代码及两项净测试改动，不带原 43aa 私人历史。
- 本轮生产代码提交：`dd6f1758810429861c4b3af961e1e24dff3c1329`，parent 为上述公开候选。仅两个文件，54+/8-，正常 hook 成功。交接文档随后单独提交，不改变生产代码。
- `#210`、`#211` 已合；#211 的 recovery 快照不能作为运行时代码重新执行。
- 以 PR 当前完整 HEAD 和 GitHub 实际 merge 返回值核对最终远端状态，不能用本文件中的旧起始 HEAD 推断。合并后的 master SHA 才是下一轮最终冻结候选。

## 当前现场

SSH：`ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes kai-mbp`；Windows 同参数，目标 `yzjw`。

Kai 根目录 `K=/Users/kai/projects/xiaok-release-1.6.3-20261109`。

- 本轮唯一 Root 工作树：`K/verification-resume-20261110`，分支 `release/1.6.3-public-verification-20261110`。
- 本轮原始证据：`K/verification-resume-evidence-20261110/`。
- 旧 `final-release-coherent-20261110`、`final-reviewed-head-integration` 等源工作树已不在当前实际 worktree list；不要按旧交接路径直接运行。对应 Git refs 和原始日志仍在 canonical 仓库 / K 下。
- Kai canonical `/Users/kai/projects/xiaok-cli` 的用户主工作树不要修改；用独立 worktree。
- KK `/Users/kk/projects/xiaok-cli` 仍是 `fix/settings-refresh-controls`。八个用户 settings/locales/renderer 测试脏文件从未暂存或覆盖。
- Node24.16：`K/toolchain/node`；最低 Node22.14：`K/toolchain/node22/bin/node`；npm JS：`K/toolchain/npm-payload/bin/npm-cli.js`。
- SSH 默认 PATH 没有 node。每次子进程显式把 `K/toolchain` 加进 PATH；不要把 `sh: node: command not found` 当产品失败。
- Windows 原记录：`E:\xiaok-release-1.6.3-20261109\`，已有真实两个 Node 与独立 source trees。先读取当前 Git HEAD/状态再更新，不假设已经是本轮 SHA。

## 本轮实际修复与验证

`desktop/electron/desktop-services.ts` 的公开 `recoverTask` 原来直接返回完整 snapshot。真实回归：派生任务消费上下文引用，撤销 grant 后仍返回含 canary 的正文。

修复：入口、实际 await 后、返回 snapshot 身份均检查当前读权限；后置拒绝在 legacy fallback 的 catch 外。legacy 候选读取也检查权限；selector 会吞 read 错误，因此保存首个原始拒绝并阻止换候选绕过。保留原恢复路由、workflow artifact、实际错误首因。内部启动控制恢复没有改成内容披露 API。

测试保原 16 个 Activity case，增加两个真实 Main 变体：实际 Host 恢复 await 后撤销，以及 legacy 提示不能绕过撤销。原正向 canary、原 Main 撤销断言保留。Activity 后续读取只接受明确 `not_readable` / `activity_source_forbidden` 拒绝，或成功但不含 canary；不接受任意错误。

实际结果：

- 原 Main case：修复前真实 1F，15 个按名称过滤；缺 Electron 的更早 0-case 前置失败另存，不算产品 RED。
- 修复后的三个 Main case：Node24.16 **3P/15 过滤**，16.481s；Node22.14 **3P/15 过滤**，17.702s。不是整个 18-case 文件通过。
- 原完整 16-case 在修复 Main 后仍 **1P/15F**：旧 owner 正向读取拿不到 canary、IPC 假 sender 缺 `isDestroyed`、旧 `assertResultCurrent` 名称等，原日志保留。不能删 case、放宽权限或把它们误计成功。
- Main `tsc -p tsconfig.electron.json --noEmit` 退出 0；governance、architecture changed 退出 0；正常 precommit 退出 0。
- Codex 编码；通过真实 xiaok production adapter 调用官方 `api.deepseek.com / deepseek-v4-pro` 的设计、有限代码及最终两文件差异评审均自然结束，无 P0/P1。全局模型配置字节未改。

对应原始文件：K 下 `resume-recover-original-main-red-ready.{log,run.json}`、`resume-recover-three-{current,minimum}.{log,run.json}`、`resume-recover-activity-whole-current.{log,run.json}`；E 下 applied/staged manifest、`recover-normal-commit.log`、类型/治理记录。三个独立模型原票来自本轮 `/private/tmp/xiaok-release-resume-20261110/`，收尾时另备份到 E；不要长期仅依赖 tmp。

## 最终统一验收的真实剩余项

完整原始组结果位于 `K/final-qa-04e7955d8397/`，绑定的是旧完整 product tree 04e795，不是本轮修复后的最终 master：

- Desktop 七组均存在失败；Root 主组也失败。不要迁为“整体验证通过”。查看 `tests-current-results.json` 及 K 根同前缀 `.log` 完整日志；`.output` 可能只有 observer 尾部。
- 旧 Electron 假对象缺 `window.once`、mock 未导出 `webContents` / `BrowserWindow`。要更新真实 EventEmitter 语义的测试夹具，不能给生产 Main 添加弱化 fallback。
- 旧 Continuity migration API、Activity owner/IPC 合同及 preload 明确 allowlist 不匹配。逐一读当前生产入口和原验收条件，不能靠 blanket skip 或改计数抹平。
- Root `captured-profile-mapper.test.ts` 多项首因是 `captured_sqlite_goal_schema`。位置 `src/runtime/verification/captured-sqlite-goals.ts` 的严格 schema 比较，使用 `goal-source-schema.ts`；与合流后的真实 Goal schema 尚未完成对照，**不能直接放宽闭集**。
- `artifact-export-package.test.ts` 的 afterPack 旧 mock 缺 `packagedRuntimePaths`；另有分词 smoke、Loop 定义列表、observation interrupted choice、preload parity 等未决失败。
- 较早 Windows 实际修复 HEAD `8725233822439d62aea1fb26aadd126c1fb0cdf1` 上 memory-close 在 20 个新进程中连续 20P；Node22/24 原 workflow53整文件各651P、7原平台 skip。这些是旧组件票，不是本轮 master 的完整票。
- Windows Snapshot 旧 geometry 30s timeout 仍未定性；不得擅自调预算。

## 构建、依赖和打包

- 04e795 的 CLI build、pack:cli 都实际退出 0；`verify:pack-dist` 退出 **2**，因为旧统一脚本没传 `--tgz`，显示用法，不是打包内容已验证。下一步明确找到该次 tgz，依次实际执行 build → pack:cli → `verify:pack-dist -- --tgz <真实文件> --ref <完整SHA>`，最后验证必须 0。
- 04e795 的 Main build、renderer build、两份类型检查和 governance/changed 为 0；当前修复后仍须以新的冻结完整 SHA 构建产物。
- 本轮恢复独立锁定依赖：Root 244 包；Desktop 1011 包。官方 registry + 保留缓存 + maxsockets4 成功；原镜像504、官方突发连接重置的日志均保留。未改全局 registry/用户依赖。
- SQLite13.0.3 自带 NAPI prebuild；`build/Release/better_sqlite3.node` 不存在不等于后端不可用。实际 Node24 `new Database(':memory:').prepare('select 1 as n').get()` 得到 `{n:1}`。不要无依据地反复 rebuild。
- Nodejieba 私有 Root binding 已准备；Desktop 忽略生命周期的依赖若缺 binding，必须按精确版本/字节补齐，不能把缺前置当分词通过。
- Electron39.8.10 安装器一度退出0但只留下部分 dist，不算安装成功。已从官方缓存归档按锁定 `checksums.json` 校验 SHA256 `f7e3ed2cc34dd2eba3f2a95234b576fe8082d35fb133e482102c08105f298572`，用 ditto 恢复完整私有树及原 path.txt；未启动 GUI。
- Sibling 输入必须是实际隔离且干净的已提交资源；保留用户 canonical 脏树，不用旧 bundle/缺 wheels 产物冒充发行。三个关联 PR 为 KSwarm#5、Broker#6、Plugins#4；正常合并结果另核 GitHub。
- 本地打包禁止签名：`CSC_IDENTITY_AUTO_DISCOVERY=false`，electron-builder 明确 `-c.mac.identity=null -c.win.signAndEditExecutable=false`。正式发布另遵守相同完整 SHA 及产物复验。
- **npm 发布暂停。** 暂不配置 `.npmrc-xiaok` 不阻止继续生成/验证本地 tgz；不要索要 token。

## 协作、进程与下一步

已通过 Intent Broker 向现有 `@codex2` 交付仅 Electron 夹具片的任务 `release-fixture-compat-20261110`；截至写本文件未收到其工作树或提交回执，不能算已完成。用户切换后已通知冻结，不要和下一 Agent 并写。先 `intent-broker who/inbox` 确认归属。

本轮已按精确 PID/出生时间/工作目录回收失效镜像 npm 95000，随后串行重新 ci 成功。run-observed 的受测子进程均核到剩余0；这不代表全机零进程。旧自有 caffeinate PID70097 只可在 UID/出生时间/命令逐一匹配后回收，最终结果写收尾回执；不得按进程名批量清理。

下一 Agent：先核 PR 合并实际结果和新 master SHA → 核协作者是否遗留 WIP → 按完整原始日志修共同失败 → 固定一个完整公开 SHA → 集中跑相关 Mac/Windows 最低/当前 Node 与平台正确 services → CLI 三步、unsigned Desktop 包、B1 模型列表、斜杠设置/顶部开关、Ctrl+C/安装复验。当前 DSH 743块/120case/14类及四个资格 false 不得偷偷放开；完整发布资格仍未得到。
