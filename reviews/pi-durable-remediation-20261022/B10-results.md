# B10 payload 适配结果与全量证据范围

唯一新增production `desktop/electron/loop-business-publication-host.ts` SHA79650281fa17e0e1f4094c8cdf38c5247aede8f2fbdc982af645f6bb885a3858，新冻结B10-production-freeze.json；原root-final-production-freeze中的7文件不变。A/C设计APPROVE后才落prod；C实际代码票APPROVE，A实码票待最终收录，GLM由主笔组织。

原真实签名8红：B-loop-budget-full-node24实际7pass1fail，output-consumer published_artifact_payload非timeout。新6局部host/store回归（固定reader叶，不冒称签名链）red-v2实际4fail2pass/6，15旧过滤未算pass。适配后B-loop-payload-green四**完整**文件65/65 exit0/reaped/PGID11039空，其中loop-business-projection whole21包含原15+新增6；另含independent、output-consumers、published-artifacts。原签名完整8在B-loop-adapted-full-node24重跑中，仍原新批准3×30/5×60，不预称绿、不自动继续加时；最低22.22完整8尚未执行，不能复用旧95。

## Full823 的准确复用范围

Full823在适配前启动，B-desktop-full-v1-partition.json保存起始source SHA；不得声称所有823在最终freeze运行，也不以某file开始时间推断Vite transform cache已刷新。B10-host-actual.diff与B10-host-ast-audit.json基于实际TypeScript AST/逐字source核验：runtime imports不变；除新type import/outer host之外顶层statement逐字不变；host原13条statement除readUserTemplateOutput函数声明外逐字不变；其余15个named runtime function逐字不变。唯一改变的运行逻辑是readUserTemplateOutput消费回调构造6字段纯data快照并post-current，返回type明确PublishedPayload。

生产名检索B10-production-consumer-search.txt完整覆盖src与desktop/electron：唯一实际调用者loop-output-service.ts:43/62/65，分别初次消费和open前/后独立fresh read。preview/open→readPublishedArtifact及list→readLoopArtifactPage→readPublishedArtifacts共用该边界；task也走原fresh host。没有给其他project/inspect/assistant/promotion/write ticket更改函数体，未触这个新方法的其他full823测试可按未改执行路径/逐字函数证据复用；不能将复用描述成final-source全量重跑。此论证不替代changed行为的全file回归：四兄弟whole65及原完整签名8需要最终SHA下fresh结果，root/A另对保守8个CLI runtime import闭包fresh替换。新增case已落原full选择的projection test，标为source drift，最终whole21替换对应旧file，不重复累计。

全量D6实际FIFO新红另保留，原whole221绿不能替代full失败。D6单独根因/方案/whole17替换待审；全量四qualified与独立Loop分区未补齐前，不称Desktop全绿。
