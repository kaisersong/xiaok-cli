# PR73 集成验证结果（2026-10-22）

本次先将已合并 PR #73 的 master `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1` 合入 PR #74 分支，再合入测试期间新增的 CI/打包测试修复，冻结最新主干 `6770092945a42fb0e45ef0d68d0971bfc01b51a8`。后者仅4个workflow/测试文件，root source测试人口及产品代码不变，基线对照始终固定3b406148，不把可变origin/master当冻结对象。保留 master 的请求预览、provider disclosure、capacity admission、semantic budget 和 durable CAS，以及 PR74 的摘要完成边界。没有更新存量治理 baseline、弱化断言、放宽测试资格或提高测试内部超时。此文接续历史 `pi-durable-optimization-results.md`；历史旧基线的能力盘点不能作为当前 master 的现状。

## 集成修改

唯一文本冲突位于 CompactRunner：保留 master 的 `prepareRequest()` 与 defensive clone，run 消费同一准备结果，再使用 PR74 collector 和内部 `requireCompleteResponse`。实际 OpenAI SDK 请求与 preview 的 body 等价测试同时验证输入和 options 不变。

真实 semantic 生产链发现兼容性回归：完整、排干、带终态的空白响应会抛内部 `CompactionResponseError('empty')`，owner 的泛化 catch 将 master 的 settled 改成 unknown；deletion census 会永久拒绝删除这类会话。先保留旧断言取得同 Node24 红证，再仅对非取消 empty 保持 settled 并继续失败。摘要不安装、不退款、不重发；截断、EOF、工具响应、迟到异常仍 unknown。持久化结算失败继续传播。

A/B/C 对抗性复审均批准该边界。额外跨模型静态评审实际模型为 GLM-5.3（原始 system.init.model 可核）：初次窄修订评审APPROVE；后来大附件未被读取的一次送审标为无效，改用443274字节完整stdin正文后，对8个生产文件及相关CAS/ledger路径给出APPROVE、无必改项。它未执行工具/测试，部分未变更下游模块未全文提供，不能替代执行证据。普通CLI的真实行为是保留deterministic applyPlan(undefined)与compact_failed；semantic失败不安装。补充GLM一句“普通CLI历史不动”的描述不准确，已对照executor及既有真实入口测试纠正；未据该描述改生产代码。GLM 的三条非阻断建议中，provider_incomplete 实际由 adapter 使用；deterministic fallback 是原 PR74 范围；collector 在 usage 分支之前调用 onProgress，因此没有其推测的 usage 心跳丢失。

另外合入主干已批准的打包测试修复：CLI/desktop manifest版本一致性替代过期1.5.9硬编码（原两侧均7/1红，当前8/8绿），afterPack检查保留服务契约门（当前39通过/1原资格skip；关闭原Desktop全量中该文件的一项失败，原全量225失败快照仍保留）。它们不是PR74新增的产品行为修复。

## 已通过的验证

- Node24 修改后相关回归：484 passed / 1 qualification skip，15 文件。
- 最低 Node22.14.0：原相关命令475 passed / 1 qualification skip；Desktop completion/context51/51 passed。没有在 Node22 上加载 Node24 native SQLite 冒充兼容。
- kai-mbp 隔离临时目录、真实注册 recipe、复制的 Node24.16.0：semantic 生产链17/17，无 skip；包含成功、原始 Intent/compound、空白、截断、EOF、迟到异常、工具响应、取消和持久化失败。仅受控网络响应，无计费 provider HTTP。相同 Node24 修复前 empty 单项失败、修复后通过。
- 冻结源码d7f9a5a独立git archive + 私有真实依赖clone：CLI构建、测试编译通过；CI十个emitted JS入口394/394，无skip。前后15个变更文件及22条补充构建输入（合计34个不同文件）逐字相同；临时目录已删除。Desktop main+renderer构建、root/desktop typecheck、最终治理/架构增量、三项intent/skill eval均exit0，具体命令见执行台账。

## 全量执行与失败边界

Desktop 全量实际45 failed / 776 passed / 4 skipped 文件；225 failed / 9965 passed / 40 skipped 测试。不能写成全绿。全部45个失败文件都有对应 master 基线执行，逐 case 结论见三份 baseline-review；“执行过同文件”不等于“每个失败均已归因”。

多数同名同错失败在干净 master 复现，包括旧接口、快照/版本、loader、缺打包 fixture、共享 KSwarm entry_path_mismatch 等。共享4400服务未被 adopt/kill。post-seal-facts38个模块解析失败保留原日志；显式 NODE_PATH 指向隔离依赖后，两侧38/38通过，只证明该 fixture 的模块解析路径。

仍需保留未归因项：Desktop 全量中的两个 post-seal 进程超时（随后双侧精确两项均通过），approval wire budget（master同项通过）。CLI hook 全量两项失败、孤立整文件仍一项失败、随后双侧精确两项通过；不能据此宣称全量通过或擅自定性为机器负载。

CLI 第一次全量在两个 verification case 上出现持续 CPU 活跃而无报告，超过原case期限。只对本次记录的worker作干预，父进程随后ERR_IPC_CHANNEL_CLOSED退出；这不是完整测试summary。第一次初始解析登记1136文件分区：94已识别报告、2未完整报告、1040未识别报告；后续明确选择这1040继续执行。最终原始日志审计发现scroll-region的报告被stdout拼在同一行，第一次实际95文件已完成；后续重跑该125通过文件一次，覆盖台账明确去重这一项，不叠加次数。覆盖统计必须区分命令选入与实际完整报告，不把重跑/基线次数叠加成覆盖数量。后续1040文件全部完成：14 failed / 998 passed / 28 skipped文件；51 failed / 10116 passed / 207 skipped测试。该51个失败中41个在固定主干失败子集对照中复现、10个未复现（loop-fence2、loop-set6、public-near-limit1、blackbox1）；helper另有suite-only失败。基线只执行了所选失败人口，按名称过滤的其他1192等skip不算通过。原两个文件另行完整补跑：publication已完成23项（12通过/10失败/1原opt-in跳过），原RPC单项本次74.11s通过；此前75s超时仍保留，其余10个原30/40/45s超时未归因。controller16项也正常完成（15通过/1失败，1409s）；原receiver-self本次46.16s通过，唯一当前失败为receiver-project的controller_ipc_timeout_unknown。两文件合计39项=27通过/11失败/1原opt-in跳过，exit1/reaped、未触发外层超时。该11项没有对应失败人口的完整主干对照，全部保留未归因。

最终按文件去重覆盖 **1136/1136**，总 **13677项=13337通过/82失败/258跳过**，没有未报告文件、没有重复叠加scroll-region的125通过。这是中断后分批与补跑的联合实际覆盖，不能改写成一次全绿full调用。初次中断的旧错误也不被后来两单项通过抹平。

临时诊断只针对记录的自有worker启用inspect读取当前file/case，关闭连接并在收尾核对监听和PGID；原始日志保留诊断行。后续定位显示本轮长文件仍在推进，不能仅根据持续CPU和缺少文件报告就称为无限循环。

## 环境与发布限制

Node24.16.0 arm64 / macOS27.0.1；依赖复制到本任务专用目录后才运行类型修复，不修改共享node_modules。基线worktree为同master的独立checkout和依赖clone。sibling kswarm/plugins已核更新；intent-broker原checkout有他人WIP且落后，保持未改。hygiene因此非零，不能称release ready。未签名、安装、发布或自动合并PR。

源代码哈希、原始执行元数据、脱敏日志及其转换前后SHA256见同名证据目录。测试期间窄修订后另有相关回归和真实生产链验证；不把联合覆盖冒称为一次不可变HEAD全绿执行。最终完整提交SHA在PR正文和最终质量票中记录，以免自引用改变本文件。

收尾：核对本地66个登记runner/66个进程组均无残留；另外清理1个确认属于本次root剩余全量PGID和私有cwd的孤儿（70643）。远端3个登记组已回收；临时远端、干净baseline和隔离构建目录均删除；9229临时inspector监听为0。生成的28个自有未跟踪dist文件已删除，tracked dist/build-info从合并后index恢复，未提交生成物。实现worktree保留供审阅。

## 证据导航

- [执行台账](pi-durable-integration-20261022/execution-ledger.json)、[去重root覆盖](pi-durable-integration-20261022/root-full-coverage-final.json)、[归档原始/脱敏SHA256](pi-durable-integration-20261022/artifact-manifest.json)。
- [当前源码快照](pi-durable-integration-20261022/integration-snapshot.sha256)、[生产链red/green源证明](pi-durable-integration-20261022/remote-provenance.json)、[隔离最终构建](pi-durable-integration-20261022/final-isolated-build-review.md)。
- [root原失败基线](pi-durable-integration-20261022/baseline-review-A.md)、[root后续失败基线](pi-durable-integration-20261022/baseline-review-A-remaining.md)、[Desktop基线B](pi-durable-integration-20261022/baseline-review-B.md)、[Desktop基线C](pi-durable-integration-20261022/baseline-review-C.md)、[最后两个长文件](pi-durable-integration-20261022/blocked-files-review-C.md)。
- [代码席A](pi-durable-integration-20261022/integration-code-A.md)、[代码席B](pi-durable-integration-20261022/integration-code-B.md)、[代码席C](pi-durable-integration-20261022/integration-code-C.md)。GLM身份、有效stdin审查和无效附件记录也在同一目录。
