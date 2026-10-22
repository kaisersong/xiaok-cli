# C9 原连接关闭回执方案第二轮（B）

**APPROVE（本轮设计）**。完整重读计划第二轮与实际 services2927、MA disposeOwned、store.close 顺序；计划 SHA 见 JSON。之前代码和首增量方案的 BLOCK 均保留，不靠后来 active0 补发当时未发生的 close。

四个必要条件合取：原 memoized dispose fulfilled、同一实际 coordinator active===0、实际 runtime blocked===false、捕获的真实 db own native isOpen getter 以同一原 db receiver 返回明确 false。后者提供此前缺失的实际连接关闭事实；不再把 store.isClosed 的先置 flag 当回执。自身 nonconfigurable accessor 的真实24/22.22探针已读，prototype 无该属性的事实也已记录；不默认未知值，不主动关闭连接。

两条负例分别持 ticket 到 cleanup 后、以及原 dispose fulfilled 后先 release 再 cleanup。后者必须先证明 active0/blockedfalse 但原 dbOpen=true/SELECT1 仍可用，且 cleanup 零尝试删除精确 root。这样能证伪上一轮不充分 gate。精确 rm 保护叶使旧红不真的删活 journal，保留其余真实 IO 与原所有权，父仅在 worker/group 退出后收取。

未知 descriptor/getter/返回值或 gate 异常均 retain 并报错；known active/blocked/open 未释放仅 retain、不假称失败已排空。不减少原 none-completed、错误身份、blocked/resources 断言。无必改设计项；实际新 source、有效红与两版本五整文件仍需独立代码/结果复核，当前19c旧代码 BLOCK 尚未关闭。
