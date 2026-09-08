# 本地模型缓存测量

测量工具依据 `docs/2026-09-07-local-model-prompt-cache-stability.md`（四方通过的 v5）和实施设计，只做诊断，不自动认证收益或开启优化。随后按用户要求增加了**默认关闭的工具顺序实验开关**，见下节；性能收益仍待真实 A/B 验证。

从仓库根运行（Node ≥22，无新增依赖）：

```bash
node scripts/evals/local-model-cache/run.mjs --help
node --test tests/evals/local-model-cache.test.mjs tests/evals/local-model-cache-capture.test.mjs tests/evals/local-model-cache-command.test.mjs
node scripts/evals/local-model-cache/calibrate.mjs
```

真实 CLI fixture 使用已构建的 `dist/index.js`。TUI 单独验证：

```bash
python3 tests/e2e/tmux-cache-visibility-e2e.py --project-dir . --evidence /tmp/cache-tui-result.json
```

## 工具顺序实验开关

只对指定 endpoint + model 的 generic OpenAI Chat Completions 请求生效，按工具名稳定排序本次发送的 tools 数组。main 和相同目标的 SubAgent 使用同一设置。不开启则保持原顺序；不改变工具集合、定义、权限或执行顺序。

macOS / Linux，在新 CLI 进程中对照（示例目标必须与当前选择的模型配置一致）：

```bash
# A：关闭，原有顺序
XIAOK_EXPERIMENTAL_TOOL_ORDER=0 xiaok

# B：开启，只匹配这个 baseUrl + model
XIAOK_EXPERIMENTAL_TOOL_ORDER='{"baseUrl":"http://127.0.0.1:11434/v1","model":"qwen3.8-27b:latest","order":"name"}' xiaok
```

Windows PowerShell：先 `$env:XIAOK_EXPERIMENTAL_TOOL_ORDER='{"baseUrl":"http://127.0.0.1:11434/v1","model":"qwen3.8-27b:latest","order":"name"}'`，再运行 `xiaok`；关闭用 `$env:XIAOK_EXPERIMENTAL_TOOL_ORDER='0'`。

配置在 adapter 创建时捕获，现有进程须重启才能改变设置。只接受上述三个键；非法 JSON、未知键或不匹配目标均保持原行为。URL 可忽略一个末尾 `/`，但 `localhost` 和 `127.0.0.1` 是不同目标。Kimi（包括 generic Kimi binding）、Responses、Anthropic 不受该开关影响。它不验证服务端权重、模型 digest、runner 或缓存命中，也没有 Desktop 设置页。

若通过下节 `observe` 代理采集，开关的 **baseUrl 要填实际 CLI 配置中的代理地址**，而不是代理上游地址。`measure-print` 内部每次创建随机代理地址，未接入自动重绑开关，不能直接将上述上游目标用于它来声称完成排序 A/B。建议使用 `observe` 的已知监听地址与自己的临时 CLI 配置做开/关对照。

真实主进程 + SubAgent 的接线验真（先构建 CLI）：

```bash
npm run build
node --test tests/evals/experimental-tool-order-cli.test.mjs
```

该测试通过本地 SSE fixture 接收真实 CLI 请求，对照开启/关闭两侧的工具顺序与完整定义，并在 main、SubAgent 中实际执行 read 和 grep。它验证接线与功能，不证明模型速度收益。设计见 `docs/design/2026-09-07-experimental-tool-order-toggle.md`。

## 观察现有请求

```bash
node scripts/evals/local-model-cache/run.mjs observe --upstream http://127.0.0.1:11434 --out cache-wire.jsonl
```

启动后输出随机 loopback 监听地址。将**待测的临时配置**的 OpenAI base URL 指向该地址的 `/v1`，完成预登记的窗口后按 Ctrl-C；不要改用户日常配置。上游参数只能是 origin，完整 path/query 由客户端原样传入，不跟随重定向。默认连接/首包/空闲/总请求期限为 10/300/300/900 秒，`--timeout-ms` 可修改总期限，记录内保留配置。

只有能证明窗口内全部请求属于同一 owner 时才加 `--scope main` 等标签；不凭工具集合推断主 Agent / SubAgent。未指定 scope 仍收集体积/时间，但不生成顺序漂移比较。相同 key ID、scope、endpoint、模型和工具定义集合内才比较顺序；定义或集合变化单列。改变 header/query/路由或能力绑定的窗口应分别采集，不用于跨路径比较。

```bash
node scripts/evals/local-model-cache/run.mjs summarize --input cache-wire.jsonl
```

日志仅含字节、计时、有限状态和 HMAC。每次观察使用新随机密钥，密钥不落盘；不同 key ID 的摘要不能拼接比较。原始 prompt、工具名/参数、响应正文、Authorization、cookie、URL/query 不保存。证据文件必须是新文件，以 0600 独占创建。公开日志仍可能透露流量大小/时序，不包含可重放的原始请求。

## 测量真实 print 输出

先准备只读任务的 UTF-8 prompt 文件，再运行：

```bash
node scripts/evals/local-model-cache/run.mjs measure-print --upstream http://127.0.0.1:11434 --model qwen3.8-27b:latest --prompt-file task.txt --cwd . --out cache-print.json
```

它创建并清理自己的临时 CLI 配置，沿真实 `chat -p` 运行。该配置不含用户的私有 MCP/插件/模型设置，因此报告标记为 `isolated-local-diagnostic`，不能代表用户的完整调用人口。任务本身会实际执行，使用只读任务和受控目录。总期限默认 180 秒，退出码 2 表示任务失败/超时/输出不可核实，错误记录仍保存。

`visibleMs` 从首个模型请求开始，到 stdout 首次有效正文 flush 后由父进程接收的时间；整个进程耗时另记 `totalMs`。仅在 stdout 与 SSE 正文拼接可核对时提供 `visibleMs`，否则为 null。它不覆盖 raw think-tag 转换、并发 SubAgent 输出归属等复杂转换；这些情况宁可不可核实，不伪造成功。stdout 管道时间是 flush 后上界，不是 TUI 的屏幕采样。

每个请求单列 thinking、正文、完整工具调用、上游流结束、下游排空时间。角色/空片段/心跳不算首个有效内容；参数可解析但没有 `finish_reason=tool_calls` 不算完整工具。非 SSE、压缩、解析超限/异常均标记不可用并保持传输；400/500、取消、超时、截断单独分类。

## 固定统计计算

```bash
node scripts/evals/local-model-cache/run.mjs decide --input experiment.json
```

输入格式为 `{"scenarios":[{"id":"print","weight":1,"pairs":[...]}]}`。每场景必须恰好 20 对，pair ID 全局唯一；每对包含 `id`、`a`、`b`，每个 arm 必须有：

```json
{"status":"success","visibleMs":100,"totalMs":200,"outputTokens":4,"stopReason":"stop","toolRounds":0,"quality":"pass"}
```

权重为真实预登记人口权重，和为 1。失败/缺失/超时/质量差异不得删除或补 0，均阻断统计通过。算法固定为 seed 20260907、Mulberry32、场景内整对重采样 10,000 次、线性 percentile；非退化 golden 已经独立 Python 统计复核。

`statisticalThresholdMet` 只表示输入数值满足 G 的 95% 区间下界 >5%、总耗时 R 的区间上界 ≤2%。**`decision` 始终是 `inconclusive`，`productionAuthorized` 始终 false**。本工具不认证人工提供的数字、manifest、真实权重、输入等价、干净 runner、缓存命中、输出质量或代理校准；报告保留这些未核实项。这些字段不控制用户主动启用的实验开关；正式确认收益或建议默认开启仍须满足 v5 的证据要求。

`calibrate.mjs` 只对固定 43KB HTTP/SSE fixture 做 20 对交替顺序的直连/代理传输校准；它不证明真实模型缓存收益。共享 Ollama 服务不会被工具重启、卸载或清缓存。
