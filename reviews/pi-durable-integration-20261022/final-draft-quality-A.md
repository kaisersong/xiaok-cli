# A席：最终文档与证据预览质量预审

日期：2026-10-22。本轮仅只读核验已有文件、哈希、日志与元数据，没有启动测试、构建或模型调用，没有修改源码/测试/其他票。仅写本报告。此票是预览质量结论，不是最终完整SHA表决，也不批准全量测试通过。

## 核验对象

- 当前HEAD：`d7f9a5a07b8695fc05b1a406c0863eafaac4a421`。
- 结果草稿：`reviews/pi-durable-integration-results-20261022.md`，本次读取SHA256 `d6a50bf17dc0070389c41714954bef83a1482451b34fbaf0012108bd75a13ffb`。
- 证据预览目录：`reviews/pi-durable-integration-20261022/`。本次172项manifest SHA256 `15ec91426b181e0a9fc6c8a47ae9713245c6718ae47293edb77675f60b2cb60a`；snapshot SHA256 `310d8a7b373e7d3fe74932e5effbbbe992212b13fba6c297aaeb0859edb382f7`。
- 源码snapshot/provenance、隔离构建原始JSON与log、CI十入口、远端semantic红/绿、focused/全量summary、本人已有基线报告、归档转换脚本、GLM原始身份与最终result。没有阅读B/C原始评审结论；动态报告只作逐字哈希核对。独立构建报告按本轮指定作为执行证据核验。

## 已核实

1. 15份snapshot对应工作区与冻结HEAD内容逐字一致，provenance的三份完整commit定位正确。`3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`到`6770092945a42fb0e45ef0d68d0971bfc01b51a8`确实只有两份workflow和两份打包测试修改，未将移动origin/master当原基线。
2. 独立隔离构建来源为git archive冻结d7f，setup记录独立inode的真实依赖clone、非symlink；CLI build/testcompile/CI runner均exit0且reaped。CI实际十个emitted JS路径均在冻结workflow中，原log为10文件、394 passed、无skip，未拿TS focused代替。22项补充输入对当前文件/冻结HEAD哈希全部一致；前后37条检查均一致，其中3条重合，实际34个不同输入。cleanup记录只删除自建根、没有手动kill/共享服务操作。
3. Node24修订后focused为484 passed/1 qualification skip/15文件，Node22原focused为475 passed/1 skip/14文件；两者人口不同，草稿没有伪装相同人口。远端Node24真实注册链原绿日志17/17、exit0/reaped；原红保持empty唯一失败，符合本席已关闭semantic阻断的窄范围。
4. Desktop全量原summary确为45 failed/776 passed/4 skipped文件，225 failed/9965 passed/40 skipped测试。root remaining确为14 failed/998 passed/28 skipped文件，51 failed/10116 passed/207 skipped测试。草稿正确保留原失败、过滤skip、suite-only失败、未复现的10个case以及hook与Desktop未归因项；没有把基线执行同文件写成所有case已归因。
5. root原始报告初始parser94/raw审计95、scroll-region125通过重叠一次、原分区remaining1040等口径与本席原始审计一致。旧coverage预览1134报告/2未报告、13638 per-file tests，不是一次完整绿执行。
6. 172个归档文件savedSha256及bytes全部正确，无重复、无缺件（manifest本身不自引用）。按manifest的rawFile字段核GLM派生后，170项与当前raw及指定clean转换逐字一致；另外两项正在更新，见待办。特别说明：glm-static-review.md来源为glm-review.log，不要求同名raw。
7. 原始system.init.model确为GLM-5.3，tools与mcp_servers均为空；最终result success且无permission denials。派生静态正文等于init.model+result经指定clean转换。新增glm-review-identity.json中的原logSHA `5fc635b82cbd0fb0c665e6ef8f9efe9a3c2574069bef1352f67751bc518f441a`、result文本SHA `f714c8adb4f64f02bb3e33b8f819564978e1081ac78ad1a4578ca710b49c973f`均重新核对正确。草稿清楚限制为附件静态评审、没有测试执行，未冒称外部独立完整仓库验收。
8. 归档中未发现未替换的<local-user>路径或脚本定义的sk-token形状。仅验证声明的路径/ANSI/token形状转换，不外推为所有秘密形态均被全面扫描。

## 最终归档前待填/修订

这些是预览已知收口项，本阶段不据此给产品BLOCK；最终提交前必须使文字、raw、archive和manifest同步。

1. 结果正文第30行末句“另两个文件的完整补跑结果及最终去重覆盖见……”目前超前。最新retry raw已有publication 23 tests（12 pass/10 fail/1 skip，901699ms），所以当前为1135报告；controller16 tests尚未完整报告。旧coverage仍1134/两个未报告。应等待或明确写尚未完成，并在结束后刷新coverage、执行台账和正文；保留原raw失败与未报告，不把case deadline/有界诊断当正常通过。
2. 本次manifest中blocked-files-review-C.md、root-blocked-files-retry.log的saved文件与manifest相符，但当前raw已变化，转换后也不同。最终须重归档并重算全部raw/saved哈希，新增GLM身份子集证据也应纳入。172仅是本次预览人口，不能固化成最终件数。
3. 本次git status仍有229项tracked生成物变化及30项untracked（含预览证据与构建输出）。按主笔既定收尾恢复生成物后，确认最终docs-only提交相对d7f没有产品/测试/CI/构建输入改动；最终完整HEAD、范围与manifest再另立票核验，不能直接复用本预览票。
4. 第20行“15个变更文件及22个额外构建输入”建议精确写为“15项快照和22项补充检查（3项重合，共34个不同输入）”，避免误读成37份不同文件。
5. 建议在当前集成结果也直接重述：预算容量qualification、真实provider、代表性性能/缓存收益及安装发布门不因本次完成边界修复而转绿，父P0门槛仍按原设计保留unknown。现有正文已限制无计费provider HTTP、非release ready、未签名安装发布，未发现明确越权完成宣称。

## 本阶段结论

预览的已完成事实、源码冻结与模型身份没有发现新的实质错误。除上述明确待收口内容外，未发现需要改产品代码的必改项。允许继续整理最终证据与docs-only提交；本票不作最终APPROVE/BLOCK、不批准尚未完成的controller人口、不声称全量绿或release ready。
