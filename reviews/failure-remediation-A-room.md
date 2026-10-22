# A补批：Room新增字段逐项分类

B明确分配`desktop/tests/main/room-field-classification.test.ts`及专属`src/runtime/conversation-activity/sensitivity.ts`，B/C未改；本批不触room service/IPC/permission grants。

## 原红与核实现状

`A-room-classification-red`完整19项：4failed15passed，原log/runner保存。失败为编译期SameKeys与Instructions/Claim/Artifact三个人口表不全。当前Desktop contract新增41字段：Instructions6、Claim24、Artifact11。Snapshot/permissions/dispatch等其余表不改。真实`projectMetadataOnly`在sensitivity.ts:350后只投射显式metadata，其它敏感/未知字段先跳过；复杂object仅已登记nested kind可递归，不能靠任意object/toJSON注入。因此当前新增unknown是丢弃，本修订不能借修类型契约扩大content/path/identity/authority字段曝光。

## 最小生产修订

只在三个LocalRoom*镜像接口增加实际41个显式unknown字段，并在三个`as const satisfies Record<keyof LocalRoom*, Sensitivity>`表补逐项固定分类。不引入index signature，不删实际字段，不改SameKeys，不自动根据runtime对象生成允许表，不改projection算法、nested registry或ID校验。

| contract | 新metadata（25项合计） | 新content（4项合计） | 新forbidden（12项合计） |
|---|---|---|---|
| Instructions（6） | roomId, snapshotDigest, publishedAt | description, directoryNotes | publishedBy |
| Claim（24） | roomId, logicalAgentId, parentClaimId, projectMappingRevision, taskId, protocolVersion, hostIncarnation, bindingId, generation, workspaceRevision, instructionsDigest, membershipRevision, createdAt, mappingRevision, roomSequence, updatedAt, lastHeartbeatAt | taskName | contextScope, workspaceId, originHostId, hostPrincipal, acquireDigest, terminationEvidence |
| Artifact（11） | roomId, workspaceRevision, producerClaimId, observedAt, sourceSequence | handoff | workspaceId, originHostId, contextScope, commitTicketId, confirmationTicketId |

理由：业务对象ID、数字版本/序号和系统时间属元数据；snapshot/instructions摘要hash保留既有sourceHash/contentHash类别。人写描述、目录说明、task name和handoff含任意内容，禁止进入metadata。workspaceId沿既有Snapshot同类forbidden，避免逻辑ID承载本地路径；host机器身份/principal、授权acquire digest/tickets保守forbidden，不因其是string当作无害metadata。contextScope/actor/terminationEvidence等完整嵌套对象不是本批metadata输出契约，整体forbidden保持此前unknown丢弃行为，不投射其任意scalar/嵌套内容。

## 红测试先行与兄弟入口

评审通过后，先在同一真实test新增三个明确literal输入/输出用例，分别直接调用Instructions/Claim/Artifact和通过Snapshot三个实际nested入口，覆盖全部41字段：25 metadata值保留，12 forbidden及4 content canary完全丢弃；metadata输入不用canary当合法ID。未知extra字段仍丢弃，敏感新字段getter不得执行，拒绝自定义toJSON路径；原嵌套getter/array serializer测试保留。

先实跑补充测试红，证明原表尚未投射新metadata，而不是先改prod再自证。随后最小更新镜像/表，完整原19人口加新3用例跑绿。原编译期key equality、runtime全字段人口、注入unclassifiedCanary必须触发TS2344、workspace_changed Main AST人口、旧内容/路径/未知字段保护全部保留，不改deadline/skip。

同权限兄弟入口不另建解析逻辑：projectMetadataOnly(kind, value)直接与Snapshot nestedObjects/nestedArrays共享相同三表，两个入口都实际测，不只验证对象shape或复制projection实现。其余11类已分类表不扩；room IPC与service的authorization完全不变。最终root组织GLM5.3不同模型审具体diff；统一构建/typecheck/governance按root安排。每数字均A-*原log可核，maxWorkers1，仅自有PID收尾。


## 审批与producer核验补充

root独立审批APPROVE后才新增3例红（7failed15passed/22），随后补production镜像/表后22/22通过。原19不删。root已明确更正hostIncarnation使用真实数字启动代数。

实际Main broker-client.ts:10 startupId为randomUUID，:26 hostIncarnation须SafeInteger；只读intent-broker/src/room/workspace-service.js:254为旧incarnation+1（不是随机机器名）。该producer源文件无工作区diff，读到SHA256 `063136ccb073933c7bc4e2a7c3f07ef69c19c61d03a6bb47e4c87426095b1765`；没有修改sibling或启动其共享服务。:336以workspaceDigest生成snapshotDigest并用time()生成publishedAt；:354-359的claim业务ID/修订/版本/boot代数/创建时间来自固定请求identity与broker state，taskName另为自由内容字段。taskId仅有nonempty业务ID约束，这里是字段分类而非新增ID有效性/授权校验，不宣称该值本身授予权限。当前repo room-workspace-service.ts:274用randomUUID生成bindingId，:351/372 ticket是独立授权流程；因此bindingId metadata不等于ticket许可。所有相关ticket/hostPrincipal/originHostId/scope仍forbidden。
