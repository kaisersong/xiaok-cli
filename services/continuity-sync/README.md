# Continuity Sync（实施中）

独立的自托管密文中继与控制面。需要 Node **24.0.0 或以上**，服务持久化目前支持 POSIX 本地文件系统。依赖固定在本目录 lockfile，不安装到 Desktop 或 CLI 的共享 `node_modules`。

当前已有真实 HTTPS 服务、设备签名认证、根签名成员/密钥清单、两端签名配对、授权 scope、接受水位、撤销 cutoff、承诺链、crypto outbox 和控制面接收验证。**Desktop P4 默认关闭**：OS 密钥/防回滚 owner、AEAD 后 canonical 导入、完整执行权/queue transfer、Desktop 交互仍在实施。测试 guard 不是生产 OS 存储，协议测试不等于双电脑或安装包验收。

## 运行

```sh
cd services/continuity-sync
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

配置文件及 online signing key、TLS key/certificate 必须由服务 OS 用户持有、常规文件、无链接、权限 `0600`。专用 state/witness 目录权限 `0700`；不递归修改共享目录。路径相对于配置文件解析，绝对路径也可用。

```json
{
  "schemaVersion": 1,
  "identity": {
    "rootKeyId": "<SHA256 of root Ed25519 public key>",
    "rootPublicKey": "<32-byte base64url>",
    "syncGroupId": "<stable group ID>",
    "coordinatorId": "<stable coordinator ID>",
    "certificate": {"body": "<root-issued certificate body>", "signature": "<root detached signature>"}
  },
  "stateDir": "/var/lib/xiaok-continuity/state",
  "witnessDir": "/var/lib/xiaok-continuity-witness",
  "signingKeyFile": "/etc/xiaok-continuity/online-key",
  "tlsKeyFile": "/etc/xiaok-continuity/tls-key.pem",
  "tlsCertFile": "/etc/xiaok-continuity/tls-cert.pem",
  "host": "0.0.0.0",
  "port": 5443,
  "publicOrigin": "https://sync.example.com:5443"
}
```

`certificate.body` 是实际对象，包含 `schemaVersion=1`、相同 root/group/coordinator、`generation=1`、`coordinatorPublicKey`（32-byte base64url）、`capabilities=["head","receipt","authority"]`。根设备签名域为 `xiaok/context-sync/coordinator-certificate/v1`，签名覆盖 `[domain, body]` 的规范 JSON。服务仅持有对应 **online Ed25519 64-byte secret key** 的 base64url 文件；根私钥、设备内容 key、provider token 不应放到在线主机。根签名/恢复材料留在根设备或离线恢复介质。

第一次启动只允许全新空目录和未使用的 coordinatorId。CLI 在 OS 账户真实 home（不采用 HOME 环境变量）下固定的 `.xiaok-context-sync-provisioning-v1` 私有目录保存一次性锚点，绑定完整身份和 state/witness realpath。先持久化锚点再建 journal；中途失败也不能删除锚点重试初始化。

```sh
npm start -- --config /etc/xiaok-continuity/server.json --initialize
```

正常重启去掉 `--initialize`，必须保留原锚点及两个原目录。已有锚点永远拒绝 `--initialize`；换配置名、换空目录、换 key 文件名不能重置同协调器身份。缺失/损坏锚点、路径改变均拒绝启动；路径迁移尚不支持，无法恢复原路径时须根签新的 coordinatorId 并重新配对。

根签 certificate 必含 `deploymentMode="self-hosted"` 或 `"test"`。生产证书拒绝 `--test-provisioning-dir`。测试证书只能用于 loopback 监听及 loopback publicOrigin，且必须显式指定测试 registry；不能更改生产证书的 mode 后沿用原根签名。嵌入式 `AuthorityJournal` 是受信宿主 API，生产宿主必须自行调用同等部署门禁，直接 new Journal 不是合格部署。

启动输出只含监听 URL/PID，不打印 key、正文或密文。非 loopback 监听必须显式配置 HTTPS public origin。反代须保留该 Host，且对上游 HTTPS 验证证书；不提供 HTTP 或跳过 TLS 验证的生产 fallback。

新 group 先由根设备提交初始根签名 membership record 和 key manifest，再使用普通设备认证。初始 membership 只含一个 active root device。完整对象/规范编码入口见 `crypto.mjs`、`Coordinator.handleControl`；不能由 online signing key 代签成员记录。Desktop 的正式根设备导出/配对流程尚待集成，不要将测试私钥当真实设备身份。

## 网络协议

仅 POST、规范 UTF-8 JSON，不接受重复键、非规范编码或压缩请求。默认请求最大 1 MiB、响应最大 2 MiB、并发请求 4、连接 32；响应过大时应缩小分页，不能把错误当空尾页。无浏览器直连/CORS；设备密钥留在 main。

| 路径 | 权限与用途 |
| --- | --- |
| `/v1/membership` | 根签名 record + manifest；连续 epoch，不可复活撤销 ID |
| `/v1/scopes` | 根签名 conversation/branch/profile/device allowlist |
| `/v1/pairings/confirm` | 已签发挑战的双方独立签名；尚不授成员权 |
| `/v1/challenge` | 活跃设备短期一次性 challenge |
| `/v1/head` | 设备签名请求；返回绑定新随机 nonce 的 signed head |
| `/v1/journal/pull` | 只返回公开承诺，不含 entry request/changes 或密文 |
| `/v1/control/pull` | 全局控制记录，须与 global-control 承诺逐一覆盖 |
| `/v1/events/pull` | 当前 scope 授权后返回完整单 scope entry + 承诺 |
| `/v1/events/push` | 设备签名、当前 member/key/scope、连续 stream；原字节重试 |
| `/v1/pairings/begin` | 用户路径下由已认证 sponsor 申请配对挑战 |
| `/v1/key-use/consume` | 需根证书 key-use-v1；当前 scope/epoch 的单次加密 nonce、reservation 与累计预算见证，丢 ACK 不重签许可 |

## 单次线上加密见证

新部署可使用根签 `capabilities=["head","receipt","authority","key-use-v1"]`。旧身份不隐式升级：certificate 属于 identityHash，改签能力后不能沿用原 journal/provisioning pin，本实现尚不提供原地迁移。旧部署维持已有协议，不能用于生产 AEAD 许可。

`/v1/key-use/consume` 在同一持久事务记录原 device+reservationId、derived-key+nonce 和累计加密次数（最多2^32），要求当前成员、scope、manifest epochs 和 exact expected head。每次成功只返回绑定本次 challenge/workerBoot/useId/header 的签名结果；重复请求永远拒绝，不将旧决定重签成新许可。请求失败或丢 ACK 不能盲重试加密。全局只暴露承诺，control/event pull 不返回许可正文。实际 HTTPS client 核对其原 challenge，旧合法签名 response 不能冒充下次成功。

此接口是线上见证前置协议，**尚未接入生产 device worker 或 CryptoOutbox AEAD**；不改变 Desktop P4 关闭状态。未来 worker 还须持有真实设备命名空间、Keychain/OS floor、原始本次请求与一次性 private proof，并在 AEAD 前持久化许可/intent；只拿到一个 response DTO 不能开放加密。

设备请求签名绑定 method/path/root/group/coordinator/device/requestId/challenge/bodyHash/expected head。`requestSource` 是 main 的调用归属参数，**不能替代签名或用户确认**；根签名/双方确认仍必须在有权 main 流程生成。业务 request ID 按 actor/操作域隔离。客户端不自动重试 mutation；丢回执时按同 ID/原始 outbox 字节对账，不能重新提交用户输入。

接收端必须验证连续承诺到精确目标 head、收齐所有 global-control 和目标 scope 的完整条目，并以独立 nonce 再取 fresh head。缺页、缺撤销 cutoff、OS 水位不在新链上、未知分类或前后 head 改变时保持关闭。`verifyCatchUp` 仅输出冻结的 `verified-control-only` 密文候选；这尚不是可读正文，也不是执行许可。

## 持久化与恢复

- `state/authority.sqlite` 保存完整私有 entry 与控制状态；journal schema 2 的权威 hash 链只锚 commitment。schema 1 不会默默升级。
- `witness/heads.sqlite` 逐 mutation 独立 durable commit。`.owner.sqlite` 另持生命周期 exclusive lock，不能用同一长期事务保存 witness head。
- witness 先提交、正文后提交、最后签 durable ACK。中间失败即本进程 sticky unavailable；不继续读取、签 head、签回执或修改数据。
- body 和 witness 必须独立保留，部署时使用独立备份策略/卷。备份前停止服务并确认进程退出；恢复后先核对同一身份与提交水位。
- provisioning registry 必须在配置目录和 body/witness 之外独立持久保留，不提供删除、覆盖或重置入口。该门禁不声称抵抗恶意 OS 账户删除全部独立见证和锚点，或克隆全部密钥到另一主机。
- 禁止把 signing secret 与 witness 克隆成第二主，禁止一起恢复所有卷到旧快照后继续宣称 current。全部独立见证同时丢失/回滚时无法证明当前性：停旧 group，用可信根恢复建立可验证新身份并重新配对；旧 branch queue 不自动复制执行。
- `owner_unavailable`、witness 缺失/不一致或数据库损坏都应调查并恢复一致数据，不能删除数据库、清空计数或换文件名绕过。

`deploy/continuity-sync.service` 是 Node 直接运行模板；部署前填写安装/配置路径并由管理员创建专用服务用户及私有目录。模板要求该账户在 OS 用户数据库中的 home 为 `/var/lib/xiaok-continuity`；预建其中的 `.xiaok-context-sync-provisioning-v1`（该账户持有、0700），并核对 `ReadWritePaths`，不能仅设置 HOME 环境变量。本仓未执行在线主机部署、容器构建、签名打包或真实双电脑验收。

## 验证范围

测试覆盖官方 XChaCha20/Ed25519/HKDF 向量、篡改、持久化故障、真实 SIGKILL、独立 owner 进程、nonce 重试、撤销/配对、越权 journal 旁路、多页和大事件、真实 TLS/CLI 生命周期。Windows 运行算法向量及显式 unsupported-storage gate；POSIX 服务测试不冒称 Windows owner/ACL 资格。实际 Electron 包与 OS guard 仍须单独验证。
