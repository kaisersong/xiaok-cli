# 正常 Loop 八项的有界执行窗口

本案只校准测试执行窗口，没有生产优化。最新6ae原四矩阵：Ubuntu22.22及24各8/8；Mac22.22为1通过7失败，Mac24为7通过1失败。32次矩阵执行中24通过、6个原runner到界、2个明确产品10秒错误，不是新增32个业务用例。Mac22 full-projection在51.685秒触发 `loop_publication_read_timeout`，Mac24 output在228.895秒触发相同产品错误；全部原红保留。不能把489那次全部runner红的结论用于6ae，更不能把另一次manual的post-open定位移植到这两次inner红。

原测试明确将30/120/300秒声明为runner预算。完整成功记录已有simple29.6秒、complex114秒、output295.677秒，后者距300仅4.323秒；一次原300秒manual又直接记录ctx取消打断最后fresh验证。此次保持全部工作量，为三条single chain、四条full chain及一条output统一采用固定45/180/450秒，均为1.5倍。原body、59 expect、5处逻辑setTime、八模式、原SQL/签名/authority、每次current/fresh和导航前后检查、ctx.signal及同Promise finished join全部保留，产品10秒与hook10秒不变。

首轮“仍保job35分钟”遭C容量BLOCK：c7 Ubuntu22实际两段npm安装421+424=845秒，加名义八项case预算1305秒已2150秒，超过2100秒，尚未计setup/collect/hook。旧票保留；第二轮仅正常Loop job改为固定40分钟，各独立席与实际不同模型gpt-5.6-sol重新批准同一配置。2400秒给予已见安装与该人口余量，不保证任意宿主/安装速度。40分钟截断仍是未验，runner再次到界仍红，不自动继续扩时；原矩阵、命令、npm flags和其它jobs不变。

实际测试文件29205字节SHA `2ba7714f2999b5396b0c68925e68e3a10b65da6cfd935491655f76f57274a1cd`，撤销三个整数和注释逐字恢复原8358/29201字节。Desktop workflow10503字节SHA `668015a2304acafcacd3ce66abde1a15bc1a793908e104e05f5365548fc7af5f`，只将该job40撤回35即逐字恢复原7df80。A与实际不同模型又核实际两份源码，均APPROVE。这些只是静态实现票，不是运行或产品性能票。

原一次性manual五输入仍完整冻结于6ae，owner和变换表继续硬绑定原8358。新正常测试SHA变化后，若未来对新HEAD显式manual true，将安全拒绝 `original_test_changed`；不更新绑定、重写旧实验或重派唯一诊断。正常push/PR/defaultfalse路径不运行该专用job。

源码/原红/逐轮策略/实码票/全93源冻结见[证据](pi-durable-runner-window-evidence-20261022.json)。当前93源中90与6ae相同，仅本测试、该workflow和另案Windows单case第三参改变；生产源码未变。七文件本机93回归是在Windows3196候选下执行，随后这两项Loop独立输入变动不改变其七文件/生产闭包；不能据此宣称最终完整HEAD跨平台通过。

最终完整HEAD必须取得原四正常矩阵各完整8/8、无未处理/迟到错误及真实退出。任何产品10秒、业务断言、清理或退出失败仍保持红；本窗口校准不能关闭已有inner10或宣称Loop全绿。缺少安全且满足收益门的生产候选时不移除安全检查。实际新CI状态写入PR，远端128仍另待真实资格。
