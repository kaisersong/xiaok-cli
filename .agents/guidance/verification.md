# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## Desktop 验证

- desktop main / service / scheduler:
  ```bash
  cd desktop
  npm run test -- --run tests/main/<target>.test.ts
  npm run build:main
  ```
- preload / IPC contract:
  ```bash
  cd desktop
  npm run test -- --run tests/main/preload-contract.test.ts tests/main/preload-sandbox.test.ts
  npm run build:main
  ```
- renderer UI / hooks / context:
  ```bash
  cd desktop
  npm run test -- --run tests/renderer/<target>.test.tsx
  npm run build:renderer
  ```
- cross-layer desktop 改动：
  ```bash
  cd desktop
  npm run test -- --run tests/main/<target>.test.ts tests/renderer/<target>.test.tsx
  npm run build:main
  npm run build:renderer
  ```
- typecheck:
  ```bash
  cd desktop
  npm run typecheck
  ```
- packaging 相关改动：
  ```bash
  cd desktop
  npm run build
  ```
  必要时再跑：
  ```bash
  cd desktop
  npm run pack:dir
  ```
- 本地打包**禁止签名**。`npm run pack:dir` 默认会触发 codesign，本机 keychain 经常 `errSecInternalComponent` 失败，且本地验证不需要签名。本地验证使用：
  ```bash
  cd desktop
  CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --dir \
    --config electron-builder.json \
    -c.mac.identity=null \
    -c.win.signAndEditExecutable=false
  ```
  仅在需要正式发布产物时才允许签名。
- `desktop` 的 `typecheck` 使用 baseline；不要因为无关历史错误更新 baseline。只有本次改动确实需要改变 baseline 时，才说明原因并更新。


## CLI / Sandbox 验证说明

- 在 Codex sandbox 中，raw `vitest` 跑 TypeScript source 可能因为 Vite / esbuild 启动 child process 出现 `spawn EPERM`。
- CLI 侧优先使用 `npm test` 或 `npm run test:sandbox`，它会先把 `src/` 和 `tests/` 编译到 `.test-dist/`，再用 `vitest.sandbox.config.mjs` 跑 emitted JavaScript。
- reminder / daemon suites 会打开真实 Unix socket；受限 sandbox 中可能出现 `listen EPERM`。需要 full pass signal 时，在 unrestricted 环境重跑。
- sandbox suite 会排除依赖 subprocess 的测试，例如 `bash` 和 `grep`；完整套件在非受限机器跑 `npm run test:full`。
