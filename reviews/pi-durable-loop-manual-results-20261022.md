# 唯一 Loop RPC CI 诊断结果

按已审[设计](pi-durable-loop-ci-rpc-diagnostic-20261022.md)，仅实际执行一次[manual run39720164588](https://github.com/kaisersong/xiaok-cli/actions/runs/39720164588)，绑定完整 `6ae23be2490a49714bfc17e581c2be7b569abad1`。Mac14.8.9、Node22.22.0/arm64、Python3.13.15。原output-consumer触及300000ms runner期限，同一用例随后报告 `controller_ipc_aborted_unknown`；1失败、7名称过滤，原exit1、workflow FAILURE保持。本次没有复现旧产品10秒错误；唯一诊断已用完，不重跑替换结果。

观察质量与业务结果分开：owner `qualityComplete=true`、errors空，pending/listener/observerErrors为0、无截断或方法unknown；693对RPC（462client/231server）的方法均由冻结62方法白名单识别，其中11个协议方法含连字符，不声称62种方法都在本场景执行。九变换逐字可逆恢复原8358，实际TS AST59 expect/5 setTime/八模式和原预算均保持。独立A核1382输入，其中1373 tracked实际git show 6ae blob均同；九项远端依赖及Node二进制SHA按远端manifest记录，没有以本机binary伪装复验。

实际artifact14文件完整下载；原ZIP180163字节SHA `0bfe800b5c0aa2232d500e04bfa1ffdce412c140b50326b3576cf8237ea04499` 由root另取原ZIP实际复算，等于GitHub artifact API digest，14个解压文件逐字与该ZIP匹配。独立A质量票读取于该ZIP复算之前，明确当时只有API声明；后续root证明单列，不改写原票限制。原stdout SHA `8c1f2dc9a98aa7d965e16607a62e23070de01ffb04211b510e80076a76b48c08` 与owner匹配，完整两错误保留。

preflight child1279 exit0，原child1283实际307.322秒exit1；两者均reaped、组无残留、无signal。worker1287/PPID1283、root nonce/UID/dev/inode/birthtime及创建窗口匹配；远端已审owner在worker/组消失和身份复核后删除精确fixture及临时根，三临时bin归档SHA匹配。物理absence和删除依据同次远端owner执行记录及源码门，独立审查没有冒称再次远端ps/stat。质量绿不代表业务绿或完整八项资格。

轨迹阶段：fixture ready10.987秒、root publication38.644、stage publications77.562、business projection107.552、preview138.949、artifacts list167.070、task read195.528、workspace拒绝229.873，未完成整个导航验证，在306.314结束finally。按固定源码和第三批RPC次序，可推断 `openPath` 已返回、失败位于其后的fresh验证；没有直接观测 `openPath` 时长。时间原点是observer，不能把这些数值直接当case开始或产品10秒起点。

最后client692 `publication.readOwnerPayload` 对应server693，server于306118.627ms fulfill；ctx于306225.210ms首次abort，client同ctx于306225.233ms收到取消并在306225.433ms reject，scenario随后保留同opaque错误对象。它说明该次最终取消发生在服务端返回之后，不证明产品安全检查失败或已完成整个导航。最长一组完成的五业务RPC窗口为9805.571ms，仅是调用窗口，不等于完整产品reader的10秒计时。

大头在fresh业务server：observeOwner45次、payload23次、observeLoopSet7次；client/server区间重叠，不能相加。process CPU增量与这些区间wall接近，只说明该worker执行成本，不推宿主饱和、磁盘或锁根因。identity231次合计约0.735秒；所有业务client/server窗口差合约3.678秒且含真实协议/观察成本，不能据此宣称≥5%可删收益。全部SQL、guard/census、authority、current和导航前后独立fresh检查保留，没有批准生产候选。

完整轨迹、14文件、输入/清理/退出、独立质量与分析见[独立证据](pi-durable-loop-manual-evidence-20261022.json)。本次是有限被动观察，有额外Promise reaction和记录扰动，不作为无观察器的性能基线。后续Windows单用例测试窗口修订不属于该6ae实验HEAD；正常原八项矩阵和远端128仍另验，不宣称merge-ready或release-ready。
