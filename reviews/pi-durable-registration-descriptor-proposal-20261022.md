# Registration descriptor reader：单一纯计算候选，尚不授权实现

独立离线解析实际Mac CI原worker3542 profile：SHA256 db5cfe39a6604468c4ef8e1a7c5a711d7c22bc6252c6cc653ce26115d59f3bcd，22946906bytes、46399samples。按function/url/line聚合互斥self样本：registration-intrinsics checkPopulation10613=22.873%，census.prepare4520=9.742%、call3840=8.276%，assertRegistrationIntrinsics2152=4.638%。这不是end-to-end收益，也不相加inclusive；profile采样span不是process.cpuUsage。原output300s红保留，不能据这些占比宣布可修好CI。

## 唯一候选

仅 registration-intrinsics.ts:7 中私有启动捕获 `descriptor=Reflect.getOwnPropertyDescriptor` 试换为同一时点捕获 `Object.getOwnPropertyDescriptor`。其它源字节保持：prototype、Reflect.ownKeys、全部globalDescriptors/targets/populations/originalEdges、sameDescriptor每字段比较/原次数、WeakMap专门门、每次assert调用位置/顺序/失败原Error都不变。没有批量getOwnPropertyDescriptors、缓存、少调用、少key、少descriptor、少own-property检查、交易scope或SQL改动；不得重做已否决的descriptor批量/事务候选。

语义成立域必须先验证：所有descriptor的target均为已捕获globalObject、内建函数/对象/prototype、内建iterator prototype、node:util.types和Function.prototype，全部真实object；keys为已捕获string/symbol。两native API在此域均取自有描述符、返回完整新descriptor或undefined，保留accessor描述符而不执行其getter、保持symbol/nonenumerable/缺失与data/accessor差异。Object会对primitive装箱、Reflect拒绝primitive，但本私有closed目标集合没有caller target/primitive入口，因此不能据泛化API差异扩大接受域。必须保持捕获reader，不在每次调用时动态读可能poison的Object.getOwnPropertyDescriptor；原全Object/Reflect人口仍核各自函数身份，替换任一公开native仍必须failclosed。不能将该候选扩散到任意DTO reader。

## 最小可证伪验证设计（本案只提案，不运行）

1. 先独立A/B/C/root审语义及原全部调用域。实验仅自有隔离副本，记录baseline/candidate完整源码差一行SHA，未授权改当前production。对原完整adversarial/intrinsic-poison矩阵真实模块逐项运行，原zero-poison/defaultdeny/异常身份/keys人口不变；不得写镜像实现作为真实实现证明。发生任何差异即拒绝候选。
2. 如需短micro筛除，必须调用两版实际模块、同一完整assert入口/同一原targets与全部descriptor人口。调用数/顺序、Node/平台/预热与输入一致，不只比较孤立Object/Reflect native，也不靠手造小对象。micro只可拒绝无潜力候选，绝不作为5%生产准入或CI修复证明；不以profile采样优化前后比较收益。
3. 真正端到端门沿父v3已批准的独立holdout/固定配对验证及收益定义执行，原完整Loop8全人口、真实签名RPC/SQL/guard/current读取均保留，原case30/120/300、hook10与产品10s不动；相同硬件/Node/依赖、无profiler、同实际工作量、每臂完整日志/输入SHA/退出和owner回收。基线与候选都必须完整正确完成；超时/截断/失败是有效红，不能拿截断时长当成功分母或扩大预算获取通过。若只能取得本机完整链证据，明确适用性仅该环境，不能冒称Mac CI收益/修复。达到至少5%真实端到端收益及父统计门、语义与兄弟入口均通过后，才另批production一行实现；不足5%或基线不可完整比较就不实施。
4. 最低22.22与24分别做兼容性；不同版本票不复用。真实Mac CI原8和固定reader10s最终仍要另验；单原output profile仅根因线索，不作完整8验收。任何资格skip/remote128保持unknown，不能放宽gate。

原SQL census.prepare/call虽有较大self，占比不授权数据库/持久化改动。若Object native在实际模块同工作量无收益或更慢，本候选明确否决，继续保留原生产并回到读取分段trace；不自动转入旧batch路线。本提案没有运行CPU/测试、没有改生产/原test或预算。

## 已批准隔离筛除的最终结论：不实施（保留原设计SHA）

本节前的原提案SHA256为dfba45e46f6599ebedeef9fde91d8dd0d9fa48ac87d578a25e4a6a8fdf9f7609，A/B/C/root只批准隔离语义与短micro筛除，没有批准production或收益。2026-10-22实际Node24.16.0/darwin/arm64两真实TypeScript emit模块，candidate只一行capturedreader差异：baseline源d6b474a59d449167ff299ee5a211495b27b4e8862b40c3b750ead541a5d6f8be，candidate源b736d6e3624a261956b521a10254635fab28dbee34727b8289020cef0fdcfa6e。当前production未改。

原25descriptor modes每臂、全部342可变closed-key/prototype变更每臂调用实际export，结果一致、poison调用0。固定3对AB/BA/AB，每臂预热2000、计时10000次完整guard+weak入口：baseline191.739083/201.600792/191.454750ms；candidate190.206958/197.847958/201.970750ms；candidate/base比0.992009/0.981385/1.054927。短micro没有明显潜力且一对更慢，按授权直接筛除，**不实施production**，不进入长完整8/新profile/最低22实验。不把这组短micro说成端到端≥5%或统计显著性/CI平台结论。

全部59个自有Node（build1+语义2+原probe50+micro6）原始runner/log各有PID/PGID、实际exit0/reaped，最后逐组验证absent、signals0。仅本次专用canonical/stat身份tmp逐文件归档SHA匹配后精确删除；没有通扫tmp、共享路径或foreign进程，没有把事后group0证明扩大成完整全时段进程出生census。八production均与713db字节同，原CLI1136/Desktop828人口没有混入临时测试文件。完整原日志/源码/运行元数据及明细在ignored A-descriptor-experiment-final.json/md与同前缀文件；后续公开归档需保这些限制，不改写旧设计票。
