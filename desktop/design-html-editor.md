# Desktop HTML 直接编辑设计方案

> 状态：V2 — 四方对抗性评审后修订版
> 日期：2026-06-25
> 评审方：QoderCLI（IPC/安全）、xiaok-desktop（产品架构）、kiro-cli（spec/测试）、Qoder（综合）
> 关联：Canvas Preview, kai-report-creator, kai-slide-creator, ArtifactEditableViewer

## 1. 动机与目标

当前 xiaok desktop 的报告/幻灯片 HTML 预览仅支持"annotation"模式：用户标注区域 → 告诉 AI → AI 重新生成。专业用户希望直接编辑文本、替换图片、调整样式，无需等待 AI 回合。

**目标用户场景**：
- AI 生成报告后，用户直接修正标题措辞、替换数据图表、微调排版
- AI 生成幻灯片后，用户替换 logo/图片、调整字体颜色、删除冗余元素
- 快速迭代：直接编辑 → 保存 → 继续对话让 AI 基于已编辑版本进一步优化

**非目标**：
- 不做完整的 WYSIWYG 富文本编辑器（不引入 ProseMirror/Slate/TinyMCE）
- 不做拖拽布局 / 自由画布
- 不做 CSS 可视化编辑器（只暴露常用样式属性）

## 2. 参考方案分析（open-design）

open-design 的 ManualEdit 系统核心架构：

```
iframe (sandbox) ←→ postMessage bridge ←→ Host React UI (Inspector Panel)
       ↕                                         ↕
  data-od-id annotation               DOMParser patch pipeline
  element discovery                    source-patches.ts
  hover/select highlighting            applyManualEditPatch(source, patch)
```

**值得借鉴**：
1. DOMParser-based source patching（无需编辑器引擎，HTML in → patch → HTML out）
2. postMessage bridge 与 iframe 沙箱通信
3. 10 种 patch kind 覆盖常见编辑需求
4. Runtime override script 注入实现即时预览
5. 元素自动标注 `data-*-id` + 可编辑元素发现规则

**xiaok 已有等价实现**：
- iframe sandbox 渲染 ✅（ArtifactEditableViewer + ArtifactIframe）
- postMessage bridge ✅（artifact-sdk.ts, 已有 xiaok:annotation 协议）
- 文件备份/恢复 ✅（artifact-editing.ts, FIFO 5 份）
- Canvas Panel UI 框架 ✅

**需要新建**：
- 编辑模式桥接脚本（element discovery + hover/select + edit commit）
- Source patching 管道（DOMParser patch）
- 编辑器 Inspector 面板 UI
- 图片上传 IPC（本地文件 → base64/dataURL 或 local asset path）
- 编辑历史（undo/redo stack）

## 3. 架构设计

### 3.1 整体分层

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React)                                            │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │ Canvas Panel │  │ EditInspectorPanel                    │ │
│  │ (existing)   │  │  ├─ TextEditor (textarea)            │ │
│  │              │  │  ├─ ImageEditor (picker + alt)        │ │
│  │              │  │  ├─ LinkEditor (text + href)          │ │
│  │              │  │  ├─ StyleEditor (常用 CSS props)      │ │
│  │              │  │  ├─ SourceEditor (outerHTML textarea) │ │
│  │              │  │  └─ UndoRedo toolbar                  │ │
│  └──────┬───────┘  └──────────────┬───────────────────────┘ │
│         │                         │                          │
│         │    postMessage          │  applyPatch()            │
│         ▼                         ▼                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ iframe (sandbox="allow-scripts")                      │   │
│  │  ├─ edit-bridge.js (injected)                         │   │
│  │  │   ├─ annotateEditableElements()                    │   │
│  │  │   ├─ hover highlight (outline)                     │   │
│  │  │   ├─ click → select → report target                │   │
│  │  │   └─ applyRuntimeOverride (live preview)           │   │
│  │  └─ user's HTML content                               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │
         │ IPC (via preload)
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Main Process                                                │
│  ├─ writeFileContent(path, html)  — 保存编辑后的 HTML        │
│  ├─ artifactBackup(path)          — 编辑前备份（已有）       │
│  ├─ pickLocalImage()              — 打开文件选择器选图片     │
│  ├─ copyImageToAssets(srcPath)    — 复制到项目 assets 目录   │
│  └─ readFileContent(path)         — 读取当前文件（已有）     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 编辑模式状态机

```
preview ──[点击"编辑"按钮]──► editing
   ▲                              │
   │                              ├─ hover: highlight elements
   │                              ├─ click: select element → show inspector
   │                              ├─ edit field → applyPatch → live preview
   │                              │
   │   [点击"保存"]               │   [点击"取消"]
   │◄──── saved ◄────────────────┤◄──── reverted
   │        │                     │
   │        └─ writeFile          └─ artifactRevert
   │
   └──[annotation mode stays separate]
```

### 3.3 Patch 数据模型

```typescript
// desktop/renderer/src/lib/html-edit/types.ts

type EditableElementKind = 'text' | 'link' | 'image' | 'container';

interface EditTarget {
  id: string;           // data-xk-edit-id (auto-assigned)
  kind: EditableElementKind;
  tagName: string;
  text: string;         // innerText for text/link, alt for image
  rect: DOMRect;        // bounding box for positioning inspector
  src?: string;         // image src
  href?: string;        // link href
  outerHtml?: string;   // for container/source editing
  styles: Record<string, string>;  // computed relevant styles
}

type PatchKind =
  | 'set-text'       // { text: string }
  | 'set-link'       // { text: string, href: string }
  | 'set-image'      // { src: string, alt: string }
  | 'set-style'      // { property: string, value: string }[]
  | 'set-outer-html' // { html: string }
  | 'remove-element' // {}
  ;

interface EditPatch {
  targetId: string;
  kind: PatchKind;
  payload: Record<string, unknown>;
}

interface EditHistoryEntry {
  patch: EditPatch;
  beforeSource: string;  // for undo
  afterSource: string;
}
```

### 3.4 Source Patching 管道

```typescript
// desktop/renderer/src/lib/html-edit/source-patcher.ts

export function applyEditPatch(source: string, patch: EditPatch): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, 'text/html');
  const el = doc.querySelector(`[data-xk-edit-id="${patch.targetId}"]`);
  if (!el) return source;

  switch (patch.kind) {
    case 'set-text':
      el.textContent = patch.payload.text as string;
      break;
    case 'set-link':
      el.textContent = patch.payload.text as string;
      (el as HTMLAnchorElement).href = patch.payload.href as string;
      break;
    case 'set-image':
      (el as HTMLImageElement).src = patch.payload.src as string;
      (el as HTMLImageElement).alt = patch.payload.alt as string;
      break;
    case 'set-style':
      for (const { property, value } of patch.payload.entries as Array<{property: string, value: string}>) {
        (el as HTMLElement).style.setProperty(property, value);
      }
      break;
    case 'set-outer-html':
      el.outerHTML = patch.payload.html as string;
      break;
    case 'remove-element':
      el.remove();
      break;
  }

  return serializeDocument(doc, source);
}
```

### 3.5 iframe 编辑桥接脚本

注入到 iframe 的脚本，负责：
1. **标注可编辑元素**：遍历 DOM，为符合条件的元素添加 `data-xk-edit-id`
2. **Hover 高亮**：鼠标悬停时显示蓝色虚线边框
3. **Click 选中**：点击元素后上报 `EditTarget` 给 host
4. **Live override**：接收 host 的 patch 预览指令，即时修改 DOM（不写文件）

可编辑元素规则：
```
h1-h6, p, span, a, button, img, li, td, th, blockquote,
figcaption, label, strong, em, small, mark, pre > code
+ 容器：section, article, div（有直接文本子节点或单一用途时）
```

排除规则：
- `<script>`, `<style>`, `<meta>`, `<link>`
- 带 `data-xk-no-edit` 属性的元素
- 不可见元素（`display:none`, `visibility:hidden`）

### 3.6 图片处理

```
用户点击图片元素 → Inspector 显示当前 src + alt
                → "选择图片" 按钮
                     │
                     ▼
              IPC: pickLocalImage()
              → main process: dialog.showOpenDialog({ filters: ['Images'] })
              → 返回文件路径
                     │
                     ▼
              IPC: copyImageToAssets(srcPath, targetDir)
              → main process:
                  1. 确定 assets 目录（与 HTML 文件同级的 assets/ 子目录）
                  2. 复制文件到 assets/<filename>
                  3. 返回相对路径 "assets/<filename>"
                     │
                     ▼
              applyPatch({ kind: 'set-image', src: relativePath, alt })
              → live preview + 写入 source
```

**编辑时存储策略**：
- 所有用户插入的图片统一复制到 HTML 同级 `assets/` 目录，HTML source 中写入相对路径 `assets/<filename>`
- iframe 预览时由 main process 将相对路径解析为 base64 dataURL 注入（sandbox 限制）
- 已有网络 URL 的图片：保持不变，除非用户主动替换

**导出策略（C+B 混合方案）**：
- **小图（< 200KB）**：导出时 base64 内联到 HTML，产出单文件自包含 HTML
- **大图（≥ 200KB）**：保持为外部文件引用，导出为 ZIP 包（HTML + assets/ 目录）
- **判断逻辑**：导出时扫描 HTML 中所有 `<img src="assets/...">` 引用：
  - 如果所有图片均 < 200KB → 导出为单文件 HTML（全部 base64 内联）
  - 如果存在任一图片 ≥ 200KB → 导出为 ZIP（`report.zip` 包含 `index.html` + `assets/`）
- **导出 UI**：用户点击导出时显示预估体积 + 导出格式（单文件/ZIP），不用选择
- **网络图片处理**：`https://` 引用在导出时保持原样（不下载），除非用户选择"离线导出"

```typescript
// electron/html-export.ts

interface ExportResult {
  format: 'html' | 'zip';
  filePath: string;
  totalSize: number;
}

async function exportEditedHtml(htmlFilePath: string, outputDir: string): Promise<ExportResult> {
  const source = await fs.readFile(htmlFilePath, 'utf-8');
  const assetsDir = path.join(path.dirname(htmlFilePath), 'assets');
  const localImages = extractLocalImageRefs(source); // assets/xxx.png 引用列表

  const hasLargeImage = await Promise.all(
    localImages.map(async (ref) => {
      const stat = await fs.stat(path.join(path.dirname(htmlFilePath), ref));
      return stat.size >= 200 * 1024;
    })
  ).then(results => results.some(Boolean));

  if (!hasLargeImage) {
    // 全部内联 → 单文件 HTML
    const inlined = await inlineAllLocalImages(source, path.dirname(htmlFilePath));
    const outPath = path.join(outputDir, path.basename(htmlFilePath));
    await fs.writeFile(outPath, inlined, 'utf-8');
    return { format: 'html', filePath: outPath, totalSize: Buffer.byteLength(inlined) };
  } else {
    // ZIP 打包
    const zipPath = path.join(outputDir, path.basename(htmlFilePath, '.html') + '.zip');
    await createZipPackage(htmlFilePath, assetsDir, localImages, zipPath);
    const stat = await fs.stat(zipPath);
    return { format: 'zip', filePath: zipPath, totalSize: stat.size };
  }
}
```

### 3.7 IPC 新增接口

```typescript
// 新增到 preload-api.ts DesktopApi

interface DesktopApi {
  // ... existing ...

  // HTML 编辑相关
  pickLocalImage(): Promise<{ cancelled: boolean; filePath?: string; dataUrl?: string }>;
  copyImageToAssets(srcPath: string, htmlFilePath: string): Promise<{ relativePath: string }>;
  saveHtmlContent(filePath: string, content: string): Promise<void>;
}
```

注意：`readFileContent` 和 `artifactBackup` 已有，无需新增。

### 3.8 UI 交互设计

**进入编辑模式**：Canvas Panel toolbar 新增"编辑"按钮（铅笔图标），与现有"标注"按钮并列。

**Inspector Panel**：
- 浮动面板，出现在 Canvas Panel 右侧或选中元素附近
- 根据 `target.kind` 显示不同编辑器：
  - **text**: 多行 textarea + 字体大小/颜色/粗细快捷调整
  - **image**: 缩略图 + src 输入 + "选择图片"按钮 + alt 输入
  - **link**: text 输入 + href 输入
  - **container**: outerHTML textarea（高级用户）
- 底部工具栏：Undo / Redo / 删除元素 / 保存 / 取消

**视觉反馈**：
- 编辑模式下，可编辑元素 hover 显示蓝色虚线边框
- 选中元素显示蓝色实线边框
- 已修改但未保存的文件在 tab 标题显示圆点标记

### 3.9 Undo/Redo

- 纯前端状态，基于 `EditHistoryEntry[]` 栈
- 每次 `applyPatch` 记录 `{ patch, beforeSource, afterSource }`
- Undo：回退到 `beforeSource`，重新渲染 iframe
- Redo：前进到 `afterSource`
- 栈深度限制：50 步
- 保存后清空历史（或标记保存点）

### 3.10 与现有系统的集成

**与 annotation 模式共存**：
- toolbar 切换：preview / annotate / edit 三态互斥
- 编辑模式下，annotation 功能暂停
- 编辑保存后，annotation 模式恢复可用

**与 AI 对话流的集成**：
- 用户编辑保存后，下次 AI 对话自动使用新版 HTML 作为上下文
- 可选：保存时生成一条系统消息"用户手动编辑了报告，以下是变更摘要"

**与文件监听的集成**：
- `artifactWatch` 已有文件变更监听
- 编辑模式下暂停外部变更通知（避免自己写的变更触发刷新循环）

## 4. 文件结构

```
desktop/renderer/src/
├── lib/html-edit/
│   ├── types.ts              — EditTarget, EditPatch, PatchKind
│   ├── source-patcher.ts     — applyEditPatch(source, patch)
│   ├── serialize.ts          — serializeDocument(doc, originalSource)
│   ├── edit-bridge-script.ts — 注入 iframe 的桥接脚本（字符串模板）
│   └── editable-elements.ts  — 可编辑元素发现规则
├── components/
│   ├── HtmlEditInspector.tsx  — Inspector 面板主组件
│   ├── TextEditField.tsx      — 文本编辑子组件
│   ├── ImageEditField.tsx     — 图片编辑子组件
│   ├── LinkEditField.tsx      — 链接编辑子组件
│   ├── StyleEditField.tsx     — 样式编辑子组件
│   ├── SourceEditField.tsx    — HTML 源码编辑子组件
│   └── EditToolbar.tsx        — Undo/Redo/Save/Cancel 工具栏
├── hooks/
│   └── useHtmlEdit.ts         — 编辑状态管理 hook
desktop/electron/
├── html-edit-ipc.ts           — 图片选择/复制/保存 IPC handlers
```

## 5. 安全考量

1. **iframe sandbox 不变**：编辑模式下 sandbox 权限不提升，仍为 `allow-scripts`
2. **postMessage origin 校验**：桥接脚本验证 message source
3. **HTML 注入防护**：`set-text` patch 中 textContent 赋值天然转义 HTML
4. **图片路径限制**：`copyImageToAssets` 只允许复制到 HTML 文件同级子目录，不允许路径穿越
5. **文件写入范围**：`saveHtmlContent` 只允许写入已知的 artifact 路径（需要路径白名单校验）

## 6. 分期实施计划

### Phase 1（MVP）— 预估 3-4 天
- [ ] 编辑桥接脚本（元素发现 + hover/select + target 上报）
- [ ] Source patching 管道（set-text, set-image, set-link）
- [ ] Inspector 面板 UI（text + image 编辑）
- [ ] Canvas toolbar "编辑"按钮 + 模式切换
- [ ] 保存到文件 IPC
- [ ] 基础 undo/redo

### Phase 2 — 预估 2-3 天
- [ ] 图片本地选择 + 复制到 assets
- [ ] 样式编辑（字体、颜色、间距）
- [ ] outerHTML 源码编辑
- [ ] 删除元素
- [ ] 编辑状态持久化（未保存提示）

### Phase 3 — 预估 2 天
- [ ] 与 AI 对话流集成（编辑后变更摘要注入上下文）
- [ ] 幻灯片特殊处理（slide navigation + per-slide 编辑）
- [ ] 导出编辑后的 HTML/PDF

## 7. 测试策略

- **单元测试**：source-patcher 各 patch kind 的正确性（DOMParser round-trip）
- **组件测试**：Inspector 面板各 field 的交互
- **集成测试**：iframe bridge postMessage 通信
- **IPC contract 测试**：pickLocalImage / copyImageToAssets / saveHtmlContent
- **E2E 场景**：打开报告 → 进入编辑 → 修改文本 → 保存 → 验证文件内容

## 8. 开放问题

1. **编辑粒度 vs 源码保真度**：DOMParser 序列化会丢失原始 HTML 格式（缩进、注释）。是否需要 regex-based 局部替换来保留格式？
2. **多人协作**：当前是单用户场景，暂不考虑协作编辑冲突
3. **大文件性能**：报告 HTML 可能很大（100KB+），DOMParser 性能是否足够？
4. **与 MCP plugin 的交互**：编辑后的 HTML 如何与 report-renderer 的主题/模板系统保持兼容？

---

## 附录 A：与 open-design 的差异对比

| 维度 | open-design | xiaok desktop |
|---|---|---|
| 编辑器定位 | AI 设计工作台的辅助功能 | AI 生成物的快速微调 |
| iframe 来源 | 项目文件系统 | 磁盘 HTML 文件 |
| patch 持久化 | 写回项目文件 | 写回原 HTML 文件 |
| 图片存储 | dataURL / library | assets 目录 + 相对路径 |
| 品牌系统 | od-brand-payload JSON | 无（HTML 自包含） |
| token 编辑 | CSS variable 编辑 | 暂不支持 |
| sketch 叠加层 | 画笔/箭头/文字标注 | annotation 模式（已有） |
| 协作 | 单用户 | 单用户 |

---

## 附录 B：四方对抗性评审结果与修订决策

### B.1 评审汇总（按严重等级排序）

| # | 问题 | 提出方 | 等级 | 决策 |
|---|---|---|---|---|
| 1 | IPC 路径穿越（saveHtmlContent/copyImageToAssets） | QoderCLI | **Critical** | 修订：合并为单一安全 IPC |
| 2 | iframe sandbox 不可升级（禁止 allow-same-origin） | QoderCLI | **High** | 修订：写入不可变安全策略 |
| 3 | fs.watch 竞态（编辑写入 vs watcher 循环） | QoderCLI | **High** | 修订：write guard + edit lock |
| 4 | DOMParser 序列化丢失源码保真度 | QoderCLI + kiro-cli | **High** | 修订：采用 regex 局部替换方案 |
| 5 | IR hash 失效 / re-render 不可逆 | xiaok-desktop | **High** | 修订：structural protection + 编辑标记 |
| 6 | AI 上下文断裂（编辑后 AI 不知变更） | xiaok-desktop | **High** | 修订：patch summary 注入协议 |
| 7 | edit-bridge 与 ARTIFACT_SDK_CODE 脚本冲突 | QoderCLI + kiro-cli | **Medium** | 修订：扩展现有 SDK 而非新增脚本 |
| 8 | data-xk-edit-id 生命周期矛盾 | kiro-cli | **High** | 修订：运行时 Map，不写入 source |
| 9 | PostMessage 协议不完整 | kiro-cli | **Medium** | 修订：补充协议表 |
| 10 | set-outer-html XSS + data-xk-edit-id 泄露 | QoderCLI | **High** | 修订：DOMPurify + strip |
| 11 | Phase 1 可用性（未保存丢失 + 模式切换无守卫） | kiro-cli | **Medium** | 修订：Phase 1 加入 dirty guard |
| 12 | Slide 编辑方案不成熟 | xiaok-desktop | **Medium-High** | 修订：Phase 1 排除 slide |
| 13 | Undo stack 内存开销 | QoderCLI + kiro-cli | **Medium** | 修订：diff-based 存储 |
| 14 | 状态机组合爆炸 | QoderCLI | **Medium** | 修订：拆分独立 context |

### B.2 修订决策详情

#### 决策 1：IPC 安全架构（Critical → 解决）

**原方案**：三个独立 IPC（pickLocalImage / copyImageToAssets / saveHtmlContent）

**修订后**：
- `pickLocalImage` 改为 `pickAndEmbedImage(htmlFilePath)`：main process 内部完成选择 + 复制 + 返回相对路径。renderer 永远不传源文件路径。
- `saveHtmlContent` 复用已有 `desktop:saveFile` 但在 handler 中增加安全校验层：

```typescript
// main process handler 安全校验
function validateHtmlWritePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const real = fs.realpathSync(path.dirname(resolved)); // symlink 解析
  const allowedRoots = [
    path.join(getConfigDir(), 'tasks'),
    path.join(os.homedir(), '.xiaok', 'tasks'),
    // kswarm project output dirs 动态获取
    ...getActiveProjectOutputDirs(),
  ];
  return (
    path.isAbsolute(resolved) &&
    ['.html', '.htm'].includes(path.extname(resolved).toLowerCase()) &&
    allowedRoots.some(root => real.startsWith(root + path.sep)) &&
    !resolved.includes('node_modules') &&
    !path.basename(resolved).startsWith('.')
  );
}
```

- **Negative test 必备**：路径穿越（`../../etc/passwd`）、symlink 攻击、UNC 路径、无扩展名文件。
- 不新增 IPC channel，扩展已有 handler + 新增校验中间件。

#### 决策 2：iframe sandbox 不可变策略

**写入设计文档的不可变约束**：
> **安全红线**：任何 PR 添加 `allow-same-origin` 到编辑模式 iframe 必须被阻止。
> 图片相对路径问题通过 main process 代理解决（base64 注入或 blob URL 传递），
> 不通过提升 sandbox 权限解决。

图片加载方案：
1. 编辑模式构建 blob URL 前，将 HTML 中的相对图片路径预解析为 base64 dataURL（< 200KB）或 blob URL
2. 保存时将 base64/blob 转回相对路径
3. 图片预处理在 main process 完成，通过 IPC 传递给 renderer

#### 决策 3：Write Guard + Edit Lock

```typescript
// electron/artifact-editing.ts 新增

const editLocks = new Map<string, { sessionId: string; since: number }>();

export function acquireEditLock(filePath: string, sessionId: string): boolean {
  const existing = editLocks.get(filePath);
  if (existing && existing.sessionId !== sessionId) return false;
  editLocks.set(filePath, { sessionId, since: Date.now() });
  return true;
}

export function releaseEditLock(filePath: string, sessionId: string): void {
  const existing = editLocks.get(filePath);
  if (existing?.sessionId === sessionId) editLocks.delete(filePath);
}

export function isEditLocked(filePath: string): boolean {
  return editLocks.has(filePath);
}
```

- 编辑模式进入 → `acquireEditLock`
- 编辑模式退出 → `releaseEditLock`
- `artifactWatch` 的 onChange 中：如果 `isEditLocked(filePath)` → 跳过通知
- AI task executor 写入文件前：如果 `isEditLocked` → 排队或返回冲突错误给 runtime

#### 决策 4：源码保真度 — 局部替换方案（不用 DOMParser 全量序列化）

**核心原则**：只修改被编辑元素的精确字节范围，保持其余文件逐字节不变。

```typescript
// source-patcher.ts 修订方案

export function applyEditPatch(source: string, patch: EditPatch, elementMap: ElementPositionMap): string {
  const pos = elementMap.get(patch.targetId);
  if (!pos) return source;

  switch (patch.kind) {
    case 'set-text': {
      // 定位元素 innerHTML 的起止位置，替换 textContent
      const { innerStart, innerEnd } = pos;
      const escaped = escapeHtml(patch.payload.text as string);
      return source.slice(0, innerStart) + escaped + source.slice(innerEnd);
    }
    case 'set-image': {
      // 定位 <img> 的 src 和 alt 属性值，原地替换
      return replaceAttribute(source, pos, 'src', patch.payload.src as string)
        |> (s => replaceAttribute(s, pos, 'alt', patch.payload.alt as string));
    }
    // ... 其他 kind 类似
    case 'set-outer-html':
    case 'remove-element':
      // 仅这两种使用 DOMParser round-trip（接受格式变化）
      return domParserFallback(source, patch);
  }
}

// ElementPositionMap: 在 iframe 中扫描 DOM 时计算每个元素在 source 中的字节偏移
// 通过 postMessage 传递给 host
```

**ElementPositionMap 计算方式**：
- iframe edit-bridge 加载时，对每个可编辑元素记录其 `outerHTML` 字符串
- host 通过 `source.indexOf(outerHTML)` 定位（在大多数情况下唯一；冲突时用前后文上下文辅助定位）
- 性能：只在进入编辑模式时计算一次，编辑过程中根据 patch 增量更新偏移

#### 决策 5：Structural Element Protection

```typescript
// editable-elements.ts

const PROTECTED_IDS = [
  'toc-toggle-btn', 'card-mode-btn', 'ai-summary-btn',
  'export-btn', 'export-menu', 'edit-hotzone',
  // ... report-creator L0-L3 required IDs
];

const PROTECTED_SELECTORS = [
  '[data-export-role]',
  '[data-export-progress]',
  'script', 'style', 'meta', 'link',
  '.nav-dots', '.progress-bar', '.slide-nav',
  '[id^="export-"]',
];

function isProtectedElement(el: HTMLElement): boolean {
  if (PROTECTED_IDS.includes(el.id)) return true;
  if (PROTECTED_SELECTORS.some(sel => el.matches(sel))) return true;
  if (el.hasAttribute('data-xk-no-edit')) return true;
  return false;
}
```

保存时追加编辑标记：
```html
<meta name="xk-manual-edit" content="true" data-edit-time="2026-06-25T10:30:00Z">
```

#### 决策 6：AI 上下文注入协议

保存时自动生成 context message：

```typescript
interface EditChangesetMessage {
  type: 'system';
  role: 'system';
  content: string; // 格式化的变更摘要
  metadata: {
    kind: 'manual_edit_changeset';
    filePath: string;
    patchCount: number;
    editTime: string;
  };
}

// 变更摘要格式示例：
// "用户手动编辑了 /path/to/report.html：
//  - 标题 h1: "旧标题" → "新标题"
//  - 图片 img#chart1: src 已替换
//  - 段落 p.intro: 文本已修改
// 后续对话请基于当前文件版本工作，保留用户的编辑内容。"
```

Token budget 策略：
- patch 数量 ≤ 10：注入完整 patch list
- patch 数量 > 10：只注入 summary（"用户修改了 N 处文本、M 张图片"）+ 文件 hash
- 连续多次编辑：合并压缩为一条 changeset

#### 决策 7：edit-bridge 与 ARTIFACT_SDK_CODE 的关系

**结论：扩展现有 ARTIFACT_SDK_CODE，不新增独立脚本。**

在现有 `artifact-sdk.ts` 中增加 edit mode：
- 收到 `xiaok:setEditMode(true)` → 激活编辑行为（hover 高亮、click 上报 EditTarget）
- 收到 `xiaok:setEditMode(false)` → 退回 annotation/preview 行为
- 复用已有的 hover/click 基础设施
- 新增 `data-xk-edit-id` 运行时标注（仅在 edit mode 激活时添加）

文件结构调整：
```
desktop/renderer/src/
├── lib/html-edit/
│   ├── types.ts
│   ├── source-patcher.ts
│   └── editable-elements.ts    — 元素发现规则（导出给 artifact-sdk 使用）
├── lib/artifact-sdk.ts          — 扩展：新增 edit mode 逻辑
├── components/html-edit/        — 编辑组件子目录
│   ├── HtmlEditInspector.tsx
│   ├── TextEditField.tsx
│   ├── ImageEditField.tsx
│   ├── LinkEditField.tsx
│   ├── StyleEditField.tsx
│   ├── SourceEditField.tsx
│   └── EditToolbar.tsx
├── hooks/
│   └── useHtmlEdit.ts
```

#### 决策 8：data-xk-edit-id 生命周期

**结论：运行时 WeakMap，不写入 HTML source。**

- iframe edit-bridge 使用 `WeakMap<HTMLElement, string>` 维护 element → id 映射
- id 生成：元素的 tagName + textContent 前 20 字符的 hash + DOM 路径 index
- postMessage 上报 target 时携带 id
- host 侧的 `ElementPositionMap` 通过 outerHTML snippet 匹配 source 位置
- 保存时不写入 `data-xk-edit-id`，source 保持干净
- Undo/redo 基于完整 source snapshot（不依赖 id 重新定位）

#### 决策 9：PostMessage 协议完整表

| 消息类型 | 方向 | Payload | 触发时机 |
|---|---|---|---|
| `xiaok:setEditMode` | host → iframe | `{ enabled: boolean }` | 用户点击编辑按钮 |
| `xiaok:editReady` | iframe → host | `{ elementCount: number }` | edit-bridge 标注完成 |
| `xiaok:editHover` | iframe → host | `{ id: string, rect: DOMRect } \| null` | 鼠标移入/移出可编辑元素 |
| `xiaok:editSelect` | iframe → host | `EditTarget` | 点击可编辑元素 |
| `xiaok:editDeselect` | iframe → host | `{}` | 点击空白区域 |
| `xiaok:applyOverride` | host → iframe | `{ id: string, kind: PatchKind, payload }` | 用户在 Inspector 中修改值 |
| `xiaok:overrideApplied` | iframe → host | `{ id: string, success: boolean }` | iframe 确认 live preview |
| `xiaok:elementPositions` | iframe → host | `ElementPositionMap` | edit mode 进入时 + 每次 override 后更新 |

#### 决策 10：Phase 1 scope 修正

**从 Phase 2 提前到 Phase 1 的项目**：
- dirty guard（未保存时切换模式/关闭窗口弹确认）
- beforeunload 拦截
- 模式切换互斥守卫

**从 Phase 1 延后的项目**：
- `set-image` 的本地图片选择（Phase 1 仅支持 URL 输入 + alt 编辑）

**从 Phase 3 移除的项目**：
- 幻灯片编辑（需要独立 sub-design，当前方案不成熟）

修订后的 Phase 划分：

**Phase 1（MVP）— 4-5 天**：
- [ ] artifact-sdk.ts 扩展 edit mode（元素发现 + hover/select + target 上报）
- [ ] source-patcher（局部替换方案：set-text, set-link）
- [ ] Inspector 面板（text + link 编辑）
- [ ] Canvas toolbar 编辑按钮 + 三态互斥
- [ ] saveFile 安全校验扩展 + write guard
- [ ] Undo/redo（diff-based 存储）
- [ ] Dirty guard + beforeunload
- [ ] Structural element protection

**Phase 2 — 3-4 天**：
- [ ] 图片编辑（pickAndEmbedImage IPC + 图片预处理管道）
- [ ] 样式编辑（字体、颜色、间距）
- [ ] outerHTML 源码编辑（DOMPurify 消毒）
- [ ] 删除元素
- [ ] AI 上下文注入（patch summary message）

**Phase 3 — 2-3 天**：
- [ ] 导出编辑后的 HTML/PDF（走现有 MCP plugin）
- [ ] 编辑模式快捷键（Ctrl+E 进入/退出，Ctrl+Z/Y undo/redo）
- [ ] 批量选择 + 批量样式修改

**Future（独立设计）**：
- [ ] 幻灯片 per-slide 编辑器
- [ ] 与 KSwarm deliverable 联动

### B.3 四方达成的共识

1. **安全红线**：不升级 sandbox、IPC 写入必须有 realpath + 白名单校验、`set-outer-html` 必须 DOMPurify 消毒
2. **源码保真度**：优先 regex 局部替换，仅 DOM 结构变更（remove/replace outerHTML）走 DOMParser fallback
3. **与现有系统关系**：扩展 artifact-sdk 而非新增脚本；复用 saveFile IPC 而非新增 channel
4. **Slide 不在 MVP 范围内**：幻灯片的多页/导航/布局复杂度需要独立设计
5. **AI 感知编辑**：保存时必须生成 changeset summary 注入对话上下文
6. **data-xk-edit-id 不污染产物**：运行时 WeakMap，保存文件绝不含编辑标注属性
7. **Phase 1 必须包含 dirty guard**：未保存修改的切换/关闭保护不是"锦上添花"，是基本可用性
8. **编辑标记**：保存后的 HTML 追加 `<meta name="xk-manual-edit">` 让下游工具识别

### B.4 遗留风险（接受的 trade-off）

| 风险 | 影响 | 接受理由 |
|---|---|---|
| 局部替换方案对嵌套 HTML 结构复杂度高 | set-text 在包含子元素时可能误判 innerHTML 边界 | 可编辑元素规则已限制为叶子节点（无子元素），容器级编辑走 DOMParser |
| ir-hash 失效后 AI 无法 re-render 原始主题 | 用户换主题时需重新生成 | 编辑保存时追加 meta 标记，AI prompt 可据此决定是否保留编辑 |
| Undo stack 在大文件下仍有内存压力 | 50 步 × diff ≈ 合理范围 | diff-based 存储已将内存从 10MB 降到 ~500KB |
| annotation 和 edit 的用户认知差异 | 新手可能困惑 | Phase 1 通过明确 tooltip + 首次使用引导缓解 |
