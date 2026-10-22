# B席：最终CLI source bundle相关测试与单文件恢复

日期：2026-10-22。结论：**修复后8/8通过；C席已独立只读APPROVE该单文件恢复。** 本票不是打包、签名、安装或发布验收。

## 冻结基线，保留原失败

指定clean master基线为完整SHA `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`，独立baseline worktree tracked状态干净。执行时MERGE_HEAD也仍为该SHA。共享`origin/master`被其他会话fetch移动到较新的`6770092945a42fb0e45ef0d68d0971bfc01b51a8`，因此不以可变ref替代本轮指定基线。

我最初读`git diff origin/master`就推断“clean master不是pin1.5.9”，尚未核固定3b406148便发了预判；**该预判错误，已向主笔纠正**。固定SHA原文与实际基线运行均确认pin1.5.9。不能把该项说成PR74独有回归，也不能说clean baseline已绿。

## 原命令与红测

两组完全相同argv：

```text
node --test tests/package/cli-source-bundle.test.mjs
```

`final-cli-source-bundle` cwd为任务worktree根；`cli-source-bundle-baseline` cwd为detached `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1` worktree根。两组均**8项中7通过、1失败，exit1，0skip**。同名失败为 `merged manifest preserves native source lifecycle and all original helper build gates`；实际错误均：

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
'1.5.15' !== '1.5.9'
actual: '1.5.15'
expected: '1.5.9'
operator: 'strictEqual'
```

当前/基线原始红log/json均保留原样，没有更新断言来伪装原baseline通过。固定基线测试文件SHA256为 `468faa83144f8e33f9df5011fa1725e21d74c4c9a3411990585963c2ac4bb1a5`。

## 经明确授权的精确恢复与暂存

主笔在读取差异后明确授权恢复较新主干的动态版本一致性契约。本席只修改并`git add -- tests/package/cli-source-bundle.test.mjs`暂存该单文件；不动其他源文件或已存在merge暂存内容。

相对冻结基线的唯一改动：

```diff
-  assert.equal(manifest.version, '1.5.9');
+  const desktopManifest = JSON.parse(await readFile(join(packageRoot, 'desktop', 'package.json'), 'utf8'));
+  assert.equal(manifest.version, desktopManifest.version);
```

不是把断言换成当前1.5.15，也没有删除版本要求。全部native source lifecycle、postinstall/prepack、build gates、文件列表、依赖pin、lock一致性以及唯一tar key检查保留。

修复后全文件与冻结较新主干 `6770092945a42fb0e45ef0d68d0971bfc01b51a8` **精确相同：true**；工作树与index暂存内容**精确相同：true**。当前/较新主干/index测试文件SHA256：`2f2ea206e1f59b70fd45fc00c9b1e4f2f656396d5bc177964dd78cc38ceec930`。`git diff --check -- tests/package/cli-source-bundle.test.mjs`无输出。

## 修复后实际复验

`final-cli-source-bundle-fixed`仍用相同argv/cwd，结果**8 passed / 0 failed / 0 skipped，exit0**。原native binary拒绝、错误installer版本拒绝、prepack直接源码拒绝、三种缺universal native input拒绝、manifest生命周期/原helper gate与lock检查全部实际执行。

测试内部仅在私有fixture运行生产entry的提前拒绝路径，并逐字节/mode盘点确保失败无输出；没有实际生成产品包。本席未运行npm pack/pack:cli、签名、安装、发布或修改共享4400服务。

实际Node版本日志`final-package-node-version.log`为 `v24.16.0`，exit0。

## C席独立复核

已将实际diff、冻结两个SHA、两组原红和修复green证据送`/root/pi_review_value`。C席回复**APPROVE**：已独立核冻结3b406148的两行恢复、冻结677全文件diff为空及文件SHA、原两组7pass1fail、修复8pass0fail/exit0/reaped；确认native lifecycle/lock检查保留，不能称基线绿、PR74独有回归或产品打包验收。本票不把独立agent会话称为不同模型身份。

## 原始证据与收尾

| label | runner PID | child PID/PGID | exit | reaped | 登记PGID当前剩余 |
|---|---:|---|---:|---|---:|
| `final-cli-source-bundle` | 72664 | 72681/72681 | 1 | True | 0 |
| `cli-source-bundle-baseline` | 73450 | 73466/73466 | 1 | True | 0 |
| `final-cli-source-bundle-fixed` | 77188 | 77196/77196 | 0 | True | 0 |
| `final-package-node-version` | 78747 | 78755/78755 | 0 | True | 0 |

- `final-cli-source-bundle.log` SHA256 `d42e3355d75c6e8ce48fbabc125826f5071aab57cd479f87664c6089cd683791`；`final-cli-source-bundle.json` SHA256 `307cd146934f70908493ec4acfcc3340729317df8178432a76f4269bb394a40b`。
- `cli-source-bundle-baseline.log` SHA256 `0063a25a164e88726bc902b119fb2c494cec2254b52e0c162decb12486335df9`；`cli-source-bundle-baseline.json` SHA256 `1775cfa2818db44285d88dbefee7ebfc50f166511765ab103fc5f1d47e20c4fb`。
- `final-cli-source-bundle-fixed.log` SHA256 `bcc4f4363ae00733857c533ca579e77ba7a9359428d5d480fcfdef49c3db8fad`；`final-cli-source-bundle-fixed.json` SHA256 `f679dbdb78fbd8c3445760d659117e5ff8ef55173731b561c97d95763d87f50e`。
- `final-package-node-version.log` SHA256 `a8f8f7ba69d43285857a0ea34017ef8dadd3ba012404bb7dd188fc773cf63ee2`；`final-package-node-version.json` SHA256 `966e8e301be6e2a2b4a66a854f8dcf5b1c6084a7a33522225a261af11ae012c9`。

仅按这些owned记录PGID检查，全部组内剩余0；没有手动kill，没有以命令名匹配清理，也不宣称全机未知detached进程残留0。原红和baseline未覆写。后续其他测试、整体全量、CI与产品包验收保持各自证据边界，不能由本次8/8替代。
