# 全量失败修复 A：ROOT 快速/生命周期批

对象：PR74 `d0e35e73014add369748de77fe2a868a62777f13` 工作区。原始失败见integration-20261022归档；本轮日志独立为 `.xiaok/evals/pi-durable/remediation-20261022/A-*`，单worker，原断言/资格/deadline不放宽。先设计评审、保留红证，再修测试夹具或生产；本阶段尚未修改测试或production。hygiene已执行，失败来自intent-broker现有WIP/behind，不动共享服务/sibling。

## 核实现状与拟修复

### 1. MCP执行context与权限竞态

`src/ai/mcp/runtime/tools.ts:57-59` 已将executionContext传入真实client，支持durable MCP观察；旧M8测试仅期望signal是过期接口断言。保留两轮不同signal、旧signal取消后新调用正常、不可泄漏前一task context，明确断言对应各轮executionContext，而不是删生产字段。

`src/ai/tools/index.ts:444,541` 新增native workflow checkpoint await后，旧registry-lifecycle与mcp-owner-fencing在permission.check真正开始前就dispose/unregister/replace，因而分别测成“调用前已dispose/工具不存在/新实例正常调用”，未命中其题目声称的旧permission挂起窗口。生产`:586-612`已有实例/generation/filter/permission revision fencing，后续final policy/准备消费/native effect边界仍重查。方案不改生产：在permission mock加entered barrier，等待真实check进入再变更，仍要求authorization changed、旧/新execute均不启动；后续新调用仍允许。补充同权限兄弟入口executeTool/prepareToolInvocation/prepareToolInvocationDetailed的dispose/remove/replace矩阵，避免只测一种入口；真实ToolRegistry/factory，不重实现权限判断。若精确窗口仍绕过，则另提生产修复，不降低expect。

### 2. owner-launcher-exit 与 owner-process

`owner-protocol.ts:20-21` 将dataRoot realpath；`owner-launcher.ts:32-34`对normalized config算digest，`:69`实际spawn传规范configPath。launcher fake digest却直接JSON.stringify原mkdtemp的/var路径，macOS当前/private/var差异导致digest mismatch/反复重试；fake timer于是卡在正确拒绝分支。owner-process手写legacy进程configPath亦用非规范/var，`owner-retire.ts:54-55,69`为安全原因要求完整argv configPath匹配，因规范路径不同而kept_unverified，旧进程未被退休。

拟将这两套fixture的mkdtemp root立即realpathSync，使其模拟真实launcher已规范化的原生owner配置，保留generation2/undefined退休、pending不杀、foreign profile/digest拒绝、并发赢家/退出grace等所有原期望及deadline。**不放松生产cmdline/uid/epoch/rootHash验证**。另加fake launcher正常别名路径场景，其mock digest按真实activityOwnerAddress(root).dataRoot计算并验证传入spawn配置路径；证明调用者合法symlink祖先仍能走真实normalization，而不是仅改所有输入掩盖路径行为。

### 3. storage-permissions

`cli-loader.ts:131-150`当前startup notice仅queueOwnerReplaced等，成功attach明确silent，queueStarted与持久first-start标记已撤销；`tests/.../cli-loader.test.ts:76`已有三种marker状态silent实测。因此umask子进程调用queueStarted为过期API，非存储权限bug。

子进程改为真实现存queueOwnerReplaced/take/markShown，验证通知可消费，且不生成废弃first-start标记；继续保留全部四种umask、credentials、两轮SQLite+WAL/SHM/owner DB的0600和目录0700断言，既有共享目录/符号链接不跟随断言不动。不恢复用户成功启动提示，不新增notice文件写入。

### 4. chat source-position

`chat.ts:5188-5193`仍先处理Kimi durable stable error，随后委派现有handleFatalError，而非原dynamic import crash-reporter。旧sourceguard搜索被抽走的import是过期结构假设。改定位真实`await handleFatalError(error);`，保留catch→typedguard→stable code→终止→通用fatal路径顺序。确认handleFatalError实际错误报告路径；不改生产。source断言只承认结构守护，结合现有真实session-store/provider-conversation-authorization入口回归，不把sourceguard冒称完整CLI交互验收。

### 5. Kimi builtin platform child

该test源运行时`new URL(...bash.js,import.meta.url)`指向不存在的src JS；emitted测试却正确。拟用当前suite运行形态选择真实生产模块：source mode使用bash.ts+tsx loader，emitted mode用bash.js不加loader；子进程仍在import前覆写platform，仍必须无getter、plain data描述及Windows/POSIX分别正确，两个平台都实际调用生产bash模块。不得读旧dist补绿。

### 6. Desktop inherited owner边界

`desktop-services.ts:6460`真正要求ToolLoopContext.signal；原test传{}使正确HANDOFF拒绝后的cleanup读undefined.reason再聚合成cleanup_failed，遮住原拒绝。拟给fixture最小合法signal（非取消），保留exact HANDOFF拒绝，并加adapter stream spy确保零model调用。显式observationOwner早拒绝等6项不降低期待，不改production cleanup的双错误聚合。

## 验证计划与风险

本轮原9文件130测试的单worker红执行已启动并记录PID/PGID；不把原baseline失败当修复。评审通过后修改上述fixture与补充真实入口负例，单worker执行九文件及权限/owner/notice兄弟回归。source/emitted形态都验证；共享.test-dist编译先协调，或用本批独立临时emitted根，不覆盖别人的运行输入。所需build/typecheck/governance/architecture由主笔统一集成或本席按分工执行，绝不更新baseline。

当前方案无需生产修改；若真实精确时序负例仍失败，立即追加反例和生产方案重新评审。安全语义不以“旧测试错了”概括，必须按真实权限入口矩阵逐项证明，最终由主笔组织不同模型GLM5.3复审。全部本席进程登记并精确回收，退出/信号与日志数字可追溯。
