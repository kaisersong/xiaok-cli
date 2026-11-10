# D0 child fixture：强引用持有 OS 锁直到终止

第三轮 macOS/Node24 的 initializing crash 回归在第二进程探测时得到ready而非unavailable。该原断言必须保留；产品锁实现和测试文件与a07相同。本轮不因未改源码就称其flake。

已读事实：tests/fixtures/harness-optimization-child.mjs只在initializing块内const持有lock，写ready后块结束，stdin.resume不引用lock。native owner_lock.c的NAPI external finalizer会close(fd)；没有外部强引用时GC可能释放真实锁。此为待确定性复现的fixture生命周期假设，不是产品OS锁安全结论。

最小验证与修复：新增只用于测试的--expose-gc preload，真实fixture宣布ready后由父stdin请求GC，等待collector和两次event-loop turn，固定JSON确认后运行同一原contender断言。先证实旧fixture红，再以child stdin end listener保留实际lock/runtime引用，EOF时释放，SIGKILL仍由OS回收。fixture返回原ready、原产品入口、原断言、原deadline均保留，不改native或产品授权/所有权逻辑。新增强制GC用例，原3crash场景保持。

不同模型先复审设计；红绿后本地D0对应测试和当前HEAD完整CI验证。若假设未复现，不凭静态推测提交修复；若需要产品改动先报告范围。

## 证据与最终复审

官方Node22实际Mac的受控红测，在GC ack后得到原断言expected unavailable/actual ready，exit1；旧fixture源码无强引用修正。修复后原4项加GC/EOF共6项通过。EOF分支另断言真实close为[0,null]，不允许disposer出错退出1再靠OS释放锁冒充优雅成功。gpt-6-astra独立确认红绿与真实native/contender未替换。它证明fixture GC生命周期缺口；本次云端随机失败归于同机制仍是有源码和复现支持的推断。
