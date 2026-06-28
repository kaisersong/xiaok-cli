---
inclusion: always
---

# Desktop 本地构建默认流程

当用户要求"本地构建 / 构建 desktop / 打个包来体验"且没有特别说明时，默认执行：
**构建 → 拷到 `/Applications` → 启动**，而不是只 build 完就停。

## 默认步骤

```bash
cd desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
```

**本地构建默认不签名**：用 `CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭 electron-builder 的
代码签名身份自动发现，避免本机钥匙串里的证书触发签名/公证流程，构建更快也不弹授权。
签名只在正式 release 流程里做，本地体验一律不签名。

`pack:dir` 会 `build:icon` + `build:clean` + `electron-builder --dir`，产物是未压缩的
`.app`，落在 `desktop/release/` 下按架构分目录（Apple Silicon 为 `release/mac-arm64/`，
Intel 为 `release/mac/`）。productName 是 `xiaok`，所以 app 名为 `xiaok.app`。

构建完成后，把 app 部署到 `/Applications` 再启动：

```bash
# 在 desktop 目录下，自动定位刚构建出的 .app（兼容 mac-arm64 / mac）
APP_PATH="$(/bin/ls -d release/mac*/xiaok.app 2>/dev/null | head -1)"
# 先关掉正在运行的旧实例，避免拷贝时占用
osascript -e 'quit app "xiaok"' 2>/dev/null || true
rm -rf "/Applications/xiaok.app"
cp -R "$APP_PATH" "/Applications/xiaok.app"
open "/Applications/xiaok.app"
```

## 注意

- 本地构建默认**不签名**（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。签名/公证只在正式 release 做。
- 拷贝到 `/Applications` 前先退出正在运行的旧 `xiaok` 实例，否则可能拷贝失败或启动到旧进程。
- 这些是 macOS 专有命令（`open`、`osascript`、`.app` bundle），仅在 `process.platform === 'darwin'`
  / 本机 macOS 下执行；不要写进跨平台代码路径。
- 只想快速验证渲染层时可以用 `npm run dev`；但用户说"构建/打包/体验"时按上面的"构建→/Applications→启动"全流程走。
- 如果 `release/mac*/xiaok.app` 不存在，说明 `pack:dir` 没成功，先排查构建错误，不要静默跳过部署。
