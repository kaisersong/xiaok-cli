# Activity storm：先确认 runner 状态，再执行原同步输入（设计）

仅设计，未修改测试、生产或 node_modules，未运行测试/CPU。基线原 store test SHA31895b58390c69c119596f605d22af972ad515528a2c5aa9c02e64bab3d753d3；实际 Desktop Vitest 和 @vitest/runner 均3.2.4。

## 原红与机制证据

ci-c7-desktop-win-path.log 的 Windows22.22作业先9文件106pass，下一完整5文件68pass，但另有1个未处理 `[vitest-worker]: Timeout calling "onTaskUpdate"`，step exit1。原storm65219ms、store文件66490ms，均不能被68pass表面数字抹平。不是原Windows120s case超时，也不据此断言磁盘/调度原因。

本机实际源码链：

- `desktop/node_modules/vitest/dist/chunks/defaults.B7q_naMc.js:83` 默认pool=forks；原desktop配置和CI命令未覆盖pool。`coverage.DL5VHqXY.js:2616`使用child_process Tinypool，`utils.CAioKnHs.js:25` fork RPC用捕获的process.send/process.on和v8序列化。
- `@vitest/runner/dist/chunk-hooks.js:1549`发test-prepare，1566执行beforeEach，再1570调用原测试。1456–1474的sendTasksUpdate立即取得onTaskUpdate Promise并存pending，但updateTask1498–1505本身不等待；发送受100ms throttle影响。
- `vitest/dist/chunks/index.CwejwG0H.js:47–50` onTaskUpdate返回真实worker→parent RPC Promise。`index.B521nVV-.js:3,53–71`默认60000ms，从发送前注册worker timer，ACK处理133–142才clearTimeout。`rpc.-pEldfrD.js:41–53`没有把onTaskUpdate列为无ACK事件，超时抛原错误。同步storm期间worker不能处理消息/计时回调，因此已有状态RPC可跨过60s；原CI没有每RPC时间戳，不冒称已知道确切message id或ACK/timeout实际先后。

## 最小改动与确定性屏障

只将原storm callback改为`async (ctx) =>`，最前加固定无私有信息文字：

```ts
// Vitest 3.2.4 flushes and acknowledges task updates before annotate resolves.
await ctx.annotate('Runner task updates acknowledged before synchronous activity storm');
ctx.signal.throwIfAborted();
```

这是实际确认屏障，不是猜测setImmediate或sleep：公开TestContext.annotate类型在`@vitest/runner/dist/tasks.d-CkscK4of.d.ts:537`；实现`chunk-hooks.js:1968`先`await finishSendTasksUpdate(runner)`。后者1477–1479先同步发送所有尚在packs的状态，再`await Promise.all(pendingTasksUpdates)`，包含此前已发start/beforeEach状态RPC。接着1969等待onTestAnnotate；实际wrapper `index.CwejwG0H.js:54–58`也等待annotation RPC ACK。1970只有annotations.push，2065–2081只登记/移除此已等待Promise，没有新增updateTask。遗留throttle timer在packs已空时不会产生新的状态RPC。

因此await成功之后，这些已发或排队的状态更新和注解本身均已确认；失败原样拒绝原case，不catch、不ignoreUnhandledErrors、不放RPC60s期限。相比自定义runner/私有RPC读取，此公开入口直接调用当前版本内部真正flush，不需新增harness或修改配置。

await后必须立即以原ctx.signal.throwIfAborted拒绝迟到继续，再执行原bind。原withTimeout在超时时abort该context（chunk-hooks.js:641,1916–1925），但不会取消JavaScript async continuation；否则非Win15s或独立取消先到、RPC迟到返回时，afterEach可能已关store/删根甚至下一case已替换共享变量。该检查抛原signal.reason，不触产品/根、不吞原失败，不改正常storm输入；这是新await必须配套的生命周期边界。

原`bind()`及其后10000次progress、10001 terminal、close/reopen/replay和全部5个expect逐字不变。屏障在整个同步输入段之前，循环及terminal之间没有await/yield/定时器，也不分批或降低SQL/事件人口。原now1000、顺序和实际store实现不变；原store未启动自己的后台timer，输入采用原注入now。callback的async/await仍由原withTimeout包围，`chunk-hooks.js:1852`在调用fn前计时，包含屏障耗时；Windows120000/其它15000及原hook/cleanup/product期限不改，不额外给予60s测试时间。

## 验证与停止

root/B设计票及不同模型新实际SHA审查后才实施。只一文件上述前缀；反向去掉前缀应整字节还原31895b58，AST核原5expect、10000+1顺序、reopen、now和其它15case/全部预算不变。

原c7实际完整日志已是有效回归触发证据，不另外构造61s CPU probe、不缩改birpc timeout或patch node_modules。root另给唯一CPUslot后，原5完整文件68项在本机Node24与最低22.22按实际计划运行，既验5文件人口/断言，也要求无unhandled error且exit0；不以本机较快storm冒称重演Windows超过60s。

最终同新HEAD真实Windows原完整job（含原9文件及后5文件68）必须实际exit0/无未处理错误才能关闭该CI红；新原case/注解/报告/cleanup错误仍红。原65219ms/68pass但exit1事实永久保留。若仍红，另案诊断，不自动扩大任何预算、不插循环yield、不改产品或宣称性能收益。
