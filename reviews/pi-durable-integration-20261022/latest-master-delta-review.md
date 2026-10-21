# B席：最新冻结master四文件增量复核

2026-10-22。结论：**四文件增量只读复核无新增阻断；原资格下artifact-export-package全file为39 passed / 1 skipped、exit0。** 不是全量全绿、真实helper执行、CI或发布验收。

## 冻结对象和提交演进

第一merge HEAD `33b6b8bb44c48cc0cc9e97c15177daaaa07995c4`。本次执行开始时，`--no-commit --no-ff` MERGE_HEAD为`6770092945a42fb0e45ef0d68d0971bfc01b51a8`；写报告时主笔已完成merge，当前HEAD `d7f9a5a07b8695fc05b1a406c0863eafaac4a421`，父提交为 `33b6b8bb44c48cc0cc9e97c15177daaaa07995c4 6770092945a42fb0e45ef0d68d0971bfc01b51a8`。不能因MERGE_HEAD随后消失而把测试期间的冻结目标改写。

固定比较范围为 `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1` → `6770092945a42fb0e45ef0d68d0971bfc01b51a8`，不使用可变origin/master。该区间只有以下四文件：

| 文件 | 实际增量 | 本次验证 |
|---|---|---|
| `.github/workflows/desktop-release.yml` | release view成功才跳过创建，创建失败不再被`|| true`吞掉 | 静态读取，冻结main原文 |
| `.github/workflows/windows-absence.yml` | packaging job降为contents:read，去掉直接commit/push master，改上传verified payload供独立PR | 静态读取，原双架构构建、下载、packaging hook、文件检查保留 |
| `desktop/tests/main/artifact-export-package.test.ts` | afterPack stub补service-contracts gate，并增加service gate失败时helper不得运行断言 | 本次全file实跑 |
| `tests/package/cli-source-bundle.test.mjs` | CLI/Desktop动态版本相等，保留native lifecycle/lock检查 | 上轮原红/基线红及恢复后8/8已有独立报告 |

第一merge已恢复package测试相同两行，因此第二merge实际提交相对第一merge只改3文件：`.github/workflows/desktop-release.yml, .github/workflows/windows-absence.yml, desktop/tests/main/artifact-export-package.test.ts`。不是漏合package文件。

当前四文件的工作树/index与冻结677相同：

```json
{
  ".github/workflows/desktop-release.yml": {
    "sha256": "ab99d2e965fe8d4e6b80de3d831e1dd9f4c5318405a76964c26d89daec3fd20e",
    "equalsFrozen677": true,
    "indexEqualsWorktree": true
  },
  ".github/workflows/windows-absence.yml": {
    "sha256": "2875c4674eaca130cefb2bdbd717493ce2b3d2d60b942b0e253209cfa7e2f332",
    "equalsFrozen677": true,
    "indexEqualsWorktree": true
  },
  "desktop/tests/main/artifact-export-package.test.ts": {
    "sha256": "c5c742ef724db1de95b4407e10a74507db163a8c6417509950b7e27f4b86ded7",
    "equalsFrozen677": true,
    "indexEqualsWorktree": true
  },
  "tests/package/cli-source-bundle.test.mjs": {
    "sha256": "2f2ea206e1f59b70fd45fc00c9b1e4f2f656396d5bc177964dd78cc38ceec930",
    "equalsFrozen677": true,
    "indexEqualsWorktree": true
  }
}
```

本席本轮未改这些文件、源代码、workflow、index或旧断言。报告时主笔并行构建产生过未暂存dist/build-info输出；那些不是上述冻结提交增量，也不纳入此票的打包结论，最终清单仍需主笔恢复并由质量核完整HEAD。

## 实际命令、结果与资格

owned runner `final-artifact-export-package`，任务worktree desktop cwd：

```text
node node_modules/vitest/vitest.mjs run tests/main/artifact-export-package.test.ts --maxWorkers=2
```

执行前环境实读`XIAOK_EXPORT_PACKAGE_INTEGRATION=None`，没有设置/放宽资格。原日志：**1文件通过、39 passed / 1 skipped / 40，exit0**。skip为原`it.runIf(XIAOK_EXPORT_PACKAGE_INTEGRATION==='1')`实际prepared helper经Main owner执行用例，不能记通过。

其余是明确自包含的container-header fixture、fixture ASAR/afterPack、异常拒绝和gate顺序测试；没有把synthetic PE/Mach-O/ELF header说成真实平台二进制资格，没有运行实际helper或正式打包/签名/安装/发布。asar sourcemap missing source warning保留在log，不掩盖为无warning。

## 旧失败的具体对应

原集成full和同master新增23文件baseline均有该文件40项中的1失败/1skip；失败名是`the single afterPack entry retains both existing gates before the helper gate`。冻结677补齐已经存在的五gate顺序，并增加前置service gate失败阻止helper的断言；产品`desktop/scripts/after-pack.cjs`在冻结区间未变。此次是测试fixture与既有真实hook一致，不是删gate或改生产hook刷绿。

当时实际摘要与行号：

- `desktop-full-node24.log:2076`：❯ tests/main/artifact-export-package.test.ts (40 tests | 1 failed | 1 skipped) 258ms
- `desktop-full-node24.log:2104`：× the single afterPack entry retains both existing gates before the helper gate 2ms
- `desktop-full-node24.log:2105`：→ The "path" argument must be of type string. Received undefined
- `desktop-new-baseline.log:28`：❯ tests/main/artifact-export-package.test.ts (40 tests | 1 failed | 1 skipped) 262ms
- `desktop-new-baseline.log:56`：× the single afterPack entry retains both existing gates before the helper gate 2ms
- `desktop-new-baseline.log:57`：→ The "path" argument must be of type string. Received undefined

本轮完整file已经绿，可关闭该旧fixture失败；不能外推其他Desktop失败已归因或已修复。

## 全量source证据覆盖复用范围

冻结3b→677清单核验：`src/**`没有变化；根`tests/**/*.test.ts`没有变化（唯一根测试变更为上表.mjs）；Desktop产品`electron/**`、`renderer/**`、`shared/**`、`scripts/**`无变化。root/Desktop package/lock和相关tsconfig未变。

所以第一merge后针对相同runtime、根.test.ts和Desktop产品源码的source测试证据可以按**相同代码**复用，原有失败/skip照旧保留；变化的两个测试文件分别已有8/8与本轮39+1skip新日志。代码不变支持覆盖复用，不等于证明所有全量失败因果、更不等于全绿。

两份workflow只是冻结main已合入的原文，本任务不另改。静态可见release错误不吞、Windows生成payload不再直推master且仍经过构建/packaging gate；未执行GitHub Actions、gh release或upload artifact，不能宣称远端CI通过、tracked native输入已刷新，不能用source验证代替tgz/ASAR/安装包验证。

## 原始证据与进程收尾

log SHA256 `2c793662411eb87726357cc7b0a03bdd510e5de215bc0ad818d0fb049a83dc61`；runner JSON SHA256 `88ec1959e822fbd97a836de61364adac3e5d72dd86e3b859c90a7db81de2967c`。
runnerPid `81705`，child PID/PGID `81715`/`81715`，exit `0`，reaped `True`；仅按登记PGID检查，组内剩余 `0`。未手动kill、未触碰共享4400/权限/依赖。

唯一人工写入为本独立报告；既有票/原始失败归档不改。后续最终docs提交SHA和完整HEAD清单仍由质量独立核对，本票只对上述冻结四文件增量及对应测试证据作结论。

## 最终HEAD源代码检查补录

在HEAD `d7f9a5a07b8695fc05b1a406c0863eafaac4a421` 顺序运行两条独立owned runner命令，未改baseline、断言、源码或资格：

| label | 根目录命令 | 原日志结果 | exit / reaped | runner / child PID / PGID |
|---|---|---|---|---|
| final-head-governance | `npm run governance:check` | lint扫描1816文件，4 current / 0 new violations；architecture扫描1662文件，139 current / 0 new violations | 0 / true | 92323 / 92349 / 92349 |
| final-head-architecture | `npm run architecture:check -- --changed` | architecture扫描877文件，124 current / 0 new violations | 0 / true | 92618 / 92629 / 92629 |

这里的通过意味着既有baseline规则下没有新增违规；不将current违规写成零，也不将这两条源代码检查外推为所有测试/产物/发布通过。两次退出后按各自登记PGID核验组内剩余均0，未手动kill或操作共享服务。

证据SHA256：

- `final-head-governance.log`：`c1db5bd6eae9b41eea11bcab8be748a8b2b2e4f83bf2d68f3b39c8bf4c14578b`
- `final-head-governance.json`：`c195edc4d8b301257d66699e20f3c24b294d83d31212b865ad8b0ac2c6573391`
- `final-head-architecture.log`：`297840733eb9fcc5b1fb3291110b74ca00054d07937d9952946777489b264c39`
- `final-head-architecture.json`：`9062d6fb3ebeff3db8c85fc7987651c34ebe9b034aaec4d70b050bcf92e3212e`
