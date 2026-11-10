# Fixture owned chat / child-process lifetime（第三轮补充）

新证据：中断的Node22本地验证没有剩余runner、没有JSON/receipt，但遗留42个本工作区真实activity-owner子进程。已按记录PID及精确命令复核后SIGTERM清理，剩余0。它支持fixture资源管理缺口，不证明云端首次prompt超时的原因。

## 边界

只改tests/support与原interactive fixture，不改production API/行为，不mock活动owner，不吞process.exit(1)/ENOENT，不延长原就绪/用例deadline。原70用例身份和原expect表达式保留；额外增加故障路径回归。

## 机制

- 以harness对象为scope，`startOwnedChat`实际调用原Command.parseAsync，并保存同一个pending及此scope配置根；57个原parseAsync调用只替换为此显式fixture入口。
- 在原try的finally最前面`await scope.close()`，之后才做原有listener/env/harness恢复。无需依赖afterEach发一次可能丢失的/exit。
- close幂等：通过现成InputReader signal取消真实read（包括注册前），随后必须await pending；不发送猜测的退出输入。独立有界cleanup预算（不得让失败转成功）；超限明确失败且beforeEach拒绝在前scope仍活跃时启动下一case。
- 所有case原finally保留、afterEach在删tempDir前再次等待同一close Promise。若原断言与cleanup都失败，保留原错误并附cleanup错误，不能用cleanup异常覆盖原断言。
- 只跟踪真实owner-launcher调用产生的ChildProcess：测试spy必须原样代理actual.spawn，不修改command/args/options；限定owner-entry脚本、config在本scope明确配置根内。对记录的自身child发SIGTERM并await退出后再删目录；未退出明确失败，不改为假通过。不按进程名杀其他任务。
- 故障注入调用真实registerChatCommands入口，用受控启动gate在输入监听注册前制造原断言失败；关闭过程abort后释放此新case专有gate，证明pending确实退出、children为0，再恢复流/删除目录，随后第二会话不受旧listener/writer影响。不能用虚假已resolved Promise替代这个集成回归。

## 暂缓范围

pending若在cleanup预算内始终没有输入入口，fixture无权无声强制结束当前Vitest进程；该场景保持失败。若需要production新增AbortSignal/取消入口，先向主任务报告产品改动边界，不自行扩展。

## 修订：使用现成的真实 InputReader AbortSignal，不猜测输入监听/发送退出文本

已读 `src/ui/input.ts:675–676`：真实read在signal已abort时直接返回null，注册后也监听abort；`chat.ts:4232–4245`在read返回null时走正常结束分支，无需SIGINT/EOF/process.exit mock。fixture原样代理真实InputReader，将scope自有signal与原signal组合，仅在cleanup时abort，正常运行不触发。InputReader实例在构造时绑定当时scope，避免后来scope误认旧reader；正常read直接返回实际Promise，不增加前置await。

子进程通过owner-launcher已有spawn seam原样代理，真实client/Promise不替换；规范化configRoot限定在当前fixture明确tempDirs内，记录ChildProcess并等待真正close。真实ensure成功另记ready信号供故障回归验证。

原finally前先await close，catch记录原断言以便close失败时AggregateError保留两者；afterEach在任何rm/restore/reset前再次确认所有scope已关闭。close超时保留poisoned/active，不删目录不恢复流，后续beforeEach直接失败。即便异步close后来完成也不自动解除poison，避免迟到finally污染下一case。

故障回归使用真实registerChatCommands+真实owner：代理InputReader的首次read设置仅此新回归的gate，先确认真实owner至少1且ready，再注入固定原断言错误、启动close并abort，释放gate后真实read消费abort返回null。验证原错误对象仍可识别、pending关闭、child已close，再恢复和删root，下一会话正常read/exit。原70项无gate、预算/断言不变。

## 最终代码评审修订

测试自己的tool/answer gate先释放，再close；restore/delete仍必须在close成功后。子进程仅以实际close事件标记回收，exitCode不冒充stdio已关闭。spawn argv严格两项，入口canonical等于本仓库对应emitted/source owner-entry，config文件等于真实storage名字且在owned根内。若原断言A与pending拒绝B不同，结束实际清理后hook报告包含A与B的AggregateError，不因A存在吞掉B。外层finally同样检查可恢复边界。
