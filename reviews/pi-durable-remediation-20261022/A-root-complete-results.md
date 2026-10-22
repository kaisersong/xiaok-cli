# A CLI 精确补集完整回归结果

本报告只覆盖原1136的精确1134文件补集，明确排除verification-host-controller与intent-publication-dependencies，由root另跑完整39case。不将本报告称全1136或已安装产品/真实provider资格。主命令原样在A-root-full-remaining.json，单worker，outer5400，原case期限不变。

实际主runner起00:10:17.640Z、终01:08:15.594Z，exit0/reaped，Vitest3477.54s。逐case真实终态与最终摘要一致：1105通过/29跳过文件=1134；13418通过/0失败/224跳过测试=13642。1134均有终态行，没有遗漏file、额外file、FAIL或suite-only失败。raw日志SHA256 b812408b1a974df5be5fb2ab21fb460e5942edd488a6fcbadcda8edb97dada19。

B10生产host变更后，另完整重跑真实runtime依赖闭包8文件，起00:55:47.294Z、终01:05:57.232Z，exit0/reaped，609.59s，8文件331/331通过，verbose331与JSON331相符。host冻结79650281fa17e0e1f4094c8cdf38c5247aede8f2fbdc982af645f6bb885a3858，12输入起终无漂移。8文件每项人口与原1134相同，已在A-root-partition-final.json整file替换对应分区，绝不再加331。

最终机读A-root-partition-final.json含精确1134 sortedFiles、逐file pass/fail/skip/observedCompletedTestCount、replacement来源，合计仍13418/0/224=13642。原helper40本次成功收集33通过/7原平台skip，own-data1199/1199、hook52/52、publication-operation30/30；hook本次无诊断注入通过不意味着旧EPERM根因已证。历史计数需直接对照raw，不能把header/union/collection口径混成新总数。

源freeze2148起点全部匹配；终点仅授权MJS包测试拆分与被排除的Intent test更新，两者均在A-root-full-final.json逐hash列出；不能写2148全部未变。Desktop host输入变更由上述完整8fresh替换覆盖，不能把原full跨host输入称单一freeze。

主runner68280/PGID68288 reaped后留1个孤儿Node11525。原ps核UID502/PGID68288/start08:54:53/命令node -e setInterval后，再次核完全同身份，仅SIGTERM该PID；随后PID消失且group0。完整原始A-root-full-orphan-before/cleanup.json保留，未杀外部PID。8runner14366/PGID14374已reaped/group0；最终A自有worker0。采样祖先表仅观测到存活进程，不声称全瞬时出生人口。

本机未注册Darwin recipe，原资格skip均保留；远端资格、当前GitHubCI及root两长文件结果由各自原始证据补齐，不能由本报告代替。
