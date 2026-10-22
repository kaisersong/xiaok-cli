# B席：冻结HEAD隔离构建与CI编译JS复验

2026-10-22。**本轮本机Node24隔离复验通过：CLI build和test compile均exit0；model-recovery workflow指定十个emitted JS文件394/394通过，无skip。** 不将本次结果外推为GitHub Actions跨平台矩阵、全量Desktop、发布或安装包验证。

## 冻结来源和隔离性

源提交固定为 `d7f9a5a07b8695fc05b1a406c0863eafaac4a421`；没有fetch、改refs或更改运行中的main生成物。自己通过`tempfile.mkdtemp(prefix='xiaok-pi-final-validation-', dir='/tmp')`建立临时根 `<final-validation>

`git archive --format=tar <完整冻结SHA>`通过管道交给`tar -xf - -C <临时根>`，两者exit0。依赖复制命令：

```text
cp -cR <worktree>/node_modules <final-validation>/node_modules
```

copy exit0；临时node_modules是独立inode的真实目录、不是symlink。采用私有APFS clone，没有改用共享依赖目录，没有跑npm ci或宣称全新联网安装。原task ROOT依赖约549Mi；执行前/tmp可用约11Gi，无复制或空间失败。Node为`v24.16.0`。`prepare:types --apply`按原脚本实际执行，原日志`sqlite-types: exact`；主依赖`@types/better-sqlite3/index.d.ts`前后SHA256同为`8413bb67e4f57a5a9b41af969d018982db63e245f5cedd87f18394c6db6bad69`。

## 原命令与结果

以下命令按顺序通过原integrationdir绝对`run.py`执行；cwd均为临时根，日志与JSON留在原integrationdir。

| label | 命令 | 实际结果 | runner / child PID / PGID |
|---|---|---|---|
| final-cli-build | `npm run build` | exit0，reaped=true | 97898 / 97906 / 97906 |
| final-test-compile | `npm run test:sandbox:build` | exit0，reaped=true | 98281 / 98289 / 98289 |
| final-ci-emitted | `npm run test:sandbox:run -- <下列十入口> --maxWorkers=2` | 10文件通过，394 passed / 0 failed / 0 skipped；exit0，reaped=true | 98852 / 98853 / 98853 |

十个入口由冻结`.github/workflows/model-recovery.yml`逐项提取，顺序、文件、runner和config不替换，仅按授权追加`--maxWorkers=2`：

```text
.test-dist/tests/ai/adapters/openai.test.js
.test-dist/tests/ai/adapters/claude.test.js
.test-dist/tests/ai/adapters/openai-responses.test.js
.test-dist/tests/ai/runtime/compaction-completion.test.js
.test-dist/tests/ai/runtime/compact-runner.test.js
.test-dist/tests/ai/runtime/portable-compaction-executor.test.js
.test-dist/tests/ai/runtime/model-stream-recovery.test.js
.test-dist/tests/ai/runtime/abort-error-discrimination.test.js
.test-dist/tests/ai/runtime/agent-runtime.test.js
.test-dist/tests/ai/runtime/provider-request-error.test.js
```

实际npm runner仍是`node -r ./tests/support/vite-net-use-patch.cjs ./node_modules/vitest/vitest.mjs run --no-cache --config vitest.sandbox.config.mjs --configLoader runner`，没有用TS focused结果代替CI emitted JS。按上列顺序，测试数为188、15、9、33、13、25、11、11、77、12，合计394，原log逐项可核。

## 来源哈希与覆盖限制

`integration-source-provenance.json`原有15份source在导出后、构建/编译完成且测试前、测试后均核对：临时文件和task主worktree内容SHA256与manifest及冻结d7f逐字相同。额外核对十个CI入口TS源、package/lock、两份tsconfig、sandbox config、构建/复制/类型修复脚本与Vite网络patch，共22个补充条目；构建前后均对冻结内容一致，其中3项与原15份重合。没有削断言、改timeout或更新baseline。

构建仅在临时根照常改写其build-info/build-flavor和dist/.test-dist，没有复制回task。十份实际测试emitted JS的SHA256另存post-test JSON。本次覆盖冻结源码、本机Node24与既有owned依赖副本；不能替代Node22、Windows/Linux、真实网络provider、Desktop build、pack/sign/install或发布验证。最终docs-only提交复用此证据，仍需质量席核其完整HEAD源码未变。

## 收尾

三次runner均正常exit0且reaped；按登记PGID 97906、98289、98853读取ps列表，组内剩余均0。没有手动kill，没有干预main测试或共享4400。全部进程回收且哈希复核通过后，使用`shutil.rmtree`只删除本次mkdtemp根；根路径非symlink且实际父路径为`/private/tmp`，目录symlink只解除链接不跟随。清理后临时根与根symlink均不存在。cleanup JSON保留完整路径、时间与前置核查。

## 原始证据SHA256

- `final-isolated-setup.json`: `f1ed186ac75b7739c22b5c69deeaef3e4934124edf1e97eb996e24cc29aa306e`
- `final-isolated-ci-source.json`: `9dbba41da89b96b75c64f6aab08f4abaee4fb71f23e3f787e75308dd9a86e905`
- `final-isolated-pre-test-source.json`: `32a44589e606d25beda323b1ed547c57d97a820637b94253d50997bde06ae9d0`
- `final-isolated-post-test-source.json`: `01c00a88fb8cd0a7e566bdb2737f35bde565e1f494034ded48a1be4b6539ce8f`
- `final-cli-build.log`: `ec5bb696727b2d309a9bb2d5c81fdce874813cc4d21457aa23c73e8dd6ff34c2`
- `final-cli-build.json`: `cd4365d9c224ad179a2ebfbdc4f95f58ab365d791a9af242ca315b6d634a06e3`
- `final-test-compile.log`: `46f55ce5e56109c9a847180b54dfb261b9f4bccad37109bf585f984453a54d60`
- `final-test-compile.json`: `8a8ceb08729e76e602d2a2c06df8a62785c51542d893ad3ce75a679c94514030`
- `final-ci-emitted.log`: `7c9ef486e029646815a174e3421762a39bf6c23f7f118b3a505f332731e35e4a`
- `final-ci-emitted.json`: `3757fd970737df50dfbbebf34820bdeadcc21815c4aef4934d59bab08036a11b`
- `final-isolated-cleanup.json`: `dc2699a1677b2617fb4137c0e01a4af6dcd5fab85e67c1378eca15f322361450`
