# 最终HEAD CI：真实KSwarm源码装配修复

eade543a3e4a0a9e7d1558beb9162744824eac27的recovery Ubuntu22.22/24实际均为七完整文件92通过/1失败：`project-agent-model-runtime.test.ts`的真实store reopen测试仍从`../../kswarm/src/core/agent-store.js`导入，但冷CI没有该sibling。原始job为119590666876和119590666283，run39707436621。失败发生在真实模块导入，不是模型/断言失败；保留日志SHA与原失败。

现有workflow只在该测试之后checkout固定KSwarm16c3ed14c5493a82d000d69d34e4b1c933187433到CI自有`.ci-sidecars/kswarm`供真实generator读取，因此顺序和测试的源码入口均不匹配。

最小修订：将同一固定checkout移到七文件测试前；该测试step显式传同一个`KSWARM_SOURCE_ROOT`，build/generator继续用同一目录。真实store reopen测试采用这个已有源码根变量，未提供时保留原sibling默认路径；仍通过原native import加载真实`src/core/agent-store.js`，保留原create/update/reopen/null断言。生产代码、原93项人口、最低版本、其它OS、预算、资格和治理baseline均不改；不复制store实现、不mock或skip。

方案由A/B/C先独立审查，再最小修改。使用固定真实revision的自有干净archive作为显式源码根，在Node24与最低22.22完整执行同七文件，核真实文件hash；YAML结构/顺序及原命令人口核对；不同模型GLM-5.3审具体增量。之后提交新完整HEAD，重验相关实际GitHub矩阵；旧eade的CI不能当新HEAD已通过。

原本机1136/824分区和79源审查仍按eade记录保留。此增量只改变一项测试源码定位与CI装配，最终HEAD需逐blob比对：原79清单中78项及八生产输入不变，只有workflow更新；runtime测试原本不在该79清单中，作为另一个实际变动文件单独纳入新绑定。两文件分别由装配审查/实际矩阵及上述完整七文件新结果覆盖；不重复累计93，也不将旧CI失败删去。

清单核对更正：设计审查曾将原79中的不变数写成77，基于误以为该runtime测试已在79中的判断。实码准备的强制SHA断言发现该误读后逐路径核对，确认78不变/1个原清单内变动/1个清单外测试变动；有效源域合并为80。实际补丁仍仅原定两文件，未增加实现范围；旧票保留，新实码票核当前清单。


## 实码与验收记录

KSwarm装配实际两版原七完整文件均93/93通过，真实固定revision的独立干净源码archive已核SHA并在runner退出后按原身份门删除，未改sibling。A/B/C实码及实际不同模型GLM-5.3（54985字节完整输入，SHA50f6ddaa1bb2338d89a631e4f0934c0ff6744535cfd5c3015b855f7807d07786，工具0）均APPROVE。

另一个独立CI失败及方案见[Windows活动预算](pi-durable-windows-activity-budget-20261022.md)：单case第三参数仅Windows120s/其余15s；原五完整文件在本机Node24与22.22均68/68。A/B实码与GLM-5.3（20663字节，SHA6efa5a89c81e878728f8d22471d5728a572b377342f9bb9b8fdfb3e1b815c328，工具0）APPROVE。GLM回复中“predates this branch”并无主干证据，本报告只确认失败发生于旧eade HEAD、先于本增量，不作主干性能归因。

两个独立增量合并后的源码域为80：旧79中77项不变、workflow与activity测试2项变动，另加原清单外runtime测试1项；八生产输入不变。七文件93与五文件68均整文件替换已有结果，不重复累计，CLI13456/0/225及Desktop10159/0/8本机计数保持。逐路径SHA、实际runner、审查票、原红日志及清理身份见[增量证据](pi-durable-ci-evidence-20261022.json)。

真实新HEAD的recovery跨平台矩阵及Windows原68仍待验。旧eade的macOS Loop两个版本均实际失败（Node24为5通过3失败，22.22为4通过4失败），包括产品固定10秒读取超时及runner超时；Linux两个版本同原8项通过。这些红保留且继续诊断，不由本增量关闭，不自动扩大Loop预算或产品期限。
