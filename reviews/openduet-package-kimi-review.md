# OpenDuet packaging / smoke 独立 Kimi 静态评审

恢复后核对：下列受审 packaging/smoke 文件 hash 与当前完全一致（本地 preserved-review-drift.json）；旧票只覆盖这些脚本，不延伸至新功能。最新完整包与 GUI 见[恢复验证](openduet-recovery-verification.md)，产品源码复审见[当前状态](openduet-review-status.md)。

## 结论与版本边界

作者 Codex GPT-6；独立评审 Kimi CLI 2.2.0，显式 model alias `kimi-code/k3`。仅静态审查提供的设计、完整变更 diff 与必要上下文；未让 reviewer 运行工具、测试、应用或模型业务调用。两组最终结论均 **APPROVE，无 P0/P1**。

**只绑定下表提供的源码内容，不是整个 PR/HEAD 的批准。** 用户提供首个 draft commit `93992a440b7a416f091e70b65c06528a22d596af` / PR116，随后通知需要合并 upstream `a4933b62` 并冻结 production/Git/build。本报告不声称旧票覆盖合并后的源码。评审后、本次 merge 通知前，已逐文件 SHA256 复核与 bundle 输入完全一致；合并后须重新逐文件核对，任一受审文件变化则旧票不覆盖新内容。

[验证入口](openduet-package-validation.md) · [打包历史](openduet-package-validation-history.md) · [实际 GUI](openduet-package-validation-gui.md) · [CI](openduet-package-validation-ci.md) · [窄设计](openduet-package-dependency-design.md)

## 两组评审与超时原记录

| 组别 | 输入 UTF-8 字节 | 退出码 | 超时 | 结论 | Reviewer PID |
| --- | ---: | ---: | --- | --- | ---: |
| packaging 首轮 | 24,525 | 143 | 是，240 秒 | 无票，未批准 | 47335 |
| packaging 第二轮 | 18,786 | 0 | 否 | APPROVE，无 P0/P1 | 63862 |
| 隔离 GUI smoke | 22,478 | 0 | 否 | APPROVE，无 P0/P1 | 47336 |

每份输入均低于 25,000 字节。第二轮保留完整 dependency-copy、afterPack、测试与设计，仅将未改动 verifier 的整文件上下文缩至实际 path function 和 gate 语义；没有压缩、删除或改写 production/test 文件以绕限额。首轮超时由自有 runner 按记录的独立 PGID 回收，没有将超时记为 APPROVE。所有 reviewer 直接进程已 wait 回收，记录 PID 集复查剩余 0；未按名称/端口杀进程。

原始 bundle、完整 verdict、stdout/stderr、process/completion、SHA256 与清理证据只在 ignored `.artifacts/openduet-package-validation/kimi-review/{package,package-r2,smoke}/`，最终复核为 `final-audit.json`；不提交完整本地日志或大型产物。

## Packaging 审查范围与裁决

受审 `copy-packaged-dependencies.cjs`、`after-pack.cjs`、精确 dependency contract 测试及窄设计；verifier path derivation 为只读上下文。信任边界是本地已安装 npm 树、自己 manifest 和 builder 创建的输出 ASAR，不把它说成可处理恶意远程任意 archive 的入口。

Kimi 原票结论：`APPROVE`，`P0/P1 findings: none.` 审查了路径/源 symlink、installed nesting 与版本冲突/遮蔽、原 unpack/link/executable 元数据、有限依赖遍历、required/optional、失败清理和全部原门禁顺序。复制在 afterPack 各原门禁之前，实际改后的最终 ASAR 继续经过 freshness、真实 Electron imports、service contracts、bundled runtimes 与 helper 验证；没有安装依赖、改共享 node_modules、签名或发布。

非阻塞 P2 保留：非 optional peer 缺失会 fail closed；向 unpacked 合并不清除陈旧孤儿文件，复用旧 appOutDir 可能留下无引用 bytes。因此实际复验使用新的 run label / builder 输出，不把旧失败目录当成功产物复用。不为这些观察扩大功能。

Reviewer 说明其票绑定粘贴的逐字代码而非自行核验外部 hash。本报告中的 hash 由本任务 bundle 生成器与最终只读 audit 核对，**不是冒称 Kimi 自己计算这些 hash**。

## Smoke 审查范围与裁决

受审 `smoke-packaged-openduet.cjs` 是测试脚本，不进入 shipped dist；不改真实 app/main/preload 实现。Kimi 原票：`Verdict: APPROVE`，`I found no P0 or P1 issues.` 重点为 app/output 路径、临时目录、自有 PID/start identity、失败 cleanup、真实 preload/IPC/DB gate 的 false-positive 方向。

外层 Seatbelt 限制仅 localhost 网络和自己临时 root 的写入；测试进程 `--no-sandbox` / single-instance disable 只为处理嵌套限制，不是 production 安全弱化，也不声称验证 Chromium sandbox/singleton。真实主进程、ASAR/CDP preload 原源码和 IPC 检查保持；实际 r4 基础通过另见 GUI 文档，该运行仍绑定旧 09:35 输入快照。

非阻塞 P2 原票边界全部保留：

- 250ms PID 轮询可能漏掉中间 parent 迅速退出/双 fork 后脱离的后代；“残留 0”只覆盖记录捕获的自有 PID 集。
- `ps lstart` 只有秒级，极窄的 PID 同秒复用风险；慢 zombie 回收可能令短等待 false-fail。
- 端口空闲预检查存在 TOCTOU；运行期仍需主线程保证本次启动窗口不与别的 app 抢固定端口。
- `--output` 目前不禁止落在 `--app` 内；本任务实际固定 output 在 `.app` 外部独立 evidence 目录，不能扩展为任意输出路径都已证明安全。
- 参数误把下一 flag 当值时诊断不够清楚；DB 检查目前只看 private config，未来 DB 迁移会 fail closed；`ps` 行异常可使 cleanup 报错。这些未被当作当前运行成功或未来泛化安全证明。

不针对 P2 扩展产品功能，也不修改已批准源码；若后续为这些点改脚本，需要新 source hash 与相应复审，不继续沿用原票。

## 文件 hash 与可复核证据

以下均在回票后逐文件比对，`currentSourcesMatch=true`；该断言只代表 merge 前 audit 时点。

| 受审文件 | SHA256 |
| --- | --- |
| `desktop/scripts/copy-packaged-dependencies.cjs` | `e16d1724d93caa272a991128b5e8f99657de8d2871663402864a91c937637f8f` |
| `desktop/scripts/after-pack.cjs` | `084388f4c3592cc74313fa8a69ed231a1f5cb2fce466edd962e5a1090e6299a5` |
| `desktop/tests/main/copy-packaged-dependencies.test.ts` | `f5b7844558e457eadadd5fe1b25d750adbde4e6e993fff7b1fc9c0203ead7e09` |
| `reviews/openduet-package-dependency-design.md` | `6aac26f3bc4c874d488e6400a13631f78d615b751a33bcb40a3f110372a995df` |
| `desktop/scripts/smoke-packaged-openduet.cjs` | `601fbdcd40a4e7eb93ce420188acaf035768d0f338b972e02943c228d5d1e6f7` |

| bundle | SHA256 |
| --- | --- |
| `package` | `21475e0fe7cc646041d46bf2c7452354b03512490bc2400c407a1a80de58e0f5` |
| `package-r2` | `1cd7121e6b10b8c494ea7c3182c17d0859f4f74f7245d45c60cede19596d21c4` |
| `smoke` | `001da4040add5af65dc7b732bab54a356cabd89a79aaea470fabfb159fa11cb8` |

## 后续动作

等待主线程合并完成并给出新 source hash/复验 scope；只读核对受审文件与新内容，差异需重审，不把旧票搬到新 HEAD。等明确 final main/renderer fresh build 通知，再使用新 run label 冻结 source/dist/resource manifest、完整 unsigned package + isolated GUI smoke。CI 由主线程监控。本任务没有 git commit/push，不在冻结期间改 production 或重建 dist。
