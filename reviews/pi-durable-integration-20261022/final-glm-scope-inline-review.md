# B席：GLM-5.3 stdin完整正文静态审查记录

2026-10-22。**追加一次已授权的传输修正调用完成；实际GLM-5.3对声明范围给出APPROVE、无必改项。** 本记录保留模型明确承认的范围局限与一句不准确措辞，不将其扩大为整个产品、全部调用链或全量测试通过。第一轮attachment调用仍为无效评审，原失败票和raw不改。

## 传输、输入与模型身份

只读`qodercli --help`确认`--input-format`；安装二进制可见headless text输入分支及stdin UTF8读取和8388608-byte上限。相应help与机制片段已存证。通过Python结构化Popen链，将正文文件作为stdin交给原owned绝对run.py，其qodercli子进程继承stdin；未使用大shell插值、巨大argv或依赖Read工具的文件attachment。

原442594 bytes packet逐字包含在443274 bytes user正文中；正文前后明确“全部已直接贴入、不要Read、请给APPROVE/BLOCK”，末尾带END-PACKET标记。input SHA256 `40cff97b3e828fbae788c737ce4afbe3b9ff1dc7bd93da20ef9274bb3ed54356`；原packet SHA256 `9a0fced68fa6cfb717b1aa997ad116d444bdd14eea0af786bfed3adf17c86931`。该大小低于已核stdin上限，无截断warning。

仍使用GLM-5.3、tools空、strict MCP空、setting sources空、retry0、no-session-persistence、thinking disabled、stream-json输出；只改为`--input-format text -p`和stdin正文，max-output-tokens设3500。此次只请求一次，不是quota重试，未观察到quota/429/1308错误。实际system.init.model和assistant model均为GLM-5.3，qodercli1.1.73，实际tools=[]、mcp_servers=[]，tool_use block为0。

本次raw context_usage_ratio约0.61549，且输出实质讨论了附件中的八文件和CAS链；不同于首轮只请求读取附件。input/output token telemetry仍为0，不能据此声称精确输出token数；仅记录配置上限、输入字节与原始文本。

## 材料及实际审查范围

冻结源码为`d7f9a5a07b8695fc05b1a406c0863eafaac4a421`，production diff对照`6770092945a42fb0e45ef0d68d0971bfc01b51a8`。完整packet/source hash清单复用`final-glm-scope-packet-manifest.json`，调用结束后逐条核实际task源码，全部仍与冻结SHA相符。

模型明确列出八份变更production全文/diff，及semantic-summary-attempt、provider-conversation-authorization、ledger/deletion census、store接口及File/SQLite实现、execution-authority、single-request-https、semantic-snapshot、session和portable executor；引用具体行号分析collector终态/late事件/abort、三个adapter的严格完成性、semantic empty结算/预算/不安装、CAS和单次物理发送、Desktop fallback。

模型也明确承认usage.js、session-graph.ts、AgentRuntime其余部分、abort-utils.ts、semantic-policy.ts未附全文，涉及内部行为按调用契约推断；所以本次只能计为“八文件与已提供CAS/guard链的声明范围静态审查”。不能写为所有依赖源码都已完整审阅。附件提供的真实资格semantic17/17及CI emitted394/394只是上下文，全量未全绿的事实已告知，模型亦声明未据通过数字背书。

## 模型票与准确性注记

模型票为**APPROVE，无必改项**。它给出的非阻断观察是Desktop的receivedChunk包含usage，因此仅usage后网络异常会拒绝而不snip；该路径符合“已收到chunk不得退回旧网络fallback”的冻结范围。模型尝试讨论取消与empty、thinking-only、Claude迟到delta、OpenAI usage-only尾块、空摘要commit与double settle，没有提出需执行的源码修改。本席未执行任何模型建议。

须保留一处表述校正：模型末句把普通CLI fallback描述为“仅发compact_failed、历史不动”，这不是准确的产品行为描述。冻结`portable-compaction-executor.ts:123-126`明确：非semantic失败调用`ports.applyPlan(plan,undefined)`，保留确定性fallback，允许按该原有机制改变压缩历史；semantic失败才直接no_gain而不安装。原文仍完整保留，不静默改写；报告和最终对用户说明应以实际源码及已有入口测试为准。这一措辞问题不是新增反例或要求修改代码，不将模型APPROVE当成替代既有独立代码票。

## 原始证据与回收

owned label `final-glm-scope-inline`；runnerPid24082，child PID/PGID24083/24083，exit0、reaped=true，按登记PGID核组内剩余0。无手动kill、未接触共享服务、未修改源码/refs/断言或运行中生成物。原始回答单独保存`final-glm-scope-inline-response.md`，完整stream原文在`.log`，身份与局限在`final-glm-scope-inline-identity.json`。

## SHA256

- `final-glm-scope-inline.log`: `a61e67b2056d19899aac3dab079a592c4a303d26aa5c22979fa97fad7b4977aa`
- `final-glm-scope-inline.json`: `26cdf3aed1ca154a002757c2941cc22ef1e80dd4a855fcfa60ffd2271f264f81`
- `final-glm-scope-inline-identity.json`: `7458e8426da16169bb766cc69b6bdf3d49d4cde1f7646bce4ac780f3369ea3b7`
- `final-glm-scope-inline-response.md`: `aebe82299da6abb66b13410b66524ea32dc56b03c91685b9cccf27d4d2291578`
- `final-glm-scope-inline-input.txt`: `40cff97b3e828fbae788c737ce4afbe3b9ff1dc7bd93da20ef9274bb3ed54356`
- `final-glm-scope-inline-input.json`: `26eb7fdb18a4a3075c4924e3408a7db01a65411b8b5cce8b387f0acbcdd0df28`
- `final-glm-inline-help.log`: `84074a05973773911e001ee08be3767974dbe3509a2d65da16cc4f87ff14c34e`
- `final-glm-inline-input-mechanism.json`: `593466c7edcfbc97e495e7f1c75b078b0fc5ecf26608c7b771f7dfc78439f107`
- `final-glm-scope-packet-manifest.json`: `32386ca2d7f8f6826af3af0b48ccebaa134bc09097ffd08030b80df5ab220014`
