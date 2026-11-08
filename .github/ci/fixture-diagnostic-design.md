# 第三轮：缩小慢诊断关键路径并核实 TTY fixture 契约

第二轮总墙钟25m38s，比首轮24m56s慢42s；总job duration 16097s vs16520s仅下降2.56%，不足仓库性能门槛。Mac Registration两片的单job696–861s，相比首轮三片447–579s变长，等待减少未抵消。恢复Mac三片；保留已测Windows三片、Terminal Linux/Mac完整单片。

第二轮首个启动断言失败仍未定因。后续明确发生pending chat未结束就清临时目录导致ENOENT，不得将此级联反推成首次失败原因。不得改原请求3000ms就绪预算（Windows helper按既有逻辑乘5）/20s测试上限，不吞process.exit/ENOENT，不更改production code。

本轮先在fixture内做两项可验证改动；所有权收尾见同目录fixture-owner-design.md：

1. `createTtyHarness` 补齐成功Writable.write callback（支持encoding和无encoding重载，异步回调）和stdin.off代理/恢复。现有模拟EPIPE仍按原同步throw。先写实际harness回归，验证callback时序、stderr及off移除真实注册到fake emitter的监听。不声称这两项已修复首次startup失败。
2. `waitForInputTurnReady` 原断言失败后输出有界、allowlist诊断（Node/platform、数据监听数、屏幕行数/提示符与活动指示行号/输出长度、固定资源类型计数（未知归other），不输出任何行文本）；继续抛同一个错误。成功路径、原deadline、原expect表达式保持。禁止输出环境变量/凭据/任意对象或修改ready判定。

暂不草率用SIGINT/EOF清理pending：原退出路径process.exit，必须单独设计owner收尾并用真实故障注入验证后才能实施。诊断可指导后续根因；本轮不宣称未实现的生命周期修复。

新harness回归纳入原Terminal其它文件命令，覆盖原所有OS/Node组合。继续完整head实测；任何未解决失败保持阻断。按真实墙钟和runner分钟报告，不以减少job数证明提速。
