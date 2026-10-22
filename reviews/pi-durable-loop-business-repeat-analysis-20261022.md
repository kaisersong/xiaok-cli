# Loop失败路径：真实业务重复与最短下一诊断（只读）

当前没有可直接批准、预计稳定达到5%的等价production修法。原8/30–120–300、product10s/hook10、资格与全部拒绝边界不改；不实施、不跑新CPU/模型。已筛除的captured Object reader和已否决descriptor批量/事务/Statement-cache不重开。

## 真实profile指向注册读取，不是重复开库

独立对worker3542原profile(db5cfe39…，46399samples)逐样本走父链离线归因，明细A-loop-business-path-offline-attribution.json。registrationReadVector inclusive28523=61.473%；collectFixedRegistrationData28254=60.894%，二者重叠，不能相加。openPrivateVerificationDatabase子树只有7=0.015%；readInstalledCurrentOwner16=0.034%。真实Loop原测试把installed profile/client身份叶替换成实际私有fixture，所以这些比例不能外推已安装包开库/扫描成本；但足以说明“为这份CI再做开库池”没有5%依据。测试fixture数据库/authority/receiver在各mode原setup只创建一次，非每次fixed read重开。

跨OS原始事实由B归档的真实raw与stage保留：eade Ubuntu曾全绿；同源debcb Linux22为1P7F、24为2P6F；profile这次单output是1F7filter，root-current36.403s、stage78.042、business113.579、preview148.984、list183.051、task214.277、workspace-refused246.770、finally300.690。另早Mac24 output38.314触内层10s，尚未rootcurrent，与这次300s红不是同一失败原因。没有CPU/RSS/IO根因证据，不能据源码同或Ubuntu绿消掉新红。

## 可证伪机制：observeOwner首opened后立即再次opened

真实入口approved-publication-operation.ts:129先 `open=opened(requested,who),key=json(open.owner)`；130内部readOwner调用current/principal后再次 `fresh=opened(open.owner,who)`；131立即调用它，140才是首次receiver await。第一次mint的readGrant没有被消费，第一open的owner/key却作为后续身份锚。每次opened实际调用owner-enrollment-authority.ts:668–675的完整openOwner：principal/resolveOwner、registration fence、migration/intent/KSwarm readiness、clock及真实read-grant写入/校验。不是两个廉价JS对象。

原profile把每个openOwner样本按最近业务caller互斥分桶：首observeOwner opened3745=8.071%（分配sample-span8.510%）；readOwner前后7606=16.393%；payload.check2057=4.433%；application.inspect2674=5.763%；其余分桶见JSON。只有这组openOwner分桶互斥，其它inclusive表不能加。8.071%是整个初开子树调查空间，**不是可删比例或端到端收益**；要贡献5%需消去其约62%成本且不引入新开销，当前没有证明。

不能因“无await、grant没消费”直接删除首opened。readOwner在两开之间还执行current/resolvePrincipal，SQL/native callbacks也可能改profile/generation/registration。首开锁定ownerA/keyA，原第二开若解析成ownerB就publication_observation_owner；改成只开一次或较晚取首身份会失去早期锚。即使始终同owner，早期registration非法→回调后恢复，也会改变原拒绝时序。openOwner自己的首尾fence只能约束它自己的窗口，不能替代已删的更早观察。因此在“原全部fence/SQL观察人口不减”约束下，不能把这8.071%整块视为无必要工作。需要新内部owner-read组合API的完整语义设计与实际callback矩阵；当前不批准该变化。

最小证伪矩阵应包括：第一打开后current/resolvePrincipal改变profile/generation，第二次原开须拒绝；旧registration暂时坏后恢复仍不得因删首开转accept；同owner的epoch/migration/pending变化、receiver await前后变更/取消、scope write/capacity失败、正常同owner原场景均保留。不得缓存首grant/registration/rows/current供后续调用，不能把旧错改成skip/ordinary。若要靠另一个轻身份查询代替首开，也必须证明该轻查询仍保早期registration/qualification/clock原拒绝，不能只有owner字段相等。

## 一个确切死读取，但不足门槛

application-binding-authority.ts:181 的局部 `a=host.authorityHost.inspectApplication(open.owner)` 结果未使用；下一行inspectApplicationValue在19–20行再次读相同authority。profile可按helper祖先区分：未用首次34samples=0.073%，helper第二次32=0.069%。proof-authority.ts:640每次是实际transaction/snapshot/read owner/application，并非fullregistration大扫描。这一行确切重复，但单独远低5%，不为“看起来重复”而实施性能改动，也不将openOwner的5.763%错嫁给它。

## counter SQL谓词筛选：当前不具备等价性证据

counter()原四次records(PRAGMA function_list)路径inclusive4349=9.373%（包括其不能删的guards/native结果构造），不是9.373%可得收益。全部census.copyRecords self886=1.910%且跨所有SQL；只省该复制没有5%依据。若保PRAGMA原人口仅少复制无关字段，最多是另一个低收益筛除hypothesis，当前不启动。

改为FROM pragma_function_list()会引入eponym module/表名解析面，SQL lower/LIKE/GLOB/collation又与原JS只改ASCII[A-Z]的lower不同；SQL函数/模块可替换、BLOB/nonstring/coercion和enumeration次序均须真实证明。本次没有跑遮蔽反例，因此仅列风险，**不把“肯定可遮蔽”冒充已实测**。不能只因不缓存rows便视等价，不能先改固定pragma或删原fence后再找测试。

## 最短下一份诊断

若主笔仍要继续，不跑长full8或新profile，先单独评审一个**原terminal精确单场景**的被动RPC/身份端口trace（仍原30s/inner10/hook10，重现失败也保留）：原test leaf roundTrip与server.invoke原方法不变，白名单method/序号/单调起终/信号来源/原错误；只在原fixture resolvePrincipal/current/clock回调记录进入返回序号，返回原对象，不读getter/SQL/payload/票据，不加await或重发。identity在public daemon内部，不经过server.invoke，须单独计数，不能误报缺调用。此取证只能确定第一fixed read的5logical方法（各identity+业务）、每个关键RPC耗时及取消来源，不能直接减少任何调用或批准新优化。

从这份trace加现有profile，可证伪“每次scope初开就是可删重复”或定位到底application.inspect/observeOwner/readOwnerPayload哪段触product10。若没有安全等价且>=5%真实无prof端到端候选，就保持unknown/失败，不通过改预算、降安全人口或继续微优化掩盖。任何新生产设计仍需父v3固定验证集/收益门、原完整8与真实平台绿；一个>=5%优化也不自动足以修复300s完整链，不能提前宣称CI关闭。
