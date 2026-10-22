# Windows durable target 重开用例的执行窗口

6ae23be 的真实 Windows24 recovery job119630897323 原七文件为92通过1失败/93。失败是 `loop-assistant-consumption.test.ts` 中 `persisted knowledge target survives a genuine DB close/reopen and never changes collection`，默认5000ms runner到界，报告8923ms。完整原红保留，不由此前489fe同文件93成功覆盖。同用例在489fe Windows24为1436ms、22.22为1565ms；6ae最低Windows22.22仍以1474ms通过，原七文件93/93。

该用例真实关闭和重开 LoopStore，保留首次目标失败后的原 collection intent、冲突拒绝、scheduler recovery、至少两次fresh读取及最终accepted。target writer为本地函数，当前产品publication reader在此文件被mock，未运行其10秒定时器。5000ms来自Vitest默认，与业务逻辑时钟120/130或SQLite busy_timeout不是同一契约。原8923ms只有generic timeout，不能证明旧body/全部断言/finally已经完成，也不能反推SQL锁、磁盘、宿主或杀毒软件原因。另一个passing runtime用例的八native false与memory false不证明该失败LoopStore已关闭。

唯一代码变化是目标用例第三参 `process.platform==='win32'?15_000:5_000`。Windows执行窗口明确5→15秒，其它平台仍5秒；其余34个collected cases仍为原默认5秒，hook10秒、产品期限、SQLite配置、逻辑时钟、SQL/fresh检查均不变。完整35853字节SHA `3196a7def05c5fe8c74db857c28cb80d8cb882a347efdbdca52daf9fbd874eea`，撤销该40字节增量逐字恢复原35813字节SHA `6a4e352d0327641a2cef08e965ff572e4f1077a698e2439335045ca987ad7156`，因此原body、断言、close/reopen/finally和35人口保持。

相邻protected双DB恢复、ordinary重开和ordinary中断恢复本次分别2012/419/349ms通过，没有证据统一扩大其默认5秒。修订仅为测试执行窗口，不是生产性能修复、旧断言通过证明或≥5%收益。A、C及实际不同模型gpt-5.6-sol独立批准策略；A和该不同模型又对最终精确源码重新给APPROVE实现票。若15秒仍红或出现资源问题，保留红并先定位阶段，不自动继续加时。

root使用与CI相同的原七文件及maxWorkers=2，本机Node24.16、最低22.22分别93/93，目标为223/242ms；两版均exit0/reaped且无未处理错误。它们运行在darwin，不能替代Windows。固定KSwarm原commit16c3ed的454文件完整archive与此前SHA相同；自有输入根在两runner/组均退出、454文件及canonical/stat身份匹配后精确删除。每版三个受控counterexample留档根也只在nonce、worker父子关系、stat及实际group/worker消失后晚删。普通fixture自己的清理随完整body执行，不扩大为所有进程全时段出生census。治理0新增违规，dist/build-info不变。

新完整提交必须取得 Windows Node22.22和24原七文件各93/93、目标PASS、无迟到/未处理错误和后续干扰；本文件写入时仍待实际新CI，不能借旧HEAD或本机结果宣称已修稳。全部原始/公开SHA、策略/实码票、源冻结、runner和清理见[证据](pi-durable-runner-window-evidence-20261022.json)。历史全量及跨版本93计数不追加相加；Loop及远端128资格仍未关闭。
